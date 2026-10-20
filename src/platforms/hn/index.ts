import type { Platform } from '../../platform.js';
import { liveComments, postPoints, type ThreadState } from '../../thread.js';
import { fetchThread } from './fetch.js';
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
  VOTER_SYSTEM
} from './prompts.js';
import {
  BAND_ORDER,
  bandFor,
  DEFAULT_STEPS,
  flamewarFactor,
  rankScore,
  STEP_MINUTES,
  visitorFraction
} from './rank.js';

/** The post's rank score at `ageHours`, flamewar penalty included. */
export function postRankScore(s: ThreadState, ageHours: number): number {
  const points = postPoints(s);
  return (
    rankScore(points, ageHours, s.postFlags) *
    flamewarFactor(points, liveComments(s).length)
  );
}

const hn: Platform = {
  id: 'hn',
  stepMinutes: STEP_MINUTES,
  defaultSteps: DEFAULT_STEPS,
  bands: BAND_ORDER,
  frontPage: ['top10', 'top30'],
  votes: ['up', 'none', 'flag'],
  commentVote: 'up',
  visibility: (state, step) => {
    const band = bandFor(postRankScore(state, (step * STEP_MINUTES) / 60));
    return { band, visitorFraction: visitorFraction(band, step) };
  },
  rankScore: postRankScore,
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
  fetchReference: fetchThread
};

export default hn;
