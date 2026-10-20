import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bandFor, BAND_ORDER, hotScore, visitorFraction } from './rank.js';

describe('hotScore', () => {
  it('matches Reddit hot relative to now: log10 of the score, minus 1 per 12.5 h', () => {
    expect(hotScore(1, 0)).toBe(0);
    expect(hotScore(0, 0)).toBe(0);
    expect(hotScore(10, 0)).toBeCloseTo(1);
    expect(hotScore(-10, 0)).toBeCloseTo(-1);
    expect(hotScore(100, 0)).toBeCloseTo(2);
    expect(hotScore(1, 12.5)).toBeCloseTo(-1);
    expect(hotScore(100, 2)).toBeCloseTo(1.84);
  });

  it('rises with score and falls with age', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.double({ min: 0, max: 24, noNaN: true }),
        (score, age) => {
          expect(hotScore(score + 1, age)).toBeGreaterThanOrEqual(
            hotScore(score, age)
          );
          expect(hotScore(score, age + 1)).toBeLessThan(hotScore(score, age));
        }
      )
    );
  });
});

describe('bands', () => {
  it('maps hot score to the hot-list position, best first', () => {
    expect(BAND_ORDER).toEqual(['top5', 'top25', 'rising', 'new']);
    expect(bandFor(hotScore(100, 2))).toBe('top5');
    expect(bandFor(hotScore(20, 1))).toBe('top25');
    expect(bandFor(hotScore(3, 0.5))).toBe('rising');
    expect(bandFor(hotScore(1, 0.5))).toBe('new');
    expect(bandFor(hotScore(-5, 0.5))).toBe('new');
  });

  it('gives better bands more visitors, and new posts a short early window', () => {
    for (const step of [0, 5]) {
      const f = BAND_ORDER.map((b) => visitorFraction(b, step));
      expect([...f].sort((a, b) => b - a)).toEqual(f);
    }
    expect(visitorFraction('top5', 3)).toBe(1);
    expect(visitorFraction('new', 0)).toBeGreaterThan(
      visitorFraction('new', 4)
    );
  });
});
