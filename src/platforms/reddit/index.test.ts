import { cpSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  makePersona,
  makePost,
  personaHandler
} from '../../../test/fixtures.js';
import { main } from '../../cli.js';
import { FakeLlm, type LlmRequest } from '../../llm.js';
import type { Metrics } from '../../metrics.js';
import type { Platform } from '../../platform.js';
import { emptyThread, type ThreadState } from '../../thread.js';
import type { SimEvent } from '../../types.js';
import { loadPlatform } from '../index.js';

const votes = (s: ThreadState, ups: number, downs: number): ThreadState => {
  s.postUps = ups;
  s.postDowns = downs;
  return s;
};

describe('reddit platform', () => {
  it('loads via loadPlatform and satisfies the Platform interface', async () => {
    const p: Platform = await loadPlatform('reddit');
    expect(p.id).toBe('reddit');
    expect(p.stepMinutes).toBe(30);
    expect(p.defaultSteps).toBe(16);
    expect(p.votes).toEqual(['up', 'down', 'none']);
    expect(p.commentVote).toBe('up');
    expect(p.bands).toEqual(['top5', 'top25', 'rising', 'new']);
    expect(p.frontPage).toEqual(['top5', 'top25']);
    const s = emptyThread(makePost());
    expect(p.visibility(s, 0).band).toBe('new');
    expect(p.rankScore(s, 0)).toBe(0);
    expect(p.agentSystem(makePersona(1))).toContain('r/SideProject');
    expect(p.reportTitle(makePost({ title: 'X' }))).toBe(
      'r/SideProject rehearsal: X'
    );
    expect(typeof p.fetchReference).toBe('function');
  });

  it('ranks by hot score, so downvotes sink the post', async () => {
    const p = await loadPlatform('reddit');
    const post = makePost();
    expect(p.visibility(votes(emptyThread(post), 99, 0), 2).band).toBe('top5');
    expect(
      p.visibility(votes(emptyThread(post), 99, 0), 2).visitorFraction
    ).toBe(1);
    expect(p.visibility(votes(emptyThread(post), 15, 0), 2).band).toBe('top25');
    expect(p.visibility(votes(emptyThread(post), 15, 15), 2).band).toBe('new');
    expect(p.rankScore(votes(emptyThread(post), 9, 0), 0)).toBeCloseTo(1);
    expect(p.rankScore(votes(emptyThread(post), 0, 11), 0)).toBeCloseTo(-1);
  });

  it('applies subreddit and flair from platform.yaml to the prompts', async () => {
    const p = await loadPlatform('reddit', {
      subreddit: 'selfhosted',
      flair: 'Release'
    });
    const sys = p.agentSystem(makePersona(1));
    expect(sys).toContain('r/selfhosted');
    expect(sys).toContain('"Release" post');
    expect(sys).toMatch(/open source/);
    expect(p.voterSystem).toContain('r/selfhosted');
    expect(p.founderSystem(2)).toMatch(/r\/selfhosted.*At most 2 replies/s);
    expect(p.personaPrompt({ id: 'a', share: 1, leanings: 'x' }, 3)).toContain(
      'browse r/selfhosted'
    );
    await expect(loadPlatform('reddit', { subreddit: '' })).rejects.toThrow(
      /platform.yaml: "subreddit"/
    );
    await expect(
      loadPlatform('reddit', { subreddit: 'a', flair: 3 })
    ).rejects.toThrow(/platform.yaml: "flair"/);
    await expect(
      loadPlatform('reddit', { subreddit: 'a', karma: 3 })
    ).rejects.toThrow(/platform.yaml: unknown key "karma"/);
  });
});

/** Agents upvote and comment once; voters up the post and down c1; a few agents down the post. */
function world(req: LlmRequest<unknown>): unknown {
  if (
    req.label.startsWith('personas') ||
    req.label.startsWith('voter-profiles')
  )
    return personaHandler(req);
  if (req.label.startsWith('agent:')) {
    const commented = req.prompt.includes(
      'Your earlier comments in this thread:\n['
    );
    return {
      vote: /p[12]$/.test(req.label) ? 'down' : 'up',
      upvoteComments: [],
      comment: commented
        ? null
        : { parent: 'post', text: 'Is it open source?' },
      leave: commented
    };
  }
  if (req.label.startsWith('voters:')) {
    const ids = [...req.prompt.matchAll(/- (v\d+):/g)].map((m) => m[1]);
    return {
      ballots: ids.map((voterId) => ({
        voterId,
        postVote: 'up',
        commentVotes: [{ id: 'c1', vote: 'down' }]
      }))
    };
  }
  if (req.label.startsWith('founder:'))
    return { replies: [{ parent: 'c1', text: 'Yes, MIT. I built it.' }] };
  if (req.label.startsWith('labels')) {
    const ids = [...req.prompt.matchAll(/^\[(c\d+)\]/gm)].map((m) => m[1]);
    return { labels: ids.map((id) => ({ id, label: 'praise', sentiment: 1 })) };
  }
  if (req.label === 'report')
    return {
      topObjections: 'licence [c1]',
      changes: 'none',
      riskiestComments: 'none',
      founderReplies: 'none',
      hypotheses: 'none'
    };
  throw new Error(`unexpected ${req.label}`);
}

describe('reddit end to end', () => {
  it('runs the example seed through engine, metrics and report on the reddit platform', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reddit-'));
    const seedDir = join(root, 'seeds', 'reddit-tablecraft');
    cpSync('examples/reddit-tablecraft', seedDir, { recursive: true });
    const llms: FakeLlm[] = [];
    const logs: string[] = [];
    const code = await main(['run', seedDir, '--steps', '2'], {
      makeLlm: () => {
        const llm = new FakeLlm(world);
        llms.push(llm);
        return llm;
      },
      now: () => new Date('2026-10-20T09:00:00Z'),
      log: (m: string) => void logs.push(m)
    });
    expect(code, logs.join('\n')).toBe(0);
    const [run] = readdirSync(join(root, 'runs'));
    const dir = join(root, 'runs', run!);
    const read = (f: string): string => readFileSync(join(dir, f), 'utf8');
    expect(JSON.parse(read('run.json'))).toMatchObject({ platform: 'reddit' });
    const prompts = llms.flatMap((l) => l.requests.map((r) => r.system));
    expect(prompts.some((s) => s.includes('r/SideProject'))).toBe(true);
    expect(prompts.some((s) => s.includes('Hacker News'))).toBe(false);
    const m = JSON.parse(read('metrics.json')) as Metrics;
    expect(['top5', 'top25', 'rising', 'new']).toContain(m.peakBand);
    for (const st of m.steps)
      expect(['top5', 'top25', 'rising', 'new']).toContain(st.band);
    // One vote per voter counts, as in the core.
    const postVotes = new Map<string, string>();
    for (const l of read('events.jsonl').trim().split('\n')) {
      const e = JSON.parse(l) as SimEvent;
      if (e.kind === 'vote' && e.target === 'post' && !postVotes.has(e.voter))
        postVotes.set(e.voter, e.value);
    }
    const count = (v: string): number =>
      [...postVotes.values()].filter((x) => x === v).length;
    expect(count('down')).toBeGreaterThan(0);
    expect(m.finalPoints).toBe(1 + count('up') - count('down'));
    expect(read('thread.md')).toMatch(/\[c1\] p\d+ · -\d+ points/);
    expect(read('report.md')).toContain('# r/SideProject rehearsal:');
  });
});
