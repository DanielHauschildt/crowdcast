import { CONTEXT_CHARS } from './agents.js';
import type { Llm, LlmResult } from './llm.js';
import type { Platform } from './platform.js';
import hn from './platforms/hn/index.js';
import type { Comment } from './thread.js';
import type { Post, Vote, Voter } from './types.js';

export interface Ballot {
  voterId: string;
  postVote: Vote;
  commentVotes: Array<{ id: string; vote: Vote }>;
}

const voterSchema = (votes: readonly string[]) => {
  const vote = { enum: votes };
  return {
    type: 'object',
    required: ['ballots'],
    properties: {
      ballots: {
        type: 'array',
        items: {
          type: 'object',
          required: ['voterId', 'postVote', 'commentVotes'],
          properties: {
            voterId: { type: 'string' },
            postVote: vote,
            commentVotes: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'vote'],
                properties: { id: { type: 'string' }, vote }
              }
            }
          }
        }
      }
    }
  };
};

function isBallots(
  x: unknown,
  votes: readonly string[]
): x is { ballots: Ballot[] } {
  const isVote = (v: unknown): v is Vote => votes.includes(v as Vote);
  const bs = (x as { ballots?: unknown }).ballots;
  return (
    Array.isArray(bs) &&
    bs.every(
      (b) =>
        typeof b?.voterId === 'string' &&
        isVote(b.postVote) &&
        Array.isArray(b.commentVotes) &&
        b.commentVotes.every(
          (cv: { id?: unknown; vote?: unknown }) =>
            typeof cv?.id === 'string' && isVote(cv.vote)
        )
    )
  );
}

export async function voterBatch(
  llm: Llm,
  args: {
    voters: Voter[];
    post: Post;
    context: string;
    comments: Comment[];
    batch: number;
    platform?: Platform;
  }
): Promise<LlmResult<Ballot[]>> {
  const platform = args.platform ?? hn;
  const readers = args.voters.map((v) => `- ${v.id}: ${v.oneLiner}`).join('\n');
  const comments = args.comments.length
    ? args.comments
        .map((c) => `[${c.id}] ${c.author}: ${c.text.slice(0, 300)}`)
        .join('\n')
    : '(no comments yet)';
  const prompt = [
    `Post: ${args.post.title}${args.post.url ? ` (${args.post.url})` : ''}`,
    args.post.body,
    '',
    `<linked-page-excerpt>\n${args.context.slice(0, CONTEXT_CHARS / 4)}\n</linked-page-excerpt>`,
    '',
    `Visible comments:\n${comments}`,
    '',
    `Readers:\n${readers}`,
    '',
    'Return one ballot per reader (same voterId): postVote and any commentVotes (omit comments they ignore).'
  ].join('\n');
  const res = await llm.call({
    tier: 'haiku',
    system: platform.voterSystem,
    prompt,
    schema: voterSchema(platform.votes),
    validate: (x): x is { ballots: Ballot[] } => isBallots(x, platform.votes),
    label: `voters:${args.batch}`
  });
  return res.ok ? { ok: true, value: res.value.ballots } : res;
}
