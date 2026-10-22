import type { Snapshot } from './hn-timeline.js';
import { BAND_THRESHOLDS, STEP_MINUTES, visitorFraction } from './schedule.js';
import { flamewarFactor, rankScore } from './thread.js';
import type { Band } from './types.js';

export interface Timeline {
  id: string;
  snapshots: Snapshot[];
}

export interface StepRow {
  step: number;
  stories: number;
  medianPoints: number;
  medianComments: number;
  /** Share of stories at this age with rankTop < 30. */
  frontShare: number;
}

export interface FrontByPoints {
  step: number;
  points: string;
  stories: number;
  share: number;
}

type Cut = 'top10' | 'top30' | 'page2';
type Group = 'top10' | 'top30' | 'page2' | 'newEarly' | 'newLate';

export interface ScheduleFit {
  stories: number;
  snapshots: number;
  steps: StepRow[];
  frontByPoints: FrontByPoints[];
  /** Proposed BAND_THRESHOLDS (rankScore units); null where no story reached the band. */
  thresholds: Record<Cut, number | null>;
  ordered: boolean;
  /** Comments per step relative to top10 (newEarly = first 3 steps in `new`); null without data. */
  fractions: Record<Group, number | null>;
  commentsPerStep: Record<Group, number | null>;
}

const RANK_CUT: Record<Cut, number> = { top10: 10, top30: 30, page2: 60 };
const POINT_BUCKETS = [1, 5, 10, 20, 50, Infinity];
const STEPS = 360 / STEP_MINUTES;

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function bandOf(rankTop: number | null): Band {
  if (rankTop === null || rankTop >= RANK_CUT.page2) return 'new';
  if (rankTop < RANK_CUT.top10) return 'top10';
  return rankTop < RANK_CUT.top30 ? 'top30' : 'page2';
}

function score(s: Snapshot): number {
  return (
    rankScore(s.points, s.ageMin / 60, 0) * flamewarFactor(s.points, s.comments)
  );
}

/** The cut-off on `score` that misclassifies fewest snapshots as in/out of the top `rank`. */
function bestCut(snaps: readonly Snapshot[], rank: number): number | null {
  const xs = snaps
    .map((s) => ({ v: score(s), pos: s.rankTop !== null && s.rankTop < rank }))
    .sort((a, b) => a.v - b.v);
  const positives = xs.filter((x) => x.pos).length;
  if (positives === 0) return null;
  // Cut at xs[i].v: everything from i up is predicted in.
  let posBelow = 0;
  let negAbove = xs.length - positives;
  let best = { errors: Infinity, v: 0 };
  for (let i = 0; i < xs.length; i++) {
    if (i === 0 || xs[i]!.v !== xs[i - 1]!.v) {
      const errors = posBelow + negAbove;
      if (errors < best.errors) best = { errors, v: xs[i]!.v };
    }
    if (xs[i]!.pos) posBelow++;
    else negAbove--;
  }
  return best.v;
}

function group(s: Snapshot): Group {
  const band = bandOf(s.rankTop);
  if (band !== 'new') return band;
  return s.ageMin < 3 * STEP_MINUTES ? 'newEarly' : 'newLate';
}

function commentRates(
  timelines: readonly Timeline[]
): Record<Group, number | null> {
  const sums = new Map<Group, { comments: number; minutes: number }>();
  for (const { snapshots } of timelines) {
    const s = [...snapshots].sort((a, b) => a.ageMin - b.ageMin);
    for (let i = 1; i < s.length; i++) {
      const dt = s[i]!.ageMin - s[i - 1]!.ageMin;
      if (dt <= 0) continue;
      const g = group(s[i - 1]!);
      const acc = sums.get(g) ?? { comments: 0, minutes: 0 };
      acc.comments += Math.max(0, s[i]!.comments - s[i - 1]!.comments);
      acc.minutes += dt;
      sums.set(g, acc);
    }
  }
  const rate = (g: Group): number | null => {
    const acc = sums.get(g);
    return acc ? (acc.comments / acc.minutes) * STEP_MINUTES : null;
  };
  return {
    top10: rate('top10'),
    top30: rate('top30'),
    page2: rate('page2'),
    newEarly: rate('newEarly'),
    newLate: rate('newLate')
  };
}

function relativeFractions(
  rates: Record<Group, number | null>
): Record<Group, number | null> {
  const known = Object.values(rates).filter((r): r is number => r !== null);
  const base = rates.top10 || Math.max(0, ...known);
  const rel = (r: number | null): number | null =>
    r === null ? null : base > 0 ? Math.min(1, r / base) : 0;
  return {
    top10: rel(rates.top10),
    top30: rel(rates.top30),
    page2: rel(rates.page2),
    newEarly: rel(rates.newEarly),
    newLate: rel(rates.newLate)
  };
}

function stepRows(timelines: readonly Timeline[]): {
  steps: StepRow[];
  frontByPoints: FrontByPoints[];
} {
  const steps: StepRow[] = [];
  const frontByPoints: FrontByPoints[] = [];
  for (let step = 0; step < STEPS; step++) {
    // One snapshot per story and step: the first one in the window.
    const at = timelines.flatMap(({ snapshots }) => {
      const s = snapshots.find(
        (x) => Math.floor(x.ageMin / STEP_MINUTES) === step
      );
      return s ? [s] : [];
    });
    const front = (xs: Snapshot[]): number =>
      xs.length === 0
        ? 0
        : xs.filter((x) => x.rankTop !== null && x.rankTop < 30).length /
          xs.length;
    steps.push({
      step,
      stories: at.length,
      medianPoints: median(at.map((s) => s.points)),
      medianComments: median(at.map((s) => s.comments)),
      frontShare: front(at)
    });
    for (let b = 0; b < POINT_BUCKETS.length - 1; b++) {
      const lo = POINT_BUCKETS[b]!;
      const hi = POINT_BUCKETS[b + 1]!;
      const inBucket = at.filter((s) => s.points >= lo && s.points < hi);
      if (inBucket.length === 0) continue;
      frontByPoints.push({
        step,
        points: hi === Infinity ? `${lo}+` : `${lo}-${hi - 1}`,
        stories: inBucket.length,
        share: front(inBucket)
      });
    }
  }
  return { steps, frontByPoints };
}

export function fitSchedule(timelines: readonly Timeline[]): ScheduleFit {
  const snaps = timelines.flatMap((t) => t.snapshots);
  const thresholds = {
    top10: bestCut(snaps, RANK_CUT.top10),
    top30: bestCut(snaps, RANK_CUT.top30),
    page2: bestCut(snaps, RANK_CUT.page2)
  };
  const { top10, top30, page2 } = thresholds;
  const commentsPerStep = commentRates(timelines);
  return {
    stories: timelines.length,
    snapshots: snaps.length,
    ...stepRows(timelines),
    thresholds,
    ordered:
      top10 !== null &&
      top30 !== null &&
      page2 !== null &&
      top10 > top30 &&
      top30 > page2,
    fractions: relativeFractions(commentsPerStep),
    commentsPerStep
  };
}

const fmt = (v: number | null, digits = 2): string =>
  v === null ? '–' : v.toFixed(digits);

const CURRENT_FRACTION: Record<Group, number> = {
  top10: visitorFraction('top10', 3),
  top30: visitorFraction('top30', 3),
  page2: visitorFraction('page2', 3),
  newEarly: visitorFraction('new', 0),
  newLate: visitorFraction('new', 3)
};

export function fitMarkdown(fit: ScheduleFit): string {
  const cuts = (Object.keys(RANK_CUT) as Cut[]).map(
    (c) =>
      `| ${c} | rank < ${RANK_CUT[c]} | ${fmt(BAND_THRESHOLDS[c])} | ${fmt(fit.thresholds[c])} |`
  );
  const groups = (Object.keys(CURRENT_FRACTION) as Group[]).map(
    (g) =>
      `| ${g} | ${fmt(fit.commentsPerStep[g])} | ${fmt(CURRENT_FRACTION[g])} | ${fmt(fit.fractions[g])} |`
  );
  const steps = fit.steps
    .filter((s) => s.stories > 0)
    .map(
      (s) =>
        `| ${s.step * STEP_MINUTES} | ${s.stories} | ${s.medianPoints} | ${s.medianComments} | ${fmt(s.frontShare)} |`
    );
  const front = fit.frontByPoints.map(
    (r) =>
      `| ${r.step * STEP_MINUTES} | ${r.points} | ${r.stories} | ${fmt(r.share)} |`
  );
  return [
    '# Show HN schedule fit',
    '',
    `${fit.stories} stories, ${fit.snapshots} snapshots, ${STEP_MINUTES}-min steps.`,
    '',
    '## BAND_THRESHOLDS (rankScore units)',
    '',
    '| band | real rank | current | proposed |',
    '|---|---|---|---|',
    ...cuts,
    '',
    fit.ordered
      ? 'Proposed thresholds are ordered top10 > top30 > page2.'
      : '**Proposed thresholds are not ordered top10 > top30 > page2 (too little data?); do not apply.**',
    '',
    '## visitorFraction (comment rate relative to top10)',
    '',
    '| band | comments/step | current | proposed |',
    '|---|---|---|---|',
    ...groups,
    '',
    '## Medians by age',
    '',
    '| age min | stories | median points | median comments | front-page share |',
    '|---|---|---|---|---|',
    ...steps,
    '',
    '## Front-page share by points at age',
    '',
    '| age min | points | stories | front-page share |',
    '|---|---|---|---|',
    ...front,
    ''
  ].join('\n');
}
