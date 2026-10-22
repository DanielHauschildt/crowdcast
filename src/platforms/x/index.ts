import type { Platform } from '../../platform.js';
import type { ThreadState } from '../../thread.js';
import type { Post } from '../../types.js';
import { readFit } from '../bluesky/fit.js';
import {
  BAND_ORDER,
  bandFor,
  decay,
  impressions,
  visitorFraction,
  type ReachConstants
} from '../bluesky/reach.js';
import {
  AGENT_RULES,
  agentSystem,
  founderSystem,
  LABEL_SYSTEM,
  PERSONA_SYSTEM,
  personaPrompt,
  RECALL_SYSTEM,
  REPORT_SYSTEM,
  reportTitle,
  THEMES_SYSTEM,
  VOTER_PERSONA_SYSTEM,
  VOTER_SYSTEM,
  X_DISCLAIMER
} from './prompts.js';
import { engagement, forYouImpressions, heavyRankerScore } from './rank.js';

export const STEP_MINUTES = 15;
export const DEFAULT_STEPS = 16;

export interface XOptions extends ReachConstants {
  /** Real people the simulated population stands for; 250 = the backtest crowd (100 active + 150 voters). */
  audiencePool: number;
  /** For You impressions per step as the ranker score grows without bound. */
  forYouReach: number;
  /** Ranker score that earns half of `forYouReach`. */
  halfScore: number;
  /** Assumption: X shows posts with an external link in the post itself to about half as many non-followers. */
  linkPenalty: number;
}

export const DEFAULT_OPTIONS: XOptions = {
  ...readFit(),
  audiencePool: 250,
  forYouReach: 500,
  halfScore: 1,
  linkPenalty: 0.5
};

/** A link in the first post; a link in the founder's follow-up reply (the seed's first comment) is not penalised. */
export const hasLink = (post: Post): boolean =>
  post.url !== '' || /https?:\/\//.test(post.body);

const score = (o: XOptions, s: ThreadState): number =>
  heavyRankerScore(engagement(s), o.audiencePool);

function reach(
  o: XOptions,
  s: ThreadState,
  ageHours: number,
  followers: number
): number {
  const e = engagement(s);
  const forYou =
    forYouImpressions(
      heavyRankerScore(e, o.audiencePool),
      o.forYouReach,
      o.halfScore
    ) *
    decay(ageHours, o.halfLifeHours) *
    (hasLink(s.post) ? o.linkPenalty : 1);
  return (
    impressions(o, {
      followers,
      ageHours,
      reposts: e.repost,
      quotes: e.quote
    }) + forYou
  );
}

export function makeX(o: XOptions): Platform {
  return {
    id: 'x',
    stepMinutes: STEP_MINUTES,
    defaultSteps: DEFAULT_STEPS,
    bands: BAND_ORDER,
    frontPage: ['viral', 'spreading'],
    votes: ['like', 'repost', 'bookmark', 'down', 'flag', 'none'],
    commentVote: 'like',
    visibility: (state, step, author) => {
      const f = visitorFraction(
        reach(
          o,
          state,
          (step * STEP_MINUTES) / 60,
          author?.followers ?? o.authorFollowers
        ),
        o.audiencePool
      );
      return { band: bandFor(f), visitorFraction: f };
    },
    rankScore: (state) => score(o, state),
    agentSystem,
    agentRules: AGENT_RULES,
    voterSystem: VOTER_SYSTEM,
    founderSystem,
    personaSystem: PERSONA_SYSTEM,
    personaPrompt,
    voterPersonaSystem: VOTER_PERSONA_SYSTEM,
    labelSystem: LABEL_SYSTEM,
    reportSystem: REPORT_SYSTEM,
    reportTitle,
    disclaimer: X_DISCLAIMER,
    themesSystem: THEMES_SYSTEM,
    recallSystem: RECALL_SYSTEM,
    withOptions: (options) => {
      const next = { ...o };
      for (const [key, value] of Object.entries(options)) {
        if (!(key in DEFAULT_OPTIONS))
          throw new Error(
            `platform.yaml: unknown x key "${key}"; known: ${Object.keys(DEFAULT_OPTIONS).join(', ')}`
          );
        if (typeof value !== 'number' || !(value > 0))
          throw new Error(`platform.yaml: "${key}" must be a number > 0`);
        if (key === 'linkPenalty' && value > 1)
          throw new Error('platform.yaml: "linkPenalty" must be in (0, 1]');
        next[key as keyof XOptions] = value;
      }
      return makeX(next);
    }
  };
}

export default makeX(DEFAULT_OPTIONS);
