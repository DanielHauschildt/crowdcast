import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Author, Platform } from '../platform.js';

export const DEFAULT_PLATFORM = 'hn';

const here = dirname(fileURLToPath(import.meta.url));

export function knownPlatforms(): string[] {
  return readdirSync(here, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** `src/platforms/<id>/index.ts`'s default export, with a seed's extra platform.yaml keys and author applied. */
export async function loadPlatform(
  id: string = DEFAULT_PLATFORM,
  options: Record<string, unknown> = {},
  author?: Author
): Promise<Platform> {
  // Check the folder first so a bug inside a platform module is not reported as an unknown id.
  if (!/^[a-z0-9-]+$/.test(id) || !existsSync(join(here, id)))
    throw new Error(
      `unknown platform "${id}"; known: ${knownPlatforms().join(', ')}`
    );
  const p = (
    (await import(/* @vite-ignore */ `./${id}/index.js`)) as {
      default: Platform;
    }
  ).default;
  return (Object.keys(options).length > 0 || author) && p.withOptions
    ? p.withOptions(options, author)
    : p;
}
