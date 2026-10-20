import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchFn } from '../../platform.js';
import { fetchBskyPost, threadId, type Timeline } from './bsky-api.js';
import {
  decay,
  DEFAULT_REACH,
  DEFAULT_STEPS,
  STEP_MINUTES,
  type ReachConstants
} from './reach.js';

/** `simulations/backtests/bluesky/` of this checkout, from src/ or dist/. */
export const DATA_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../simulations/backtests/bluesky'
);
export const FIT_FILE = join(DATA_DIR, 'fit.json');

export interface Ref {
  id: number;
  uri: string;
}

/** Thread lists: `<id>  # <at-uri>  # note`; the id is threadId(at-uri), as backtests need numbers. */
export function parseRefList(text: string): Ref[] {
  const refs: Ref[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^(\d+)\s+#\s*(at:\/\/\S+)/.exec(line);
    if (!m || threadId(m[2]!) !== Number(m[1]))
      throw new Error(
        `bluesky threads list line ${i + 1}: want "<threadId(at-uri)>  # <at-uri>"`
      );
    refs.push({ id: Number(m[1]), uri: m[2]! });
  });
  return refs;
}

export function readFit(file: string = FIT_FILE): ReachConstants {
  if (!existsSync(file)) return DEFAULT_REACH;
  const { constants } = JSON.parse(readFileSync(file, 'utf8')) as {
    constants: Partial<ReachConstants>;
  };
  return { ...DEFAULT_REACH, ...constants };
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, x) => a + x, 0) / xs.length;

const HALF_LIVES = Array.from(
  { length: 400 },
  (_, i) => 0.05 * Math.pow(48 / 0.05, i / 399)
);

/**
 * Fits the reach model to real posts' likes over the first `steps` steps: the half-life from the
 * shape of the like curves, then baseReach and repostFactor by weighted least squares on the totals.
 */
export function fitReach(
  timelines: readonly Timeline[],
  steps: number = DEFAULT_STEPS
): { constants: ReachConstants; n: number } {
  const used = timelines.filter((t) => t.likesComplete);
  const bins = used.map((t) => {
    const n = new Array<number>(steps).fill(0);
    for (const m of t.likeMinutes) {
      const s = Math.floor(m / STEP_MINUTES);
      if (s >= 0 && s < steps) n[s]!++;
    }
    return n;
  });
  const curve = (h: number): number[] =>
    Array.from({ length: steps }, (_, s) => decay((s * STEP_MINUTES) / 60, h));
  const sse = (h: number): number => {
    const d = curve(h);
    const k = d.reduce((a, x) => a + x, 0);
    let e = 0;
    for (const n of bins) {
      const total = n.reduce((a, x) => a + x, 0);
      if (total === 0) continue;
      n.forEach((x, s) => (e += (x / total - d[s]! / k) ** 2));
    }
    return e;
  };
  const halfLifeHours = HALF_LIVES.reduce((best, h) =>
    sse(h) < sse(best) ? h : best
  );
  const k = curve(halfLifeHours).reduce((a, x) => a + x, 0);

  // likes_i = a·x1 + r·x2, weighted 1/likes (Poisson-like), no intercept.
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let s1y = 0;
  let s2y = 0;
  used.forEach((t, i) => {
    const y = bins[i]!.reduce((a, x) => a + x, 0);
    const m = mean(t.reposterFollowers);
    const x1 = k * (t.followers + t.quotes * m);
    const x2 = k * t.reposts * m;
    const w = 1 / Math.max(y, 1);
    s11 += w * x1 * x1;
    s12 += w * x1 * x2;
    s22 += w * x2 * x2;
    s1y += w * x1 * y;
    s2y += w * x2 * y;
  });
  const det = s11 * s22 - s12 * s12;
  let a = det > 0 ? (s1y * s22 - s2y * s12) / det : s1y / (s11 || 1);
  let r = det > 0 ? (s11 * s2y - s12 * s1y) / det : 0;
  if (r < 0) [a, r] = [s1y / (s11 || 1), 0];
  if (a < 0) [a, r] = [0, s2y / (s22 || 1)];

  return {
    constants: {
      baseReach: a,
      repostFactor: r,
      halfLifeHours,
      reposterFollowers: mean(timelines.flatMap((t) => t.reposterFollowers)),
      authorFollowers: median(timelines.map((t) => t.followers))
    },
    n: used.length
  };
}

/** Fetches (or reads cached) timelines of a thread list, fits, and writes fit.json beside the list. */
export async function fitList(
  listFile: string,
  fetchFn?: FetchFn
): Promise<string> {
  const root = dirname(listFile);
  const refs = parseRefList(readFileSync(listFile, 'utf8'));
  const skipped: string[] = [];
  const timelines: Timeline[] = [];
  for (const ref of refs) {
    const dir = join(root, 'threads', String(ref.id));
    const file = join(dir, 'timeline.json');
    if (!existsSync(file)) {
      try {
        const { thread, timeline } = await fetchBskyPost(ref.uri, fetchFn);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'real.json'), JSON.stringify(thread, null, 2));
        writeFileSync(join(dir, 'context.md'), thread.context);
        writeFileSync(file, JSON.stringify(timeline, null, 2));
      } catch (err) {
        skipped.push(`${ref.id}: skipped — ${(err as Error).message}`);
        continue;
      }
    }
    timelines.push(JSON.parse(readFileSync(file, 'utf8')) as Timeline);
  }
  const { constants, n } = fitReach(timelines);
  writeFileSync(
    join(root, 'fit.json'),
    JSON.stringify(
      { fittedAt: new Date().toISOString().slice(0, 10), n, constants },
      null,
      2
    ) + '\n'
  );
  return [...skipped, `fit on ${n} posts: ${JSON.stringify(constants)}`].join(
    '\n'
  );
}
