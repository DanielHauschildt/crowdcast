import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { emptyThread } from '../../thread.js';
import { loadPlatform } from '../index.js';
import { LINKEDIN_DISCLAIMER } from './index.js';
import { DEFAULT_REACH } from './reach.js';

const BANDS = ['viral', 'expanding', 'test', 'network', 'fading'];

describe('linkedin platform', () => {
  it('loads via loadPlatform and satisfies the Platform interface', async () => {
    const p: Platform = await loadPlatform('linkedin');
    expect(p.id).toBe('linkedin');
    expect(p.stepMinutes).toBe(120);
    expect(p.defaultSteps).toBe(18);
    expect(p.votes).toEqual([
      'like',
      'celebrate',
      'support',
      'love',
      'insightful',
      'funny',
      'repost',
      'none'
    ]);
    expect(p.commentVote).toBe('like');
    expect(p.bands).toEqual(BANDS);
    expect(p.frontPage).toEqual(['viral', 'expanding']);
    const s = emptyThread(makePost());
    expect(p.visibility(s, 0).band).toBe('test');
    expect(p.agentSystem(makePersona(1))).toContain('LinkedIn');
    expect(p.reportTitle(makePost({ title: 'X' }))).toBe(
      'LinkedIn rehearsal: X'
    );
    expect(p.fetchReference).toBeUndefined();
  });

  it('says it is not validated against real data', async () => {
    const p = await loadPlatform('linkedin');
    expect(p.disclaimer).toBe(LINKEDIN_DISCLAIMER);
    expect(LINKEDIN_DISCLAIMER).toMatch(
      /^LinkedIn mode is not validated against real data/
    );
  });

  it('sizes the test slice by the larger of followers and connections, with a default network', async () => {
    const p = await loadPlatform('linkedin');
    const s = emptyThread(makePost());
    const frac = (n: number): number =>
      (n * DEFAULT_REACH.testSlice) /
      DEFAULT_REACH.testSteps /
      DEFAULT_REACH.audiencePool;
    expect(p.visibility(s, 0).visitorFraction).toBeCloseTo(frac(1000));
    expect(p.visibility(s, 0, { followers: 2000 }).visitorFraction).toBeCloseTo(
      frac(2000)
    );
    const q = await loadPlatform('linkedin', { connections: 3000 });
    expect(q.visibility(s, 0).visitorFraction).toBeCloseTo(frac(3000));
    expect(q.visibility(s, 0, { followers: 2000 }).visitorFraction).toBeCloseTo(
      frac(3000)
    );
  });

  it('takes the network from author.connections and the audience into the prompts', async () => {
    const author = {
      followers: 500,
      connections: 3000,
      audience: 'data leads at mid-sized companies'
    };
    const p = await loadPlatform('linkedin', {}, author);
    expect(
      p.visibility(emptyThread(makePost()), 0, author).visitorFraction
    ).toBeCloseTo(
      (3000 * DEFAULT_REACH.testSlice) /
        DEFAULT_REACH.testSteps /
        DEFAULT_REACH.audiencePool
    );
    for (const prompt of [
      p.personaSystem,
      p.voterPersonaSystem,
      p.founderSystem(2)
    ])
      expect(prompt).toContain('data leads at mid-sized companies');
    expect((await loadPlatform('linkedin')).personaSystem).not.toContain(
      'mostly'
    );
  });

  it('applies platform.yaml options: headline, connections and reach constants', async () => {
    const p = await loadPlatform('linkedin', {
      headline: 'Founder at Tablecraft',
      testSlice: 0.1
    });
    expect(p.agentSystem(makePersona(1))).toContain('Founder at Tablecraft');
    expect(p.founderSystem(2)).toMatch(
      /Founder at Tablecraft.*At most 2 replies/s
    );
    expect(
      p.visibility(emptyThread(makePost()), 0).visitorFraction
    ).toBeCloseTo(
      (1000 * 0.1) / DEFAULT_REACH.testSteps / DEFAULT_REACH.audiencePool
    );
    await expect(loadPlatform('linkedin', { connections: -1 })).rejects.toThrow(
      /platform.yaml: "connections" must be an integer ≥ 0/
    );
    await expect(loadPlatform('linkedin', { testSlice: 0 })).rejects.toThrow(
      /platform.yaml: "testSlice" must be a number > 0/
    );
    await expect(loadPlatform('linkedin', { headline: 3 })).rejects.toThrow(
      /platform.yaml: "headline" must be a non-empty string/
    );
    await expect(loadPlatform('linkedin', { karma: 3 })).rejects.toThrow(
      /platform.yaml: unknown linkedin key "karma"/
    );
  });
});

/** Agents react and comment once (p1, p2 repost); voters celebrate the post and like c1. */
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
      vote: /p[12]$/.test(req.label) ? 'repost' : 'insightful',
      upvoteComments: [],
      comment: commented
        ? null
        : {
            parent: 'post',
            text: 'How does this fit into our reporting stack?'
          },
      leave: commented
    };
  }
  if (req.label.startsWith('voters:')) {
    const ids = [...req.prompt.matchAll(/- (v\d+):/g)].map((m) => m[1]);
    return {
      ballots: ids.map((voterId) => ({
        voterId,
        postVote: 'celebrate',
        commentVotes: [{ id: 'c1', vote: 'like' }]
      }))
    };
  }
  if (req.label.startsWith('founder:'))
    return {
      replies: [
        {
          parent: 'c1',
          text: 'It reads CSV exports directly, happy to show you.'
        }
      ]
    };
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

describe('linkedin end to end', () => {
  it('runs the example seed through engine, metrics and report on the linkedin platform', async () => {
    const root = mkdtempSync(join(tmpdir(), 'linkedin-'));
    const seedDir = join(root, 'seeds', 'linkedin-tablecraft');
    cpSync(
      fileURLToPath(
        new URL('../../../examples/linkedin-tablecraft', import.meta.url)
      ),
      seedDir,
      { recursive: true }
    );
    writeFileSync(
      join(seedDir, 'platform.yaml'),
      'platform: linkedin\nauthor:\n  followers: 4000\nheadline: Data lead at Acme\n'
    );
    const llms: FakeLlm[] = [];
    const logs: string[] = [];
    const code = await main(['run', seedDir, '--steps', '3'], {
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
    expect(JSON.parse(read('run.json'))).toMatchObject({
      platform: 'linkedin',
      author: { followers: 4000 },
      options: { headline: 'Data lead at Acme' }
    });
    const prompts = llms.flatMap((l) => l.requests.map((r) => r.system));
    expect(prompts.some((s) => s.includes('Data lead at Acme'))).toBe(true);
    expect(prompts.some((s) => s.includes('Hacker News'))).toBe(false);
    const m = JSON.parse(read('metrics.json')) as Metrics;
    // A step's band is the reach of the next step: test slice, then expansion.
    expect(m.steps[0]!.band).toBe('test');
    expect(m.steps[1]!.band).not.toBe('test');
    for (const st of m.steps) expect(BANDS).toContain(st.band);
    expect(read('events.jsonl')).toContain('"value":"repost"');
    expect(read('report.md')).toContain('# LinkedIn rehearsal:');
    for (const f of ['report.md', 'thread.md'])
      expect(read(f).split('\n')[0]).toContain(LINKEDIN_DISCLAIMER);
  });
});
