import type { Platform } from '../../platform.js';
import { postPoints, type ThreadState } from '../../thread.js';
import { fetchReference } from './arctic-shift.js';
import { AGENT_RULES, redditPrompts } from './prompts.js';
import {
  BAND_ORDER,
  bandFor,
  DEFAULT_STEPS,
  hotScore,
  STEP_MINUTES,
  visitorFraction
} from './rank.js';

export const DEFAULT_SUBREDDIT = 'SideProject';

const postHot = (s: ThreadState, ageHours: number): number =>
  hotScore(postPoints(s), ageHours);

/** Reddit in one subreddit; `flair` only colours the prompts. */
export function reddit(
  subreddit = DEFAULT_SUBREDDIT,
  flair?: string
): Platform {
  return {
    id: 'reddit',
    stepMinutes: STEP_MINUTES,
    defaultSteps: DEFAULT_STEPS,
    bands: BAND_ORDER,
    frontPage: ['top5', 'top25'],
    votes: ['up', 'down', 'none'],
    commentVote: 'up',
    visibility: (state, step) => {
      const band = bandFor(postHot(state, (step * STEP_MINUTES) / 60));
      return { band, visitorFraction: visitorFraction(band, step) };
    },
    rankScore: postHot,
    ...redditPrompts(subreddit, flair),
    agentRules: AGENT_RULES,
    fetchReference,
    withOptions: (options) => {
      const { subreddit: sub, flair: fl, ...rest } = options;
      const fail = (msg: string): never => {
        throw new Error(`platform.yaml: ${msg}`);
      };
      const unknown = Object.keys(rest)[0];
      if (unknown !== undefined) fail(`unknown key "${unknown}" for reddit`);
      if (sub !== undefined && (typeof sub !== 'string' || !sub.trim()))
        fail('"subreddit" must be a non-empty string, e.g. SideProject');
      if (fl !== undefined && typeof fl !== 'string')
        fail('"flair" must be a string');
      return reddit(
        (sub as string | undefined)?.replace(/^r\//, '') ?? subreddit,
        (fl as string | undefined) ?? flair
      );
    }
  };
}

export default reddit();
