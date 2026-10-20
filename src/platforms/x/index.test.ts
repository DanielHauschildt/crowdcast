import { describe, expect, it } from 'vitest';
import { makePersona, makePost } from '../../../test/fixtures.js';
import { disclaimerFor } from '../../report.js';
import { applyEvent, emptyThread, type ThreadState } from '../../thread.js';
import { loadPost, loadSeed } from '../../seed.js';
import { FOUNDER, type Post, type SimEvent } from '../../types.js';
import { loadPlatform } from '../index.js';
import x, { hasLink } from './index.js';
import { MAX_CHARS, X_DISCLAIMER } from './prompts.js';

function thread(events: SimEvent[], post: Post = makePost()): ThreadState {
  const s = emptyThread(post);
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
const comment = (id: string, parent = 'post', author = 'p1'): SimEvent => ({
  kind: 'comment',
  step: 0,
  id,
  parent,
  author,
  text: 'hm'
});
const votes = (value: string, n: number): SimEvent[] =>
  Array.from({ length: n }, (_, i) => vote(`v${value}${i}`, value));

const pool = x.withOptions!({ audiencePool: 1e6 });
const f = (s: ThreadState, followers = 2000, step = 0): number =>
  pool.visibility(s, step, { followers }).visitorFraction;
const noLink = makePost({
  url: '',
  body: 'Tablecraft 1.0: CSV in, chart out.'
});

describe('loadPlatform("x")', () => {
  it('loads the X platform with its reactions and short-post prompts', async () => {
    const p = await loadPlatform('x');
    expect(p.id).toBe('x');
    expect(p.votes).toEqual([
      'like',
      'repost',
      'bookmark',
      'down',
      'flag',
      'none'
    ]);
    expect(p.commentVote).toBe('like');
    expect(p.agentSystem(makePersona(1))).toContain('X (Twitter)');
    expect(p.agentRules).toContain(String(MAX_CHARS));
    expect(p.founderSystem(2)).toContain(String(MAX_CHARS));
    expect(p.reportTitle(makePost())).toContain('X launch rehearsal');
    expect(p.fetchReference).toBeUndefined();
  });

  it('applies platform.yaml overrides and rejects unknown keys', async () => {
    const p = await loadPlatform('x', { audiencePool: 10 });
    expect(
      p.visibility(thread([]), 0, { followers: 2000 }).visitorFraction
    ).toBeGreaterThan(
      x.visibility(thread([]), 0, { followers: 2000 }).visitorFraction
    );
    await expect(loadPlatform('x', { nope: 1 })).rejects.toThrow(
      /platform.yaml.*nope/
    );
    await expect(loadPlatform('x', { linkPenalty: 0 })).rejects.toThrow(
      /linkPenalty/
    );
  });
});

describe('x disclaimer', () => {
  it('reports and thread.md open with the shared disclaimer plus the unvalidated note', () => {
    expect(X_DISCLAIMER).toContain('X mode is not validated against real data');
    expect(disclaimerFor(x)).toContain(X_DISCLAIMER);
    expect(x.reportSystem).toContain('not validated');
  });
});

describe('x visibility', () => {
  it('grows with followers and works without an author', () => {
    expect(f(thread([], noLink), 5000)).toBeGreaterThan(
      f(thread([], noLink), 500)
    );
    expect(pool.visibility(thread([]), 0).visitorFraction).toBeGreaterThan(0);
  });

  it('replies earn more For You reach than the same number of likes', () => {
    const replies = thread(
      [comment('c1'), comment('c2', 'post', 'p2')],
      noLink
    );
    const likes = thread(votes('like', 2), noLink);
    expect(f(replies)).toBeGreaterThan(f(likes));
    expect(f(likes)).toBeGreaterThan(f(thread([], noLink)));
  });

  it('author replies boost reach', () => {
    const plain = thread([comment('c1'), comment('c2', 'post', 'p2')], noLink);
    const answered = thread(
      [comment('c1'), comment('c2', 'c1', FOUNDER)],
      noLink
    );
    expect(f(answered)).toBeGreaterThan(f(plain));
  });

  it('a report wipes out For You reach from many likes', () => {
    const liked = thread(votes('like', 50), noLink);
    const reported = thread([...votes('like', 50), vote('r1', 'flag')], noLink);
    expect(f(reported)).toBeLessThan(f(liked));
    expect(x.rankScore(reported, 0)).toBeLessThan(0);
    expect(x.rankScore(liked, 0)).toBeGreaterThan(0);
  });

  it('a link in the post halves For You reach; in the follow-up reply it does not', () => {
    const events = [comment('c1'), ...votes('like', 5)];
    const linked = makePost({
      url: 'https://example.com/tablecraft',
      body: 'CSV in, chart out.'
    });
    expect(f(thread(events, linked))).toBeLessThan(f(thread(events, noLink)));
    expect(
      hasLink(makePost({ url: '', body: 'see https://example.com' }))
    ).toBe(true);
    expect(hasLink({ ...noLink, firstComment: 'https://example.com' })).toBe(
      false
    );
  });

  it('caps the visitor fraction at 1', () => {
    expect(x.visibility(thread([]), 0, { followers: 1e8 })).toEqual({
      band: 'viral',
      visitorFraction: 1
    });
  });
});

describe('examples/x-tablecraft', () => {
  it('is an X seed: a 280-char post with the link in the follow-up, and a pool the size of its crowd', async () => {
    const seed = loadSeed('examples/x-tablecraft');
    expect(seed.platform).toBe('x');
    expect(seed.author?.followers).toBeGreaterThan(0);
    expect(seed.options).toEqual({
      audiencePool: seed.activeCount + seed.voterCount
    });
    const post = loadPost(seed, 'default');
    expect(post.body.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(hasLink(post)).toBe(false);
    expect(post.firstComment).toContain('https://');
    const p = await loadPlatform('x', seed.options);
    expect(
      p.visibility(thread([]), 0, seed.author).visitorFraction
    ).toBeGreaterThan(0);
  });
});
