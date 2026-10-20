import type { CommentLabel, Label } from './label.js';
import type { Platform } from './platform.js';
import hn from './platforms/hn/index.js';
import { replay, type ThreadState } from './thread.js';
import {
  FOUNDER,
  type Band,
  type PersonaSet,
  type Post,
  type SimEvent
} from './types.js';

export interface FounderEffect {
  replyId: string;
  parentId: string;
  delta: number | null;
  verdict: 'defused' | 'neutral' | 'escalated' | 'no-response';
}

export interface Metrics {
  steps: Array<{
    step: number;
    score: number;
    band: Band;
    points: number;
    flags: number;
  }>;
  peakBand: Band;
  frontPage: boolean;
  finalPoints: number;
  comments: number;
  founderReplies: number;
  maxDepth: number;
  flagShare: number;
  objectionMix: Partial<Record<Label, number>>;
  sentimentBySegment: Record<string, { mean: number; n: number }>;
  founderEffects: FounderEffect[];
  calls: { total: number; failed: number };
  aborted: string | null;
}

const idNum = (id: string): number => Number(id.slice(1));

function descendants(s: ThreadState, id: string): string[] {
  const out: string[] = [];
  for (const c of s.comments.values()) {
    if (c.parent === id) out.push(c.id, ...descendants(s, c.id));
  }
  return out;
}

export function computeMetrics(
  events: readonly SimEvent[],
  labels: readonly CommentLabel[],
  personas: PersonaSet,
  platform: Platform = hn
): Metrics {
  const postEvent = events.find((e) => e.kind === 'post');
  const post: Post =
    postEvent?.kind === 'post'
      ? postEvent.post
      : { title: '', url: '', body: '', firstComment: null };
  const s = replay(post, events);
  const ends = events.filter(
    (e): e is Extract<SimEvent, { kind: 'step-end' }> => e.kind === 'step-end'
  );
  const label = new Map(labels.map((l) => [l.id, l]));
  const comments = [...s.comments.values()];
  const crowd = comments.filter((c) => c.author !== FOUNDER);

  const labelled = crowd.filter((c) => label.has(c.id));
  const objectionMix: Partial<Record<Label, number>> = {};
  for (const c of labelled) {
    const l = label.get(c.id)!.label;
    objectionMix[l] = (objectionMix[l] ?? 0) + 1 / labelled.length;
  }

  const segmentOf = new Map(personas.personas.map((p) => [p.id, p.segment]));
  const acc = new Map<string, { sum: number; n: number }>();
  for (const c of labelled) {
    const seg = segmentOf.get(c.author) ?? 'unknown';
    const a = acc.get(seg) ?? { sum: 0, n: 0 };
    a.sum += label.get(c.id)!.sentiment;
    a.n++;
    acc.set(seg, a);
  }
  const sentimentBySegment = Object.fromEntries(
    [...acc].map(([seg, a]) => [seg, { mean: a.sum / a.n, n: a.n }])
  );

  const founderEffects: FounderEffect[] = comments
    .filter((c) => c.author === FOUNDER && c.parent !== 'post')
    .map((reply) => {
      const parent = label.get(reply.parent);
      const after = descendants(s, reply.id)
        .filter((id) => s.comments.get(id)!.author !== FOUNDER && label.has(id))
        .sort((a, b) => idNum(a) - idNum(b))
        .slice(0, 3);
      if (!parent || after.length === 0) {
        return {
          replyId: reply.id,
          parentId: reply.parent,
          delta: null,
          verdict: 'no-response' as const
        };
      }
      const mean =
        after.reduce((a, id) => a + label.get(id)!.sentiment, 0) / after.length;
      const delta = mean - parent.sentiment;
      const verdict =
        delta > 0.5 ? 'defused' : delta < -0.5 ? 'escalated' : 'neutral';
      return { replyId: reply.id, parentId: reply.parent, delta, verdict };
    });

  const rank = (b: Band): number => platform.bands.indexOf(b);
  const peakBand = ends.reduce<Band>(
    (best, e) => (rank(e.band) < rank(best) ? e.band : best),
    platform.bands.at(-1)!
  );
  const votes = s.postUps + s.postFlags;
  const abort = events.find((e) => e.kind === 'abort');
  return {
    steps: ends.map((e) => ({
      step: e.step,
      score: e.score,
      band: e.band,
      points: e.points,
      flags: e.flags
    })),
    peakBand,
    frontPage: platform.frontPage.includes(peakBand),
    finalPoints: 1 + s.postUps,
    comments: crowd.length,
    founderReplies: comments.filter((c) => c.author === FOUNDER).length,
    maxDepth: comments.reduce((m, c) => Math.max(m, c.depth), 0),
    flagShare: votes === 0 ? 0 : s.postFlags / votes,
    objectionMix,
    sentimentBySegment,
    founderEffects,
    calls: {
      total: ends.reduce((a, e) => a + e.calls, 0),
      failed: ends.reduce((a, e) => a + e.failed, 0)
    },
    aborted: abort?.kind === 'abort' ? abort.reason : null
  };
}
