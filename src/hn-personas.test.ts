import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makePersona, makeVoter } from '../test/fixtures.js';
import {
  buildHnPersonas,
  excludeThread,
  handleFor,
  leak,
  personaFromHn,
  selectAuthors
} from './hn-personas.js';
import type { FetchFn } from './hn-users.js';
import { FakeLlm, type LlmRequest } from './llm.js';
import { tierFor } from './personas.js';
import type { Segment } from './types.js';

const SEGMENTS: Segment[] = [
  { id: 'builders', share: 0.5, leanings: 'curious' },
  { id: 'skeptics', share: 0.5, leanings: 'grumpy' }
];

const word = fc.stringMatching(/^[a-z]{2,7}$/);

describe('leak', () => {
  it('catches any 8-word run lifted from a source comment', () => {
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 8, maxLength: 30 }),
        fc.nat(),
        fc.array(word, { maxLength: 5 }),
        (source, at, around) => {
          const start = at % (source.length - 7);
          const lifted = source.slice(start, start + 8).join(' ');
          const text = `${around.join(' ')} ${lifted.toUpperCase()}, ${around.join(' ')}`;
          expect(leak(text, 'someone', [source.join(' ')])).toMatch(/quote/);
        }
      )
    );
  });

  it('passes original text and flags urls and the username', () => {
    const src = [
      'I have been writing Rust for years and the borrow checker is fine.'
    ];
    expect(
      leak('Writes Rust; likes the borrow checker.', 'rustfan', src)
    ).toBeNull();
    expect(leak('see https://x.io', 'rustfan', src)).toMatch(/link/);
    expect(leak('blog at example.com', 'rustfan', src)).toMatch(/link/);
    expect(leak('Known as RustFan here.', 'rustfan', src)).toMatch(/username/);
  });
});

describe('handleFor', () => {
  it('is deterministic and never the real username', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (id, username) => {
        expect(handleFor(id, username)).toBe(handleFor(id, username));
        expect(handleFor(id, username).toLowerCase()).not.toBe(
          username.toLowerCase()
        );
      })
    );
    const h = handleFor('h1', 'x');
    expect(handleFor('h1', h)).not.toBe(h);
  });
});

describe('selectAuthors', () => {
  const threads = fc.array(
    fc.record({
      thread: fc.stringMatching(/^\d{1,4}$/),
      authors: fc.uniqueArray(
        fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f').map((s): string => s)
      )
    }),
    { maxLength: 5 }
  );

  it('picks unique authors round-robin across threads with every source thread', () => {
    fc.assert(
      fc.property(threads, fc.nat(20), (byThread, max) => {
        const picked = selectAuthors(byThread, max);
        expect(picked.length).toBeLessThanOrEqual(max);
        const names = picked.map((p) => p.username);
        expect(new Set(names).size).toBe(names.length);
        for (const p of picked) {
          expect(p.sourceThreads).toEqual([
            ...new Set(
              byThread
                .filter((t) => t.authors.includes(p.username))
                .map((t) => t.thread)
            )
          ]);
        }
        const nonEmpty = new Set(
          byThread.filter((t) => t.authors.length).map((t) => t.thread)
        );
        if (max >= byThread.length)
          for (const t of nonEmpty)
            expect(picked.some((p) => p.sourceThreads.includes(t))).toBe(true);
      })
    );
  });

  it('takes the busiest commenters of each thread first', () => {
    expect(
      selectAuthors(
        [
          { thread: '1', authors: ['a', 'b', 'c'] },
          { thread: '2', authors: ['x', 'a', 'y'] }
        ],
        4
      ).map((p) => p.username)
    ).toEqual(['a', 'x', 'b', 'c']);
  });
});

describe('excludeThread', () => {
  const set = {
    personas: [
      makePersona(1, { sourceThreads: ['1'] }),
      makePersona(2, { sourceThreads: ['1', '2'] }),
      makePersona(3, { sourceThreads: ['3'] }),
      makePersona(4)
    ],
    voters: [makeVoter(1)]
  };

  it('drops every persona derived from the thread and nothing else', () => {
    const out = excludeThread(set, '1');
    expect(out.personas.map((p) => p.id)).toEqual(['p3', 'p4']);
    expect(out.voters).toBe(set.voters);
    expect(excludeThread(out, '1')).toEqual(out);
  });

  it('never keeps a persona sourced from the thread', () => {
    fc.assert(
      fc.property(fc.constantFrom('1', '2', '3', '9'), (t) => {
        const out = excludeThread(set, t);
        expect(out.personas.every((p) => !p.sourceThreads?.includes(t))).toBe(
          true
        );
        expect(out.personas.length).toBe(
          set.personas.filter((p) => !p.sourceThreads?.includes(t)).length
        );
      })
    );
  });
});

const COMMENTS = [
  'The borrow checker stopped being a problem for me after two weeks of real use.',
  'Every MCP server I tried leaked tokens like a sieve, so I wrote my own proxy.',
  'Show me the pricing page before the demo video, please.'
].map((text, i) => ({
  text,
  createdAt: `2026-0${i + 1}-01T00:00:00Z`,
  storyId: null
}));

const summary = (over: Record<string, unknown> = {}) => ({
  segment: 'skeptics',
  bio: 'Systems programmer at a mid-size company; tired of AI hype.',
  expertise: ['rust', 'proxies'],
  aiAttitude: -1,
  verbosity: 2,
  contrarian: 0.7,
  activity: 0.3,
  voiceSample: 'Cool, but what does it cost per run once the tokens add up?',
  ...over
});

describe('personaFromHn', () => {
  const author = {
    username: 'realname42',
    sourceThreads: ['77'],
    comments: COMMENTS
  };

  it('summarises with opus without ever sending or storing the username', async () => {
    const llm = new FakeLlm(() => summary());
    const p = await personaFromHn(llm, author, SEGMENTS, 'h3');
    expect(llm.requests[0]!.tier).toBe('opus');
    expect(llm.requests[0]!.prompt + llm.requests[0]!.system).not.toContain(
      'realname42'
    );
    expect(llm.requests[0]!.prompt).toContain('skeptics');
    expect(p).toMatchObject({
      id: 'h3',
      segment: 'skeptics',
      tier: tierFor('h3'),
      sourceThreads: ['77'],
      aiAttitude: -1
    });
    expect(JSON.stringify(p)).not.toContain('realname42');
  });

  it('returns null when the summary quotes, links, names or picks an unknown segment', async () => {
    for (const bad of [
      summary({ voiceSample: COMMENTS[1] }),
      summary({ bio: 'Blogs at https://me.dev' }),
      summary({ bio: 'realname42 on HN' }),
      summary({ segment: 'nope' })
    ]) {
      expect(
        await personaFromHn(new FakeLlm(() => bad), author, SEGMENTS, 'h1')
      ).toBeNull();
    }
  });
});

describe('buildHnPersonas', () => {
  const fetchFn: FetchFn = async (url) => {
    const few = url.includes('author_quiet');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        hits: (few ? COMMENTS.slice(0, 1) : COMMENTS).map((c) => ({
          comment_text: c.text,
          created_at: c.createdAt
        }))
      })
    };
  };

  it('builds up to max personas, skipping quiet users and failed summaries', async () => {
    const llm = new FakeLlm((req: LlmRequest<unknown>) =>
      req.label === 'hn-persona:h2' ? new Error('nope') : summary()
    );
    const logs: string[] = [];
    const out = await buildHnPersonas({
      llm,
      byThread: [
        { thread: '1', authors: ['quiet', 'alice', 'bob'] },
        { thread: '2', authors: ['carol', 'dave'] }
      ],
      segments: SEGMENTS,
      max: 3,
      fetchFn,
      log: (m) => logs.push(m)
    });
    expect(out.map((p) => p.id)).toEqual(['h1', 'h3']);
    expect(new Set(out.map((p) => p.handle)).size).toBe(out.length);
    const json = JSON.stringify(out);
    for (const name of ['quiet', 'alice', 'bob', 'carol', 'dave'])
      expect(json).not.toContain(`"${name}"`);
    expect(logs.join('\n')).toMatch(/1 skipped/);
  });
});
