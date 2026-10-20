export const STEP_MINUTES = 15;
export const DEFAULT_STEPS = 16;

/** Reach constants in likes per step; `fit.ts` estimates them from real posts. */
export interface ReachConstants {
  /** Likes per author follower in the first step. */
  baseReach: number;
  /** Likes per reposter follower in the first step. */
  repostFactor: number;
  halfLifeHours: number;
  /** Share of the post's likes + reposts that are reposts. */
  repostShare: number;
  /** Typical follower count of a reposter or quoter. */
  reposterFollowers: number;
  /** Typical author follower count of the reference posts; backtests use it (RealThread has no author). */
  authorFollowers: number;
}

export const DEFAULT_REACH: ReachConstants = {
  baseReach: 0.002,
  repostFactor: 0.002,
  halfLifeHours: 1,
  repostShare: 0.2,
  reposterFollowers: 1000,
  authorFollowers: 5000
};

/** Share of people who open a post that like it; turns fitted likes into visitors. */
export const LIKE_SHARE = 0.1;

export interface ReachInput {
  followers: number;
  ageHours: number;
  reposts: number;
  /** A quote is a new root post, seen by the quoter's followers. */
  quotes: number;
}

export const decay = (ageHours: number, halfLifeHours: number): number =>
  Math.pow(0.5, ageHours / halfLifeHours);

/** People who see the post during one step at `ageHours`; the cascade decays with the post's age too. */
export function impressions(k: ReachConstants, x: ReachInput): number {
  const likes =
    x.followers * k.baseReach +
    x.quotes * k.reposterFollowers * k.baseReach +
    x.reposts * k.reposterFollowers * k.repostFactor;
  return (likes * decay(x.ageHours, k.halfLifeHours)) / LIKE_SHARE;
}

export function visitorFraction(impressions: number, pool: number): number {
  return Math.min(1, impressions / pool);
}

export const BAND_ORDER = ['viral', 'spreading', 'followers', 'quiet'] as const;

export function bandFor(fraction: number): string {
  if (fraction >= 0.5) return 'viral';
  if (fraction >= 0.2) return 'spreading';
  if (fraction >= 0.05) return 'followers';
  return 'quiet';
}
