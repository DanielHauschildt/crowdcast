import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makePost } from '../test/fixtures.js';
import {
  applyEvent,
  emptyThread,
  rankScore,
  renderThread,
  replay,
  unseenReplies,
  type ThreadState
} from './thread.js';
import type { SimEvent } from './types.js';

const comment = (
  id: string,
  parent: string,
  author = 'p1',
  step = 0
): SimEvent => ({
  kind: 'comment',
  step,
  id,
  parent,
  author,
  text: `text of ${id}`
});

/** Builds a random tree: element i picks a parent among post + c1..c{i}. */
function treeEvents(picks: number[]): SimEvent[] {
  return picks.map((n, i) => {
    const idx = n % (i + 1);
    return comment(
      `c${i + 1}`,
      idx === 0 ? 'post' : `c${idx}`,
      `p${(n % 5) + 1}`
    );
  });
}

describe('thread state', () => {
  it('computes depth from parents', () => {
    const s = replay(makePost(), [
      comment('c1', 'post'),
      comment('c2', 'c1'),
      comment('c3', 'c2')
    ]);
    expect(s.comments.get('c3')!.depth).toBe(2);
    expect(s.nextId).toBe(4);
  });

  it('rejects unknown parents and duplicate ids', () => {
    const s = emptyThread(makePost());
    expect(() => applyEvent(s, comment('c1', 'c9'))).toThrow(/unknown parent/);
    applyEvent(s, comment('c1', 'post'));
    expect(() => applyEvent(s, comment('c1', 'post'))).toThrow(/duplicate/);
  });

  it('dedupes votes and ignores self-votes', () => {
    const s = replay(makePost(), [comment('c1', 'post', 'p1')]);
    const up = (voter: string, target: string): SimEvent => ({
      kind: 'vote',
      step: 0,
      voter,
      target,
      value: 'up'
    });
    applyEvent(s, up('v1', 'post'));
    applyEvent(s, up('v1', 'post'));
    applyEvent(s, up('p1', 'c1'));
    applyEvent(s, up('v2', 'c1'));
    expect(s.postUps).toBe(1);
    expect(s.comments.get('c1')!.ups).toBe(1);
  });

  it('every reply attaches to an existing parent with depth = parent + 1', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 60 }), (picks) => {
        const s = replay(makePost(), treeEvents(picks));
        for (const c of s.comments.values()) {
          if (c.parent === 'post') expect(c.depth).toBe(0);
          else expect(c.depth).toBe(s.comments.get(c.parent)!.depth + 1);
        }
      })
    );
  });

  it('flags returners when someone else replied after their last visit', () => {
    const s = replay(makePost(), [
      { kind: 'visit', step: 1, actor: 'p1' },
      comment('c1', 'post', 'p1', 1),
      comment('c2', 'c1', 'p2', 1)
    ]);
    expect(unseenReplies(s, 'p1')).toBe(true);
    applyEvent(s, { kind: 'visit', step: 2, actor: 'p1' });
    expect(unseenReplies(s, 'p1')).toBe(false);
    expect(unseenReplies(s, 'p2')).toBe(false);
  });
});

describe('rankScore', () => {
  it('is 0 for a fresh 1-point post', () => {
    expect(rankScore(1, 0, 0)).toBe(0);
  });

  it('is monotonic in points and decays with age and flags', () => {
    const n = fc.integer({ min: 1, max: 500 });
    const t = fc.double({ min: 0, max: 24, noNaN: true });
    const f = fc.integer({ min: 0, max: 10 });
    fc.assert(
      fc.property(n, n, t, t, f, (p1, p2, t1, t2, flags) => {
        const [lo, hi] = p1 <= p2 ? [p1, p2] : [p2, p1];
        expect(rankScore(lo, t1, flags)).toBeLessThanOrEqual(
          rankScore(hi, t1, flags)
        );
        const [young, old] = t1 <= t2 ? [t1, t2] : [t2, t1];
        expect(rankScore(hi, old, flags)).toBeLessThanOrEqual(
          rankScore(hi, young, flags)
        );
        expect(rankScore(hi, t1, flags + 1)).toBeLessThanOrEqual(
          rankScore(hi, t1, flags)
        );
      })
    );
  });
});

describe('renderThread', () => {
  const build = (picks: number[]): ThreadState =>
    replay(makePost(), treeEvents(picks));

  it('never exceeds maxChars', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { maxLength: 80 }),
        fc.integer({ min: 50, max: 4000 }),
        (picks, maxChars) => {
          expect(
            renderThread(build(picks), { maxChars }).length
          ).toBeLessThanOrEqual(maxChars);
        }
      )
    );
  });

  it('unbounded render lists parents before children', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 40 }), (picks) => {
        const s = build(picks);
        const out = renderThread(s);
        for (const c of s.comments.values()) {
          if (c.parent === 'post' || c.depth > 4) continue;
          expect(out.indexOf(`[${c.parent}]`)).toBeLessThan(
            out.indexOf(`[${c.id}]`)
          );
        }
      })
    );
  });

  it('marks the founder as OP and collapses deep replies', () => {
    const events: SimEvent[] = [comment('c1', 'post', 'founder')];
    for (let i = 2; i <= 7; i++) events.push(comment(`c${i}`, `c${i - 1}`));
    const out = renderThread(replay(makePost(), events));
    expect(out).toContain('[c1] founder (OP)');
    expect(out).toContain('[c5]');
    expect(out).not.toContain('[c6]');
    expect(out).toContain('2 more replies collapsed');
  });
});
