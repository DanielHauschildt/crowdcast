import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makePersona, makePost, makeVoter } from '../test/fixtures.js';
import { rngFor } from './rng.js';
import { BAND_ORDER, bandFor, visitorFraction } from './platforms/hn/rank.js';
import { planVisits } from './schedule.js';
import { emptyThread, replay } from './thread.js';

const personas = Array.from({ length: 30 }, (_, i) =>
  makePersona(i + 1, { activity: 0.5 })
);
const voters = Array.from({ length: 50 }, (_, i) => makeVoter(i + 1));

describe('bands', () => {
  it('better scores never map to worse bands', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(BAND_ORDER.indexOf(bandFor(hi))).toBeLessThanOrEqual(
            BAND_ORDER.indexOf(bandFor(lo))
          );
        }
      )
    );
  });

  it('front page gets more visitors than page 2', () => {
    expect(visitorFraction('top10', 5)).toBeGreaterThan(
      visitorFraction('page2', 5)
    );
    expect(visitorFraction('new', 0)).toBeGreaterThan(
      visitorFraction('new', 6)
    );
  });
});

describe('planVisits', () => {
  it('is deterministic for a seed', () => {
    fc.assert(
      fc.property(fc.nat(), fc.integer({ min: 0, max: 11 }), (seed, step) => {
        const state = emptyThread(makePost());
        const a = planVisits({
          rng: rngFor(seed, step),
          fraction: visitorFraction('top30', step),
          personas,
          voters,
          state
        });
        const b = planVisits({
          rng: rngFor(seed, step),
          fraction: visitorFraction('top30', step),
          personas,
          voters,
          state
        });
        expect(a.agents.map((p) => p.id)).toEqual(b.agents.map((p) => p.id));
        expect(a.voters.map((v) => v.id)).toEqual(b.voters.map((v) => v.id));
      })
    );
  });

  it('excludes departed personas unless someone replied to them', () => {
    const state = replay(makePost(), [
      { kind: 'leave', step: 0, actor: 'p1' },
      { kind: 'leave', step: 0, actor: 'p2' },
      {
        kind: 'comment',
        step: 0,
        id: 'c1',
        parent: 'post',
        author: 'p2',
        text: 'x'
      },
      {
        kind: 'comment',
        step: 0,
        id: 'c2',
        parent: 'c1',
        author: 'p3',
        text: 'y'
      }
    ]);
    const all = personas.map((p) => ({ ...p, activity: 1 }));
    const plan = planVisits({
      rng: rngFor(1, 1),
      fraction: visitorFraction('top10', 1),
      personas: all,
      voters,
      state
    });
    const ids = plan.agents.map((p) => p.id);
    expect(ids).not.toContain('p1');
    expect(ids).toContain('p2');
  });
});
