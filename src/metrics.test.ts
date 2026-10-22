import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makePersona, makePost } from '../test/fixtures.js';
import { FakeLlm } from './llm.js';
import { LABELS, labelComments, type CommentLabel } from './label.js';
import { computeMetrics } from './metrics.js';
import { replay } from './thread.js';
import type { PersonaSet, SimEvent } from './types.js';

const personas: PersonaSet = {
  personas: [
    makePersona(1, { segment: 'a' }),
    makePersona(2, { segment: 'b' })
  ],
  voters: []
};
const c = (id: string, parent: string, author: string, step = 0): SimEvent => ({
  kind: 'comment',
  step,
  id,
  parent,
  author,
  text: id
});
const end = (step: number, score: number, points: number): SimEvent => ({
  kind: 'step-end',
  step,
  score,
  band: score >= 3 ? 'top10' : 'new',
  points,
  flags: 0,
  calls: 2,
  failed: 0
});

describe('computeMetrics', () => {
  it('handles an empty thread without NaN (review focus 3)', () => {
    const events: SimEvent[] = [
      { kind: 'post', step: 0, post: makePost() },
      end(0, 0, 1)
    ];
    const m = computeMetrics(events, [], personas);
    expect(m.comments).toBe(0);
    expect(m.objectionMix).toEqual({});
    const numbers = JSON.stringify(m).match(/-?\d+(\.\d+)?|null/g) ?? [];
    expect(JSON.stringify(m)).not.toMatch(/NaN|Infinity/);
    expect(numbers.length).toBeGreaterThan(0);
    expect(m.peakBand).toBe('new');
  });

  it('final points subtract downvotes', () => {
    const vote = (voter: string, value: string): SimEvent => ({
      kind: 'vote',
      step: 0,
      voter,
      target: 'post',
      value
    });
    const events: SimEvent[] = [
      { kind: 'post', step: 0, post: makePost() },
      vote('v1', 'up'),
      vote('v2', 'up'),
      vote('v3', 'down'),
      end(0, 0, 2)
    ];
    expect(computeMetrics(events, [], personas).finalPoints).toBe(2);
  });

  it('objection shares sum to 1 whenever something is labelled', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...LABELS), { minLength: 1, maxLength: 40 }),
        (labels) => {
          const events: SimEvent[] = [
            { kind: 'post', step: 0, post: makePost() }
          ];
          const ls: CommentLabel[] = labels.map((label, i) => {
            events.push(c(`c${i + 1}`, 'post', 'p1'));
            return { id: `c${i + 1}`, label, sentiment: 0 };
          });
          const sum = Object.values(
            computeMetrics(events, ls, personas).objectionMix
          ).reduce((a, b) => a + b!, 0);
          expect(sum).toBeCloseTo(1, 9);
        }
      )
    );
  });

  it('scores founder replies by the subtree that follows', () => {
    const events: SimEvent[] = [
      { kind: 'post', step: 0, post: makePost() },
      c('c1', 'post', 'p1'),
      c('c2', 'c1', 'founder', 1),
      c('c3', 'c2', 'p1', 2),
      c('c4', 'c3', 'p2', 2),
      c('c5', 'post', 'p2', 2),
      c('c6', 'c5', 'founder', 3),
      end(3, 4, 40)
    ];
    const labels: CommentLabel[] = [
      { id: 'c1', label: 'vs-image-gen', sentiment: -2 },
      { id: 'c3', label: 'question', sentiment: 0 },
      { id: 'c4', label: 'praise', sentiment: 1 },
      { id: 'c5', label: 'praise', sentiment: 2 }
    ];
    const m = computeMetrics(events, labels, personas);
    expect(m.founderEffects).toEqual([
      { replyId: 'c2', parentId: 'c1', delta: 2.5, verdict: 'defused' },
      { replyId: 'c6', parentId: 'c5', delta: null, verdict: 'no-response' }
    ]);
    expect(m.founderReplies).toBe(2);
    expect(m.maxDepth).toBe(3);
    expect(m.sentimentBySegment.a).toEqual({ mean: -1, n: 2 });
    expect(m.frontPage).toBe(true);
  });
});

describe('labelComments', () => {
  it('labels in batches of 15 and falls back to other/0 on failure', async () => {
    const comments = [
      ...replay(
        makePost(),
        Array.from({ length: 20 }, (_, i) => c(`c${i + 1}`, 'post', 'p1'))
      ).comments.values()
    ];
    let n = 0;
    const llm = new FakeLlm((req) => {
      n++;
      if (n === 2) return new Error('bad');
      const ids = [...req.prompt.matchAll(/\[(c\d+)\]/g)].map((m) => m[1]);
      return {
        labels: ids.map((id) => ({ id, label: 'praise', sentiment: 1 }))
      };
    });
    const labels = await labelComments(llm, makePost(), comments);
    expect(labels).toHaveLength(20);
    expect(labels.filter((l) => l.label === 'praise')).toHaveLength(15);
    expect(labels.at(-1)).toEqual({ id: 'c20', label: 'other', sentiment: 0 });
    expect(llm.requests.every((r) => r.tier === 'haiku')).toBe(true);
  });
});
