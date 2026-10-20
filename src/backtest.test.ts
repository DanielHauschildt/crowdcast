import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makePersona, makeSeed, makeVoter } from '../test/fixtures.js';
import {
  backtestThread,
  founderAnswersFor,
  labelMix,
  loadOrFetchThread,
  realThreadText,
  spearman,
  tvDistance
} from './backtest.js';
import type { FetchFn, RealThread } from './hn.js';
import { LABELS, type CommentLabel } from './label.js';
import { FakeLlm, type LlmRequest } from './llm.js';
import hn from './platforms/hn/index.js';
import { ageHours } from './schedule.js';
import type { PersonaSet } from './types.js';

const mixArb = fc
  .array(fc.tuple(fc.constantFrom(...LABELS), fc.nat(20)), { maxLength: 12 })
  .map((pairs) => Object.fromEntries(pairs));

describe('tvDistance', () => {
  it('lies in [0, 1], is symmetric, and is 0 for identical mixes', () => {
    fc.assert(
      fc.property(mixArb, mixArb, (p, q) => {
        const d = tvDistance(p, q);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1 + 1e-9);
        expect(d).toBeCloseTo(tvDistance(q, p), 9);
        expect(tvDistance(p, p)).toBeCloseTo(0, 9);
      })
    );
  });

  it('compares shares, not counts, and is 1 for disjoint mixes', () => {
    expect(tvDistance({ praise: 1, other: 1 }, { praise: 5, other: 5 })).toBe(
      0
    );
    expect(tvDistance({ praise: 3 }, { question: 2 })).toBe(1);
    expect(tvDistance({ praise: 1 }, { praise: 1, question: 1 })).toBe(0.5);
  });

  it('is 0 for two empty mixes and 1 when only one side is empty', () => {
    expect(tvDistance({}, {})).toBe(0);
    expect(tvDistance({}, { praise: 1 })).toBe(1);
  });
});

describe('spearman', () => {
  const series = fc
    .array(fc.tuple(fc.integer(), fc.integer()), {
      minLength: 3,
      maxLength: 20
    })
    .map((ps) => ({ xs: ps.map((p) => p[0]), ys: ps.map((p) => p[1]) }));

  it('lies in [-1, 1] or is null when a side is constant', () => {
    fc.assert(
      fc.property(series, ({ xs, ys }) => {
        const r = spearman(xs, ys);
        if (r === null) return;
        expect(r).toBeGreaterThanOrEqual(-1 - 1e-9);
        expect(r).toBeLessThanOrEqual(1 + 1e-9);
      })
    );
  });

  it('is 1 for any increasing map and -1 for any decreasing one', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: -1000, max: 1000 }), {
          minLength: 3,
          maxLength: 20
        }),
        (xs) => {
          expect(
            spearman(
              xs,
              xs.map((x) => x * 3 + 1)
            )
          ).toBeCloseTo(1, 9);
          expect(
            spearman(
              xs,
              xs.map((x) => -x)
            )
          ).toBeCloseTo(-1, 9);
        }
      )
    );
  });

  it('handles ties with average ranks and needs three points', () => {
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9487, 3);
    expect(spearman([1, 2], [2, 1])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe('labelMix', () => {
  it('turns labels into shares that sum to 1', () => {
    const labels: CommentLabel[] = [
      { id: 'a', label: 'praise', sentiment: 1 },
      { id: 'b', label: 'praise', sentiment: 1 },
      { id: 'c', label: 'question', sentiment: 0 },
      { id: 'd', label: 'other', sentiment: -1 }
    ];
    expect(labelMix(labels)).toEqual({
      praise: 0.5,
      question: 0.25,
      other: 0.25
    });
    expect(labelMix([])).toEqual({});
  });
});

const real: RealThread = {
  id: 7,
  post: {
    title: 'Show HN: Widget',
    url: 'https://widget.dev',
    body: 'We made a widget.',
    firstComment: null
  },
  comments: [
    {
      id: '11',
      parent: 'post',
      author: 'bob',
      createdAt: 't1',
      text: 'Pricing?'
    },
    {
      id: '12',
      parent: '11',
      author: 'op',
      createdAt: 't2',
      text: 'Free tier.'
    },
    { id: '13', parent: '12', author: 'carol', createdAt: 't3', text: 'Nice.' },
    { id: '14', parent: 'post', author: 'op', createdAt: 't4', text: 'AMA.' }
  ],
  points: 120,
  op: 'op',
  context: 'Widget README'
};

describe('founderAnswersFor / realThreadText', () => {
  it("concatenates the OP's own comments", () => {
    const a = founderAnswersFor(real);
    expect(a).toContain('Free tier.');
    expect(a).toContain('AMA.');
    expect(a).not.toContain('Pricing?');
    expect(founderAnswersFor({ ...real, comments: [] })).toMatch(/no comments/);
  });

  it('renders the tree with depth, marks the OP and respects the cap', () => {
    const t = realThreadText(real, 10_000);
    expect(t).toContain('[11] bob: Pricing?');
    expect(t).toContain('  [12] OP: Free tier.');
    expect(t).toContain('    [13] carol: Nice.');
    expect(realThreadText(real, 40).length).toBeLessThanOrEqual(40);
  });
});

describe('loadOrFetchThread', () => {
  it('fetches once and caches real.json and context.md', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'bt-')), 'threads', '7');
    let calls = 0;
    const fetchFn: FetchFn = async (url) => {
      calls++;
      if (url.endsWith('/items/7'))
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              id: 7,
              author: 'op',
              created_at: 't0',
              parent_id: null,
              title: 'Show HN: Widget',
              url: null,
              text: 'We made a widget.',
              points: 120,
              children: []
            })
        };
      return { ok: false, status: 404, text: async () => '' };
    };
    const a = await loadOrFetchThread(dir, 7, fetchFn);
    const b = await loadOrFetchThread(dir, 7, fetchFn);
    expect(calls).toBe(1);
    expect(b).toEqual(a);
    expect(readFileSync(join(dir, 'context.md'), 'utf8')).toBe(
      'We made a widget.'
    );
  });
});

const personas: PersonaSet = {
  personas: Array.from({ length: 20 }, (_, i) =>
    makePersona(i + 1, { activity: 1 })
  ),
  voters: Array.from({ length: 40 }, (_, i) => makeVoter(i + 1))
};

function world(req: LlmRequest<unknown>): unknown {
  if (req.label.startsWith('agent:'))
    return {
      vote: 'up',
      upvoteComments: [],
      comment: { parent: 'post', text: `pricing? from ${req.label}` },
      leave: true
    };
  if (req.label.startsWith('voters:')) {
    const ids = [...req.prompt.matchAll(/- (v\d+):/g)].map((m) => m[1]);
    return {
      ballots: ids.map((voterId) => ({
        voterId,
        postVote: 'up',
        commentVotes: []
      }))
    };
  }
  if (req.label.startsWith('founder:')) return { replies: [] };
  if (req.label.startsWith('labels')) {
    const ids = [...req.prompt.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
    return {
      labels: ids.map((id) => ({
        id,
        label: id!.startsWith('c') ? 'pricing/licensing' : 'praise',
        sentiment: id!.startsWith('c') ? -1 : 1
      }))
    };
  }
  if (req.label === 'themes')
    return { themes: ['pricing', 'performance', 'licence'] };
  if (req.label === 'theme-recall') return { raised: [true, false, false] };
  throw new Error(`unexpected ${req.label}`);
}

describe('backtestThread', () => {
  it('simulates from the post alone, scores against the real thread and caches real-side work', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bt-'));
    const threadDir = join(root, 'threads', '7');
    const run = (runDir: string, llm: FakeLlm) =>
      backtestThread({
        llm,
        real,
        threadDir,
        runDir,
        seed: makeSeed({ dir: threadDir, name: 'hn-7' }),
        personas,
        steps: 2,
        rngSeed: 1
      });
    const llm = new FakeLlm(world);
    const s = await run(join(root, 'runs', 'a'), llm);

    expect(s.aborted).toBeNull();
    expect(s.realPoints).toBe(120);
    expect(s.simPoints).toBeGreaterThan(1);
    expect(s.realComments).toBe(2);
    expect(s.simComments).toBeGreaterThan(0);
    expect(s.commentRatio).toBe(s.simComments / 2);
    expect(s.themes).toEqual([
      { theme: 'pricing', raised: true },
      { theme: 'performance', raised: false },
      { theme: 'licence', raised: false }
    ]);
    expect(s.recall).toBeCloseTo(1 / 3);
    expect(s.tv).toBe(1);
    expect(s.realSentiment).toBe(1);
    expect(s.simSentiment).toBe(-1);
    expect(s.sentimentGap).toBe(-2);
    for (const f of [
      'events.jsonl',
      'run.json',
      'personas.json',
      'labels.json',
      'metrics.json',
      'thread.md',
      'score.json'
    ])
      expect(existsSync(join(root, 'runs', 'a', f))).toBe(true);
    expect(existsSync(join(threadDir, 'labels.json'))).toBe(true);
    expect(existsSync(join(threadDir, 'themes.json'))).toBe(true);

    const meta = JSON.parse(
      readFileSync(join(root, 'runs', 'a', 'run.json'), 'utf8')
    ) as { founderAnswers: string };
    expect(meta.founderAnswers).toContain('Free tier.');
    const agentPrompt = llm.requests.find((r) => r.label.startsWith('agent:'));
    expect(agentPrompt?.prompt).not.toContain('Pricing?');

    const again = new FakeLlm(world);
    await run(join(root, 'runs', 'b'), again);
    const labels = again.requests.map((r) => r.label);
    expect(labels).not.toContain('themes');
    expect(
      again.requests.some(
        (r) => r.label.startsWith('labels') && r.prompt.includes('[11]')
      )
    ).toBe(false);
  });

  it('scores a run that aborted, marking it aborted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bt-'));
    const llm = new FakeLlm((req) =>
      req.label.startsWith('agent:') ? new Error('boom') : world(req)
    );
    const s = await backtestThread({
      llm,
      real,
      threadDir: join(root, 'threads', '7'),
      runDir: join(root, 'runs', 'x'),
      seed: makeSeed({ name: 'hn-7' }),
      personas,
      steps: 2,
      rngSeed: 1
    });
    expect(s.aborted).toMatch(/error rate/);
  });

  it('truncates a hot thread at its simulation budget, then still scores and marks it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bt-'));
    const runDir = join(root, 'runs', 'hot');
    const hot = {
      ...hn,
      visibility: () => ({ band: hn.bands[0]!, visitorFraction: 1 })
    };
    const llm = new FakeLlm(world);
    const s = await backtestThread({
      llm,
      real,
      threadDir: join(root, 'threads', '7'),
      runDir,
      seed: makeSeed({ name: 'hn-7' }),
      personas,
      steps: 3,
      rngSeed: 1,
      platform: hot,
      maxCalls: 25
    });
    expect(s.aborted).toBeNull();
    expect(s.truncatedAtStep).toBe(1);
    expect(s.hours).toBe(ageHours(1, hn.stepMinutes));
    expect(s.simComments).toBe(20);
    expect(s.recall).toBeCloseTo(1 / 3);
    const sim = llm.requests.filter((r) =>
      /^(agent|voters|founder):/.test(r.label)
    );
    expect(sim.length).toBeLessThanOrEqual(25);
    expect(llm.requests.map((r) => r.label)).toContain('theme-recall');
    const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as {
      truncatedAtStep?: number;
    };
    expect(meta.truncatedAtStep).toBe(1);
    const saved = JSON.parse(
      readFileSync(join(runDir, 'score.json'), 'utf8')
    ) as { truncatedAtStep: number };
    expect(saved.truncatedAtStep).toBe(1);
  });

  it('skips a thread with too few real replies before spending any call', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bt-'));
    const runDir = join(root, 'runs', 'quiet');
    const llm = new FakeLlm(world);
    const s = await backtestThread({
      llm,
      real: {
        ...real,
        comments: real.comments.filter((c) => c.author === 'op')
      },
      threadDir: join(root, 'threads', '7'),
      runDir,
      seed: makeSeed({ name: 'hn-7' }),
      personas,
      steps: 2,
      rngSeed: 1,
      minRealComments: 3
    });
    expect(llm.callCount).toBe(0);
    expect(s.skipped).toBe('skipped: 0 real replies');
    expect(s.realComments).toBe(0);
    expect(s.recall).toBeNull();
    expect(existsSync(join(runDir, 'score.json'))).toBe(true);
    expect(existsSync(join(runDir, 'events.jsonl'))).toBe(false);
  });

  it('scores recall as n/a when theme extraction fails instead of failing the thread', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bt-'));
    const llm = new FakeLlm((req) =>
      req.label === 'themes' ? { themes: [] } : world(req)
    );
    const s = await backtestThread({
      llm,
      real,
      threadDir: join(root, 'threads', '7'),
      runDir: join(root, 'runs', 'nothemes'),
      seed: makeSeed({ name: 'hn-7' }),
      personas,
      steps: 1,
      rngSeed: 1
    });
    expect(s.themes).toEqual([]);
    expect(s.recall).toBeNull();
    expect(s.tv).toBe(1);
    expect(llm.requests.map((r) => r.label)).not.toContain('theme-recall');
  });
});
