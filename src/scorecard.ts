import { spearman, type ThreadScore } from './backtest.js';
import { DISCLAIMER } from './report.js';
import { mulberry32, shuffle } from './rng.js';
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

const HOLDOUT_SHARE = 0.3;

/** Fixed hash split: an id is in the holdout set forever, whoever builds the lists. */
export const isHoldout = (id: number): boolean =>
  mulberry32(id)() < HOLDOUT_SHARE;

export function selectIds(
  ids: readonly number[],
  opts: { sample?: number; limit?: number; seed: number }
): number[] {
  let out = [...ids];
  if (opts.sample !== undefined) {
    const keep = new Set(
      shuffle(mulberry32(opts.seed), ids).slice(0, opts.sample)
    );
    out = out.filter((id) => keep.has(id));
  }
  return opts.limit === undefined ? out : out.slice(0, opts.limit);
}

export interface Interval {
  lo: number;
  hi: number;
}

/** Percentile bootstrap interval of `stat` over `xs`. */
export function bootstrapInterval(
  xs: readonly number[],
  stat: (xs: readonly number[]) => number,
  seed: number,
  level = 0.9,
  reps = 1000
): Interval | null {
  if (xs.length === 0) return null;
  const rng = mulberry32(seed);
  const stats = Array.from({ length: reps }, () =>
    stat(xs.map(() => xs[Math.floor(rng() * xs.length)]!))
  ).sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return {
    lo: stats[Math.floor(tail * reps)]!,
    hi: stats[Math.ceil((1 - tail) * reps) - 1]!
  };
}

export interface Aggregate {
  completed: number;
  aborted: number[];
  recall: number | null;
  recallCi: Interval | null;
  tv: number | null;
  tvCi: Interval | null;
  spearman: number | null;
  commentRatio: number | null;
  commentRatioMean: number | null;
  commentRatioCi: Interval | null;
  sentimentGap: number | null;
}

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, x) => a + x, 0) / xs.length;

/** A thread with no simulated comments counts as ratio 0.01, not log 0 = -Infinity. */
const RATIO_FLOOR = 0.01;

const geoMean = (xs: readonly number[]): number =>
  Math.exp(mean(xs.map((x) => Math.log(Math.max(x, RATIO_FLOOR))))!);

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const present = <T>(xs: ReadonlyArray<T | null>): T[] =>
  xs.filter((x): x is T => x !== null);

export function aggregate(scores: readonly ThreadScore[], seed = 1): Aggregate {
  const done = scores.filter((s) => !s.aborted);
  const recalls = present(done.map((s) => s.recall));
  const tvs = done.map((s) => s.tv);
  const ratios = present(done.map((s) => s.commentRatio));
  const avg = (xs: readonly number[]): number => mean(xs)!;
  return {
    completed: done.length,
    aborted: scores.filter((s) => s.aborted).map((s) => s.id),
    recall: mean(recalls),
    recallCi: bootstrapInterval(recalls, avg, seed),
    tv: mean(tvs),
    tvCi: bootstrapInterval(tvs, avg, seed),
    spearman: spearman(
      done.map((s) => s.simPoints),
      done.map((s) => s.realPoints)
    ),
    commentRatio: median(ratios),
    commentRatioMean: ratios.length === 0 ? null : geoMean(ratios),
    commentRatioCi: bootstrapInterval(ratios, geoMean, seed),
    sentimentGap: mean(present(done.map((s) => s.sentimentGap)))
  };
}

const fmt = (x: number | null, digits = 2): string =>
  x === null ? '–' : x.toFixed(digits);
const pct = (x: number | null): string =>
  x === null ? '–' : `${Math.round(x * 100)}%`;
const withCi = (
  x: number | null,
  ci: Interval | null,
  show: (x: number) => string
): string =>
  x === null || ci === null
    ? '–'
    : `${show(x)} [${show(ci.lo)}–${show(ci.hi)}]`;
const pctCi = (x: number | null, ci: Interval | null): string =>
  withCi(x, ci, pct);
const fmtCi = (x: number | null, ci: Interval | null): string =>
  withCi(x, ci, fmt);
const hoursOf = (steps: number): string =>
  `${Number(ageHours(steps).toFixed(1))}h`;

export interface ScorecardMeta {
  stamp: string;
  steps: number;
  seed: number;
  /** `train`, `holdout`, `all`, or `ids` for ids given on the command line. */
  set: string;
  /** Default: hn. */
  platform?: string;
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
    `${scores.length} real ${!meta.platform || meta.platform === 'hn' ? 'Show HN' : meta.platform} threads (${meta.set} set), each simulated from its post alone · ${meta.steps} steps (${h}) · seed ${meta.seed}. ` +
      `Simulated points @ ${h} are ranked against real final points (order, not absolute).`,
    '',
    '## Aggregate',
    '',
    'Means with a bootstrap 90% interval [lo–hi]: a change between rounds inside the interval is noise.',
    '',
    `| Completed | Theme recall | Objection-mix TV ↓ | Spearman ρ (points @ ${h} vs real) | Comment ratio (median) | Comment ratio (geo. mean) | Sentiment gap (mean, sim − real) |`,
    '|---|---|---|---|---|---|---|',
    `| ${agg.completed}/${scores.length} | ${pctCi(agg.recall, agg.recallCi)} | ${fmtCi(agg.tv, agg.tvCi)} | ${fmt(agg.spearman)} | ${fmt(agg.commentRatio)} | ${fmtCi(agg.commentRatioMean, agg.commentRatioCi)} | ${fmt(agg.sentimentGap)} |`,
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
  '| Stamp | Steps | Seed | Completed | Recall [90%] | TV [90%] | Spearman | Comment ratio | Sentiment gap | Note | Comment ratio geo. [90%] | Set | n |\n' +
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|';

export function historyRow(
  agg: Aggregate,
  meta: ScorecardMeta & { n: number; note: string }
): string {
  return `| ${meta.stamp} | ${meta.steps} | ${meta.seed} | ${agg.completed} | ${pctCi(agg.recall, agg.recallCi)} | ${fmtCi(agg.tv, agg.tvCi)} | ${fmt(agg.spearman)} | ${fmt(agg.commentRatio)} | ${fmt(agg.sentimentGap)} | ${meta.note.replace(/\|/g, '/')} | ${fmtCi(agg.commentRatioMean, agg.commentRatioCi)} | ${meta.set} | ${meta.n} |`;
}
