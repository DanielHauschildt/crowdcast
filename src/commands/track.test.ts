import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../hn-users.js';
import { loadTimelines, track } from './track.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');

const fetchFn: FetchFn = async (url) => ({
  ok: true,
  status: 200,
  json: async () =>
    url.endsWith('stories.json')
      ? [7]
      : {
          id: 7,
          type: 'story',
          title: 'Show HN: X',
          time: NOW / 1e3 - 600,
          score: 3,
          descendants: 1
        }
});

describe('track', () => {
  it('polls for --hours at --interval-min into <dir>/data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'track-'));
    let t = NOW;
    const sleeps: number[] = [];
    await track(['--hours', '0.25', '--interval-min', '5', '--dir', dir], {
      fetchFn,
      log: () => {},
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      }
    });
    expect(sleeps).toEqual([300e3, 300e3]);
    expect(
      readFileSync(join(dir, 'data', '7.jsonl'), 'utf8')
        .trim()
        .split('\n')
    ).toHaveLength(3);
  });

  it('rejects a non-positive interval', async () => {
    await expect(
      track(['--interval-min', '0'], { fetchFn, log: () => {} })
    ).rejects.toThrow(/interval/);
  });

  it('`fit` writes fit.md and fit.json from the collected timelines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'track-'));
    mkdirSync(join(dir, 'data'));
    const line = (ageMin: number, points: number, rankTop: number | null) =>
      JSON.stringify({ t: '', ageMin, points, comments: 0, rankTop });
    writeFileSync(
      join(dir, 'data', '1.jsonl'),
      [line(10, 2, null), line(40, 30, 5), ''].join('\n')
    );
    const logs: string[] = [];
    await track(['fit', '--dir', dir], { fetchFn, log: (m) => logs.push(m) });
    expect(readFileSync(join(dir, 'fit.md'), 'utf8')).toMatch(/1 stories/);
    const json = JSON.parse(readFileSync(join(dir, 'fit.json'), 'utf8'));
    expect(json.snapshots).toBe(2);
    expect(logs.join('\n')).toMatch(/fit\.md/);
  });
});

describe('loadTimelines', () => {
  it('reads every <id>.jsonl and skips a truncated last line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-'));
    writeFileSync(
      join(dir, '5.jsonl'),
      '{"t":"","ageMin":1,"points":1,"comments":0,"rankTop":null}\n{"t":"","age'
    );
    writeFileSync(join(dir, 'track.log'), 'noise');
    expect(loadTimelines(dir)).toEqual([
      {
        id: '5',
        snapshots: [{ t: '', ageMin: 1, points: 1, comments: 0, rankTop: null }]
      }
    ]);
  });
});
