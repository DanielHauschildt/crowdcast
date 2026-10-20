import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ThreadScore } from './backtest.js';
import { DISCLAIMER } from './report.js';
import {
  aggregate,
  bootstrapInterval,
  historyRow,
  HISTORY_HEADER,
  isHoldout,
  parseThreadList,
  scorecardMarkdown,
  selectIds
} from './scorecard.js';

const score = (
  id: number,
  realPoints: number,
  simPoints: number,
  over: Partial<ThreadScore> = {}
): ThreadScore => ({
  id,
  title: `Show HN: T${id}`,
  runDir: `/runs/${id}`,
  aborted: null,
  hours: 2,
  realPoints,
  simPoints,
  realComments: 10,
  simComments: 5,
  commentRatio: 0.5,
  themes: [
    { theme: 'pricing', raised: true },
    { theme: 'perf', raised: false }
  ],
  recall: 0.5,
  tv: 0.4,
  realMix: { praise: 1 },
  simMix: { praise: 0.6, question: 0.4 },
  realSentiment: 0.5,
  simSentiment: 0,
  sentimentGap: -0.5,
  ...over
});

describe('parseThreadList', () => {
  it('reads one id per line and ignores comments and blanks', () => {
    expect(
      parseThreadList('# header\n41853810  # Graphite, 785\n\n  44127653\n')
    ).toEqual([41853810, 44127653]);
  });

  it('names the line it cannot read', () => {
    expect(() => parseThreadList('123\nabc # x\n')).toThrow(/line 2/);
  });
});

describe('train/holdout split', () => {
  const ids = Array.from({ length: 2000 }, (_, i) => 40_000_000 + i * 977);

  it('is a deterministic ~30% hash split of the id', () => {
    expect(ids.map(isHoldout)).toEqual(ids.map(isHoldout));
    const share = ids.filter(isHoldout).length / ids.length;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.35);
  });

  it('keeps the committed lists disjoint, and every holdout id hashes to holdout', () => {
    const read = (f: string) =>
      parseThreadList(
        readFileSync(
          new URL(`../simulations/backtests/${f}`, import.meta.url),
          'utf8'
        )
      );
    const train = read('threads.txt');
    const holdout = read('holdout.txt');
    expect(train.length + holdout.length).toBeGreaterThanOrEqual(100);
    expect(new Set([...train, ...holdout]).size).toBe(
      train.length + holdout.length
    );
    expect(holdout.every(isHoldout)).toBe(true);
  });
});

describe('selectIds', () => {
  const ids = [11, 22, 33, 44, 55, 66, 77, 88];

  it('returns every id, in list order, without sample or limit', () => {
    expect(selectIds(ids, { seed: 1 })).toEqual(ids);
  });

  it('samples a reproducible subset per seed, kept in list order', () => {
    const a = selectIds(ids, { sample: 3, seed: 7 });
    expect(a).toHaveLength(3);
    expect(a).toEqual(selectIds(ids, { sample: 3, seed: 7 }));
    expect(a).toEqual(ids.filter((id) => a.includes(id)));
    const seeds = [1, 2, 3, 4, 5].map((seed) =>
      selectIds(ids, { sample: 3, seed }).join()
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it('applies the limit after sampling', () => {
    expect(selectIds(ids, { limit: 2, seed: 1 })).toEqual([11, 22]);
    expect(selectIds(ids, { sample: 4, limit: 2, seed: 3 })).toEqual(
      selectIds(ids, { sample: 4, seed: 3 }).slice(0, 2)
    );
  });
});

describe('bootstrapInterval', () => {
  const mean = (xs: readonly number[]) =>
    xs.reduce((a, x) => a + x, 0) / xs.length;
  const xs = [0.1, 0.4, 0.35, 0.8, 0.2, 0.55, 0.05, 0.6, 0.3, 0.45];

  it('contains the point estimate and is reproducible for a fixed seed', () => {
    const ci = bootstrapInterval(xs, mean, 1)!;
    expect(ci.lo).toBeLessThanOrEqual(mean(xs));
    expect(ci.hi).toBeGreaterThanOrEqual(mean(xs));
    expect(ci.lo).toBeLessThan(ci.hi);
    expect(bootstrapInterval(xs, mean, 1)).toEqual(ci);
    expect(bootstrapInterval(xs, mean, 2)).not.toEqual(ci);
  });

  it('collapses for one value and is null for none', () => {
    expect(bootstrapInterval([0.3], mean, 1)).toEqual({ lo: 0.3, hi: 0.3 });
    expect(bootstrapInterval([], mean, 1)).toBeNull();
  });
});

describe('aggregate', () => {
  it('averages completed threads and ranks points across the set', () => {
    const a = aggregate([
      score(1, 10, 2),
      score(2, 100, 20, { recall: 1, tv: 0.2, commentRatio: 1 }),
      score(3, 50, 9, { commentRatio: 2, sentimentGap: 0.5 })
    ]);
    expect(a.completed).toBe(3);
    expect(a.recall).toBeCloseTo(2 / 3);
    expect(a.tv).toBeCloseTo((0.4 + 0.2 + 0.4) / 3);
    expect(a.spearman).toBe(1);
    expect(a.commentRatio).toBe(1);
    expect(a.sentimentGap).toBeCloseTo(-0.5 / 3);
  });

  it('leaves aborted threads out of every number and lists them', () => {
    const a = aggregate([
      score(1, 10, 2),
      score(2, 100, 1, { aborted: 'budget', tv: 1 }),
      score(3, 50, 9),
      score(4, 70, 12)
    ]);
    expect(a.completed).toBe(3);
    expect(a.aborted).toEqual([2]);
    expect(a.tv).toBeCloseTo(0.4);
    expect(a.spearman).toBe(1);
  });

  it('adds 90% intervals for recall and TV, and a geometric mean comment ratio', () => {
    const scores = [1, 2, 3, 4, 5, 6].map((i) =>
      score(i, i * 10, i, {
        recall: i / 6,
        tv: 1 - i / 10,
        commentRatio: i % 2 ? 0.5 : 2
      })
    );
    const a = aggregate(scores);
    expect(a.recallCi!.lo).toBeLessThanOrEqual(a.recall!);
    expect(a.recallCi!.hi).toBeGreaterThanOrEqual(a.recall!);
    expect(a.tvCi!.lo).toBeLessThanOrEqual(a.tv!);
    expect(a.tvCi!.hi).toBeGreaterThanOrEqual(a.tv!);
    expect(a.commentRatioMean).toBeCloseTo(1);
    expect(a.commentRatioCi!.lo).toBeLessThanOrEqual(1);
    expect(a.commentRatioCi!.hi).toBeGreaterThanOrEqual(1);
    expect(aggregate(scores)).toEqual(a);
  });

  it('floors a zero comment ratio instead of letting the log mean go to -Infinity', () => {
    const a = aggregate([
      score(1, 10, 2, { commentRatio: 0 }),
      score(2, 20, 3, { commentRatio: 1 })
    ]);
    expect(a.commentRatioMean).toBeCloseTo(0.1);
    expect(Number.isFinite(a.commentRatioCi!.lo)).toBe(true);
  });

  it('reports null, never NaN, for an empty set', () => {
    const a = aggregate([]);
    expect(a.recall).toBeNull();
    expect(a.tv).toBeNull();
    expect(a.spearman).toBeNull();
    expect(a.commentRatio).toBeNull();
    expect(a.sentimentGap).toBeNull();
    expect(a.recallCi).toBeNull();
    expect(a.commentRatioMean).toBeNull();
    expect(a.commentRatioCi).toBeNull();
  });
});

describe('scorecardMarkdown', () => {
  it('opens with the disclaimer and shows the aggregate, every thread and its themes', () => {
    const scores = [score(1, 10, 2), score(2, 100, 1, { aborted: 'budget' })];
    const md = scorecardMarkdown(scores, aggregate(scores), {
      stamp: '20261004-1200',
      steps: 6,
      seed: 1,
      set: 'holdout'
    });
    expect(md.split('\n')[0]).toBe(DISCLAIMER);
    expect(md).toContain('points @ 2h');
    expect(md).toContain('| 1 | Show HN: T1 | 10 | 2 |');
    expect(md).toContain('aborted: budget');
    expect(md).toContain('- ✓ pricing');
    expect(md).toContain('- ✗ perf');
    expect(md).not.toContain('NaN');
    expect(md).toContain('2 real Show HN threads (holdout set)');
    expect(md).toMatch(/50% \[50%–50%\]/);
    expect(
      scorecardMarkdown(scores, aggregate(scores), {
        stamp: 'x',
        steps: 2,
        seed: 1,
        set: 'train'
      })
    ).toContain('points @ 0.7h');
    expect(
      scorecardMarkdown(scores, aggregate(scores), {
        stamp: 'x',
        steps: 2,
        seed: 1,
        set: 'train',
        platform: 'bluesky'
      })
    ).toContain('2 real bluesky threads (train set)');
  });
});

describe('historyRow', () => {
  it('matches the header column count and records the set and n', () => {
    const scores = [score(1, 10, 2), score(2, 20, 3, { aborted: 'budget' })];
    const row = historyRow(aggregate(scores), {
      stamp: '20261004-1200',
      steps: 6,
      seed: 1,
      set: 'holdout',
      n: scores.length,
      note: 'baseline'
    });
    const cols = (s: string) => s.split('|').length;
    expect(cols(row)).toBe(cols(HISTORY_HEADER.split('\n')[0]!));
    expect(row).toContain('baseline');
    expect(row).toMatch(/\| holdout \| 2 \|$/);
  });
});
