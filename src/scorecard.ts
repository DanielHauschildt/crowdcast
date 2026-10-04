import { spearman, type ThreadScore } from './backtest.js';
import { DISCLAIMER } from './report.js';
import { ageHours } from './schedule.js';

export function parseThreadList(text: string): number[] {
  const ids: number[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    if (!/^\d+$/.test(line))
      throw new Error(
        `threads list line ${i + 1}: "${raw.trim()}" is not an HN id`
      );
    ids.push(Number(line));
  });
  return ids;
}

export interface Aggregate {
  completed: number;
  aborted: number[];
  recall: number | null;
  tv: number | null;
  spearman: number | null;
  commentRatio: number | null;
  sentimentGap: number | null;
}

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, x) => a + x, 0) / xs.length;

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const present = <T>(xs: ReadonlyArray<T | null>): T[] =>
  xs.filter((x): x is T => x !== null);

export function aggregate(scores: readonly ThreadScore[]): Aggregate {
  const done = scores.filter((s) => !s.aborted);
  return {
    completed: done.length,
    aborted: scores.filter((s) => s.aborted).map((s) => s.id),
    recall: mean(present(done.map((s) => s.recall))),
    tv: mean(done.map((s) => s.tv)),
    spearman: spearman(
      done.map((s) => s.simPoints),
      done.map((s) => s.realPoints)
    ),
    commentRatio: median(present(done.map((s) => s.commentRatio))),
    sentimentGap: mean(present(done.map((s) => s.sentimentGap)))
  };
}

const fmt = (x: number | null, digits = 2): string =>
  x === null ? '–' : x.toFixed(digits);
const pct = (x: number | null): string =>
  x === null ? '–' : `${Math.round(x * 100)}%`;
const hoursOf = (steps: number): string =>
  `${Number(ageHours(steps).toFixed(1))}h`;

export interface ScorecardMeta {
  stamp: string;
  steps: number;
  seed: number;
}

export function scorecardMarkdown(
  scores: readonly ThreadScore[],
  agg: Aggregate,
  meta: ScorecardMeta
): string {
  const h = hoursOf(meta.steps);
  const lines = [
    DISCLAIMER,
    '',
    `# Backtest scorecard ${meta.stamp}`,
    '',
    `${scores.length} real Show HN threads, each simulated from its post alone · ${meta.steps} steps (${h}) · seed ${meta.seed}. ` +
      `Simulated points @ ${h} are ranked against real final points (order, not absolute).`,
    '',
    '## Aggregate',
    '',
    `| Completed | Theme recall | Objection-mix TV ↓ | Spearman ρ (points @ ${h} vs real) | Comment ratio (median) | Sentiment gap (mean, sim − real) |`,
    '|---|---|---|---|---|---|',
    `| ${agg.completed}/${scores.length} | ${pct(agg.recall)} | ${fmt(agg.tv)} | ${fmt(agg.spearman)} | ${fmt(agg.commentRatio)} | ${fmt(agg.sentimentGap)} |`,
    '',
    '## Per thread',
    '',
    `| HN id | Title | Real points | Sim points @ ${h} | Real comments | Sim comments | Ratio | Recall | TV | Sentiment real / sim | Status |`,
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...scores.map(
      (s) =>
        `| ${s.id} | ${s.title.replace(/\|/g, '/')} | ${s.realPoints} | ${s.simPoints} | ${s.realComments} | ${s.simComments} | ${fmt(s.commentRatio)} | ${pct(s.recall)} | ${fmt(s.tv)} | ${fmt(s.realSentiment)} / ${fmt(s.simSentiment)} | ${s.aborted ? `aborted: ${s.aborted}` : 'ok'} |`
    ),
    '',
    '## Themes of the real threads (✓ raised in the simulation)',
    ''
  ];
  for (const s of scores) {
    lines.push(
      `### ${s.id} — ${s.title}`,
      '',
      ...s.themes.map((t) => `- ${t.raised ? '✓' : '✗'} ${t.theme}`),
      '',
      `Run: \`${s.runDir}\``,
      ''
    );
  }
  return lines.join('\n');
}

export const HISTORY_HEADER =
  '| Stamp | Steps | Seed | Completed | Recall | TV | Spearman | Comment ratio | Sentiment gap | Note |\n' +
  '|---|---|---|---|---|---|---|---|---|---|';

export function historyRow(
  agg: Aggregate,
  meta: ScorecardMeta & { note: string }
): string {
  return `| ${meta.stamp} | ${meta.steps} | ${meta.seed} | ${agg.completed} | ${pct(agg.recall)} | ${fmt(agg.tv)} | ${fmt(agg.spearman)} | ${fmt(agg.commentRatio)} | ${fmt(agg.sentimentGap)} | ${meta.note.replace(/\|/g, '/')} |`;
}
