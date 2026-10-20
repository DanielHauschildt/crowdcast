import {
  answeredByFounder,
  liveComments,
  type ThreadState
} from '../../thread.js';
import { FOUNDER } from '../../types.js';
import { QUOTE_PREFIX } from '../bluesky/prompts.js';

/**
 * Action weights of xai-org/x-algorithm home-mixer/params/param.rs (commit 74d49a4, 2026-10-20), which
 * replaced the 2023 twitter/the-algorithm heavy ranker (reply 13.5, reply engaged by author 75, like 0.5, report −369).
 */
export const WEIGHTS = {
  like: 0.66,
  reply: 5,
  /** BidirectionalFollowReplyWeightBoost, applied to replies the author answered. */
  authorReply: 15,
  repost: 1,
  quote: 5,
  /** param.rs has no bookmark weight. */
  bookmark: 0,
  notInterested: -52.272,
  report: -234
} as const;

export type Engagement = Record<keyof typeof WEIGHTS, number>;

export function engagement(s: ThreadState): Engagement {
  const crowd = liveComments(s).filter((c) => c.author !== FOUNDER);
  const quotes = crowd.filter(
    (c) => c.parent === 'post' && c.text.startsWith(QUOTE_PREFIX)
  ).length;
  return {
    like: s.postReactions.like ?? 0,
    reply: crowd.length - quotes,
    authorReply: crowd.filter((c) => answeredByFounder(s, c.id)).length,
    repost: s.postReactions.repost ?? 0,
    quote: quotes,
    bookmark: s.postReactions.bookmark ?? 0,
    notInterested: s.postDowns,
    report: s.postFlags
  };
}

/** The ranker weighs predicted probabilities; each action's count over the audience pool estimates one. */
export function heavyRankerScore(e: Engagement, pool: number): number {
  let score = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof Engagement)[])
    score += (WEIGHTS[k] * e[k]) / pool;
  return score;
}

/** Non-follower (For You) impressions per step: saturates in the score, none at or below zero. */
export function forYouImpressions(
  score: number,
  reach: number,
  halfScore: number
): number {
  const s = Math.max(0, score);
  return (reach * s) / (s + halfScore);
}
