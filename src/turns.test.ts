import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makePersona, makePost, makeVoter } from '../test/fixtures.js';
import { CONTEXT_CHARS, agentTurn, isAgentAction } from './agents.js';
import { founderTurn, pickFounderReplies } from './founder.js';
import { FakeLlm } from './llm.js';
import { answeredByFounder, replay } from './thread.js';
import { FOUNDER, type SimEvent } from './types.js';
import { voterBatch } from './voters.js';

describe('agentTurn', () => {
  it('validates actions', () => {
    expect(
      isAgentAction({
        vote: 'up',
        upvoteComments: [],
        comment: null,
        leave: false
      })
    ).toBe(true);
    expect(
      isAgentAction({
        vote: 'up',
        upvoteComments: [],
        comment: { parent: 'post', text: 'hi' },
        leave: true
      })
    ).toBe(true);
    expect(
      isAgentAction({
        vote: 'love',
        upvoteComments: [],
        comment: null,
        leave: false
      })
    ).toBe(false);
    expect(
      isAgentAction({
        vote: 'up',
        upvoteComments: [],
        comment: { parent: 3 },
        leave: false
      })
    ).toBe(false);
  });

  it('prompts with persona voice, truncated context and the thread on haiku', async () => {
    const llm = new FakeLlm(() => ({
      vote: 'none',
      upvoteComments: [],
      comment: null,
      leave: true
    }));
    const res = await agentTurn(llm, {
      persona: makePersona(1, {
        handle: 'grumpy_dev',
        voiceSample: 'Yet another wrapper.'
      }),
      post: makePost(),
      context: 'x'.repeat(CONTEXT_CHARS + 500),
      thread: 'THREAD-MARKER',
      ownComments: []
    });
    expect(res.ok).toBe(true);
    const req = llm.requests[0]!;
    expect(req.tier).toBe('haiku');
    expect(req.system).toContain('grumpy_dev');
    expect(req.system).toContain('Yet another wrapper.');
    expect(req.prompt).toContain('THREAD-MARKER');
    expect(req.prompt.length).toBeLessThan(CONTEXT_CHARS + 2000);
  });
});

describe('voterBatch', () => {
  it('sends every voter id and returns ballots from haiku', async () => {
    const ballots = [
      {
        voterId: 'v1',
        postVote: 'up',
        commentVotes: [{ id: 'c1', vote: 'up' }]
      }
    ];
    const llm = new FakeLlm(() => ({ ballots }));
    const res = await voterBatch(llm, {
      voters: [makeVoter(1), makeVoter(2)],
      post: makePost(),
      context: 'ctx',
      comments: [],
      batch: 0
    });
    expect(res).toEqual({ ok: true, value: ballots });
    expect(llm.requests[0]!.tier).toBe('haiku');
    expect(llm.requests[0]!.prompt).toContain('v2');
  });
});

describe('founderTurn', () => {
  it('uses sonnet, includes prepared answers, passes candidates to the engine', async () => {
    const replies = [1, 2, 3, 4].map((i) => ({
      parent: `c${i}`,
      text: 'answer'
    }));
    const llm = new FakeLlm(() => ({ replies }));
    const res = await founderTurn(llm, {
      post: makePost(),
      founderAnswers: 'PRICING-FACT',
      thread: 't',
      step: 0
    });
    expect(llm.requests[0]!.tier).toBe('sonnet');
    expect(llm.requests[0]!.prompt).toContain('PRICING-FACT');
    expect(res.ok && res.value).toHaveLength(4);
  });

  it('turns TODO(team) into "not decided yet", never "can\'t confirm" chains', async () => {
    const llm = new FakeLlm(() => ({ replies: [] }));
    await founderTurn(llm, {
      post: makePost(),
      founderAnswers: 'Pricing: TODO(team)',
      thread: 't',
      step: 0
    });
    const system = llm.requests[0]!.system;
    expect(system).toContain('TODO(team)');
    expect(system).toContain('not decided yet');
    expect(system).toMatch(/can't confirm/);
    expect(system).toContain('answered by OP');
    expect(system).toContain('At most 2 replies');
  });
});

describe('pickFounderReplies', () => {
  const c = (id: string, parent: string, author = 'p1'): SimEvent => ({
    kind: 'comment',
    step: 0,
    id,
    parent,
    author,
    text: id
  });
  const up = (voter: string, target: string): SimEvent => ({
    kind: 'vote',
    step: 0,
    voter,
    target,
    value: 'up'
  });

  it('prefers unanswered top-level comments by score, at most 2', () => {
    const s = replay(makePost(), [
      c('c1', 'post'),
      c('c2', 'post'),
      c('c3', 'post'),
      c('c4', 'c1'),
      c('c5', 'post'),
      c('c6', 'c5', FOUNDER),
      up('v1', 'c3'),
      up('v2', 'c3'),
      up('v1', 'c2')
    ]);
    const picks = pickFounderReplies(s, [
      { parent: 'c4', text: 'nested' },
      { parent: 'c1', text: 'low' },
      { parent: 'c5', text: 'already answered' },
      { parent: 'c6', text: 'own comment' },
      { parent: 'c9', text: 'unknown' },
      { parent: 'c2', text: 'mid' },
      { parent: 'c3', text: '  ' },
      { parent: 'c3', text: 'top' }
    ]);
    expect(picks).toEqual([
      { parent: 'c3', text: 'top' },
      { parent: 'c2', text: 'mid' }
    ]);
  });

  it('never picks two replies under one parent, an answered parent, or more than 2', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 1, maxLength: 30 }),
        fc.array(fc.nat(), { maxLength: 8 }),
        fc.array(fc.nat(), { maxLength: 12 }),
        (picks, answered, wanted) => {
          const events: SimEvent[] = picks.map((n, i) => {
            const idx = n % (i + 1);
            return c(`c${i + 1}`, idx === 0 ? 'post' : `c${idx}`);
          });
          let next = events.length + 1;
          for (const a of answered)
            events.push(c(`c${next++}`, `c${(a % picks.length) + 1}`, FOUNDER));
          const s = replay(makePost(), events);
          const chosen = pickFounderReplies(
            s,
            wanted.map((w) => ({
              parent: `c${(w % (next + 2)) + 1}`,
              text: 'x'
            }))
          );
          expect(chosen.length).toBeLessThanOrEqual(2);
          const parents = chosen.map((r) => r.parent);
          expect(new Set(parents).size).toBe(parents.length);
          for (const p of parents) {
            const parent = s.comments.get(p)!;
            expect(parent.author).not.toBe(FOUNDER);
            expect(answeredByFounder(s, p)).toBe(false);
          }
        }
      )
    );
  });
});
