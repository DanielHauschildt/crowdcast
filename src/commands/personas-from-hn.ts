import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHnPersonas } from '../hn-personas.js';
import { fetchThreadAuthors, type FetchFn } from '../hn-users.js';
import type { Llm } from '../llm.js';
import { generateVoters } from '../personas.js';
import type { PersonaSet, Seed } from '../types.js';

export const HN_PERSONAS_FILE = 'hn.json';

function threadId(token: string): string {
  const id = /[?&]id=(\d+)/.exec(token)?.[1] ?? token;
  if (!/^\d+$/.test(id)) throw new Error(`not an HN thread id: ${token}`);
  return id;
}

/** Comma/space separated ids or item urls, or a file with one per line (`#` comments). */
export function parseThreadIds(arg: string): string[] {
  const tokens = existsSync(arg)
    ? readFileSync(arg, 'utf8')
        .split('\n')
        .map((l) => l.replace(/#.*/, '').trim().split(/\s+/)[0] ?? '')
    : arg.split(/[\s,]+/);
  const ids = [...new Set(tokens.filter(Boolean).map(threadId))];
  if (ids.length === 0) throw new Error(`no thread ids in "${arg}"`);
  return ids;
}

export interface PersonasFromHnDeps {
  llm: Llm;
  fetchFn?: FetchFn;
  log: (msg: string) => void;
}

/** Writes `<seed>/personas/hn.json`: personas from the threads' commenters, voters generated from the seed. */
export async function personasFromHn(
  deps: PersonasFromHnDeps,
  seed: Seed,
  threads: readonly string[],
  max: number
): Promise<string> {
  const byThread = await Promise.all(
    threads.map(async (thread) => ({
      thread,
      authors: await fetchThreadAuthors(thread, deps.fetchFn)
    }))
  );
  const [personas, voters] = await Promise.all([
    buildHnPersonas({
      llm: deps.llm,
      byThread,
      segments: seed.segments,
      max,
      fetchFn: deps.fetchFn,
      log: deps.log
    }),
    generateVoters(deps.llm, seed)
  ]);
  const set: PersonaSet = { personas, voters };
  const file = join(seed.dir, 'personas', HN_PERSONAS_FILE);
  mkdirSync(join(seed.dir, 'personas'), { recursive: true });
  writeFileSync(file, JSON.stringify(set, null, 2));
  return file;
}
