export const STEP_MINUTES = 30;
export const DEFAULT_STEPS = 16;

export type RedditBand = 'top5' | 'top25' | 'rising' | 'new';
export const BAND_ORDER: readonly RedditBand[] = [
  'top5',
  'top25',
  'rising',
  'new'
];

/**
 * Reddit "hot", `sign · log10(max(|score|, 1)) + t / 45000`, taken relative to now: what pushes a post down the
 * list is newer posts' larger `t`, so a post loses 1 per 45000 s (12.5 h) of age.
 */
export function hotScore(score: number, ageHours: number): number {
  return (
    Math.sign(score) * Math.log10(Math.max(Math.abs(score), 1)) -
    (ageHours * 3600) / 45000
  );
}

/**
 * hotScore cut-offs for the post's position in a mid-sized launch subreddit's hot list, from the 2026-10-20
 * backtest (the old 1.6/0.9/0.3 sent every thread to top 5 within an hour):
 * ~100+ points in the first hours ≈ top 5; ~20+ ≈ top 25; ~4+ ≈ rising.
 */
export const BAND_THRESHOLDS = { top5: 2.0, top25: 1.3, rising: 0.6 } as const;

export function bandFor(hot: number): RedditBand {
  if (hot >= BAND_THRESHOLDS.top5) return 'top5';
  if (hot >= BAND_THRESHOLDS.top25) return 'top25';
  if (hot >= BAND_THRESHOLDS.rising) return 'rising';
  return 'new';
}

/** Share of the subreddit's population that opens the thread during one step in this band. */
export function visitorFraction(band: RedditBand, step: number): number {
  switch (band) {
    case 'top5':
      return 0.5;
    case 'top25':
      return 0.3;
    case 'rising':
      return 0.15;
    case 'new':
      return step < 2 ? 0.15 : 0.05;
  }
}
