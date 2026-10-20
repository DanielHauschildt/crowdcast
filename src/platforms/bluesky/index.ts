import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchFn, Platform, RealThread } from '../../platform.js';
import { liveComments, type ThreadState } from '../../thread.js';
import { FOUNDER } from '../../types.js';
import { fetchBskyPost } from './bsky-api.js';
import { DATA_DIR, parseRefList, readFit } from './fit.js';
import {
  AGENT_RULES,
  agentSystem,
  founderSystem,
  LABEL_SYSTEM,
  PERSONA_SYSTEM,
  personaPrompt,
  QUOTE_PREFIX,
  RECALL_SYSTEM,
  REPORT_SYSTEM,
  reportTitle,
  THEMES_SYSTEM,
  VOTER_PERSONA_SYSTEM,
  VOTER_SYSTEM
} from './prompts.js';
import {
  BAND_ORDER,
  bandFor,
  DEFAULT_STEPS,
  impressions,
  STEP_MINUTES,
  visitorFraction,
  type ReachConstants
} from './reach.js';

export interface BlueskyOptions extends ReachConstants {
  /** Real people the simulated population stands for; 250 = the backtest crowd (100 active + 150 voters). */
  audiencePool: number;
}

export const DEFAULT_OPTIONS: BlueskyOptions = {
  ...readFit(),
  audiencePool: 250
};

const quotes = (s: ThreadState): number =>
  liveComments(s).filter(
    (c) =>
      c.parent === 'post' &&
      c.author !== FOUNDER &&
      c.text.startsWith(QUOTE_PREFIX)
  ).length;

function reach(
  o: BlueskyOptions,
  s: ThreadState,
  ageHours: number,
  followers: number
): number {
  return impressions(o, {
    followers,
    ageHours,
    reposts: s.postReactions.repost ?? 0,
    quotes: quotes(s)
  });
}

/** Reads the at-URI of a backtest id from the thread lists. */
async function fetchReference(
  id: number,
  fetchFn?: FetchFn
): Promise<RealThread> {
  const ref = ['threads.txt', 'holdout.txt']
    .map((f) => join(DATA_DIR, f))
    .filter(existsSync)
    .flatMap((f) => parseRefList(readFileSync(f, 'utf8')))
    .find((r) => r.id === id);
  if (!ref) throw new Error(`bluesky thread ${id} is not in ${DATA_DIR}`);
  return (await fetchBskyPost(ref.uri, fetchFn)).thread;
}

export function makeBluesky(o: BlueskyOptions): Platform {
  return {
    id: 'bluesky',
    stepMinutes: STEP_MINUTES,
    defaultSteps: DEFAULT_STEPS,
    bands: BAND_ORDER,
    frontPage: ['viral', 'spreading'],
    votes: ['like', 'repost', 'none'],
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
    // rankScore gets no author: it charts reach at the reference posts' median followers.
    rankScore: (state, ageHours) =>
      reach(o, state, ageHours, o.authorFollowers),
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
    themesSystem: THEMES_SYSTEM,
    recallSystem: RECALL_SYSTEM,
    fetchReference,
    withOptions: (options) => {
      const next = { ...o };
      for (const [key, value] of Object.entries(options)) {
        if (!(key in DEFAULT_OPTIONS))
          throw new Error(
            `platform.yaml: unknown bluesky key "${key}"; known: ${Object.keys(DEFAULT_OPTIONS).join(', ')}`
          );
        if (typeof value !== 'number' || !(value > 0))
          throw new Error(`platform.yaml: "${key}" must be a number > 0`);
        next[key as keyof BlueskyOptions] = value;
      }
      return makeBluesky(next);
    }
  };
}

export default makeBluesky(DEFAULT_OPTIONS);
