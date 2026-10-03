import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Llm } from './llm.js';
import type { Persona, PersonaSet, Seed, Segment, Voter } from './types.js';

const PERSONA_CHUNK = 10;
const VOTER_CHUNK = 50;

/** Largest-remainder allocation: integer counts that sum exactly to `total`. */
export function allocate(
  segments: readonly Segment[],
  total: number
): Map<string, number> {
  const sum = segments.reduce((a, s) => a + s.share, 0);
  const exact = segments.map((s) => ({ id: s.id, x: (s.share / sum) * total }));
  const out = new Map(exact.map((e) => [e.id, Math.floor(e.x)]));
  let left = total - [...out.values()].reduce((a, b) => a + b, 0);
  const byRemainder = [...exact].sort((a, b) => (b.x % 1) - (a.x % 1));
  for (const e of byRemainder) {
    if (left <= 0) break;
    out.set(e.id, out.get(e.id)! + 1);
    left--;
  }
  return out;
}

const chunks = (n: number, size: number): number[] =>
  Array.from({ length: Math.ceil(n / size) }, (_, i) =>
    Math.min(size, n - i * size)
  );

const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

interface RawPersona {
  handle: string;
  bio: string;
  expertise: string[];
  aiAttitude: number;
  verbosity: number;
  contrarian: number;
  activity: number;
  voiceSample: string;
}

const PERSONA_SCHEMA = {
  type: 'object',
  required: ['personas'],
  properties: {
    personas: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'handle',
          'bio',
          'expertise',
          'aiAttitude',
          'verbosity',
          'contrarian',
          'activity',
          'voiceSample'
        ],
        properties: {
          handle: { type: 'string' },
          bio: { type: 'string' },
          expertise: { type: 'array', items: { type: 'string' } },
          aiAttitude: { type: 'integer', minimum: -2, maximum: 2 },
          verbosity: { type: 'integer', minimum: 1, maximum: 3 },
          contrarian: { type: 'number', minimum: 0, maximum: 1 },
          activity: { type: 'number', minimum: 0, maximum: 1 },
          voiceSample: { type: 'string' }
        }
      }
    }
  }
};

const VOTER_SCHEMA = {
  type: 'object',
  required: ['voters'],
  properties: {
    voters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['oneLiner'],
        properties: { oneLiner: { type: 'string' } }
      }
    }
  }
};

function isRawPersona(x: unknown): x is RawPersona {
  const p = x as Record<string, unknown>;
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof p.handle === 'string' &&
    typeof p.bio === 'string' &&
    Array.isArray(p.expertise) &&
    typeof p.aiAttitude === 'number' &&
    typeof p.verbosity === 'number' &&
    typeof p.contrarian === 'number' &&
    typeof p.activity === 'number' &&
    typeof p.voiceSample === 'string'
  );
}

const PERSONA_SYSTEM =
  'You create realistic Hacker News user personas for a social simulation. Personas must be ' +
  'specific and believable — real HN regulars, not caricatures. Vary seniority, location, ' +
  'employer type and writing style. Spread aiAttitude across the plausible range for the ' +
  'segment; never make everyone hostile or everyone enthusiastic.';

const VOTER_SYSTEM =
  'You create one-line profiles of Hacker News readers who mostly lurk and vote. Make them ' +
  'diverse and concrete (role, stack, what they care about).';

async function personaChunk(
  llm: Llm,
  seg: Segment,
  count: number,
  i: number
): Promise<RawPersona[]> {
  const res = await llm.call({
    tier: 'opus',
    system: PERSONA_SYSTEM,
    label: `personas:${seg.id}:${i}`,
    schema: PERSONA_SCHEMA,
    prompt:
      `Segment: ${seg.id}\nTypical leanings: ${seg.leanings}\n\n` +
      `They browse Show HN regularly. Create exactly ${count} personas from this segment.\n` +
      'activity = chance (0–1) they engage when they open a thread. contrarian = tendency ' +
      '(0–1) to push back. aiAttitude = -2 hostile … 2 enthusiastic about AI tools. ' +
      'verbosity = 1 terse … 3 long-winded. voiceSample = one realistic HN comment (1–3 ' +
      'sentences) in their style on any tech topic.',
    validate: (x): x is { personas: RawPersona[] } => {
      const ps = (x as { personas?: unknown }).personas;
      return Array.isArray(ps) && ps.length >= count && ps.every(isRawPersona);
    }
  });
  if (!res.ok)
    throw new Error(
      `persona generation failed for segment ${seg.id}: ${res.error}`
    );
  return res.value.personas.slice(0, count);
}

async function voterChunk(
  llm: Llm,
  seg: Segment,
  count: number,
  i: number
): Promise<string[]> {
  const res = await llm.call({
    tier: 'opus',
    system: VOTER_SYSTEM,
    label: `voter-profiles:${seg.id}:${i}`,
    schema: VOTER_SCHEMA,
    prompt: `Segment: ${seg.id}\nTypical leanings: ${seg.leanings}\n\nCreate exactly ${count} one-line reader profiles.`,
    validate: (x): x is { voters: Array<{ oneLiner: string }> } => {
      const vs = (x as { voters?: unknown }).voters;
      return (
        Array.isArray(vs) &&
        vs.length >= count &&
        vs.every((v) => typeof v?.oneLiner === 'string')
      );
    }
  });
  if (!res.ok)
    throw new Error(
      `voter generation failed for segment ${seg.id}: ${res.error}`
    );
  return res.value.voters.slice(0, count).map((v) => v.oneLiner);
}

export async function generatePersonas(
  llm: Llm,
  seed: Seed
): Promise<PersonaSet> {
  const active = allocate(seed.segments, seed.activeCount);
  const voterAlloc = allocate(seed.segments, seed.voterCount);
  const perSegment = await Promise.all(
    seed.segments.map(async (seg) => {
      const [raw, lines] = await Promise.all([
        Promise.all(
          chunks(active.get(seg.id)!, PERSONA_CHUNK).map((n, i) =>
            personaChunk(llm, seg, n, i)
          )
        ),
        Promise.all(
          chunks(voterAlloc.get(seg.id)!, VOTER_CHUNK).map((n, i) =>
            voterChunk(llm, seg, n, i)
          )
        )
      ]);
      return { seg, raw: raw.flat(), lines: lines.flat() };
    })
  );
  const personas: Persona[] = [];
  const voters: Voter[] = [];
  const handles = new Set<string>();
  for (const { seg, raw, lines } of perSegment) {
    for (const r of raw) {
      let handle =
        r.handle.trim().replace(/\s+/g, '_') || `user${personas.length + 1}`;
      while (handles.has(handle)) handle = `${handle}_${personas.length + 1}`;
      handles.add(handle);
      personas.push({
        id: `p${personas.length + 1}`,
        segment: seg.id,
        handle,
        bio: r.bio,
        expertise: r.expertise.map(String),
        aiAttitude: clamp(Math.round(r.aiAttitude), -2, 2),
        verbosity: clamp(Math.round(r.verbosity), 1, 3),
        contrarian: clamp(r.contrarian, 0, 1),
        activity: clamp(r.activity, 0, 1),
        voiceSample: r.voiceSample
      });
    }
    for (const oneLiner of lines)
      voters.push({ id: `v${voters.length + 1}`, segment: seg.id, oneLiner });
  }
  return { personas, voters };
}

export async function loadOrGeneratePersonas(
  llm: Llm,
  seed: Seed,
  cacheFile: string
): Promise<PersonaSet> {
  if (existsSync(cacheFile))
    return JSON.parse(readFileSync(cacheFile, 'utf8')) as PersonaSet;
  const set = await generatePersonas(llm, seed);
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(set, null, 2));
  return set;
}
