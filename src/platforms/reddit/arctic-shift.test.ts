import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../../platform.js';
import { fetchReference } from './arctic-shift.js';

const ID = 'abc12';
const NUM = parseInt(ID, 36);
const T0 = 1709035000;

const comment = (
  id: string,
  parent: string,
  author: string,
  body: string,
  score: number,
  at: number,
  replies: unknown[] = []
): unknown => ({
  kind: 't1',
  data: {
    id,
    parent_id: parent,
    link_id: `t3_${ID}`,
    author,
    body,
    score,
    created_utc: at,
    replies: replies.length
      ? { kind: 'Listing', data: { children: replies } }
      : ''
  }
});

const post = (over: Record<string, unknown> = {}): unknown => ({
  data: [
    {
      id: ID,
      author: 'maker',
      title: 'I built a thing',
      selftext:
        'It does stuff &amp; more.\n\n&#x200B;\n\nTry it: [here](https://thing.example)',
      is_self: true,
      url: `https://www.reddit.com/r/SideProject/comments/${ID}/i_built/`,
      score: 42,
      created_utc: T0,
      subreddit: 'SideProject',
      ...over
    }
  ]
});

const tree = {
  data: [
    comment('k1', `t3_${ID}`, 'alice', 'Is it open source?', 7, T0 + 60, [
      comment('k2', 't1_k1', 'maker', 'Yes, MIT.', 3, T0 + 120, [
        comment('k3', 't1_k2', 'bob', 'nice &gt; closed', -2, T0 + 180)
      ])
    ]),
    comment('k4', `t3_${ID}`, '[deleted]', '[deleted]', 1, T0 + 90, [
      comment('k5', 't1_k4', 'carol', 'lost reply', 1, T0 + 100)
    ]),
    comment('k6', `t3_${ID}`, 'AutoModerator', 'Rules reminder', 1, T0 + 5),
    comment('k7', `t3_${ID}`, 'dave', '[removed]', 1, T0 + 30),
    { kind: 'more', data: { children: ['k8'] } }
  ]
};

function fakeFetch(postBody: unknown, page = '<p>Thing landing page</p>') {
  const urls: string[] = [];
  const fn: FetchFn = async (url) => {
    urls.push(url);
    const body = url.includes('/api/posts/ids')
      ? JSON.stringify(postBody)
      : url.includes('/api/comments/tree')
        ? JSON.stringify(tree)
        : url.startsWith('https://thing.example')
          ? page
          : null;
    return {
      ok: body !== null,
      status: body === null ? 404 : 200,
      text: async () => body ?? ''
    };
  };
  return { fn, urls };
}

describe('fetchReference (Arctic Shift)', () => {
  it('maps a self post and its comment tree to a RealThread', async () => {
    const { fn, urls } = fakeFetch(post());
    const t = await fetchReference(NUM, fn);
    expect(urls[0]).toBe(
      `https://arctic-shift.photon-reddit.com/api/posts/ids?ids=${ID}`
    );
    expect(urls[1]).toMatch(
      new RegExp(`/api/comments/tree\\?link_id=t3_${ID}&limit=\\d+`)
    );
    expect(t.id).toBe(NUM);
    expect(t.op).toBe('maker');
    expect(t.points).toBe(42);
    expect(t.post).toEqual({
      title: 'I built a thing',
      url: '',
      body: 'It does stuff & more.\n\nTry it: [here](https://thing.example)',
      firstComment: null
    });
    expect(t.comments).toEqual([
      {
        id: 'k1',
        parent: 'post',
        author: 'alice',
        createdAt: new Date((T0 + 60) * 1000).toISOString(),
        text: 'Is it open source?',
        points: 7
      },
      {
        id: 'k2',
        parent: 'k1',
        author: 'maker',
        createdAt: new Date((T0 + 120) * 1000).toISOString(),
        text: 'Yes, MIT.',
        points: 3
      },
      {
        id: 'k3',
        parent: 'k2',
        author: 'bob',
        createdAt: new Date((T0 + 180) * 1000).toISOString(),
        text: 'nice > closed',
        points: -2
      }
    ]);
    expect(t.context).toBe('Thing landing page');
  });

  it('uses the link of a link post and falls back to the body for context', async () => {
    const { fn } = fakeFetch(
      post({ is_self: false, url: 'https://gone.example', selftext: '' })
    );
    const t = await fetchReference(NUM, fn);
    expect(t.post.url).toBe('https://gone.example');
    expect(t.post.body).toBe('');
    expect(t.context).toBe('');
    const self = await fetchReference(NUM, fakeFetch(post(), '').fn);
    expect(self.context).toBe(self.post.body);
  });

  it('never fetches Reddit-hosted media and falls back to the OP comment for context', async () => {
    const { fn, urls } = fakeFetch(
      post({
        is_self: false,
        url: 'https://v.redd.it/xyz',
        selftext: '',
        author: 'alice'
      })
    );
    const t = await fetchReference(NUM, fn);
    expect(urls.some((u) => u.includes('redd.it'))).toBe(false);
    expect(t.post.url).toBe('https://v.redd.it/xyz');
    expect(t.post.firstComment).toBe('Is it open source?');
    expect(t.context).toBe('Is it open source?');
  });

  it('fails clearly when the post is unknown', async () => {
    await expect(
      fetchReference(NUM, fakeFetch({ data: [] }).fn)
    ).rejects.toThrow(/Reddit post abc12: not found/);
  });
});
