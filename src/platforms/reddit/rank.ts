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
 * hotScore cut-offs for the post's position in a mid-sized launch subreddit's hot list, by hand:
 * ~60+ points in the first hours ≈ top 5; ~10+ ≈ top 25; a few early upvotes ≈ rising.
 */
export const BAND_THRESHOLDS = { top5: 1.6, top25: 0.9, rising: 0.3 } as const;

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
      return 1;
    case 'top25':
      return 0.6;
    case 'rising':
      return 0.3;
    case 'new':
      return step < 2 ? 0.25 : 0.08;
  }
}
