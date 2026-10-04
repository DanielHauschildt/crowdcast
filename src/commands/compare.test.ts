import { describe, expect, it } from 'vitest';
import { compareJobs, mapPool } from './compare.js';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('compareJobs', () => {
  it('lists every variant × run, variant-major', () => {
    expect(compareJobs(['a', 'b'], 2)).toEqual([
      { variant: 'a', index: 1 },
      { variant: 'a', index: 2 },
      { variant: 'b', index: 1 },
      { variant: 'b', index: 2 }
    ]);
  });
});

describe('mapPool', () => {
  it('keeps input order and never exceeds n in flight', async () => {
    for (const n of [1, 2, 3, 8]) {
      let active = 0;
      let peak = 0;
      const out = await mapPool([5, 1, 4, 2, 3, 0], n, async (x) => {
        peak = Math.max(peak, ++active);
        for (let i = 0; i < x; i++) await tick();
        active--;
        return x * 10;
      });
      expect(out).toEqual([50, 10, 40, 20, 30, 0]);
      expect(peak).toBe(Math.min(n, 6));
    }
  });

  it('stops starting jobs after a failure and rethrows it', async () => {
    const started: number[] = [];
    await expect(
      mapPool([1, 2, 3, 4, 5], 2, async (x) => {
        started.push(x);
        await tick();
        if (x === 1) throw new Error('boom');
        return x;
      })
    ).rejects.toThrow('boom');
    expect(started).not.toContain(5);
  });

  it('rejects a non-positive parallelism', async () => {
    await expect(mapPool([1], 0, async (x) => x)).rejects.toThrow(/parallel/);
  });
});
