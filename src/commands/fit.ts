import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { FetchFn } from '../platform.js';
import { loadPlatform } from '../platforms/index.js';

export const FIT_USAGE = `  crowdcast fit <platform> <file> [--followers N]
                (bluesky: a thread list → fit.json beside it; linkedin: a post-analytics CSV)`;

export interface FitDeps {
  log: (msg: string) => void;
  fetch?: FetchFn;
}

/** Fits a platform's reach constants to real data through its optional `fit`. */
export async function fit(argv: string[], deps: FitDeps): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { followers: { type: 'string' } },
      allowPositionals: true
    });
  } catch (err) {
    deps.log(`${(err as Error).message}\nusage:\n${FIT_USAGE}`);
    return 2;
  }
  const [id, file, ...rest] = parsed.positionals;
  const raw = parsed.values.followers;
  const followers = raw === undefined ? undefined : Number(raw);
  if (
    !id ||
    !file ||
    rest.length > 0 ||
    (followers !== undefined &&
      !(Number.isInteger(followers) && followers >= 0))
  ) {
    deps.log(`usage:\n${FIT_USAGE}`);
    return 2;
  }
  try {
    const platform = await loadPlatform(id);
    if (!platform.fit) throw new Error(`platform ${id} has no fit`);
    deps.log(
      await platform.fit(
        resolve(file),
        followers === undefined ? undefined : { followers },
        deps.fetch
      )
    );
    return 0;
  } catch (err) {
    deps.log(`error: ${(err as Error).message}`);
    return 1;
  }
}
