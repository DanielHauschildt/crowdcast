import type { Llm } from './llm.js';
import type { Platform } from './platform.js';
import hn from './platforms/hn/index.js';
import type { Comment } from './thread.js';
import type { Post } from './types.js';

/** Objection types mirror gtm/Marketing/experiments.md, plus three non-objection buckets. */
export const LABELS = [
  'vs-image-gen',
  'vs-design-tools',
  'pricing/licensing',
  'trust/telemetry',
  'ai-replaces-designers',
  'integration-effort',
  'other',
  'praise',
  'question',
  'off-topic'
] as const;
export type Label = (typeof LABELS)[number];

export interface CommentLabel {
  id: string;
  label: Label;
  /** -2 very negative … 2 very positive toward the product */
  sentiment: number;
}

const BATCH = 15;

const LABEL_GUIDE = `- vs-image-gen: "why not just an image generator / Midjourney / HTML-to-PNG"
- vs-design-tools: comparisons to Canva, Figma, Adobe, other design tools or plugins
- pricing/licensing: cost, free tier, open source, licence, lock-in
- trust/telemetry: privacy, telemetry, data use, security, vendor trust
- ai-replaces-designers: craft, jobs, "AI slop", designers being replaced
- integration-effort: setup, install, MCP friction, compatibility, performance
- other: an objection that fits none of the above
- praise: positive without a material objection
- question: neutral question about how it works
- off-topic: tangents, jokes, meta`;

const SCHEMA = {
  type: 'object',
  required: ['labels'],
  properties: {
    labels: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'label', 'sentiment'],
        properties: {
          id: { type: 'string' },
          label: { enum: LABELS },
          sentiment: { type: 'integer', minimum: -2, maximum: 2 }
        }
      }
    }
  }
};

export async function labelComments(
  llm: Llm,
  post: Post,
  comments: readonly Comment[],
  platform: Platform = hn
): Promise<CommentLabel[]> {
  const batches = Array.from(
    { length: Math.ceil(comments.length / BATCH) },
    (_, i) => comments.slice(i * BATCH, i * BATCH + BATCH)
  );
  const results = await Promise.all(
    batches.map(async (batch, i) => {
      const ids = new Set(batch.map((c) => c.id));
      const res = await llm.call({
        tier: 'haiku',
        label: `labels:${i}`,
        system: platform.labelSystem,
        schema: SCHEMA,
        prompt: [
          `Post: ${post.title}`,
          '',
          `Labels:\n${LABEL_GUIDE}`,
          '',
          'Comments:',
          ...batch.map((c) => `[${c.id}] ${c.text}`),
          '',
          'Return one entry per comment id, with sentiment toward the product (-2..2).'
        ].join('\n'),
        validate: (x): x is { labels: CommentLabel[] } => {
          const ls = (x as { labels?: unknown }).labels;
          return (
            Array.isArray(ls) &&
            ls.every(
              (l) =>
                ids.has(l?.id) &&
                LABELS.includes(l?.label) &&
                Number.isInteger(l?.sentiment)
            ) &&
            new Set(ls.map((l: CommentLabel) => l.id)).size === ids.size
          );
        }
      });
      if (res.ok)
        return res.value.labels.map((l) => ({
          ...l,
          sentiment: Math.max(-2, Math.min(2, l.sentiment))
        }));
      return batch.map((c): CommentLabel => ({
        id: c.id,
        label: 'other',
        sentiment: 0
      }));
    })
  );
  const byId = new Map(results.flat().map((l) => [l.id, l]));
  return comments.map((c) => byId.get(c.id)!);
}
