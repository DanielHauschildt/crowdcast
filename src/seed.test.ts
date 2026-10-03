import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPost, loadSeed, parsePost } from './seed.js';

const POST = `---
title: "Show HN: Foo – editable files"
url: https://example.com
---
Body line.

<!-- first-comment -->
Hi HN, founder here.
`;

const SEGMENTS = `active: 6
voters: 20
segments:
  - id: a
    share: 0.5
    leanings: curious
  - id: b
    share: 0.5
    leanings: skeptical
`;

function seedDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'seed-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const base = {
  'post.md': POST,
  'context.md': 'README',
  'founder-answers.md': 'answers',
  'segments.yaml': SEGMENTS
};

describe('parsePost', () => {
  it('reads front matter, body and first comment', () => {
    expect(parsePost(POST, 'post.md')).toEqual({
      title: 'Show HN: Foo – editable files',
      url: 'https://example.com',
      body: 'Body line.',
      firstComment: 'Hi HN, founder here.'
    });
  });

  it('requires a title', () => {
    expect(() => parsePost('---\nurl: x\n---\nbody', 'v.md')).toThrow(
      /v\.md.*title/
    );
  });
});

describe('loadSeed', () => {
  it('loads a complete seed; hypotheses are optional', () => {
    const seed = loadSeed(seedDir(base));
    expect(seed.activeCount).toBe(6);
    expect(seed.voterCount).toBe(20);
    expect(seed.segments.map((s) => s.id)).toEqual(['a', 'b']);
    expect(seed.hypotheses).toBe('');
  });

  it('rejects shares that do not sum to 1', () => {
    const dir = seedDir({
      ...base,
      'segments.yaml': SEGMENTS.replace(
        'share: 0.5\n    leanings: skeptical',
        'share: 0.3\n    leanings: skeptical'
      )
    });
    expect(() => loadSeed(dir)).toThrow(/segments\.yaml.*sum to 1.*0\.8/);
  });

  it('names a missing required file', () => {
    const { 'context.md': _, ...rest } = base;
    expect(() => loadSeed(seedDir(rest))).toThrow(/context\.md/);
  });

  it('loads variants and names a missing one', () => {
    const seed = loadSeed(
      seedDir({ ...base, 'variants/b.md': POST.replace('Foo', 'Bar') })
    );
    expect(loadPost(seed, 'default').title).toContain('Foo');
    expect(loadPost(seed, 'b').title).toContain('Bar');
    expect(() => loadPost(seed, 'zzz')).toThrow(
      /variant "zzz".*variants\/zzz\.md/
    );
  });
});
