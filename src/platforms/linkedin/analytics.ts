import {
  DEFAULT_REACH,
  gain,
  STEP_MINUTES,
  stepImpressions,
  type ReachConstants
} from './reach.js';

/** One day of a LinkedIn post-analytics export. */
export interface DayStats {
  date: string;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
}

const COLUMNS = [
  'date',
  'impressions',
  'reactions',
  'comments',
  'reposts'
] as const;

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      fields.push(field);
      field = '';
    } else field += ch;
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

/** A post-analytics export saved as CSV (XLSX → CSV); columns by name, any order, extra columns ignored. */
export function parseAnalyticsCsv(text: string): DayStats[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? '').map((h) => h.toLowerCase());
  const index = Object.fromEntries(
    COLUMNS.map((col) => {
      const i = header.indexOf(col);
      if (i < 0) throw new Error(`analytics CSV: missing column "${col}"`);
      return [col, i];
    })
  ) as Record<(typeof COLUMNS)[number], number>;
  const days: DayStats[] = [];
  lines.slice(1).forEach((line, i) => {
    if (!line.trim()) return;
    const f = splitCsvLine(line);
    const num = (col: Exclude<(typeof COLUMNS)[number], 'date'>): number => {
      const n = Number((f[index[col]] ?? '').replace(/[,\s]/g, ''));
      if (!Number.isFinite(n) || n < 0 || f[index[col]] === '')
        throw new Error(
          `analytics CSV line ${i + 2}: "${col}" is not a number`
        );
      return n;
    };
    days.push({
      date: f[index.date] ?? '',
      impressions: num('impressions'),
      reactions: num('reactions'),
      comments: num('comments'),
      reposts: num('reposts')
    });
  });
  return days;
}

/** Real engagement per impression at which a post keeps its test-slice reach; an assumption like the rest. */
export const REAL_BASELINE_RATE = 0.04;

export const dailyRate = (d: DayStats): number =>
  (d.reactions + 2 * d.reposts + 3 * d.comments) / Math.max(1, d.impressions);

const STEPS_PER_DAY = (24 * 60) / STEP_MINUTES;

/** Daily impressions the reach model predicts, driven by each day's real engagement rate. */
export function modelDaily(
  c: ReachConstants,
  followers: number,
  days: readonly DayStats[]
): number[] {
  const real = { ...c, baselineRate: REAL_BASELINE_RATE };
  return days.map((d, day) => {
    const g = gain(real, dailyRate(d));
    let sum = 0;
    for (let k = 0; k < STEPS_PER_DAY; k++)
      sum += stepImpressions(c, followers, day * STEPS_PER_DAY + k, g);
    return sum;
  });
}

/** RMS error of log(1 + impressions) per day. */
function logError(
  c: ReachConstants,
  followers: number,
  days: readonly DayStats[]
): number {
  const model = modelDaily(c, followers, days);
  const sq = days.reduce(
    (a, d, i) => a + (Math.log1p(model[i]!) - Math.log1p(d.impressions)) ** 2,
    0
  );
  return Math.sqrt(sq / days.length);
}

export interface FitResult {
  testSlice: number;
  expansion: number;
  /** logError at the starting constants and at the fitted ones. */
  before: number;
  after: number;
}

/** Fits testSlice and expansion to the series: coarse log grid, then a pattern search in log space. */
export function fit(
  days: readonly DayStats[],
  followers: number,
  c: ReachConstants = DEFAULT_REACH
): FitResult {
  if (days.length === 0) throw new Error('analytics: no days to fit');
  const err = (ts: number, ex: number): number =>
    logError({ ...c, testSlice: ts, expansion: ex }, followers, days);
  const before = err(c.testSlice, c.expansion);
  let best = { ts: c.testSlice, ex: c.expansion, e: before };
  const grid = (lo: number, hi: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => lo * (hi / lo) ** (i / (n - 1)));
  for (const ts of grid(0.002, 0.5, 30))
    for (const ex of grid(0.05, 20, 30)) {
      const e = err(ts, ex);
      if (e < best.e) best = { ts, ex, e };
    }
  for (let step = 0.5; step > 1e-5;) {
    let moved = false;
    for (const [a, b] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1]
    ] as const) {
      const ts = Math.min(1, best.ts * Math.exp(a * step));
      const ex = best.ex * Math.exp(b * step);
      const e = err(ts, ex);
      if (e < best.e - 1e-12) {
        best = { ts, ex, e };
        moved = true;
      }
    }
    if (!moved) step /= 2;
  }
  return { testSlice: best.ts, expansion: best.ex, before, after: best.e };
}
