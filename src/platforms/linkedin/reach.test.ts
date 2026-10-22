import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makePost } from '../../../test/fixtures.js';
import { applyEvent, emptyThread, type ThreadState } from '../../thread.js';
import { FOUNDER, type SimEvent } from '../../types.js';
import {
  BAND_ORDER,
  DEFAULT_REACH,
  engagementRate,
  gain,
  reachAt,
  stepImpressions
} from './reach.js';

const c = DEFAULT_REACH;

/** `readers` agents visited; the first `reactions` liked the post, the next `comments` commented. */
function thread(
  readers: number,
  reactions: number,
  comments: number,
  text = 'Good point.'
): ThreadState {
  const s = emptyThread(makePost());
  const events: SimEvent[] = [];
  for (let i = 0; i < readers; i++)
    events.push({ kind: 'visit', step: 0, actor: `p${i}` });
  for (let i = 0; i < reactions; i++)
    events.push({
      kind: 'vote',
      step: 0,
      voter: `p${i}`,
      target: 'post',
      value: 'like'
    });
  for (let i = 0; i < comments; i++)
    events.push({
      kind: 'comment',
      step: 0,
      id: `c${i + 1}`,
      parent: 'post',
      author: `p${reactions + i}`,
      text
    });
  for (const e of events) applyEvent(s, e);
  return s;
}

describe('linkedin reach', () => {
  it('shows the first steps to a test slice of the network, whatever the engagement', () => {
    for (const step of [0, 1]) {
      for (const s of [thread(0, 0, 0), thread(20, 20, 0)]) {
        const r = reachAt(c, 2000, s, step);
        expect(r.band).toBe('test');
        expect(r.impressions).toBeCloseTo((2000 * c.testSlice) / c.testSteps);
      }
    }
  });

  it('expands after the test slice on strong engagement and shrinks on weak', () => {
    const test = (2000 * c.testSlice) / c.testSteps;
    const strong = reachAt(c, 2000, thread(10, 6, 4), 2);
    const weak = reachAt(c, 2000, thread(20, 1, 0), 2);
    expect(strong.impressions).toBeGreaterThan(test);
    expect(['viral', 'expanding']).toContain(strong.band);
    expect(weak.impressions).toBeLessThan(test);
    expect(['network', 'fading']).toContain(weak.band);
  });

  it('weighs comments above reactions, and longer comments (dwell) above short ones', () => {
    const reactions = engagementRate(c, thread(10, 3, 0));
    const comments = engagementRate(c, thread(10, 0, 3));
    const long = engagementRate(c, thread(10, 0, 3, 'x'.repeat(1200)));
    expect(comments).toBeGreaterThan(reactions);
    expect(long).toBeGreaterThan(comments);
    expect(reachAt(c, 2000, thread(10, 0, 3), 3).impressions).toBeGreaterThan(
      reachAt(c, 2000, thread(10, 3, 0), 3).impressions
    );
  });

  it('ignores the founder and votes by actors that never visited (silent voters)', () => {
    const s = thread(10, 2, 0);
    const base = engagementRate(c, s);
    applyEvent(s, {
      kind: 'comment',
      step: 1,
      id: 'c9',
      parent: 'post',
      author: FOUNDER,
      text: 'Thanks!'
    });
    applyEvent(s, {
      kind: 'vote',
      step: 1,
      voter: 'v1',
      target: 'post',
      value: 'celebrate'
    });
    expect(engagementRate(c, s)).toBe(base);
  });

  it('uses the baseline rate before anyone has read the post', () => {
    expect(engagementRate(c, thread(0, 0, 0))).toBe(c.baselineRate);
    expect(gain(c, c.baselineRate)).toBe(1);
  });

  it('decays over the following days and keeps gain within bounds', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 5, noNaN: true }),
        fc.integer({ min: 2, max: 40 }),
        (rate, step) => {
          const g = gain(c, rate);
          expect(g).toBeGreaterThanOrEqual(c.minGain);
          expect(g).toBeLessThanOrEqual(c.maxGain);
          expect(stepImpressions(c, 1000, step + 1, g)).toBeLessThan(
            stepImpressions(c, 1000, step, g)
          );
          expect(
            stepImpressions(c, 1000, step, gain(c, rate + 0.1))
          ).toBeGreaterThanOrEqual(stepImpressions(c, 1000, step, g));
        }
      )
    );
    const g = gain(c, c.baselineRate);
    // Two to three days in, the post is nearly gone.
    expect(stepImpressions(c, 1000, 30, g)).toBeLessThan(
      stepImpressions(c, 1000, 2, g) / 10
    );
  });

  it('turns impressions into a visitor fraction of the simulated audience, capped at 1', () => {
    expect(reachAt(c, 2000, thread(0, 0, 0), 0).visitorFraction).toBeCloseTo(
      (2000 * c.testSlice) / c.testSteps / c.audiencePool
    );
    expect(reachAt(c, 1e7, thread(0, 0, 0), 0).visitorFraction).toBe(1);
    expect(BAND_ORDER).toEqual([
      'viral',
      'expanding',
      'test',
      'network',
      'fading'
    ]);
  });
});
