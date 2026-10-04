import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makePost } from '../test/fixtures.js';
import {
  applyEvent,
  emptyThread,
  flamewarFactor,
  isDead,
  postRankScore,
  rankScore,
  renderThread,
  replay,
  topComments,
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

const flag = (voter: string, target: string): SimEvent => ({
  kind: 'vote',
  step: 0,
  voter,
  target,
  value: 'flag'
});

/** Three distinct flaggers per target — enough to kill a comment. */
const kill = (target: string): SimEvent[] =>
  [1, 2, 3].map((i) => flag(`k${i}`, target));

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

describe('flamewar penalty', () => {
  it('applies only above 40 comments with more comments than points', () => {
    expect(flamewarFactor(30, 41)).toBe(0.6);
    expect(flamewarFactor(30, 40)).toBe(1);
    expect(flamewarFactor(41, 41)).toBe(1);
    expect(flamewarFactor(5, 10)).toBe(1);
  });

  it('never raises the score and bites exactly when the rule holds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 300 }),
        fc.integer({ min: 0, max: 120 }),
        fc.double({ min: 0, max: 24, noNaN: true }),
        fc.integer({ min: 0, max: 5 }),
        (points, comments, age, flags) => {
          const base = rankScore(points, age, flags);
          const penalised = base * flamewarFactor(points, comments);
          expect(penalised).toBeLessThanOrEqual(base);
          const rule = comments > 40 && comments > points;
          if (!rule || base === 0) expect(penalised).toBe(base);
          else expect(penalised).toBeLessThan(base);
        }
      )
    );
  });

  it('postRankScore penalises a post whose live comments outnumber its points', () => {
    const events: SimEvent[] = [];
    for (let i = 1; i <= 45; i++) events.push(comment(`c${i}`, 'post'));
    for (let i = 1; i <= 20; i++)
      events.push({
        kind: 'vote',
        step: 0,
        voter: `v${i}`,
        target: 'post',
        value: 'up'
      });
    const s = replay(makePost(), events);
    expect(postRankScore(s, 1)).toBeCloseTo(rankScore(21, 1, 0) * 0.6);
    const calm = replay(makePost(), [
      ...events,
      ...kill('c1'),
      ...kill('c2'),
      ...kill('c3'),
      ...kill('c4'),
      ...kill('c5')
    ]);
    expect(postRankScore(calm, 1)).toBeCloseTo(rankScore(21, 1, 0));
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

  it('marks comments the OP already answered', () => {
    const out = renderThread(
      replay(makePost(), [
        comment('c1', 'post'),
        comment('c2', 'c1', 'founder'),
        comment('c3', 'post')
      ])
    );
    const line = (id: string) =>
      out.split('\n').find((l) => l.includes(`[${id}]`))!;
    expect(line('c1')).toContain('↳ answered by OP');
    expect(line('c3')).not.toContain('answered by OP');
    expect(line('c2')).toContain('[c2] founder (OP)');
  });

  it('shows a dead comment with live replies as a bare [dead] placeholder', () => {
    const s = replay(makePost(), [
      comment('c1', 'post'),
      comment('c2', 'c1', 'p2'),
      comment('c3', 'post'),
      ...kill('c1'),
      ...kill('c3')
    ]);
    const out = renderThread(s);
    expect(isDead(s.comments.get('c1')!)).toBe(true);
    expect(out).not.toContain('[c1]');
    expect(out).not.toContain('text of c1\n');
    expect(out).not.toContain('[c3]');
    expect(out).toContain('[dead]');
    expect(out).toContain('[c2]');
    expect(out).toContain('| 1 comments');
  });

  it('never renders or ranks a dead comment; always renders the live ones', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { maxLength: 40 }),
        fc.array(fc.nat(), { maxLength: 10 }),
        (picks, deadPicks) => {
          const events = treeEvents(picks);
          const n = events.length;
          const dead = new Set(
            n === 0 ? [] : deadPicks.map((d) => `c${(d % n) + 1}`)
          );
          const s = replay(makePost(), [...events, ...[...dead].flatMap(kill)]);
          const out = renderThread(s);
          const top = topComments(s, 100).map((c) => c.id);
          for (const c of s.comments.values()) {
            if (dead.has(c.id)) {
              expect(out).not.toContain(`[${c.id}]`);
              expect(out).not.toContain(`${c.text}\n`);
              expect(top).not.toContain(c.id);
            } else {
              expect(top).toContain(c.id);
              if (c.depth <= 4) expect(out).toContain(`[${c.id}]`);
            }
          }
        }
      )
    );
  });
});
