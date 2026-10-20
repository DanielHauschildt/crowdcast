import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../../platform.js';
import { fetchBskyPost, parseRef, threadId } from './bsky-api.js';

const DID = 'did:plc:author0000000000000000';
const URI = `at://${DID}/app.bsky.feed.post/3kpost`;
const at = (min: number): string =>
  new Date(Date.parse('2026-01-01T12:00:00Z') + min * 60_000).toISOString();
const reply = (
  rkey: string,
  author: string,
  text: string,
  min: number,
  replies: unknown[] = []
) => ({
  post: {
    uri: `at://${author}/app.bsky.feed.post/${rkey}`,
    author: { did: author, handle: 'someone.example' },
    record: { text, createdAt: at(min) },
    likeCount: 2
  },
  replies
});

/** Invented AppView answers, keyed by method; getLikes pages twice. */
function fakeApi(): { fetch: FetchFn; urls: string[] } {
  const urls: string[] = [];
  const body = (url: URL): unknown => {
    const method = url.pathname.split('/').pop();
    switch (method) {
      case 'app.bsky.actor.getProfile':
        return { did: DID, followersCount: 2000 };
      case 'app.bsky.feed.getPostThread':
        return {
          thread: {
            post: {
              uri: URI,
              author: { did: DID, handle: 'maker.example' },
              record: {
                text: 'Introducing Gridline 1.0\nA tiny table editor.',
                createdAt: at(0)
              },
              embed: {
                external: {
                  uri: 'https://gridline.example',
                  title: 'Gridline',
                  description: 'Tables, fast.'
                }
              },
              likeCount: 3,
              repostCount: 2,
              quoteCount: 1,
              replyCount: 3
            },
            replies: [
              reply('r1', 'did:plc:fan', 'Nice!', 5, [
                reply('r2', DID, 'Thanks!', 9)
              ]),
              { $type: 'app.bsky.feed.defs#notFoundPost', uri: 'at://x' },
              reply('r3', 'did:plc:critic', 'Why not a spreadsheet?', 20)
            ]
          }
        };
      case 'app.bsky.feed.getLikes':
        return url.searchParams.get('cursor')
          ? { likes: [{ createdAt: at(1) }] }
          : {
              likes: [{ createdAt: at(300) }, { createdAt: at(14) }],
              cursor: 'next'
            };
      case 'app.bsky.feed.getRepostedBy':
        return { repostedBy: [{ did: 'did:plc:a' }, { did: 'did:plc:b' }] };
      case 'app.bsky.actor.getProfiles':
        return { profiles: [{ followersCount: 100 }, { followersCount: 300 }] };
      case 'app.bsky.feed.getQuotes':
        return {
          posts: [
            {
              uri: 'at://did:plc:q/app.bsky.feed.post/q1',
              author: { did: 'did:plc:q' },
              record: { text: 'Trying this today', createdAt: at(30) },
              likeCount: 4
            }
          ]
        };
      default:
        throw new Error(`unexpected ${url.href}`);
    }
  };
  const fetch: FetchFn = (url) => {
    urls.push(url);
    const json = JSON.stringify(body(new URL(url)));
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(json)
    });
  };
  return { fetch, urls };
}

describe('parseRef', () => {
  it('accepts at-URIs and bsky.app post URLs', () => {
    expect(parseRef(URI)).toEqual({ repo: DID, rkey: '3kpost' });
    expect(
      parseRef('https://bsky.app/profile/maker.example/post/3kpost')
    ).toEqual({ repo: 'maker.example', rkey: '3kpost' });
    expect(() => parseRef('https://example.com/x')).toThrow(/at-URI/);
  });
});

describe('threadId', () => {
  it('is a stable positive integer per at-URI', () => {
    expect(threadId(URI)).toBe(threadId(URI));
    expect(threadId(URI)).not.toBe(threadId(`${URI}x`));
    expect(Number.isInteger(threadId(URI)) && threadId(URI) > 0).toBe(true);
  });
});

describe('fetchBskyPost', () => {
  it('maps the AppView answers to a RealThread and a reach timeline', async () => {
    const api = fakeApi();
    const { thread, timeline } = await fetchBskyPost(URI, api.fetch, {
      delayMs: 0
    });
    expect(thread.id).toBe(threadId(URI));
    expect(thread.op).toBe(DID);
    expect(thread.post.title).toBe('Introducing Gridline 1.0');
    expect(thread.post.url).toBe('https://gridline.example');
    expect(thread.points).toBe(1 + 3 + 2);
    expect(thread.context).toContain('Tables, fast.');
    expect(
      thread.comments.map((c) => [c.id, c.parent, c.author, c.text])
    ).toEqual([
      ['b1', 'post', 'did:plc:fan', 'Nice!'],
      ['b2', 'b1', DID, 'Thanks!'],
      ['b3', 'post', 'did:plc:critic', 'Why not a spreadsheet?'],
      ['b4', 'post', 'did:plc:q', '[quote] Trying this today']
    ]);
    expect(timeline).toEqual({
      uri: URI,
      createdAt: at(0),
      followers: 2000,
      likes: 3,
      reposts: 2,
      quotes: 1,
      likeMinutes: [1, 14, 300],
      likesComplete: true,
      reposterFollowers: [100, 300]
    });
    expect(
      api.urls.every((u) => u.startsWith('https://public.api.bsky.app/xrpc/'))
    ).toBe(true);
  });

  it('resolves a handle in a bsky.app URL to its DID', async () => {
    const api = fakeApi();
    const { timeline } = await fetchBskyPost(
      'https://bsky.app/profile/maker.example/post/3kpost',
      api.fetch,
      { delayMs: 0 }
    );
    expect(timeline.uri).toBe(URI);
  });

  it('reports HTTP errors with the method', async () => {
    const fail: FetchFn = () =>
      Promise.resolve({
        ok: false,
        status: 429,
        text: () => Promise.resolve('')
      });
    await expect(fetchBskyPost(URI, fail, { delayMs: 0 })).rejects.toThrow(
      /getPostThread.*429/
    );
  });
});
