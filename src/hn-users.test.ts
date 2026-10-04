import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  fetchThreadAuthors,
  fetchUserComments,
  stripHtml,
  type FetchFn
} from './hn-users.js';

function fakeFetch(routes: Record<string, unknown>): FetchFn & {
  urls: string[];
} {
  const urls: string[] = [];
  const fn = async (url: string) => {
    urls.push(url);
    const body = Object.entries(routes).find(([k]) => url.includes(k))?.[1];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: async () => body
    };
  };
  return Object.assign(fn, { urls });
}

const item = (
  author: string | null,
  children: unknown[] = [],
  text = 'x'
): unknown => ({ type: 'comment', author, text, children });

describe('stripHtml', () => {
  it('decodes entities, keeps paragraphs and link text, drops tags', () => {
    expect(
      stripHtml(
        'It&#x27;s &quot;fine&quot; &amp; &lt;ok&gt;<p>See <a href="https://x.io">x.io</a><p><i>yes</i>'
      )
    ).toBe('It\'s "fine" & <ok>\n\nSee x.io\n\nyes');
  });

  it('leaves an out-of-range numeric entity as written', () => {
    expect(stripHtml('a&#99999999;b')).toBe('a&#99999999;b');
  });

  it('never leaves a tag behind', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constantFrom('<p>', '<i>', '</i>', '<a href="u">', '</a>'),
            fc.stringMatching(/^[a-z ]{0,8}$/)
          )
        ),
        (parts) => {
          expect(stripHtml(parts.join(''))).not.toMatch(/<\/?[a-z][^>]*>/i);
        }
      )
    );
  });
});

describe('fetchThreadAuthors', () => {
  const thread = {
    type: 'story',
    author: 'op',
    title: 'Show HN: X',
    children: [
      item('alice', [item('op'), item('bob', [item('alice')])]),
      item(null),
      item('carol'),
      item('bob'),
      item('bob')
    ]
  };

  it('lists commenters by comment count, excluding the OP and deleted comments', async () => {
    const fetchFn = fakeFetch({ '/items/42': thread });
    expect(await fetchThreadAuthors('42', fetchFn)).toEqual([
      'bob',
      'alice',
      'carol'
    ]);
    expect(fetchFn.urls).toEqual(['https://hn.algolia.com/api/v1/items/42']);
  });

  it('throws on an HTTP error', async () => {
    await expect(fetchThreadAuthors('7', fakeFetch({}))).rejects.toThrow(
      /item 7.*404/
    );
  });
});

describe('fetchUserComments', () => {
  it('queries search_by_date for the author and strips each comment', async () => {
    const fetchFn = fakeFetch({
      search_by_date: {
        hits: [
          {
            comment_text: 'a &amp; b',
            created_at: '2026-01-01T00:00:00Z',
            story_id: 9
          },
          { comment_text: null, created_at: '2026-01-02T00:00:00Z' },
          { comment_text: '<p>', created_at: '2026-01-03T00:00:00Z' }
        ]
      }
    });
    expect(await fetchUserComments('a b', 40, fetchFn)).toEqual([
      { text: 'a & b', createdAt: '2026-01-01T00:00:00Z', storyId: '9' }
    ]);
    expect(fetchFn.urls[0]).toBe(
      'https://hn.algolia.com/api/v1/search_by_date?tags=comment%2Cauthor_a%20b&hitsPerPage=40'
    );
  });
});
