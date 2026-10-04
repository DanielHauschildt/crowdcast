import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  fetchThread,
  githubRepo,
  MAX_CONTEXT_CHARS,
  stripHtml,
  type FetchFn
} from './hn.js';

const item = (over: Record<string, unknown> = {}) => ({
  id: 100,
  type: 'story',
  author: 'alice',
  created_at: '2025-01-01T10:00:00.000Z',
  parent_id: null,
  title: 'Show HN: Thing',
  url: 'https://thing.dev',
  text: '<p>We built &quot;Thing&quot;.</p>',
  points: 42,
  children: [
    {
      id: 101,
      type: 'comment',
      author: 'bob',
      created_at: '2025-01-01T10:05:00.000Z',
      parent_id: 100,
      text: 'Looks nice&#x2F;neat<p>How much?',
      children: [
        {
          id: 102,
          type: 'comment',
          author: 'alice',
          created_at: '2025-01-01T10:06:00.000Z',
          parent_id: 101,
          text: 'Free for now.',
          children: []
        }
      ]
    },
    {
      id: 103,
      type: 'comment',
      author: null,
      created_at: '2025-01-01T10:07:00.000Z',
      parent_id: 100,
      text: null,
      children: []
    }
  ],
  ...over
});

function fakeFetch(routes: Record<string, string | number>): FetchFn & {
  calls: string[];
} {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const body = routes[url];
    if (body === undefined || typeof body === 'number')
      return { ok: false, status: body ?? 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  };
  return Object.assign(fn, { calls });
}

const ITEM_URL = 'https://hn.algolia.com/api/v1/items/100';

describe('stripHtml', () => {
  it('decodes entities, turns paragraphs into newlines and keeps link text', () => {
    expect(
      stripHtml(
        'a &amp; b&#x27;s &lt;x&gt;<p>next <a href="https:&#x2F;&#x2F;e.com">e.com</a> &#39;q&#39;'
      )
    ).toBe("a & b's <x>\n\nnext e.com 'q'");
  });

  it('drops script and style bodies', () => {
    expect(
      stripHtml(
        '<html><style>.a{}</style><script>var x = "<b>";</script><h1>Hi</h1></html>'
      )
    ).toBe('Hi');
  });

  it('never leaves a tag behind', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.string(),
            fc.constantFrom('<p>', '</a>', '<a href="x">', '<br/>', '<i>')
          )
        ),
        (parts) => {
          const out = stripHtml(parts.join('').replace(/[<>&]/g, ' '));
          return !/<\/?[a-z][^>]*>/i.test(out);
        }
      )
    );
    fc.assert(
      fc.property(fc.string(), (s) => {
        const tagged = `<p>${s.replace(/[<>&]/g, ' ')}</p>`;
        return !/<\/?p>/.test(stripHtml(tagged));
      })
    );
  });
});

describe('githubRepo', () => {
  it('finds owner/repo in repo, tree and blob urls', () => {
    expect(githubRepo('https://github.com/onlook-dev/onlook')).toEqual({
      owner: 'onlook-dev',
      repo: 'onlook'
    });
    expect(
      githubRepo('https://github.com/trycua/cua/tree/main/libs/lumier')
    ).toEqual({ owner: 'trycua', repo: 'cua' });
    expect(githubRepo('https://github.com/a/b.git')).toEqual({
      owner: 'a',
      repo: 'b'
    });
    expect(githubRepo('https://github.com/artifact-keeper')).toBeNull();
    expect(githubRepo('https://vecti.com')).toBeNull();
  });
});

describe('fetchThread', () => {
  it('flattens the tree, strips html, drops deleted comments and reads the linked page', async () => {
    const fetch = fakeFetch({
      [ITEM_URL]: JSON.stringify(item()),
      'https://thing.dev': '<html><body><h1>Thing</h1><p>Docs</p></body></html>'
    });
    const t = await fetchThread(100, fetch);
    expect(t.op).toBe('alice');
    expect(t.points).toBe(42);
    expect(t.post).toEqual({
      title: 'Show HN: Thing',
      url: 'https://thing.dev',
      body: 'We built "Thing".',
      firstComment: null
    });
    expect(t.comments).toEqual([
      {
        id: '101',
        parent: 'post',
        author: 'bob',
        createdAt: '2025-01-01T10:05:00.000Z',
        text: 'Looks nice/neat\n\nHow much?'
      },
      {
        id: '102',
        parent: '101',
        author: 'alice',
        createdAt: '2025-01-01T10:06:00.000Z',
        text: 'Free for now.'
      }
    ]);
    expect(t.context).toBe('Thing\n\nDocs');
  });

  it("uses the OP's earliest top-level comment as the first comment when the post has no text", async () => {
    const tree = item({ text: null });
    const opTop = {
      id: 104,
      type: 'comment',
      author: 'alice',
      created_at: '2025-01-01T10:01:00.000Z',
      parent_id: 100,
      text: 'Hi HN, I made this.',
      children: []
    };
    (tree.children as unknown[]).push(opTop);
    const t = await fetchThread(
      100,
      fakeFetch({ [ITEM_URL]: JSON.stringify(tree) })
    );
    expect(t.post.body).toBe('');
    expect(t.post.firstComment).toBe('Hi HN, I made this.');
  });

  it('reads a GitHub repo through its README', async () => {
    const fetch = fakeFetch({
      [ITEM_URL]: JSON.stringify(
        item({ url: 'https://github.com/o/r/tree/main' })
      ),
      'https://api.github.com/repos/o/r/readme': '# R\n\nreadme body'
    });
    const t = await fetchThread(100, fetch);
    expect(t.context).toBe('# R\n\nreadme body');
  });

  it('falls back to the page when the README is unavailable, and caps the text', async () => {
    const fetch = fakeFetch({
      [ITEM_URL]: JSON.stringify(item({ url: 'https://github.com/o/r' })),
      'https://github.com/o/r': `<p>${'x'.repeat(MAX_CONTEXT_CHARS * 2)}</p>`
    });
    const t = await fetchThread(100, fetch);
    expect(t.context).toHaveLength(MAX_CONTEXT_CHARS);
  });

  it('uses the post text as context when there is no link or the page fails', async () => {
    const noUrl = await fetchThread(
      100,
      fakeFetch({ [ITEM_URL]: JSON.stringify(item({ url: null })) })
    );
    expect(noUrl.post.url).toBe('');
    expect(noUrl.context).toBe('We built "Thing".');
    const broken = await fetchThread(
      100,
      fakeFetch({
        [ITEM_URL]: JSON.stringify(item()),
        'https://thing.dev': 500
      })
    );
    expect(broken.context).toBe('We built "Thing".');
  });

  it('fails with the item id when the thread cannot be fetched', async () => {
    await expect(fetchThread(100, fakeFetch({}))).rejects.toThrow(/100.*404/);
  });
});
