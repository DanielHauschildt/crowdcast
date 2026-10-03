import type { Llm, LlmResult } from './llm.js';
import type { Post } from './types.js';

export interface FounderReply {
  parent: string;
  text: string;
}

const MAX_REPLIES = 3;

const FOUNDER_SCHEMA = {
  type: 'object',
  required: ['replies'],
  properties: {
    replies: {
      type: 'array',
      maxItems: MAX_REPLIES,
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
  'misunderstanding — replying to nothing is fine. Never reply to your own comments (marked OP). ' +
  `At most ${MAX_REPLIES} replies.`;

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
  return res.ok
    ? { ok: true, value: res.value.replies.slice(0, MAX_REPLIES) }
    : res;
}
