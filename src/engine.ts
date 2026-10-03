import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentTurn } from './agents.js';
import { EVENTS_FILE, readEvents } from './events.js';
import { founderTurn } from './founder.js';
import { BudgetExceeded, LlmFatal, type Llm } from './llm.js';
import { rngFor } from './rng.js';
import { ageHours, bandFor, DEFAULT_STEPS, planVisits } from './schedule.js';
import {
  applyEvent,
  newCommentId,
  postPoints,
  rankScore,
  renderThread,
  replay,
  topComments,
  type ThreadState
} from './thread.js';
import {
  FOUNDER,
  type PersonaSet,
  type Post,
  type Seed,
  type SimEvent
} from './types.js';
import { voterBatch } from './voters.js';

export { EVENTS_FILE, readEvents } from './events.js';
/** ≈ 6k tokens of thread per agent prompt. */
export const RENDER_CHARS = 24000;
export const VOTER_BATCH = 20;
const TOP_FOR_VOTERS = 15;

type StepEnd = Extract<SimEvent, { kind: 'step-end' }>;

export interface RunConfig {
  post: Post;
  seed: Seed;
  personas: PersonaSet;
  llm: Llm;
  rngSeed: number;
  runDir: string;
  steps?: number;
  maxErrorRate?: number;
  onStep?: (e: StepEnd) => void;
}

export interface RunResult {
  events: SimEvent[];
  state: ThreadState;
  aborted: string | null;
}

const chunk = <T>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) =>
    xs.slice(i * n, i * n + n)
  );

export async function runSimulation(cfg: RunConfig): Promise<RunResult> {
  const steps = cfg.steps ?? DEFAULT_STEPS;
  const maxErrorRate = cfg.maxErrorRate ?? 0.1;
  const file = join(cfg.runDir, EVENTS_FILE);
  mkdirSync(cfg.runDir, { recursive: true });

  // Keep only complete steps; a partial step (or an abort marker) is replayed from scratch.
  const prior = readEvents(file);
  let lastEnd = -1;
  prior.forEach((e, i) => {
    if (e.kind === 'step-end') lastEnd = i;
  });
  const events: SimEvent[] = lastEnd >= 0 ? prior.slice(0, lastEnd + 1) : [];
  writeFileSync(file, events.map((e) => JSON.stringify(e) + '\n').join(''));

  const state = replay(cfg.post, events);
  const flush = (batch: SimEvent[]): void => {
    events.push(...batch);
    appendFileSync(file, batch.map((e) => JSON.stringify(e) + '\n').join(''));
  };

  if (events.length === 0) {
    const opening: SimEvent[] = [{ kind: 'post', step: 0, post: cfg.post }];
    if (cfg.post.firstComment) {
      opening.push({
        kind: 'comment',
        step: 0,
        id: 'c1',
        parent: 'post',
        author: FOUNDER,
        text: cfg.post.firstComment
      });
    }
    for (const e of opening) applyEvent(state, e);
    flush(opening);
  }

  const startStep =
    lastEnd >= 0 ? (events[events.length - 1] as StepEnd).step + 1 : 0;

  for (let step = startStep; step < steps; step++) {
    const batch: SimEvent[] = [];
    const emit = (e: SimEvent): void => {
      applyEvent(state, e);
      batch.push(e);
    };
    let calls = 0;
    let failed = 0;
    const fail = (actor: string, message: string): void => {
      failed++;
      emit({ kind: 'error', step, actor, message });
    };

    try {
      const band = bandFor(
        rankScore(postPoints(state), ageHours(step), state.postFlags)
      );
      const plan = planVisits({
        rng: rngFor(cfg.rngSeed, step),
        band,
        step,
        personas: cfg.personas.personas,
        voters: cfg.personas.voters,
        state
      });

      // 1. Agents — all see the same snapshot; visits are logged before any action.
      const view = renderThread(state, { maxChars: RENDER_CHARS });
      const results = await Promise.all(
        plan.agents.map((persona) =>
          agentTurn(cfg.llm, {
            persona,
            post: state.post,
            context: cfg.seed.context,
            thread: view,
            ownComments: [...state.comments.values()].filter(
              (c) => c.author === persona.id
            )
          })
        )
      );
      for (const p of plan.agents) emit({ kind: 'visit', step, actor: p.id });
      plan.agents.forEach((p, i) => {
        calls++;
        const res = results[i]!;
        if (!res.ok) return fail(p.id, res.error);
        const a = res.value;
        if (a.vote !== 'none')
          emit({
            kind: 'vote',
            step,
            voter: p.id,
            target: 'post',
            value: a.vote
          });
        for (const id of a.upvoteComments) {
          if (state.comments.has(id))
            emit({ kind: 'vote', step, voter: p.id, target: id, value: 'up' });
        }
        if (a.comment?.text.trim()) {
          const parent = state.comments.has(a.comment.parent)
            ? a.comment.parent
            : 'post';
          emit({
            kind: 'comment',
            step,
            id: newCommentId(state),
            parent,
            author: p.id,
            text: a.comment.text.trim()
          });
        }
        if (a.leave) emit({ kind: 'leave', step, actor: p.id });
      });

      // 2. Silent voters.
      const shown = topComments(state, TOP_FOR_VOTERS);
      const groups = chunk(plan.voters, VOTER_BATCH);
      const ballots = await Promise.all(
        groups.map((voters, i) =>
          voterBatch(cfg.llm, {
            voters,
            post: state.post,
            context: cfg.seed.context,
            comments: shown,
            batch: step * 100 + i
          })
        )
      );
      groups.forEach((voters, i) => {
        calls++;
        const res = ballots[i]!;
        if (!res.ok) return fail(`voters:${i}`, res.error);
        const allowed = new Set(voters.map((v) => v.id));
        for (const b of res.value) {
          if (!allowed.has(b.voterId)) continue;
          if (b.postVote !== 'none')
            emit({
              kind: 'vote',
              step,
              voter: b.voterId,
              target: 'post',
              value: b.postVote
            });
          for (const cv of b.commentVotes) {
            if (cv.vote !== 'none' && state.comments.has(cv.id)) {
              emit({
                kind: 'vote',
                step,
                voter: b.voterId,
                target: cv.id,
                value: cv.vote
              });
            }
          }
        }
      });

      // 3. Founder.
      calls++;
      const fr = await founderTurn(cfg.llm, {
        post: state.post,
        founderAnswers: cfg.seed.founderAnswers,
        thread: renderThread(state, { maxChars: RENDER_CHARS }),
        step
      });
      if (!fr.ok) fail(FOUNDER, fr.error);
      else {
        for (const r of fr.value) {
          const parent = state.comments.get(r.parent);
          if (!parent || parent.author === FOUNDER || !r.text.trim()) continue;
          emit({
            kind: 'comment',
            step,
            id: newCommentId(state),
            parent: r.parent,
            author: FOUNDER,
            text: r.text.trim()
          });
        }
      }
    } catch (err) {
      if (err instanceof LlmFatal || err instanceof BudgetExceeded) {
        flush([...batch, { kind: 'abort', step, reason: err.message }]);
        return { events, state, aborted: err.message };
      }
      throw err;
    }

    const score = rankScore(
      postPoints(state),
      ageHours(step + 1),
      state.postFlags
    );
    const end: StepEnd = {
      kind: 'step-end',
      step,
      score,
      band: bandFor(score),
      points: postPoints(state),
      flags: state.postFlags,
      calls,
      failed
    };
    batch.push(end);
    flush(batch);
    cfg.onStep?.(end);
    if (calls > 0 && failed / calls > maxErrorRate) {
      const reason = `error rate ${failed}/${calls} in step ${step} exceeds ${maxErrorRate}`;
      flush([{ kind: 'abort', step, reason }]);
      return { events, state, aborted: reason };
    }
  }
  return { events, state, aborted: null };
}

/** Rough expected call counts, assuming the post hovers around the 30-on-front-page band. */
export function estimateCalls(personas: PersonaSet, steps: number) {
  const visit = 0.4;
  const meanActivity =
    personas.personas.reduce((a, p) => a + p.activity, 0) /
    Math.max(personas.personas.length, 1);
  const agentTurns = Math.round(
    personas.personas.length * visit * meanActivity * steps
  );
  const voterBatches =
    Math.ceil((personas.voters.length * visit) / VOTER_BATCH) * steps;
  const founder = steps;
  const labels = Math.ceil((agentTurns * 0.5) / 15);
  const report = 1;
  return {
    agentTurns,
    voterBatches,
    founder,
    labels,
    report,
    total: agentTurns + voterBatches + founder + labels + report
  };
}
