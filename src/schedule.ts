import type { Rng } from './rng.js';
import { unseenReplies, type ThreadState } from './thread.js';
import { STEP_MINUTES } from './platforms/hn/rank.js';
import type { Persona, Voter } from './types.js';

// Moved to the HN platform; re-exported for callers of the old path.
export {
  BAND_THRESHOLDS,
  STEP_MINUTES,
  visitorFraction
} from './platforms/hn/rank.js';

export function ageHours(step: number, stepMinutes = STEP_MINUTES): number {
  return (step * stepMinutes) / 60;
}

export interface VisitPlan {
  agents: Persona[];
  voters: Voter[];
}

export interface PlanArgs {
  rng: Rng;
  /** Share of the population that opens the thread this step. */
  fraction: number;
  personas: readonly Persona[];
  voters: readonly Voter[];
  state: ThreadState;
}

export function planVisits({
  rng,
  fraction,
  personas,
  voters,
  state
}: PlanArgs): VisitPlan {
  const agents = personas.filter((p) => {
    // Always draw both numbers so the stream doesn't depend on branch outcomes.
    const visits = rng() < fraction;
    const acts = rng() < p.activity;
    if (unseenReplies(state, p.id)) return true;
    return !state.departed.has(p.id) && visits && acts;
  });
  const visiting = voters.filter(() => rng() < fraction);
  return { agents, voters: visiting };
}
