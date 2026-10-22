import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Timeline } from './bsky-api.js';
import { threadId } from './bsky-api.js';
import { fitReach, parseRefList, readFit } from './fit.js';
import { decay, DEFAULT_REACH, STEP_MINUTES } from './reach.js';

/** A post whose likes follow the model exactly: per step (aF + a·q·m + r·p·m) · decay. */
function synthetic(
  k: { a: number; r: number; h: number },
  followers: number,
  reposts: number,
  quotes: number,
  m: number
): Timeline {
  const perStep = followers * k.a + quotes * m * k.a + reposts * m * k.r;
  const likeMinutes: number[] = [];
  for (let s = 0; s < 16; s++) {
    const n = Math.round(perStep * decay((s * STEP_MINUTES) / 60, k.h));
    for (let i = 0; i < n; i++)
      likeMinutes.push(s * STEP_MINUTES + ((i + 0.5) / n) * STEP_MINUTES);
  }
  likeMinutes.push(600, 900);
  return {
    uri: 'at://did:plc:x/app.bsky.feed.post/1',
    createdAt: '2026-01-01T00:00:00Z',
    followers,
    likes: likeMinutes.length,
    reposts,
    quotes,
    likeMinutes,
    likesComplete: true,
    reposterFollowers: reposts > 0 ? [m / 2, m, (3 * m) / 2] : []
  };
}

describe('fitReach', () => {
  it('recovers known constants from synthetic posts', () => {
    const truth = { a: 0.004, r: 0.01, h: 0.8 };
    const posts = [
      synthetic(truth, 500, 2, 0, 3000),
      synthetic(truth, 2000, 10, 1, 1500),
      synthetic(truth, 8000, 5, 3, 4000),
      synthetic(truth, 20000, 40, 2, 800),
      synthetic(truth, 50000, 3, 0, 10000),
      synthetic(truth, 12000, 0, 0, 0)
    ];
    const { constants, n } = fitReach(posts);
    expect(n).toBe(6);
    expect(constants.halfLifeHours).toBeCloseTo(truth.h, 1);
    expect(constants.baseReach / truth.a).toBeGreaterThan(0.93);
    expect(constants.baseReach / truth.a).toBeLessThan(1.07);
    expect(constants.repostFactor / truth.r).toBeGreaterThan(0.85);
    expect(constants.repostFactor / truth.r).toBeLessThan(1.15);
    expect(constants.authorFollowers).toBe(10000);
  });

  it('skips posts whose likes were cut off', () => {
    const p = synthetic({ a: 0.004, r: 0.01, h: 1 }, 1000, 1, 0, 500);
    expect(fitReach([p, { ...p, likesComplete: false }]).n).toBe(1);
  });
});

describe('parseRefList', () => {
  it('reads "<id>  # <at-uri>" lines and checks the id', () => {
    const uri = 'at://did:plc:abc/app.bsky.feed.post/3k';
    expect(
      parseRefList(`# header\n\n${threadId(uri)}  # ${uri}  # 30 likes\n`)
    ).toEqual([{ id: threadId(uri), uri }]);
    expect(() => parseRefList(`12  # ${uri}`)).toThrow(/line 1/);
  });
});

describe('readFit', () => {
  it('falls back to the defaults without fit.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fit-'));
    expect(readFit(join(dir, 'fit.json'))).toEqual(DEFAULT_REACH);
    writeFileSync(
      join(dir, 'fit.json'),
      JSON.stringify({ constants: { ...DEFAULT_REACH, baseReach: 0.01 } })
    );
    expect(readFit(join(dir, 'fit.json')).baseReach).toBe(0.01);
  });
});
