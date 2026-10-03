import type { Llm } from './llm.js';
import { computeMetrics, type Metrics } from './metrics.js';
import { DISCLAIMER, ensureLabels, loadRun } from './report.js';
import { commentScore, replay, topComments } from './thread.js';
import { FOUNDER } from './types.js';

export interface RunSummary {
  variant: string;
  index: number;
  runDir: string;
  metrics: Metrics;
  topComments: Array<{ id: string; text: string; score: number }>;
}

export async function summarizeRun(
  llm: Llm,
  runDir: string,
  variant: string,
  index: number
): Promise<RunSummary> {
  const { events, personas, post } = loadRun(runDir);
  const labels = await ensureLabels(llm, runDir);
  const state = replay(post, events);
  const top = topComments(state, 10)
    .filter((c) => c.author !== FOUNDER)
    .slice(0, 3)
    .map((c) => ({ id: c.id, text: c.text, score: commentScore(c) }));
  return {
    variant,
    index,
    runDir,
    metrics: computeMetrics(events, labels, personas),
    topComments: top
  };
}

/** The variant with the strictly highest key in every run index, else null. */
export function consistentBest(
  runs: readonly RunSummary[],
  key: (m: Metrics) => number
): string | null {
  const indices = [...new Set(runs.map((r) => r.index))];
  let winner: string | null = null;
  for (const i of indices) {
    const group = runs
      .filter((r) => r.index === i)
      .sort((a, b) => key(b.metrics) - key(a.metrics));
    if (group.length < 2 || key(group[0]!.metrics) === key(group[1]!.metrics))
      return null;
    if (winner !== null && winner !== group[0]!.variant) return null;
    winner = group[0]!.variant;
  }
  return winner;
}

const meanSentiment = (m: Metrics): number => {
  const all = Object.values(m.sentimentBySegment);
  const n = all.reduce((a, s) => a + s.n, 0);
  return n === 0 ? 0 : all.reduce((a, s) => a + s.mean * s.n, 0) / n;
};

const topLabel = (m: Metrics): string =>
  Object.entries(m.objectionMix).sort((a, b) => b[1]! - a[1]!)[0]?.[0] ?? '–';

export function compareMarkdown(
  seedName: string,
  runs: readonly RunSummary[]
): string {
  const variants = [...new Set(runs.map((r) => r.variant))];
  const best = (name: string, key: (m: Metrics) => number): string => {
    const w = consistentBest(runs, key);
    return `Consistent best by ${name}: ${w ? `**${w}**` : 'none (differs between runs — treat as noise)'}`;
  };
  const lines = [
    DISCLAIMER,
    '',
    `# Variant comparison: ${seedName}`,
    '',
    best('final points', (m) => m.finalPoints),
    '',
    best('mean sentiment', meanSentiment),
    ''
  ];
  for (const v of variants) {
    const vr = runs
      .filter((r) => r.variant === v)
      .sort((a, b) => a.index - b.index);
    lines.push(
      `## ${v}`,
      '',
      '| Run | Peak band | Final points | Comments | Flag share | Mean sentiment | Top label |',
      '|---|---|---|---|---|---|---|',
      ...vr.map(
        (r) =>
          `| ${r.index} | ${r.metrics.peakBand} | ${r.metrics.finalPoints} | ${r.metrics.comments} | ${Math.round(r.metrics.flagShare * 100)}% | ${meanSentiment(r.metrics).toFixed(2)} | ${topLabel(r.metrics)} |`
      ),
      '',
      'Top comments (first run):',
      '',
      ...(vr[0]?.topComments.map(
        (c) =>
          `- [${c.id}] (${c.score}) ${c.text.replace(/\n/g, ' ').slice(0, 240)}`
      ) ?? []),
      '',
      `Runs: ${vr.map((r) => `\`${r.runDir}\``).join(', ')}`,
      ''
    );
  }
  return lines.join('\n');
}
