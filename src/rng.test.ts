import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mulberry32, rngFor, shuffle } from './rng.js';

describe('rng', () => {
  it('is deterministic per seed and stays in [0,1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => {
        const a = mulberry32(seed);
        const b = mulberry32(seed);
        for (let i = 0; i < 20; i++) {
          const x = a();
          expect(x).toBe(b());
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(1);
        }
      })
    );
  });

  it('rngFor differs by step', () => {
    expect(rngFor(1, 0)()).not.toBe(rngFor(1, 1)());
  });

  it('shuffle is a permutation', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.nat(), (xs, seed) => {
        const out = shuffle(mulberry32(seed), xs);
        expect([...out].sort((a, b) => a - b)).toEqual(
          [...xs].sort((a, b) => a - b)
        );
      })
    );
  });
});
