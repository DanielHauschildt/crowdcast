import {
  fetchUserComments,
  type FetchFn,
  type UserComment
} from './hn-users.js';
import type { Llm } from './llm.js';
import { tierFor } from './personas.js';
import type { Persona, PersonaSet, Segment } from './types.js';

const QUOTE_WORDS = 8;
const MIN_COMMENTS = 3;
const COMMENT_CHARS = 8000;
const FETCH_BATCH = 8;

const tokens = (s: string): string[] =>
  s.toLowerCase().match(/[\p{L}\p{N}_'-]+/gu) ?? [];

const ngrams = (words: string[]): string[] =>
  Array.from({ length: Math.max(0, words.length - QUOTE_WORDS + 1) }, (_, i) =>
    words.slice(i, i + QUOTE_WORDS).join(' ')
  );

const LINK = /https?:\/\/|www\.|\b[\w-]+\.(com|io|org|net|dev|ai|co|app|me)\b/i;

/** Why `text` would carry a real commenter's identity into a persona file, or null when it doesn't. */
export function leak(
  text: string,
  username: string,
  sources: readonly string[]
): string | null {
  if (LINK.test(text)) return 'contains a link';
  const words = tokens(text);
  const name = username.toLowerCase();
  if (name && words.includes(name)) return 'contains the username';
  const lifted = new Set(sources.flatMap((s) => ngrams(tokens(s))));
  if (ngrams(words).some((g) => lifted.has(g)))
    return `contains a ${QUOTE_WORDS}-word quote`;
  return null;
}

const ADJ = [
  'quiet',
  'amber',
  'brisk',
  'lunar',
  'rusty',
  'mellow',
  'sharp',
  'dusty',
  'polar',
  'vivid',
  'stoic',
  'noisy',
  'tidy',
  'odd',
  'calm',
  'grim'
];
const NOUN = [
  'otter',
  'kernel',
  'falcon',
  'pixel',
  'badger',
  'compiler',
  'heron',
  'socket',
  'lynx',
  'parser',
  'walrus',
  'daemon',
  'finch',
  'buffer',
  'moose',
  'thread'
];

const hash = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

/** A generated handle; never the commenter's own. */
export function handleFor(id: string, username: string): string {
  for (let salt = 0; ; salt++) {
    const h = hash(`${id}#${salt}`);
    const handle = `${ADJ[h % 16]}_${NOUN[(h >>> 4) % 16]}${(h >>> 8) % 100}`;
    if (handle !== username.toLowerCase()) return handle;
  }
}

export interface AuthorRef {
  username: string;
  sourceThreads: string[];
}

/** Round-robin over threads (each list busiest first) so every thread contributes before any contributes twice. */
export function selectAuthors(
  byThread: ReadonlyArray<{ thread: string; authors: readonly string[] }>,
  max: number
): AuthorRef[] {
  const picked: string[] = [];
  const longest = Math.max(0, ...byThread.map((t) => t.authors.length));
  for (let r = 0; r < longest && picked.length < max; r++)
    for (const t of byThread) {
      const a = t.authors[r];
      if (a !== undefined && !picked.includes(a) && picked.length < max)
        picked.push(a);
    }
  return picked.map((username) => ({
    username,
    sourceThreads: [
      ...new Set(
        byThread
          .filter((t) => t.authors.includes(username))
          .map((t) => t.thread)
      )
    ]
  }));
}

/** Leakage guard for backtests: drop every persona derived from `threadId`. */
export function excludeThread(set: PersonaSet, threadId: string): PersonaSet {
  return {
    ...set,
    personas: set.personas.filter((p) => !p.sourceThreads?.includes(threadId))
  };
}

interface Summary {
  segment: string;
  bio: string;
  expertise: string[];
  aiAttitude: number;
  verbosity: number;
  contrarian: number;
  activity: number;
  voiceSample: string;
}

const SYSTEM =
  "You turn one Hacker News commenter's recent public comments into an anonymous persona for a " +
  'social simulation. Capture what they know, what they care about, how they argue and how they ' +
  'write. Never include their username, any name they use, a link, an employer they name, or any ' +
  'sentence copied from the comments: paraphrase everything, and write voiceSample as a new ' +
  'comment on a different topic in their style. Generalise rare personal details (exact age, ' +
  'city, life history, hobbies few people share) to the level of a typical HN profile, so the ' +
  'persona could not be traced back to them.';

const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

function prompt(
  comments: readonly UserComment[],
  segments: readonly Segment[]
): string {
  const dates = comments
    .map((c) => c.createdAt)
    .filter(Boolean)
    .sort();
  let budget = COMMENT_CHARS;
  const shown: string[] = [];
  for (const c of comments) {
    if (budget <= 0) break;
    shown.push(`- ${c.text.slice(0, budget)}`);
    budget -= c.text.length;
  }
  return [
    `Segments (pick the one this commenter fits best):`,
    ...segments.map((s) => `- ${s.id}: ${s.leanings}`),
    '',
    `They wrote ${comments.length} comments between ${dates[0]?.slice(0, 10) ?? '?'} and ${dates.at(-1)?.slice(0, 10) ?? '?'}, newest first:`,
    ...shown,
    '',
    'activity = chance (0–1) they comment when they open a Show HN thread (judge from how often ' +
      'and how readily they comment). contrarian = tendency (0–1) to push back. aiAttitude = -2 ' +
      'hostile … 2 enthusiastic about AI tools. verbosity = 1 terse … 3 long-winded. bio = 1–2 ' +
      'sentences on who they seem to be.'
  ].join('\n');
}

export async function personaFromHn(
  llm: Llm,
  author: AuthorRef & { comments: readonly UserComment[] },
  segments: readonly Segment[],
  id: string
): Promise<Persona | null> {
  const ids = segments.map((s) => s.id);
  const sources = author.comments.map((c) => c.text);
  const res = await llm.call({
    tier: 'opus',
    system: SYSTEM,
    label: `hn-persona:${id}`,
    prompt: prompt(author.comments, segments),
    schema: {
      type: 'object',
      required: [
        'segment',
        'bio',
        'expertise',
        'aiAttitude',
        'verbosity',
        'contrarian',
        'activity',
        'voiceSample'
      ],
      properties: {
        segment: { enum: ids },
        bio: { type: 'string' },
        expertise: { type: 'array', items: { type: 'string' } },
        aiAttitude: { type: 'integer', minimum: -2, maximum: 2 },
        verbosity: { type: 'integer', minimum: 1, maximum: 3 },
        contrarian: { type: 'number', minimum: 0, maximum: 1 },
        activity: { type: 'number', minimum: 0, maximum: 1 },
        voiceSample: { type: 'string' }
      }
    },
    validate: (x): x is Summary => {
      const s = x as Partial<Summary>;
      return (
        typeof s === 'object' &&
        s !== null &&
        ids.includes(s.segment ?? '') &&
        typeof s.bio === 'string' &&
        Array.isArray(s.expertise) &&
        s.expertise.every((e) => typeof e === 'string') &&
        typeof s.aiAttitude === 'number' &&
        typeof s.verbosity === 'number' &&
        typeof s.contrarian === 'number' &&
        typeof s.activity === 'number' &&
        typeof s.voiceSample === 'string' &&
        leak(
          [s.bio, ...s.expertise, s.voiceSample].join('\n'),
          author.username,
          sources
        ) === null
      );
    }
  });
  if (!res.ok) return null;
  const s = res.value;
  return {
    id,
    segment: s.segment,
    handle: handleFor(id, author.username),
    bio: s.bio,
    expertise: s.expertise,
    aiAttitude: clamp(Math.round(s.aiAttitude), -2, 2),
    verbosity: clamp(Math.round(s.verbosity), 1, 3),
    contrarian: clamp(s.contrarian, 0, 1),
    activity: clamp(s.activity, 0, 1),
    voiceSample: s.voiceSample,
    tier: tierFor(id),
    sourceThreads: author.sourceThreads
  };
}

export interface BuildHnPersonasArgs {
  llm: Llm;
  byThread: ReadonlyArray<{ thread: string; authors: readonly string[] }>;
  segments: readonly Segment[];
  max: number;
  fetchFn?: FetchFn;
  log?: (msg: string) => void;
}

export async function buildHnPersonas(
  a: BuildHnPersonasArgs
): Promise<Persona[]> {
  const candidates = selectAuthors(a.byThread, Infinity);
  const chosen: Array<AuthorRef & { comments: UserComment[] }> = [];
  let quiet = 0;
  for (
    let i = 0;
    i < candidates.length && chosen.length < a.max;
    i += FETCH_BATCH
  ) {
    const batch = candidates.slice(i, i + FETCH_BATCH);
    const fetched = await Promise.all(
      batch.map(async (c) => ({
        ...c,
        comments: await fetchUserComments(c.username, 40, a.fetchFn)
      }))
    );
    for (const f of fetched) {
      if (chosen.length >= a.max) break;
      if (f.comments.length < MIN_COMMENTS) quiet++;
      else chosen.push(f);
    }
  }
  const built = await Promise.all(
    chosen.map((c, i) => personaFromHn(a.llm, c, a.segments, `h${i + 1}`))
  );
  const personas = built.filter((p): p is Persona => p !== null);
  a.log?.(
    `hn personas: ${personas.length} built, ${quiet} skipped (fewer than ${MIN_COMMENTS} comments), ${built.length - personas.length} failed or leaked`
  );
  return personas;
}
