import type { Llm, LlmResult } from './llm.js';
import type { Comment } from './thread.js';
import type { Persona, Post, Vote } from './types.js';

export const CONTEXT_CHARS = 8000;
const VOTES = ['up', 'none', 'flag'] as const;

export interface AgentAction {
  vote: Vote;
  upvoteComments: string[];
  comment: { parent: string; text: string } | null;
  leave: boolean;
}

export const AGENT_SCHEMA = {
  type: 'object',
  required: ['vote', 'upvoteComments', 'comment', 'leave'],
  properties: {
    vote: { enum: VOTES },
    upvoteComments: { type: 'array', items: { type: 'string' } },
    comment: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          required: ['parent', 'text'],
          properties: { parent: { type: 'string' }, text: { type: 'string' } }
        }
      ]
    },
    leave: { type: 'boolean' }
  }
};

export function isAgentAction(x: unknown): x is AgentAction {
  const a = x as Record<string, unknown>;
  if (typeof a !== 'object' || a === null) return false;
  if (!VOTES.includes(a.vote as Vote) || typeof a.leave !== 'boolean')
    return false;
  if (
    !Array.isArray(a.upvoteComments) ||
    !a.upvoteComments.every((s) => typeof s === 'string')
  )
    return false;
  if (a.comment === null) return true;
  const c = a.comment as Record<string, unknown>;
  return (
    typeof c === 'object' &&
    typeof c.parent === 'string' &&
    typeof c.text === 'string'
  );
}

const ATTITUDE = [
  'hostile',
  'skeptical',
  'neutral',
  'positive',
  'enthusiastic'
];
const VERBOSITY = ['terse', 'normal', 'long-winded'];

export function agentSystem(p: Persona): string {
  return [
    `You are ${p.handle}, a Hacker News user. ${p.bio}`,
    `Expertise: ${p.expertise.join(', ')}.`,
    `Attitude toward AI tools: ${ATTITUDE[p.aiAttitude + 2]}. Contrarian tendency: ${p.contrarian.toFixed(1)} (0–1). Writing: ${VERBOSITY[p.verbosity - 1]}.`,
    `Write exactly like this sample of your comments:\n"${p.voiceSample}"`,
    '',
    'You are reading a Show HN thread. Behave as this person really would on HN: most visitors ' +
      'only read; upvote only what you would genuinely want others to see; comment only when you ' +
      'have something specific to say. HN norms: plain ' +
      'text, no emojis, no hashtags, allergic to marketing. Never mention being an AI or a simulation.'
  ].join('\n');
}

export interface AgentTurnArgs {
  persona: Persona;
  post: Post;
  context: string;
  thread: string;
  ownComments: Comment[];
}

export function agentTurn(
  llm: Llm,
  args: AgentTurnArgs
): Promise<LlmResult<AgentAction>> {
  const own = args.ownComments.length
    ? args.ownComments.map((c) => `[${c.id}] ${c.text}`).join('\n')
    : '(none)';
  const prompt = [
    'The post links to a page. If you click through, you see:',
    `<linked-page>\n${args.context.slice(0, CONTEXT_CHARS)}\n</linked-page>`,
    '',
    `<thread>\n${args.thread}\n</thread>`,
    '',
    `Your earlier comments in this thread:\n${own}`,
    '',
    'Decide what you do now.',
    "- vote: 'up' if you'd upvote the post, 'flag' only for spam/abuse/rule-breaking, else 'none'.",
    '- upvoteComments: ids of comments you upvote (often none).',
    "- comment: null, or { parent: 'post' or an existing comment id such as 'c4', text }. At most one.",
    '- leave: true if you are done with this thread.'
  ].join('\n');
  return llm.call({
    tier: 'haiku',
    system: agentSystem(args.persona),
    prompt,
    schema: AGENT_SCHEMA,
    validate: isAgentAction,
    label: `agent:${args.persona.id}`
  });
}
