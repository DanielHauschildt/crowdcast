import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { EVENTS_FILE, readEvents } from './events.js';
import { labelComments, type CommentLabel } from './label.js';
import type { Llm } from './llm.js';
import { computeMetrics, type Metrics } from './metrics.js';
import { renderThread, replay } from './thread.js';
import { FOUNDER, type PersonaSet, type Post, type SimEvent } from './types.js';

export const DISCLAIMER =
  '**Synthetic LLM simulation — hypotheses, not a forecast.**';
export const RUN_FILE = 'run.json';
export const PERSONAS_FILE = 'personas.json';

export interface RunMeta {
  seedName: string;
  variant: string;
  rngSeed: number;
  personaSeed: number;
  createdAt: string;
  founderAnswers: string;
  hypotheses: string;
}

export interface ReportSections {
  topObjections: string;
  changes: string;
  riskiestComments: string;
  founderReplies: string;
  hypotheses: string;
}

const SECTION_KEYS = [
  'topObjections',
  'changes',
  'riskiestComments',
  'founderReplies',
  'hypotheses'
] as const;

const SCHEMA = {
  type: 'object',
  required: [...SECTION_KEYS],
  properties: Object.fromEntries(
    SECTION_KEYS.map((k) => [k, { type: 'string' }])
  )
};

const isSections = (x: unknown): x is ReportSections =>
  typeof x === 'object' &&
  x !== null &&
  SECTION_KEYS.every(
    (k) => typeof (x as Record<string, unknown>)[k] === 'string'
  );

export function citedIds(md: string): string[] {
  return [...new Set([...md.matchAll(/\[(c\d+)\]/g)].map((m) => m[1]!))];
}

export function loadRun(runDir: string): {
  meta: RunMeta;
  events: SimEvent[];
  personas: PersonaSet;
  post: Post;
} {
  const meta = JSON.parse(
    readFileSync(join(runDir, RUN_FILE), 'utf8')
  ) as RunMeta;
  const personas = JSON.parse(
    readFileSync(join(runDir, PERSONAS_FILE), 'utf8')
  ) as PersonaSet;
  const events = readEvents(join(runDir, EVENTS_FILE));
  const first = events.find((e) => e.kind === 'post');
  if (first?.kind !== 'post')
    throw new Error(`${runDir}: events.jsonl has no post event`);
  return { meta, events, personas, post: first.post };
}

export async function ensureLabels(
  llm: Llm,
  runDir: string
): Promise<CommentLabel[]> {
  const file = join(runDir, 'labels.json');
  const { events, post } = loadRun(runDir);
  const crowd = [...replay(post, events).comments.values()].filter(
    (c) => c.author !== FOUNDER
  );
  if (existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, 'utf8')) as CommentLabel[];
    if (cached.length === crowd.length) return cached;
  }
  const labels = await labelComments(llm, post, crowd);
  writeFileSync(file, JSON.stringify(labels, null, 2));
  return labels;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

export function assembleReport(
  meta: RunMeta,
  runName: string,
  post: Post,
  m: Metrics,
  s: ReportSections
): string {
  const mix = Object.entries(m.objectionMix)
    .sort((a, b) => b[1]! - a[1]!)
    .map(([label, share]) => `| ${label} | ${pct(share!)} |`)
    .join('\n');
  const effects = m.founderEffects.reduce<Record<string, number>>(
    (a, e) => ((a[e.verdict] = (a[e.verdict] ?? 0) + 1), a),
    {}
  );
  return [
    DISCLAIMER,
    '',
    `# Show HN rehearsal: ${post.title}`,
    '',
    `Run \`${runName}\` · seed \`${meta.seedName}\` · variant \`${meta.variant}\` · rng ${meta.rngSeed}` +
      (m.aborted ? ` · **aborted: ${m.aborted}**` : ''),
    '',
    '## Numbers',
    '',
    '| Peak band | Front page | Final points | Comments | Founder replies | Max depth | Flag share | Calls (failed) |',
    '|---|---|---|---|---|---|---|---|',
    `| ${m.peakBand} | ${m.frontPage ? 'yes' : 'no'} | ${m.finalPoints} | ${m.comments} | ${m.founderReplies} | ${m.maxDepth} | ${pct(m.flagShare)} | ${m.calls.total} (${m.calls.failed}) |`,
    '',
    '| Label | Share |',
    '|---|---|',
    mix || '| (no comments) | – |',
    '',
    `Founder replies: ${
      Object.entries(effects)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ') || 'none'
    }`,
    '',
    '## Top objections',
    '',
    s.topObjections,
    '',
    '## Changes to post / README / demo',
    '',
    s.changes,
    '',
    '## Riskiest comments',
    '',
    s.riskiestComments,
    '',
    '## Founder replies that helped / hurt',
    '',
    s.founderReplies,
    '',
    '## Mapping to experiments.md hypotheses',
    '',
    s.hypotheses,
    ''
  ].join('\n');
}

const SYSTEM =
  'You analyse a simulated Hacker News thread for the team launching the product. Be concrete and ' +
  'critical. Every claim about the thread must cite comment ids in square brackets, e.g. [c4]. ' +
  'Use only ids that appear in the thread. This is synthetic data: frame findings as hypotheses.';

export async function writeReport(llm: Llm, runDir: string): Promise<string> {
  const { meta, events, personas, post } = loadRun(runDir);
  const state = replay(post, events);
  const thread = renderThread(state);
  writeFileSync(
    join(runDir, 'thread.md'),
    `${DISCLAIMER}\n\n\`\`\`text\n${thread}\n\`\`\`\n`
  );
  const labels = await ensureLabels(llm, runDir);
  const metrics = computeMetrics(events, labels, personas);
  writeFileSync(join(runDir, 'metrics.json'), JSON.stringify(metrics, null, 2));

  const basePrompt = [
    `<metrics>\n${JSON.stringify(metrics, null, 2)}\n</metrics>`,
    `<labels>\n${labels.map((l) => `${l.id}: ${l.label} (${l.sentiment})`).join('\n')}\n</labels>`,
    `<prepared-founder-answers>\n${meta.founderAnswers}\n</prepared-founder-answers>`,
    `<hypotheses>\n${meta.hypotheses || '(none provided)'}\n</hypotheses>`,
    `<thread>\n${thread}\n</thread>`,
    '',
    'Write these markdown sections (no headings inside them):',
    '- topObjections: the 3–6 most important objections, each with cited comments and a suggested addition to the prepared founder answers.',
    '- changes: concrete edits to the post title/body, README and demo.',
    '- riskiestComments: comments that could sink the thread if they became top comment, and why.',
    '- founderReplies: which founder replies helped or hurt, citing them.',
    '- hypotheses: for each hypothesis, whether this thread supports, contradicts or says nothing about it.'
  ].join('\n');

  const valid = new Set(state.comments.keys());
  let prompt = basePrompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm.call({
      tier: 'opus',
      system: SYSTEM,
      prompt,
      schema: SCHEMA,
      validate: isSections,
      label: 'report'
    });
    if (!res.ok) throw new Error(`report generation failed: ${res.error}`);
    const bad = citedIds(Object.values(res.value).join('\n')).filter(
      (id) => !valid.has(id)
    );
    if (bad.length === 0) {
      const file = join(runDir, 'report.md');
      writeFileSync(
        file,
        assembleReport(meta, basename(runDir), post, metrics, res.value)
      );
      return file;
    }
    if (attempt === 1)
      throw new Error(
        `report cites comments that do not exist: ${bad.join(', ')}`
      );
    prompt = `${basePrompt}\n\nYour previous answer cited ids that do not exist: ${bad.join(', ')}. Use only ids present in the thread.`;
  }
  throw new Error('unreachable');
}
