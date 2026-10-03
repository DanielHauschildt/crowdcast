import { describe, expect, it } from 'vitest';
import { makePersona, makePost, makeVoter } from '../test/fixtures.js';
import { CONTEXT_CHARS, agentTurn, isAgentAction } from './agents.js';
import { founderTurn } from './founder.js';
import { FakeLlm } from './llm.js';
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
  it('uses sonnet, includes prepared answers, caps at 3 replies', async () => {
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
    expect(res.ok && res.value).toHaveLength(3);
  });
});
