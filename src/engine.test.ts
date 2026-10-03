import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  makePersona,
  makePost,
  makeSeed,
  makeVoter
} from '../test/fixtures.js';
import {
  EVENTS_FILE,
  estimateCalls,
  readEvents,
  runSimulation
} from './engine.js';
import { BudgetExceeded, FakeLlm, LlmFatal, type LlmRequest } from './llm.js';
import type { PersonaSet, SimEvent } from './types.js';

const personas: PersonaSet = {
  personas: Array.from({ length: 6 }, (_, i) =>
    makePersona(i + 1, { activity: 1 })
  ),
  voters: Array.from({ length: 30 }, (_, i) => makeVoter(i + 1))
};

/** Scripted world: agents comment once (replying to `replyTo` if given), voters upvote the post. */
function world(opts: { replyTo?: string } = {}) {
  return (req: LlmRequest<unknown>): unknown => {
    if (req.label.startsWith('agent:')) {
      const commented = req.prompt.includes(
        'Your earlier comments in this thread:\n['
      );
      return {
        vote: 'up',
        upvoteComments: ['c1'],
        comment: commented
          ? null
          : { parent: opts.replyTo ?? 'post', text: `hello from ${req.label}` },
        leave: commented
      };
    }
    if (req.label.startsWith('voters:')) {
      const ids = [...req.prompt.matchAll(/- (v\d+):/g)].map((m) => m[1]);
      return {
        ballots: ids.map((voterId) => ({
          voterId,
          postVote: 'up',
          commentVotes: []
        }))
      };
    }
    if (req.label.startsWith('founder:'))
      return { replies: [{ parent: 'c1', text: 'thanks' }] };
    throw new Error(`unexpected ${req.label}`);
  };
}

const dir = (): string => mkdtempSync(join(tmpdir(), 'run-'));
const ends = (events: SimEvent[]) =>
  events.filter((e) => e.kind === 'step-end');

describe('runSimulation', () => {
  it('runs all steps, persists events, and the post climbs', async () => {
    const runDir = dir();
    const res = await runSimulation({
      post: makePost(),
      seed: makeSeed(),
      personas,
      llm: new FakeLlm(world()),
      rngSeed: 1,
      runDir
    });
    expect(res.aborted).toBeNull();
    expect(ends(res.events)).toHaveLength(12);
    expect(readEvents(join(runDir, EVENTS_FILE))).toEqual(res.events);
    expect(res.state.postUps).toBeGreaterThan(0);
    expect(
      [...res.state.comments.values()].some((c) => c.author === 'founder')
    ).toBe(true);
  });

  it('schedules identically for the same seed', async () => {
    const visits = async () =>
      (
        await runSimulation({
          post: makePost(),
          seed: makeSeed(),
          personas,
          llm: new FakeLlm(world()),
          rngSeed: 7,
          runDir: dir()
        })
      ).events
        .filter((e) => e.kind === 'visit')
        .map((e) => `${e.step}:${(e as { actor: string }).actor}`);
    expect(await visits()).toEqual(await visits());
  });

  it('attaches replies to unknown comments at top level (review focus 1)', async () => {
    const res = await runSimulation({
      post: makePost(),
      seed: makeSeed(),
      personas,
      llm: new FakeLlm(world({ replyTo: 'c99' })),
      rngSeed: 1,
      runDir: dir()
    });
    const agentComments = [...res.state.comments.values()].filter(
      (c) => c.author !== 'founder'
    );
    expect(agentComments.length).toBeGreaterThan(0);
    expect(agentComments.every((c) => c.parent === 'post')).toBe(true);
  });

  it('aborts with the message when claude is unusable (review focus 2)', async () => {
    const runDir = dir();
    const llm = new FakeLlm(
      () => new LlmFatal('claude is not usable: Not logged in')
    );
    const res = await runSimulation({
      post: makePost(),
      seed: makeSeed(),
      personas,
      llm,
      rngSeed: 1,
      runDir
    });
    expect(res.aborted).toMatch(/Not logged in/);
    expect(readEvents(join(runDir, EVENTS_FILE)).at(-1)).toMatchObject({
      kind: 'abort'
    });
  });

  it('aborts on budget exhaustion', async () => {
    let n = 0;
    const llm = new FakeLlm((req) =>
      ++n > 10 ? new BudgetExceeded('max-calls 10 reached') : world()(req)
    );
    const res = await runSimulation({
      post: makePost(),
      seed: makeSeed(),
      personas,
      llm,
      rngSeed: 1,
      runDir: dir()
    });
    expect(res.aborted).toMatch(/max-calls/);
  });

  it('aborts when more than 10% of a step fails', async () => {
    const llm = new FakeLlm((req) =>
      req.label.startsWith('agent:') ? new Error('bad json') : world()(req)
    );
    const res = await runSimulation({
      post: makePost(),
      seed: makeSeed(),
      personas,
      llm,
      rngSeed: 1,
      runDir: dir()
    });
    expect(res.aborted).toMatch(/error rate/);
    expect(res.events.some((e) => e.kind === 'error')).toBe(true);
  });

  it('resumes after a crash mid-step (review focus 4)', async () => {
    const runDir = dir();
    const full = await runSimulation({
      post: makePost(),
      seed: makeSeed(),
      personas,
      llm: new FakeLlm(world()),
      rngSeed: 3,
      runDir,
      steps: 12
    });
    const cut = full.events.findIndex(
      (e) => e.kind === 'step-end' && e.step === 4
    );
    const kept = full.events.slice(0, cut + 1);
    const partialStep = full.events.slice(cut + 1, cut + 4);
    writeFileSync(
      join(runDir, EVENTS_FILE),
      [...kept, ...partialStep].map((e) => JSON.stringify(e) + '\n').join('')
    );
    appendFileSync(join(runDir, EVENTS_FILE), '{"kind":"comm'); // torn write
    const resumed = await runSimulation({
      post: makePost(),
      seed: makeSeed(),
      personas,
      llm: new FakeLlm(world()),
      rngSeed: 3,
      runDir
    });
    expect(ends(resumed.events).map((e) => e.step)).toEqual([
      ...Array(12).keys()
    ]);
    const ids = resumed.events
      .filter((e) => e.kind === 'comment')
      .map((e) => (e as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(readFileSync(join(runDir, EVENTS_FILE), 'utf8')).not.toContain(
      '{"kind":"comm\n'
    );
  });
});

describe('estimateCalls', () => {
  it('grows with steps and population', () => {
    const a = estimateCalls(personas, 6);
    const b = estimateCalls(personas, 12);
    expect(b.total).toBeGreaterThan(a.total);
    expect(b.founder).toBe(12);
  });
});
