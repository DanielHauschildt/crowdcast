import type { Llm, LlmResult } from './llm.js';
import type { Platform } from './platform.js';
import hn from './platforms/hn/index.js';
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

export async function founderTurn(
  llm: Llm,
  args: {
    post: Post;
    founderAnswers: string;
    thread: string;
    step: number;
    platform?: Platform;
  }
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
    system: (args.platform ?? hn).founderSystem(MAX_REPLIES),
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
