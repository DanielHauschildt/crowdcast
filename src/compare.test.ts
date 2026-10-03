import { describe, expect, it } from 'vitest';
import { DISCLAIMER } from './report.js';
import { compareMarkdown, consistentBest, type RunSummary } from './compare.js';
import type { Metrics } from './metrics.js';

const metrics = (finalPoints: number): Metrics => ({
  steps: [],
  peakBand: 'page2',
  frontPage: false,
  finalPoints,
  comments: 3,
  founderReplies: 1,
  maxDepth: 1,
  flagShare: 0,
  objectionMix: { 'vs-image-gen': 0.5, praise: 0.5 },
  sentimentBySegment: {},
  founderEffects: [],
  calls: { total: 10, failed: 0 },
  aborted: null
});

const run = (variant: string, index: number, points: number): RunSummary => ({
  variant,
  index,
  runDir: `/r/${variant}-${index}`,
  metrics: metrics(points),
  topComments: [{ id: 'c1', text: 'top comment', score: 4 }]
});

describe('consistentBest', () => {
  it('returns the variant that wins every run index', () => {
    expect(
      consistentBest(
        [run('a', 1, 10), run('b', 1, 5), run('a', 2, 9), run('b', 2, 3)],
        (m) => m.finalPoints
      )
    ).toBe('a');
  });

  it('returns null when winners differ or tie', () => {
    expect(
      consistentBest(
        [run('a', 1, 10), run('b', 1, 5), run('a', 2, 2), run('b', 2, 3)],
        (m) => m.finalPoints
      )
    ).toBeNull();
    expect(
      consistentBest([run('a', 1, 5), run('b', 1, 5)], (m) => m.finalPoints)
    ).toBeNull();
  });
});

describe('compareMarkdown', () => {
  it('starts with the disclaimer and lists each variant', () => {
    const md = compareMarkdown('seed', [run('a', 1, 10), run('b', 1, 5)]);
    expect(md.split('\n')[0]).toBe(DISCLAIMER);
    expect(md).toContain('## a');
    expect(md).toContain('## b');
    expect(md).toContain('Consistent best by final points: **a**');
  });
});
