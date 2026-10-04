import fc from 'fast-check';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeSeed, personaHandler } from '../test/fixtures.js';
import { FakeLlm } from './llm.js';
import {
  allocate,
  generatePersonas,
  loadOrGeneratePersonas,
  tierFor
} from './personas.js';

describe('allocate', () => {
  it('sums to total and stays within one of the exact share', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100 }), {
          minLength: 1,
          maxLength: 8
        }),
        fc.integer({ min: 0, max: 500 }),
        (weights, total) => {
          const sum = weights.reduce((a, b) => a + b, 0);
          const segments = weights.map((w, i) => ({
            id: `s${i}`,
            share: w / sum,
            leanings: ''
          }));
          const alloc = allocate(segments, total);
          expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(total);
          for (const s of segments) {
            expect(Math.abs(alloc.get(s.id)! - s.share * total)).toBeLessThan(
              1
            );
          }
        }
      )
    );
  });
});

describe('tierFor', () => {
  it('is deterministic and only haiku or sonnet', () => {
    fc.assert(
      fc.property(fc.string(), (id) => {
        expect(['haiku', 'sonnet']).toContain(tierFor(id));
        expect(tierFor(id)).toBe(tierFor(id));
      })
    );
  });

  it('assigns about 60% haiku', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `p${i + 1}`);
    const haiku = ids.filter((id) => tierFor(id) === 'haiku').length;
    expect(haiku / ids.length).toBeGreaterThan(0.55);
    expect(haiku / ids.length).toBeLessThan(0.65);
  });
});

describe('generatePersonas', () => {
  const seed = makeSeed({
    segments: [
      { id: 'a', share: 0.5, leanings: 'curious' },
      { id: 'b', share: 0.5, leanings: 'skeptical' }
    ],
    activeCount: 24,
    voterCount: 120
  });

  it('creates the configured counts with unique ids and handles and clamped numbers', async () => {
    const set = await generatePersonas(new FakeLlm(personaHandler), seed);
    expect(set.personas).toHaveLength(24);
    expect(set.voters).toHaveLength(120);
    expect(new Set(set.personas.map((p) => p.id)).size).toBe(24);
    expect(new Set(set.personas.map((p) => p.handle)).size).toBe(24);
    for (const p of set.personas) {
      expect(p.aiAttitude).toBe(2);
      expect(p.contrarian).toBe(1);
    }
    expect(set.personas.filter((p) => p.segment === 'a')).toHaveLength(12);
    for (const p of set.personas) expect(p.tier).toBe(tierFor(p.id));
  });

  it('uses opus and chunks persona calls by 10', async () => {
    const llm = new FakeLlm(personaHandler);
    await generatePersonas(llm, seed);
    const personaCalls = llm.requests.filter((r) =>
      r.label.startsWith('personas')
    );
    expect(personaCalls).toHaveLength(4); // 12 per segment → 10 + 2
    expect(llm.requests.every((r) => r.tier === 'opus')).toBe(true);
  });

  it('throws with the segment name when generation fails', async () => {
    await expect(
      generatePersonas(new FakeLlm(() => new Error('boom')), seed)
    ).rejects.toThrow(/segment a/);
  });

  it('caches to disk and reuses the cache', async () => {
    const file = join(
      mkdtempSync(join(tmpdir(), 'pc-')),
      'personas',
      'seed-1.json'
    );
    const first = await loadOrGeneratePersonas(
      new FakeLlm(personaHandler),
      seed,
      file
    );
    expect(existsSync(file)).toBe(true);
    const llm = new FakeLlm(personaHandler);
    expect(await loadOrGeneratePersonas(llm, seed, file)).toEqual(first);
    expect(llm.callCount).toBe(0);
  });
});
