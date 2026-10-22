import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchFn } from './hn-users.js';
import {
  newTracker,
  parseSnapshot,
  pollCycle,
  pollLoop,
  type HnItem
} from './hn-timeline.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const sec = (minAgo: number): number => Math.floor((NOW - minAgo * 60e3) / 1e3);

function item(id: number, over: Partial<HnItem> = {}): HnItem {
  return {
    id,
    type: 'story',
    title: `Show HN: Tool ${id}`,
    time: sec(30),
    score: 5,
    descendants: 2,
    ...over
  };
}

describe('parseSnapshot', () => {
  it('reads points, comments, age and front-page rank from item JSON', () => {
    const raw = JSON.parse(
      '{"by":"someone","descendants":7,"id":42,"score":12,"time":' +
        sec(95) +
        ',"title":"Show HN: A thing","type":"story","url":"https://example.com"}'
    ) as HnItem;
    expect(parseSnapshot(raw, [1, 42, 3], NOW)).toEqual({
      t: '2026-10-20T12:00:00.000Z',
      ageMin: 95,
      points: 12,
      comments: 7,
      rankTop: 1
    });
  });

  it('defaults missing comment counts to 0 and off-list stories to rank null', () => {
    const snap = parseSnapshot(item(9, { descendants: undefined }), [], NOW);
    expect(snap).toMatchObject({ comments: 0, rankTop: null });
  });

  it('stores no usernames, titles or links', () => {
    const snap = parseSnapshot(item(9, { by: 'realuser' }), [], NOW);
    expect(Object.keys(snap ?? {}).sort()).toEqual(
      ['ageMin', 'comments', 'points', 'rankTop', 't'].sort()
    );
  });

  it('only tracks live Show HN stories younger than 6 h', () => {
    expect(parseSnapshot(item(1, { time: sec(359) }), [], NOW)).not.toBeNull();
    expect(parseSnapshot(item(1, { time: sec(360) }), [], NOW)).toBeNull();
    expect(
      parseSnapshot(item(1, { title: 'Ask HN: why' }), [], NOW)
    ).toBeNull();
    expect(
      parseSnapshot(item(1, { title: 'Showing HN some love' }), [], NOW)
    ).toBeNull();
    expect(parseSnapshot(item(1, { type: 'job' }), [], NOW)).toBeNull();
    expect(parseSnapshot(item(1, { dead: true }), [], NOW)).toBeNull();
    expect(parseSnapshot(item(1, { deleted: true }), [], NOW)).toBeNull();
    expect(parseSnapshot(null, [], NOW)).toBeNull();
  });
});

interface FakeApi {
  fetchFn: FetchFn;
  urls: string[];
  maxInFlight: () => number;
}

function fakeApi(
  items: Map<number, HnItem>,
  lists: { newIds: number[]; topIds: number[] },
  fail: (url: string) => boolean = () => false
): FakeApi {
  const urls: string[] = [];
  let inFlight = 0;
  let max = 0;
  const fetchFn: FetchFn = async (url) => {
    urls.push(url);
    inFlight++;
    max = Math.max(max, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    if (fail(url)) return { ok: false, status: 503, json: async () => null };
    const id = /item\/(\d+)\.json$/.exec(url)?.[1];
    const body = url.endsWith('/newstories.json')
      ? lists.newIds
      : url.endsWith('/topstories.json')
        ? lists.topIds
        : (items.get(Number(id)) ?? null);
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchFn, urls, maxInFlight: () => max };
}

const lines = (file: string): string[] =>
  readFileSync(file, 'utf8').trim().split('\n');

describe('pollCycle', () => {
  it('appends one snapshot per tracked story and never rewrites old lines', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tl-'));
    const items = new Map([
      [1, item(1)],
      [2, item(2, { title: 'Launch: not a show' })],
      [3, item(3, { time: sec(400) })]
    ]);
    const api = fakeApi(items, { newIds: [1, 2, 3], topIds: [2, 1] });
    const tracker = newTracker();
    const deps = { fetchFn: api.fetchFn, dataDir, concurrency: 4 };

    expect(await pollCycle(deps, tracker, NOW)).toBe(1);
    const first = lines(join(dataDir, '1.jsonl'));
    items.set(1, item(1, { score: 9, descendants: 4 }));
    expect(await pollCycle(deps, tracker, NOW + 5 * 60e3)).toBe(1);

    expect(readdirSync(dataDir)).toEqual(['1.jsonl']);
    const both = lines(join(dataDir, '1.jsonl'));
    expect(both).toHaveLength(2);
    expect(both[0]).toBe(first[0]);
    expect(JSON.parse(both[1]!)).toMatchObject({
      ageMin: 35,
      points: 9,
      comments: 4,
      rankTop: 1
    });
  });

  it('does not refetch stories it already ruled out', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tl-'));
    const items = new Map([
      [1, item(1)],
      [2, item(2, { title: 'Not a show' })]
    ]);
    const api = fakeApi(items, { newIds: [1, 2], topIds: [] });
    const tracker = newTracker();
    const deps = { fetchFn: api.fetchFn, dataDir, concurrency: 4 };
    await pollCycle(deps, tracker, NOW);
    await pollCycle(deps, tracker, NOW + 60e3);
    expect(api.urls.filter((u) => u.endsWith('/item/2.json'))).toHaveLength(1);
    expect(api.urls.filter((u) => u.endsWith('/item/1.json'))).toHaveLength(2);
  });

  it('keeps polling a tracked story after it leaves newstories, until 6 h', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tl-'));
    const items = new Map([[1, item(1, { time: sec(340) })]]);
    const lists = { newIds: [1], topIds: [] as number[] };
    const api = fakeApi(items, lists);
    const tracker = newTracker();
    const deps = { fetchFn: api.fetchFn, dataDir, concurrency: 4 };
    await pollCycle(deps, tracker, NOW);
    lists.newIds = [];
    expect(await pollCycle(deps, tracker, NOW + 10 * 60e3)).toBe(1);
    expect(await pollCycle(deps, tracker, NOW + 30 * 60e3)).toBe(0);
    expect(lines(join(dataDir, '1.jsonl'))).toHaveLength(2);
  });

  it('fetches items with at most `concurrency` requests in flight', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tl-'));
    const ids = Array.from({ length: 20 }, (_, i) => i + 1);
    const items = new Map(ids.map((id) => [id, item(id)]));
    const api = fakeApi(items, { newIds: ids, topIds: [] });
    await pollCycle(
      { fetchFn: api.fetchFn, dataDir, concurrency: 3 },
      newTracker(),
      NOW
    );
    expect(api.maxInFlight()).toBeLessThanOrEqual(3);
    expect(readdirSync(dataDir)).toHaveLength(20);
  });
});

describe('pollLoop', () => {
  function fakeClock(start: number) {
    let t = start;
    const sleeps: number[] = [];
    return {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
      sleeps
    };
  }

  it('runs one cycle per interval for the given duration', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tl-'));
    const api = fakeApi(new Map([[1, item(1)]]), { newIds: [1], topIds: [] });
    const clock = fakeClock(NOW);
    const cycles = await pollLoop({
      fetchFn: api.fetchFn,
      dataDir,
      concurrency: 4,
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
      hours: 0.5,
      intervalMs: 5 * 60e3
    });
    expect(cycles).toBe(6);
    expect(clock.sleeps).toEqual(Array(5).fill(5 * 60e3));
    expect(lines(join(dataDir, '1.jsonl'))).toHaveLength(6);
  });

  it('backs off on errors, doubling up to a cap, and resets on success', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tl-'));
    let failing = 3;
    const api = fakeApi(
      new Map([[1, item(1)]]),
      { newIds: [1], topIds: [] },
      (url) => url.endsWith('/newstories.json') && failing-- > 0
    );
    const clock = fakeClock(NOW);
    const logs: string[] = [];
    await pollLoop({
      fetchFn: api.fetchFn,
      dataDir,
      concurrency: 4,
      now: clock.now,
      sleep: clock.sleep,
      log: (m) => logs.push(m),
      hours: 2,
      intervalMs: 5 * 60e3,
      maxBackoffMs: 15 * 60e3
    });
    expect(clock.sleeps.slice(0, 4)).toEqual([
      10 * 60e3,
      15 * 60e3,
      15 * 60e3,
      5 * 60e3
    ]);
    expect(logs.some((l) => /HTTP 503/.test(l))).toBe(true);
  });
});
