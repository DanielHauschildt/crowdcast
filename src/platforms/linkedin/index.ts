import type { Platform } from '../../platform.js';
import { AGENT_RULES, linkedinPrompts } from './prompts.js';
import {
  BAND_ORDER,
  DEFAULT_REACH,
  DEFAULT_STEPS,
  reachAt,
  STEP_MINUTES,
  type ReachConstants
} from './reach.js';

export const LINKEDIN_DISCLAIMER =
  'LinkedIn mode is not validated against real data; its reach model (a test slice of the network, then ' +
  'expansion on early engagement) uses commonly reported mechanics with assumed constants.';

export interface LinkedinOptions {
  headline: string;
  /** First-degree connections; the network is the larger of this and `author.followers`. */
  connections: number;
  reach: ReachConstants;
}

/** Network size when platform.yaml gives neither `author.followers` nor `connections`. */
export const DEFAULT_NETWORK = 1000;

export const DEFAULT_OPTIONS: LinkedinOptions = {
  headline: 'the founder',
  connections: 0,
  reach: DEFAULT_REACH
};

const REACH_KEYS = [
  'testSlice',
  'expansion',
  'halfLifeHours',
  'audiencePool'
] as const;

export function makeLinkedin(o: LinkedinOptions): Platform {
  const network = (followers?: number): number =>
    Math.max(followers ?? 0, o.connections) || DEFAULT_NETWORK;
  return {
    id: 'linkedin',
    stepMinutes: STEP_MINUTES,
    defaultSteps: DEFAULT_STEPS,
    bands: BAND_ORDER,
    frontPage: ['viral', 'expanding'],
    votes: [
      'like',
      'celebrate',
      'support',
      'love',
      'insightful',
      'funny',
      'repost',
      'none'
    ],
    commentVote: 'like',
    visibility: (state, step, author) => {
      const { band, visitorFraction } = reachAt(
        o.reach,
        network(author?.followers),
        state,
        step
      );
      return { band, visitorFraction };
    },
    rankScore: (state, ageHours, author) =>
      reachAt(
        o.reach,
        network(author?.followers),
        state,
        Math.floor((ageHours * 60) / STEP_MINUTES)
      ).impressions,
    ...linkedinPrompts(o.headline),
    agentRules: AGENT_RULES,
    disclaimer: LINKEDIN_DISCLAIMER,
    withOptions: (options) => {
      const next: LinkedinOptions = { ...o, reach: { ...o.reach } };
      const fail = (msg: string): never => {
        throw new Error(`platform.yaml: ${msg}`);
      };
      for (const [key, value] of Object.entries(options)) {
        if (key === 'headline') {
          if (typeof value !== 'string' || !value.trim())
            fail(
              '"headline" must be a non-empty string, e.g. Founder at Tablecraft'
            );
          next.headline = (value as string).trim();
        } else if (key === 'connections') {
          if (
            typeof value !== 'number' ||
            !Number.isInteger(value) ||
            value < 0
          )
            fail('"connections" must be an integer ≥ 0');
          next.connections = value as number;
        } else if ((REACH_KEYS as readonly string[]).includes(key)) {
          if (typeof value !== 'number' || !(value > 0))
            fail(`"${key}" must be a number > 0`);
          next.reach[key as (typeof REACH_KEYS)[number]] = value as number;
        } else
          fail(
            `unknown linkedin key "${key}"; known: headline, connections, ${REACH_KEYS.join(', ')}`
          );
      }
      return makeLinkedin(next);
    }
  };
}

export default makeLinkedin(DEFAULT_OPTIONS);
