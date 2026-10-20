export const STEP_MINUTES = 20;
export const DEFAULT_STEPS = 12;

export type HnBand = 'top10' | 'top30' | 'page2' | 'new';

/**
 * rankScore cut-offs for each band. Calibrated by hand against the HN formula: a post with
 * ~100 points at 4h scores ≈ 3.9 (top 10); ~30 points at 2h ≈ 2.4; ~15 points at 3h ≈ 0.8.
 * Crude on purpose — the sim predicts relative, not absolute, rank.
 */
export const BAND_THRESHOLDS = { top10: 3.0, top30: 1.0, page2: 0.4 } as const;
export const BAND_ORDER: readonly HnBand[] = ['top10', 'top30', 'page2', 'new'];

export function bandFor(score: number): HnBand {
  if (score >= BAND_THRESHOLDS.top10) return 'top10';
  if (score >= BAND_THRESHOLDS.top30) return 'top30';
  if (score >= BAND_THRESHOLDS.page2) return 'page2';
  return 'new';
}

/** Share of the population that opens the thread during one step in this band. */
export function visitorFraction(band: HnBand, step: number): number {
  switch (band) {
    case 'top10':
      return 1;
    case 'top30':
      return 0.75;
    case 'page2':
      return 0.4;
    case 'new':
      return step < 3 ? 0.3 : 0.12;
  }
}

/** HN-style ranking: (points − 1) / (age + 2)^1.8, damped 20% per flag. */
export function rankScore(
  points: number,
  ageHours: number,
  flags: number
): number {
  return (
    (Math.max(points - 1, 0) / Math.pow(ageHours + 2, 1.8)) *
    Math.pow(0.8, flags)
  );
}

/** HN's flamewar detector: > 40 comments and more comments than points costs 40% of the rank. */
export function flamewarFactor(points: number, comments: number): number {
  return comments > 40 && comments > points ? 0.6 : 1;
}
