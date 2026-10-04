import type { Rng } from './rng.js';
import { unseenReplies, type ThreadState } from './thread.js';
import type { Band, Persona, Voter } from './types.js';

export const STEP_MINUTES = 20;
export const DEFAULT_STEPS = 12;

/**
 * rankScore cut-offs for each band. Calibrated by hand against the HN formula: a post with
 * ~100 points at 4h scores ≈ 3.9 (top 10); ~30 points at 2h ≈ 2.4; ~15 points at 3h ≈ 0.8.
 * Crude on purpose — the sim predicts relative, not absolute, rank.
 */
export const BAND_THRESHOLDS = { top10: 3.0, top30: 1.0, page2: 0.4 } as const;
export const BAND_ORDER: readonly Band[] = ['top10', 'top30', 'page2', 'new'];

export function ageHours(step: number): number {
  return (step * STEP_MINUTES) / 60;
}

export function bandFor(score: number): Band {
  if (score >= BAND_THRESHOLDS.top10) return 'top10';
  if (score >= BAND_THRESHOLDS.top30) return 'top30';
  if (score >= BAND_THRESHOLDS.page2) return 'page2';
  return 'new';
}

/** Share of the population that opens the thread during one step in this band. */
export function visitorFraction(band: Band, step: number): number {
  switch (band) {
    case 'top10':
      return 1;
    case 'top30':
      return 0.75;
    case 'page2':
      return 0.4;
    case 'new':
      return step < 3 ? 0.3 : 0.12;
  }
}

export interface VisitPlan {
  agents: Persona[];
  voters: Voter[];
}

export interface PlanArgs {
  rng: Rng;
  band: Band;
  step: number;
  personas: readonly Persona[];
  voters: readonly Voter[];
  state: ThreadState;
}

export function planVisits({
  rng,
  band,
  step,
  personas,
  voters,
  state
}: PlanArgs): VisitPlan {
  const fraction = visitorFraction(band, step);
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
