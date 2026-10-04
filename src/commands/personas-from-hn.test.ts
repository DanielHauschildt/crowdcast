import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeSeed, personaHandler } from '../../test/fixtures.js';
import type { FetchFn } from '../hn-users.js';
import { FakeLlm, type LlmRequest } from '../llm.js';
import type { PersonaSet } from '../types.js';
import { parseThreadIds, personasFromHn } from './personas-from-hn.js';

describe('parseThreadIds', () => {
  it('reads comma lists, HN urls and thread files with comments', () => {
    expect(
      parseThreadIds('1, 22,https://news.ycombinator.com/item?id=333')
    ).toEqual(['1', '22', '333']);
    const file = join(mkdtempSync(join(tmpdir(), 'th-')), 'threads.txt');
    writeFileSync(file, '# header\n41 low performer\n\n  42 # note\n41\n');
    expect(parseThreadIds(file)).toEqual(['41', '42']);
  });

  it('rejects anything that is not a thread id', () => {
    expect(() => parseThreadIds('abc')).toThrow(/abc/);
    expect(() => parseThreadIds('')).toThrow(/no thread/);
  });
});

const COMMENTS = [
  'I would rather pay for a tool than feed my data to another startup.',
  'Fonts are always the first thing these generators get wrong in practice.',
  'Is there a self-hosted version, or does everything go through your cloud?'
];

const fetchFn: FetchFn = async (url) => ({
  ok: true,
  status: 200,
  json: async () =>
    url.includes('/items/')
      ? {
          author: 'op',
          children: [
            { author: 'realuser_one', children: [{ author: 'op' }] },
            { author: 'realuser_two', children: [] }
          ]
        }
      : {
          hits: COMMENTS.map((c) => ({
            comment_text: c,
            created_at: '2026-09-01T00:00:00Z'
          }))
        }
});

function handler(req: LlmRequest<unknown>): unknown {
  if (req.label.startsWith('hn-persona'))
    return {
      segment: 'agent-builders',
      bio: 'Privacy-minded indie developer.',
      expertise: ['self-hosting'],
      aiAttitude: 0,
      verbosity: 1,
      contrarian: 0.6,
      activity: 0.2,
      voiceSample: 'Where does my data end up?'
    };
  return personaHandler(req);
}

describe('personasFromHn', () => {
  it('writes personas from the threads plus seed voters to personas/hn.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'));
    const logs: string[] = [];
    const file = await personasFromHn(
      {
        llm: new FakeLlm(handler),
        fetchFn,
        log: (m) => logs.push(m)
      },
      makeSeed({ dir, voterCount: 4 }),
      ['500'],
      80
    );
    expect(file).toBe(join(dir, 'personas', 'hn.json'));
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('realuser');
    const set = JSON.parse(text) as PersonaSet;
    expect(set.personas).toHaveLength(2);
    expect(set.personas[0]!.sourceThreads).toEqual(['500']);
    expect(set.voters).toHaveLength(4);
    expect(logs.join('\n')).toMatch(/2 built/);
  });
});
