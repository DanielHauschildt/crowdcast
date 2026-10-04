import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RENDER_CHARS, runSimulation } from './engine.js';
import { fetchThread, type FetchFn, type RealThread } from './hn.js';
import { labelComments, type CommentLabel, type Label } from './label.js';
import type { Llm } from './llm.js';
import { computeMetrics } from './metrics.js';
import { ageHours } from './schedule.js';
import {
  DISCLAIMER,
  ensureLabels,
  PERSONAS_FILE,
  RUN_FILE,
  type RunMeta
} from './report.js';
import { postPoints, renderThread, type Comment } from './thread.js';
import { FOUNDER, type PersonaSet, type Seed } from './types.js';

export type Mix = Partial<Record<Label, number>>;

export function labelMix(labels: readonly CommentLabel[]): Mix {
  const out: Mix = {};
  for (const l of labels)
    out[l.label] = (out[l.label] ?? 0) + 1 / labels.length;
  return out;
}

/** Total-variation distance between two label distributions (counts or shares). */
export function tvDistance(p: Mix, q: Mix): number {
  const sum = (m: Mix) => Object.values(m).reduce((a, x) => a + (x ?? 0), 0);
  const sp = sum(p);
  const sq = sum(q);
  if (sp === 0 && sq === 0) return 0;
  if (sp === 0 || sq === 0) return 1;
  const keys = new Set([...Object.keys(p), ...Object.keys(q)]) as Set<Label>;
  let d = 0;
  for (const k of keys) d += Math.abs((p[k] ?? 0) / sp - (q[k] ?? 0) / sq);
  return Math.min(1, d / 2);
}

function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const out = new Array<number>(xs.length);
  for (let s = 0; s < order.length; ) {
    let e = s;
    while (e + 1 < order.length && order[e + 1]!.x === order[s]!.x) e++;
    for (let k = s; k <= e; k++) out[order[k]!.i] = (s + e) / 2 + 1;
    s = e + 1;
  }
  return out;
}

/** Spearman rank correlation with average ranks for ties; null below 3 points or for a constant side. */
export function spearman(
  xs: readonly number[],
  ys: readonly number[]
): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (rx.length + 1) / 2;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < rx.length; i++) {
    const dx = rx[i]! - mean;
    const dy = ry[i]! - mean;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return Math.max(-1, Math.min(1, cov / Math.sqrt(vx * vy)));
}

const meanSentiment = (labels: readonly CommentLabel[]): number | null =>
  labels.length === 0
    ? null
    : labels.reduce((a, l) => a + l.sentiment, 0) / labels.length;

export function founderAnswersFor(t: RealThread): string {
  const own = t.comments.filter((c) => c.author === t.op);
  if (own.length === 0)
    return '(The founder posted no comments in the real thread. Say only what the post says.)';
  return [
    "The founder's own comments in the real thread — use them as the facts you know:",
    '',
    ...own.map((c) => `- ${c.text.replace(/\n+/g, ' ')}`)
  ].join('\n');
}

export function realThreadText(t: RealThread, maxChars: number): string {
  const depth = new Map<string, number>();
  const lines: string[] = [];
  for (const c of t.comments) {
    const d = c.parent === 'post' ? 0 : (depth.get(c.parent) ?? 0) + 1;
    depth.set(c.id, d);
    const who = c.author === t.op ? 'OP' : c.author;
    lines.push(
      `${'  '.repeat(d)}[${c.id}] ${who}: ${c.text.replace(/\n+/g, ' ')}`
    );
  }
  return lines.join('\n').slice(0, maxChars);
}

export async function loadOrFetchThread(
  dir: string,
  id: number,
  fetchFn?: FetchFn
): Promise<RealThread> {
  const file = join(dir, 'real.json');
  if (existsSync(file))
    return JSON.parse(readFileSync(file, 'utf8')) as RealThread;
  const t = await fetchThread(id, fetchFn);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(t, null, 2));
  writeFileSync(join(dir, 'context.md'), t.context);
  return t;
}

const crowdOf = (t: RealThread): Comment[] =>
  t.comments
    .filter((c) => c.author !== t.op)
    .map((c) => ({
      id: c.id,
      parent: c.parent,
      author: c.author,
      text: c.text,
      step: 0,
      depth: 0,
      ups: 0,
      flags: 0
    }));

async function cached<T>(
  file: string,
  ok: (x: T) => boolean,
  make: () => Promise<T>
): Promise<T> {
  if (existsSync(file)) {
    const x = JSON.parse(readFileSync(file, 'utf8')) as T;
    if (ok(x)) return x;
  }
  const x = await make();
  writeFileSync(file, JSON.stringify(x, null, 2));
  return x;
}

const THEMES_SCHEMA = {
  type: 'object',
  required: ['themes'],
  properties: {
    themes: { type: 'array', items: { type: 'string' }, maxItems: 5 }
  }
};

async function extractThemes(llm: Llm, t: RealThread): Promise<string[]> {
  const res = await llm.call({
    tier: 'opus',
    label: 'themes',
    system:
      'You analyse real Hacker News threads. Name the themes commenters actually raised, each as one short, specific sentence.',
    schema: THEMES_SCHEMA,
    prompt: [
      `Post: ${t.post.title}`,
      '',
      `<thread>\n${realThreadText(t, RENDER_CHARS)}\n</thread>`,
      '',
      "List the thread's top 5 themes (fewer if the thread is small), most discussed first. Ignore the OP's own comments as a source of themes."
    ].join('\n'),
    validate: (x): x is { themes: string[] } => {
      const ts = (x as { themes?: unknown }).themes;
      return (
        Array.isArray(ts) &&
        ts.length > 0 &&
        ts.every((s) => typeof s === 'string')
      );
    }
  });
  if (!res.ok) throw new Error(`theme extraction failed: ${res.error}`);
  return res.value.themes.slice(0, 5);
}

const RECALL_SCHEMA = {
  type: 'object',
  required: ['raised'],
  properties: { raised: { type: 'array', items: { type: 'boolean' } } }
};

async function judgeRecall(
  llm: Llm,
  themes: readonly string[],
  simThread: string
): Promise<boolean[]> {
  const res = await llm.call({
    tier: 'opus',
    label: 'theme-recall',
    system:
      'You compare a simulated Hacker News thread with themes from the real one. A theme counts as raised only if at least one simulated comment makes substantially the same point.',
    schema: RECALL_SCHEMA,
    prompt: [
      'Themes:',
      ...themes.map((t, i) => `${i + 1}. ${t}`),
      '',
      `<simulated-thread>\n${simThread}\n</simulated-thread>`,
      '',
      `Return "raised": one boolean per theme, in order (${themes.length} entries).`
    ].join('\n'),
    validate: (x): x is { raised: boolean[] } => {
      const r = (x as { raised?: unknown }).raised;
      return (
        Array.isArray(r) &&
        r.length === themes.length &&
        r.every((b) => typeof b === 'boolean')
      );
    }
  });
  if (!res.ok) throw new Error(`theme recall failed: ${res.error}`);
  return res.value.raised;
}

export interface ThreadScore {
  id: number;
  title: string;
  runDir: string;
  aborted: string | null;
  hours: number;
  realPoints: number;
  simPoints: number;
  realComments: number;
  simComments: number;
  commentRatio: number | null;
  themes: Array<{ theme: string; raised: boolean }>;
  recall: number | null;
  tv: number;
  realMix: Mix;
  simMix: Mix;
  realSentiment: number | null;
  simSentiment: number | null;
  sentimentGap: number | null;
}

export interface BacktestThreadArgs {
  llm: Llm;
  real: RealThread;
  /** Cache for the real side: real.json, labels.json, themes.json. */
  threadDir: string;
  runDir: string;
  /** Audience and naming; context and founder answers come from the real thread. */
  seed: Seed;
  personas: PersonaSet;
  steps: number;
  rngSeed: number;
}

export async function backtestThread(
  a: BacktestThreadArgs
): Promise<ThreadScore> {
  const { llm, real } = a;
  const seed: Seed = {
    ...a.seed,
    context: real.context,
    founderAnswers: founderAnswersFor(real),
    hypotheses: ''
  };
  mkdirSync(a.runDir, { recursive: true });
  mkdirSync(a.threadDir, { recursive: true });
  const meta: RunMeta = {
    seedName: seed.name,
    variant: 'backtest',
    rngSeed: a.rngSeed,
    personaSeed: a.rngSeed,
    createdAt: new Date().toISOString(),
    founderAnswers: seed.founderAnswers,
    hypotheses: ''
  };
  writeFileSync(join(a.runDir, RUN_FILE), JSON.stringify(meta, null, 2));
  writeFileSync(
    join(a.runDir, PERSONAS_FILE),
    JSON.stringify(a.personas, null, 2)
  );

  const res = await runSimulation({
    post: real.post,
    seed,
    personas: a.personas,
    llm,
    rngSeed: a.rngSeed,
    runDir: a.runDir,
    steps: a.steps
  });
  const simLabels = await ensureLabels(llm, a.runDir);
  const metrics = computeMetrics(res.events, simLabels, a.personas);
  writeFileSync(
    join(a.runDir, 'metrics.json'),
    JSON.stringify(metrics, null, 2)
  );
  const simThread = renderThread(res.state, { maxChars: RENDER_CHARS });
  writeFileSync(
    join(a.runDir, 'thread.md'),
    `${DISCLAIMER}\n\n\`\`\`text\n${renderThread(res.state)}\n\`\`\`\n`
  );

  const crowd = crowdOf(real);
  const realLabels = await cached<CommentLabel[]>(
    join(a.threadDir, 'labels.json'),
    (x) => x.length === crowd.length,
    () => labelComments(llm, real.post, crowd)
  );
  const themes = await cached<string[]>(
    join(a.threadDir, 'themes.json'),
    (x) => x.length > 0,
    () => extractThemes(llm, real)
  );
  const raised = await judgeRecall(llm, themes, simThread);

  const simCrowd = [...res.state.comments.values()].filter(
    (c) => c.author !== FOUNDER
  ).length;
  const realMix = labelMix(realLabels);
  const simMix = labelMix(simLabels);
  const realSentiment = meanSentiment(realLabels);
  const simSentiment = meanSentiment(simLabels);
  const score: ThreadScore = {
    id: real.id,
    title: real.post.title,
    runDir: a.runDir,
    aborted: res.aborted,
    hours: ageHours(a.steps),
    realPoints: real.points,
    simPoints: postPoints(res.state),
    realComments: crowd.length,
    simComments: simCrowd,
    commentRatio: crowd.length === 0 ? null : simCrowd / crowd.length,
    themes: themes.map((theme, i) => ({ theme, raised: raised[i]! })),
    recall:
      themes.length === 0
        ? null
        : raised.filter(Boolean).length / themes.length,
    tv: tvDistance(realMix, simMix),
    realMix,
    simMix,
    realSentiment,
    simSentiment,
    sentimentGap:
      realSentiment === null || simSentiment === null
        ? null
        : simSentiment - realSentiment
  };
  writeFileSync(join(a.runDir, 'score.json'), JSON.stringify(score, null, 2));
  return score;
}
