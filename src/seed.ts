import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parse } from 'yaml';
import type { Post, Seed, Segment } from './types.js';

const FIRST_COMMENT = '<!-- first-comment -->';

export function parsePost(text: string, file: string): Post {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file}: missing front matter (--- title/url ---)`);
  const meta = (parse(m[1]!) ?? {}) as Record<string, unknown>;
  if (typeof meta.title !== 'string' || !meta.title.trim()) {
    throw new Error(`${file}: front matter needs a non-empty "title"`);
  }
  const [body, first] = m[2]!.split(FIRST_COMMENT);
  return {
    title: meta.title.trim(),
    url: typeof meta.url === 'string' ? meta.url.trim() : '',
    body: (body ?? '').trim(),
    firstComment: first?.trim() ? first.trim() : null
  };
}

function readRequired(dir: string, name: string): string {
  const file = join(dir, name);
  if (!existsSync(file))
    throw new Error(`seed ${dir}: missing required file ${name}`);
  return readFileSync(file, 'utf8');
}

export function parseSegments(text: string): {
  active: number;
  voters: number;
  segments: Segment[];
} {
  const raw = (parse(text) ?? {}) as Record<string, unknown>;
  const fail = (msg: string): never => {
    throw new Error(`segments.yaml: ${msg}`);
  };
  const active = Number(raw.active);
  const voters = Number(raw.voters ?? 0);
  if (!Number.isInteger(active) || active < 1)
    fail('"active" must be an integer ≥ 1');
  if (!Number.isInteger(voters) || voters < 0)
    fail('"voters" must be an integer ≥ 0');
  if (!Array.isArray(raw.segments) || raw.segments.length === 0)
    fail('"segments" must be a non-empty list');
  const segments = (raw.segments as Array<Record<string, unknown>>).map(
    (s, i) => {
      if (typeof s.id !== 'string' || !s.id) fail(`segment ${i} needs an "id"`);
      const share = Number(s.share);
      if (!(share > 0))
        fail(`segment ${String(s.id)} needs a positive "share"`);
      return { id: s.id as string, share, leanings: String(s.leanings ?? '') };
    }
  );
  if (new Set(segments.map((s) => s.id)).size !== segments.length)
    fail('segment ids must be unique');
  const sum = segments.reduce((a, s) => a + s.share, 0);
  if (Math.abs(sum - 1) > 0.01)
    fail(`shares must sum to 1 (got ${Number(sum.toFixed(3))})`);
  return { active, voters, segments };
}

export function loadSeed(dirArg: string): Seed {
  const dir = resolve(dirArg);
  const hypothesesFile = join(dir, 'hypotheses.md');
  const segs = parseSegments(readRequired(dir, 'segments.yaml'));
  readRequired(dir, 'post.md');
  return {
    name: basename(dir),
    dir,
    context: readRequired(dir, 'context.md'),
    founderAnswers: readRequired(dir, 'founder-answers.md'),
    hypotheses: existsSync(hypothesesFile)
      ? readFileSync(hypothesesFile, 'utf8')
      : '',
    segments: segs.segments,
    activeCount: segs.active,
    voterCount: segs.voters
  };
}

export function loadPost(seed: Seed, variant: string): Post {
  const rel = variant === 'default' ? 'post.md' : `variants/${variant}.md`;
  const file = join(seed.dir, rel);
  if (!existsSync(file))
    throw new Error(
      `variant "${variant}" not found: expected ${rel} in ${seed.dir}`
    );
  return parsePost(readFileSync(file, 'utf8'), rel);
}
