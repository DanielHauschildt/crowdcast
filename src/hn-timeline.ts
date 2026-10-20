import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchFn } from './hn-users.js';

const API = 'https://hacker-news.firebaseio.com/v0/';
export const MAX_AGE_MIN = 6 * 60;
export const DEFAULT_DATA_DIR = 'simulations/timelines/data';

/** The fields of a Firebase HN item we read. */
export interface HnItem {
  id: number;
  type?: string;
  title?: string;
  by?: string;
  time?: number;
  score?: number;
  descendants?: number;
  dead?: boolean;
  deleted?: boolean;
}

/** One observation of a story; deliberately no usernames, titles or links. */
export interface Snapshot {
  t: string;
  ageMin: number;
  points: number;
  comments: number;
  /** Index in topstories (0 = #1 on the front page), null when not listed. */
  rankTop: number | null;
}

export function parseSnapshot(
  item: HnItem | null,
  topIds: readonly number[],
  now: number
): Snapshot | null {
  if (!item || item.type !== 'story' || item.dead || item.deleted) return null;
  if (!/^Show HN:/i.test(item.title ?? '') || item.time === undefined)
    return null;
  const ageMin = Math.round((now - item.time * 1000) / 60e3);
  if (ageMin >= MAX_AGE_MIN) return null;
  const rank = topIds.indexOf(item.id);
  return {
    t: new Date(now).toISOString(),
    ageMin,
    points: item.score ?? 0,
    comments: item.descendants ?? 0,
    rankTop: rank < 0 ? null : rank
  };
}

/** Story ids already classified, so each non-Show-HN story is fetched once. */
export interface Tracker {
  ruledOut: Set<number>;
  tracked: Set<number>;
}

export function newTracker(): Tracker {
  return { ruledOut: new Set(), tracked: new Set() };
}

export interface PollDeps {
  fetchFn: FetchFn;
  dataDir: string;
  concurrency: number;
}

async function getJson(fetchFn: FetchFn, path: string): Promise<unknown> {
  const res = await fetchFn(API + path);
  if (!res.ok) throw new Error(`HN ${path}: HTTP ${res.status}`);
  return res.json();
}

async function ids(fetchFn: FetchFn, list: string): Promise<number[]> {
  const body = await getJson(fetchFn, `${list}.json`);
  return Array.isArray(body) ? body.filter(Number.isInteger) : [];
}

async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.max(1, limit) }, lane));
}

/** One poll: snapshots every Show HN story < 6 h old; returns how many were written. */
export async function pollCycle(
  deps: PollDeps,
  tracker: Tracker,
  now: number
): Promise<number> {
  const [newIds, topIds] = await Promise.all([
    ids(deps.fetchFn, 'newstories'),
    ids(deps.fetchFn, 'topstories')
  ]);
  const todo = [...new Set([...tracker.tracked, ...newIds])].filter(
    (id) => !tracker.ruledOut.has(id)
  );
  mkdirSync(deps.dataDir, { recursive: true });
  let written = 0;
  await eachLimited(todo, deps.concurrency, async (id) => {
    const item = (await getJson(
      deps.fetchFn,
      `item/${id}.json`
    )) as HnItem | null;
    const snap = parseSnapshot(item, topIds, now);
    if (!snap) {
      tracker.tracked.delete(id);
      tracker.ruledOut.add(id);
      return;
    }
    tracker.tracked.add(id);
    appendFileSync(
      join(deps.dataDir, `${id}.jsonl`),
      JSON.stringify(snap) + '\n'
    );
    written++;
  });
  return written;
}

export interface LoopDeps extends PollDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
  hours: number;
  intervalMs: number;
  maxBackoffMs?: number;
}

/** Polls every `intervalMs` for `hours`; a failed cycle doubles the wait (capped) until one succeeds. */
export async function pollLoop(deps: LoopDeps): Promise<number> {
  const end = deps.now() + deps.hours * 3600e3;
  const maxBackoff = deps.maxBackoffMs ?? 30 * 60e3;
  const tracker = newTracker();
  let wait = deps.intervalMs;
  let cycles = 0;
  for (;;) {
    cycles++;
    try {
      const n = await pollCycle(deps, tracker, deps.now());
      deps.log(`cycle ${cycles}: ${n} snapshots`);
      wait = deps.intervalMs;
    } catch (err) {
      wait = Math.min(wait * 2, maxBackoff);
      deps.log(
        `cycle ${cycles} failed (${String(err)}); next in ${wait / 60e3} min`
      );
    }
    if (deps.now() + wait >= end) return cycles;
    await deps.sleep(wait);
  }
}
