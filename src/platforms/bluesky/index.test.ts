import { describe, expect, it } from 'vitest';
import { makePersona, makePost } from '../../../test/fixtures.js';
import { applyEvent, emptyThread, type ThreadState } from '../../thread.js';
import type { SimEvent } from '../../types.js';
import { loadSeed } from '../../seed.js';
import { loadPlatform } from '../index.js';
import bluesky from './index.js';
import { QUOTE_PREFIX } from './prompts.js';

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
const comment = (id: string, text: string, parent = 'post'): SimEvent => ({
  kind: 'comment',
  step: 0,
  id,
  parent,
  author: 'p1',
  text
});
const fraction = (s: ThreadState, followers = 2000, step = 0): number =>
  bluesky.visibility(s, step, { followers }).visitorFraction;

describe('loadPlatform("bluesky")', () => {
  it('loads the Bluesky platform', async () => {
    const p = await loadPlatform('bluesky');
    expect(p.id).toBe('bluesky');
    expect(p.stepMinutes).toBe(15);
    expect(p.defaultSteps).toBe(16);
    expect(p.votes).toEqual(['like', 'repost', 'none']);
    expect(p.commentVote).toBe('like');
    expect(p.bands).toEqual(['viral', 'spreading', 'followers', 'quiet']);
    expect(p.agentSystem(makePersona(1))).toContain('Bluesky');
    expect(p.agentRules).toContain('300');
    for (const text of [
      p.voterSystem,
      p.founderSystem(2),
      p.personaSystem,
      p.voterPersonaSystem,
      p.labelSystem,
      p.reportSystem,
      p.themesSystem,
      p.recallSystem
    ])
      expect(text).toContain('Bluesky');
    expect(p.reportTitle(makePost())).toContain('Bluesky');
    expect(typeof p.fetchReference).toBe('function');
  });

  it('applies platform.yaml overrides and rejects unknown keys', async () => {
    const p = await loadPlatform('bluesky', { audiencePool: 10 });
    expect(fraction(emptyThread(makePost()), 2000)).toBeLessThan(
      p.visibility(emptyThread(makePost()), 0, { followers: 2000 })
        .visitorFraction
    );
    await expect(loadPlatform('bluesky', { nope: 1 })).rejects.toThrow(
      /platform.yaml.*nope/
    );
    await expect(
      loadPlatform('bluesky', { audiencePool: 'big' })
    ).rejects.toThrow(/audiencePool/);
  });
});

describe('bluesky visibility', () => {
  const pool = bluesky.withOptions!({ audiencePool: 1e9 });
  const f = (s: ThreadState, followers = 2000, step = 0): number =>
    pool.visibility(s, step, { followers }).visitorFraction;

  it('grows with followers and decays with age', () => {
    const s = thread([]);
    expect(f(s, 5000)).toBeGreaterThan(f(s, 500));
    expect(f(s, 2000, 8)).toBeLessThan(f(s, 2000, 0));
  });

  it('adds reach for reposts but not for likes', () => {
    expect(f(thread([vote('v1', 'repost')]))).toBeGreaterThan(f(thread([])));
    expect(f(thread([vote('v1', 'like')]))).toBe(f(thread([])));
  });

  it('a quote is a new root post that adds reach; a reply is not', () => {
    const base = f(thread([]));
    expect(f(thread([comment('c1', 'nice')]))).toBe(base);
    expect(
      f(thread([comment('c1', `${QUOTE_PREFIX}look at this`)]))
    ).toBeGreaterThan(base);
    expect(
      f(thread([comment('c1', 'a'), comment('c2', `${QUOTE_PREFIX}x`, 'c1')]))
    ).toBe(base);
  });

  it('caps the visitor fraction at 1 and names the band', () => {
    const v = bluesky.visibility(thread([]), 0, { followers: 10_000_000 });
    expect(v).toEqual({ band: 'viral', visitorFraction: 1 });
  });

  it('falls back to the reference median followers without an author', () => {
    expect(f(thread([]), 0)).toBeLessThan(
      pool.visibility(thread([]), 0).visitorFraction
    );
  });
});

describe('examples/bluesky-tablecraft', () => {
  it('is a Bluesky seed with followers and a pool the size of its crowd', async () => {
    const seed = loadSeed('examples/bluesky-tablecraft');
    expect(seed.platform).toBe('bluesky');
    expect(seed.author?.followers).toBe(2000);
    expect(seed.options).toEqual({
      audiencePool: seed.activeCount + seed.voterCount
    });
    const p = await loadPlatform('bluesky', seed.options);
    expect(
      p.visibility(thread([]), 0, seed.author).visitorFraction
    ).toBeGreaterThan(0);
  });
});
