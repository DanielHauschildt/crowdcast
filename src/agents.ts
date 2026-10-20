import type { Llm, LlmResult } from './llm.js';
import type { Platform } from './platform.js';
import hn from './platforms/hn/index.js';
import type { Comment } from './thread.js';
import type { Persona, Post, Vote } from './types.js';

export const CONTEXT_CHARS = 8000;

export interface AgentAction {
  vote: Vote;
  upvoteComments: string[];
  comment: { parent: string; text: string } | null;
  leave: boolean;
}

export const agentSchema = (votes: readonly string[]) => ({
  type: 'object',
  required: ['vote', 'upvoteComments', 'comment', 'leave'],
  properties: {
    vote: { enum: votes },
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
});

export function isAgentAction(
  x: unknown,
  votes: readonly string[] = hn.votes
): x is AgentAction {
  const a = x as Record<string, unknown>;
  if (typeof a !== 'object' || a === null) return false;
  if (!votes.includes(a.vote as Vote) || typeof a.leave !== 'boolean')
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

export interface AgentTurnArgs {
  persona: Persona;
  post: Post;
  context: string;
  thread: string;
  ownComments: Comment[];
  platform?: Platform;
}

export function agentTurn(
  llm: Llm,
  args: AgentTurnArgs
): Promise<LlmResult<AgentAction>> {
  const platform = args.platform ?? hn;
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
    platform.agentRules
  ].join('\n');
  return llm.call({
    tier: args.persona.tier ?? 'haiku',
    system: platform.agentSystem(args.persona),
    prompt,
    schema: agentSchema(platform.votes),
    validate: (x): x is AgentAction => isAgentAction(x, platform.votes),
    label: `agent:${args.persona.id}`
  });
}
