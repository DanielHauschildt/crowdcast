import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bandFor,
  DEFAULT_REACH,
  impressions,
  visitorFraction,
  type ReachInput
} from './reach.js';

const input = (over: Partial<ReachInput> = {}): ReachInput => ({
  followers: 2000,
  ageHours: 0,
  reposts: 0,
  quotes: 0,
  ...over
});

describe('impressions', () => {
  it('grows with the author’s followers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.double({ min: 0, max: 4, noNaN: true }),
        (f, extra, age) =>
          impressions(
            DEFAULT_REACH,
            input({ followers: f + extra, ageHours: age })
          ) > impressions(DEFAULT_REACH, input({ followers: f, ageHours: age }))
      )
    );
  });

  it('decays with age', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 4, noNaN: true }),
        fc.double({ min: 0.05, max: 4, noNaN: true }),
        fc.integer({ min: 0, max: 50 }),
        (age, later, reposts) =>
          impressions(
            DEFAULT_REACH,
            input({ ageHours: age + later, reposts })
          ) < impressions(DEFAULT_REACH, input({ ageHours: age, reposts }))
      )
    );
  });

  it('adds reach for every repost and every quote', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (n) => {
        const base = impressions(
          DEFAULT_REACH,
          input({ reposts: n, quotes: n })
        );
        return (
          impressions(DEFAULT_REACH, input({ reposts: n + 1, quotes: n })) >
            base &&
          impressions(DEFAULT_REACH, input({ reposts: n, quotes: n + 1 })) >
            base
        );
      })
    );
  });
});

describe('visitorFraction', () => {
  it('is impressions over the audience pool, capped at 1', () => {
    expect(visitorFraction(50, 1000)).toBe(0.05);
    expect(visitorFraction(5000, 1000)).toBe(1);
    expect(visitorFraction(0, 1000)).toBe(0);
  });
});

describe('bandFor', () => {
  it('maps the visitor fraction to a band, widest first', () => {
    expect(bandFor(1)).toBe('viral');
    expect(bandFor(0.3)).toBe('spreading');
    expect(bandFor(0.1)).toBe('followers');
    expect(bandFor(0.01)).toBe('quiet');
  });
});
