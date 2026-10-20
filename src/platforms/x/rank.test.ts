import { describe, expect, it } from 'vitest';
import { makePost } from '../../../test/fixtures.js';
import { applyEvent, emptyThread, type ThreadState } from '../../thread.js';
import { FOUNDER, type SimEvent } from '../../types.js';
import { QUOTE_PREFIX } from '../bluesky/prompts.js';
import {
  engagement,
  forYouImpressions,
  heavyRankerScore,
  type Engagement
} from './rank.js';

const none: Engagement = {
  like: 0,
  reply: 0,
  authorReply: 0,
  repost: 0,
  quote: 0,
  bookmark: 0,
  notInterested: 0,
  report: 0
};
const score = (e: Partial<Engagement>): number =>
  heavyRankerScore({ ...none, ...e }, 100);

function thread(events: SimEvent[]): ThreadState {
  const s = emptyThread(makePost());
  for (const e of events) applyEvent(s, e);
  return s;
}
const vote = (voter: string, value: string): SimEvent => ({
  kind: 'vote',
  step: 0,
  voter,
  target: 'post',
  value
});
const comment = (
  id: string,
  text: string,
  parent = 'post',
  author = 'p1'
): SimEvent => ({ kind: 'comment', step: 0, id, parent, author, text });

describe('heavyRankerScore', () => {
  it('weighs a reply above a like and a repost', () => {
    expect(score({ reply: 1 })).toBeGreaterThan(score({ like: 1 }));
    expect(score({ reply: 1 })).toBeGreaterThan(score({ repost: 1 }));
    expect(score({})).toBe(0);
  });

  it('a reply the author answered outweighs several plain replies', () => {
    expect(score({ reply: 1, authorReply: 1 })).toBeGreaterThan(
      score({ reply: 3 })
    );
  });

  it('one report outweighs a hundred likes; negative feedback is strongly negative', () => {
    expect(score({ like: 100, report: 1 })).toBeLessThan(0);
    expect(score({ like: 50, notInterested: 1 })).toBeLessThan(0);
    expect(score({ report: 1 })).toBeLessThan(score({ notInterested: 1 }));
  });
});

describe('engagement', () => {
  it('counts reactions, replies, quotes and replies the author answered', () => {
    const e = engagement(
      thread([
        vote('v1', 'like'),
        vote('v2', 'like'),
        vote('v3', 'repost'),
        vote('v4', 'bookmark'),
        vote('v5', 'down'),
        vote('v6', 'flag'),
        comment('c1', 'how fast is it?'),
        comment('c2', `${QUOTE_PREFIX}worth a look`),
        comment('c3', 'about 2x', 'c1', FOUNDER),
        comment('c4', 'nice', 'c1', 'p2')
      ])
    );
    expect(e).toEqual({
      like: 2,
      reply: 2,
      authorReply: 1,
      repost: 1,
      quote: 1,
      bookmark: 1,
      notInterested: 1,
      report: 1
    });
  });
});

describe('forYouImpressions', () => {
  it('is zero for a non-positive score and grows towards the reach', () => {
    expect(forYouImpressions(0, 500, 1)).toBe(0);
    expect(forYouImpressions(-3, 500, 1)).toBe(0);
    expect(forYouImpressions(1, 500, 1)).toBe(250);
    expect(forYouImpressions(100, 500, 1)).toBeLessThan(500);
  });
});
