import { CONTEXT_CHARS } from './agents.js';
import type { Llm, LlmResult } from './llm.js';
import type { Comment } from './thread.js';
import type { Post, Vote, Voter } from './types.js';

export interface Ballot {
  voterId: string;
  postVote: Vote;
  commentVotes: Array<{ id: string; vote: Vote }>;
}

const VOTE = { enum: ['up', 'none', 'flag'] };

const VOTER_SCHEMA = {
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
          postVote: VOTE,
          commentVotes: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'vote'],
              properties: { id: { type: 'string' }, vote: VOTE }
            }
          }
        }
      }
    }
  }
};

const isVote = (v: unknown): v is Vote =>
  v === 'up' || v === 'none' || v === 'flag';

function isBallots(x: unknown): x is { ballots: Ballot[] } {
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

const SYSTEM =
  'You simulate how individual Hacker News readers vote. Each reader decides independently from ' +
  'their own profile. Calibrate to real HN: only about 1 in 10 readers who open a Show HN ' +
  'upvote it, and only when it clearly matches their interests; most give no vote at all. ' +
  'Comments are upvoted only when notably insightful or funny. Flags are rare and reserved for ' +
  'spam, astroturfing or marketing-speak.';

export async function voterBatch(
  llm: Llm,
  args: {
    voters: Voter[];
    post: Post;
    context: string;
    comments: Comment[];
    batch: number;
  }
): Promise<LlmResult<Ballot[]>> {
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
    system: SYSTEM,
    prompt,
    schema: VOTER_SCHEMA,
    validate: isBallots,
    label: `voters:${args.batch}`
  });
  return res.ok ? { ok: true, value: res.value.ballots } : res;
}
