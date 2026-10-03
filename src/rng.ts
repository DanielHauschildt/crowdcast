export type Rng = () => number;

/** Small, fast, seedable PRNG; good enough for scheduling, not for crypto. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent stream per (run seed, step, salt) so resumed runs schedule identically. */
export function rngFor(seed: number, step: number, salt = 0): Rng {
  return mulberry32((seed * 1000003 + step * 7919 + salt * 104729) >>> 0);
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
