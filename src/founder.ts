import type { Llm, LlmResult } from './llm.js';
import {
  answeredByFounder,
  commentScore,
  isDead,
  type ThreadState
} from './thread.js';
import { FOUNDER, type Post } from './types.js';

export interface FounderReply {
  parent: string;
  text: string;
}

export const MAX_REPLIES = 2;
/** The model may propose a few more than it may post, so the engine can drop invalid ones. */
const MAX_CANDIDATES = 4;

const FOUNDER_SCHEMA = {
  type: 'object',
  required: ['replies'],
  properties: {
    replies: {
      type: 'array',
      maxItems: MAX_CANDIDATES,
      items: {
        type: 'object',
        required: ['parent', 'text'],
        properties: { parent: { type: 'string' }, text: { type: 'string' } }
      }
    }
  }
};

function isReplies(x: unknown): x is { replies: FounderReply[] } {
  const rs = (x as { replies?: unknown }).replies;
  return (
    Array.isArray(rs) &&
    rs.every(
      (r) => typeof r?.parent === 'string' && typeof r?.text === 'string'
    )
  );
}

const SYSTEM =
  'You are the founder who submitted this Show HN and you are on comment duty. HN norms: ' +
  'technical, modest, specific. No marketing language, no superlatives, no "great question". ' +
  'Admit limitations plainly; state pricing and telemetry plainly when asked. Use the prepared ' +
  'answers as facts but write naturally. Reply only where it adds information or corrects a ' +
  'misunderstanding — replying to nothing is fine. Never reply to your own comments (marked OP), ' +
  'and never reply again under a comment marked "↳ answered by OP". Prefer unanswered top-level ' +
  'comments with the most points. Where a prepared answer is marked TODO(team), say plainly ' +
  "that it is not decided yet and state what is known; never reply only to say you can't " +
  `confirm something. At most ${MAX_REPLIES} replies.`;

export async function founderTurn(
  llm: Llm,
  args: { post: Post; founderAnswers: string; thread: string; step: number }
): Promise<LlmResult<FounderReply[]>> {
  const prompt = [
    `<prepared-answers>\n${args.founderAnswers}\n</prepared-answers>`,
    '',
    `<thread>\n${args.thread}\n</thread>`,
    '',
    'Pick the comments (by id) that deserve a reply now and write the replies.'
  ].join('\n');
  const res = await llm.call({
    tier: 'sonnet',
    system: SYSTEM,
    prompt,
    schema: FOUNDER_SCHEMA,
    validate: isReplies,
    label: `founder:${args.step}`
  });
  return res.ok ? { ok: true, value: res.value.replies } : res;
}

/**
 * The replies the engine posts: one per parent, never under the founder's own or an already
 * answered or dead comment; unanswered top-level comments first, by score.
 */
export function pickFounderReplies(
  s: ThreadState,
  replies: readonly FounderReply[]
): FounderReply[] {
  const seen = new Set<string>();
  const ok = replies.filter((r) => {
    const parent = s.comments.get(r.parent);
    if (!parent || seen.has(r.parent) || !r.text.trim()) return false;
    if (parent.author === FOUNDER || isDead(parent)) return false;
    if (answeredByFounder(s, r.parent)) return false;
    seen.add(r.parent);
    return true;
  });
  const key = (r: FounderReply) => s.comments.get(r.parent)!;
  return ok
    .sort((a, b) => {
      const ca = key(a);
      const cb = key(b);
      return (
        Number(ca.depth > 0) - Number(cb.depth > 0) ||
        commentScore(cb) - commentScore(ca) ||
        Number(ca.id.slice(1)) - Number(cb.id.slice(1))
      );
    })
    .slice(0, MAX_REPLIES)
    .map((r) => ({ parent: r.parent, text: r.text.trim() }));
}
