import { describe, expect, it } from 'vitest';
import type { ThreadScore } from './backtest.js';
import { DISCLAIMER } from './report.js';
import {
  aggregate,
  historyRow,
  HISTORY_HEADER,
  parseThreadList,
  scorecardMarkdown
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

  it('reports null, never NaN, for an empty set', () => {
    const a = aggregate([]);
    expect(a.recall).toBeNull();
    expect(a.tv).toBeNull();
    expect(a.spearman).toBeNull();
    expect(a.commentRatio).toBeNull();
    expect(a.sentimentGap).toBeNull();
  });
});

describe('scorecardMarkdown', () => {
  it('opens with the disclaimer and shows the aggregate, every thread and its themes', () => {
    const scores = [score(1, 10, 2), score(2, 100, 1, { aborted: 'budget' })];
    const md = scorecardMarkdown(scores, aggregate(scores), {
      stamp: '20261004-1200',
      steps: 6,
      seed: 1
    });
    expect(md.split('\n')[0]).toBe(DISCLAIMER);
    expect(md).toContain('points @ 2h');
    expect(md).toContain('| 1 | Show HN: T1 | 10 | 2 |');
    expect(md).toContain('aborted: budget');
    expect(md).toContain('- ✓ pricing');
    expect(md).toContain('- ✗ perf');
    expect(md).not.toContain('NaN');
  });
});

describe('historyRow', () => {
  it('matches the header column count', () => {
    const scores = [score(1, 10, 2)];
    const row = historyRow(aggregate(scores), {
      stamp: '20261004-1200',
      steps: 6,
      seed: 1,
      note: 'baseline'
    });
    const cols = (s: string) => s.split('|').length;
    expect(cols(row)).toBe(cols(HISTORY_HEADER.split('\n')[0]!));
    expect(row).toContain('baseline');
  });
});
