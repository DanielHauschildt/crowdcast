import type { LlmRequest } from '../src/llm.js';
import type { Persona, Post, Seed, Voter } from '../src/types.js';

export function makePost(over: Partial<Post> = {}): Post {
  return {
    title: 'Show HN: Test tool',
    url: 'https://example.com',
    body: 'A tool.',
    firstComment: null,
    ...over
  };
}

export function makePersona(i: number, over: Partial<Persona> = {}): Persona {
  return {
    id: `p${i}`,
    segment: 'agent-builders',
    handle: `user${i}`,
    bio: 'Backend engineer.',
    expertise: ['go'],
    aiAttitude: 0,
    verbosity: 2,
    contrarian: 0.5,
    activity: 1,
    voiceSample: 'Neat, but how does it handle fonts?',
    ...over
  };
}

export function makeVoter(i: number, over: Partial<Voter> = {}): Voter {
  return {
    id: `v${i}`,
    segment: 'agent-builders',
    oneLiner: 'Rails dev, lurker.',
    ...over
  };
}

export function makeSeed(over: Partial<Seed> = {}): Seed {
  return {
    name: 'test-seed',
    dir: '/tmp/test-seed',
    context: 'README: the tool makes editable files.',
    founderAnswers: 'Pricing: free locally.',
    hypotheses: 'H1: editable files land.',
    segments: [{ id: 'agent-builders', share: 1, leanings: 'curious' }],
    activeCount: 3,
    voterCount: 4,
    ...over
  };
}

/** Answers persona and voter-profile requests with the count the prompt asks for. */
export function personaHandler(req: LlmRequest<unknown>): unknown {
  const count = Number(/exactly (\d+)/.exec(req.prompt)![1]);
  if (req.label.startsWith('voter-profiles')) {
    return {
      voters: Array.from({ length: count }, (_, i) => ({
        oneLiner: `voter ${i}`
      }))
    };
  }
  return {
    personas: Array.from({ length: count }, (_, i) => ({
      handle: i % 2 ? 'dup' : `h${i}`,
      bio: 'bio',
      expertise: ['x'],
      aiAttitude: 9,
      verbosity: 2,
      contrarian: 1.5,
      activity: 0.4,
      voiceSample: 'meh'
    }))
  };
}
