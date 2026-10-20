import type { ThreadState } from '../../thread.js';
import { FOUNDER } from '../../types.js';

export const STEP_MINUTES = 120;
export const DEFAULT_STEPS = 18;
const STEP_HOURS = STEP_MINUTES / 60;

export type LinkedinBand =
  'viral' | 'expanding' | 'test' | 'network' | 'fading';
export const BAND_ORDER: readonly LinkedinBand[] = [
  'viral',
  'expanding',
  'test',
  'network',
  'fading'
];

/**
 * The commonly reported LinkedIn mechanism, every constant an unvalidated assumption: the first `testSteps` show the
 * post to `testSlice` of the author's network; afterwards reach is the test slice × `expansion` × the engagement gain,
 * halving every `halfLifeHours`. Fit testSlice and expansion to your own analytics (README.md).
 */
export interface ReachConstants {
  testSlice: number;
  testSteps: number;
  expansion: number;
  halfLifeHours: number;
  /** Engagement per simulated reader at which the post keeps its test-slice reach. */
  baselineRate: number;
  minGain: number;
  maxGain: number;
  /** Impressions per step that bring every simulated persona and voter to the post. */
  audiencePool: number;
}

export const DEFAULT_REACH: ReachConstants = {
  testSlice: 0.05,
  testSteps: 2,
  expansion: 1.5,
  halfLifeHours: 10,
  baselineRate: 0.3,
  minGain: 0.1,
  maxGain: 4,
  audiencePool: 250
};

/** Engagement weights: comments count more than reactions; dwell adds one engagement per DWELL_CHARS read. */
export const WEIGHTS = { reaction: 1, comment: 3 } as const;
export const DWELL_CHARS = 600;

/**
 * Engagement per reader so far. Only agents log visits, so readers and their votes are agents only; silent voters'
 * reactions do not drive expansion. Before anyone has read the post the baseline applies.
 */
export function engagementRate(c: ReachConstants, s: ThreadState): number {
  const readers = s.lastVisit.size;
  if (readers === 0) return c.baselineRate;
  let score = 0;
  for (const actor of s.lastVisit.keys())
    if (s.voted.has(`${actor}|post`)) score += WEIGHTS.reaction;
  for (const comment of s.comments.values()) {
    if (comment.author === FOUNDER) continue;
    score += WEIGHTS.comment + comment.text.length / DWELL_CHARS;
  }
  return score / readers;
}

export const gain = (c: ReachConstants, rate: number): number =>
  Math.min(c.maxGain, Math.max(c.minGain, rate / c.baselineRate));

export function stepImpressions(
  c: ReachConstants,
  network: number,
  step: number,
  g: number
): number {
  const test = (network * c.testSlice) / c.testSteps;
  if (step < c.testSteps) return test;
  const age = (step - c.testSteps) * STEP_HOURS;
  return test * c.expansion * g * 0.5 ** (age / c.halfLifeHours);
}

/** Band by impressions relative to the test slice. */
export function bandFor(
  step: number,
  ratio: number,
  c: ReachConstants
): LinkedinBand {
  if (step < c.testSteps) return 'test';
  if (ratio >= 3) return 'viral';
  if (ratio >= 1) return 'expanding';
  if (ratio >= 0.2) return 'network';
  return 'fading';
}

export function reachAt(
  c: ReachConstants,
  network: number,
  s: ThreadState,
  step: number
): { impressions: number; band: LinkedinBand; visitorFraction: number } {
  const impressions = stepImpressions(
    c,
    network,
    step,
    gain(c, engagementRate(c, s))
  );
  const test = (network * c.testSlice) / c.testSteps;
  return {
    impressions,
    band: bandFor(step, test > 0 ? impressions / test : 0, c),
    visitorFraction: Math.min(1, impressions / c.audiencePool)
  };
}
