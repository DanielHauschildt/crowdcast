import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from './hn-timeline.js';
import { fitMarkdown, fitSchedule, type Timeline } from './schedule-fit.js';
import { rankScore } from './thread.js';

const COMMENTS_PER_10MIN = { top10: 10, top30: 5, page2: 2, new: 1 };

function rankFor(score: number, k: number): number | null {
  if (score >= 4) return k % 10;
  if (score >= 1.5) return 10 + (k % 20);
  if (score >= 0.5) return 30 + (k % 30);
  return null;
}

/** Stories whose front-page rank follows rankScore with cut-offs 4 / 1.5 / 0.5. */
function synthetic(): Timeline[] {
  return Array.from({ length: 40 }, (_, k) => {
    const perTenMin = 0.2 + k * 0.3;
    let comments = 0;
    const snapshots: Snapshot[] = [];
    for (let ageMin = 0; ageMin < 360; ageMin += 10) {
      const points = 1 + Math.round(perTenMin * (ageMin / 10));
      const rankTop = rankFor(rankScore(points, ageMin / 60, 0), k);
      snapshots.push({ t: '', ageMin, points, comments, rankTop });
      const band =
        rankTop === null
          ? 'new'
          : rankTop < 10
            ? 'top10'
            : rankTop < 30
              ? 'top30'
              : 'page2';
      comments += COMMENTS_PER_10MIN[band];
    }
    return { id: String(k), snapshots };
  });
}

describe('fitSchedule', () => {
  const fit = fitSchedule(synthetic());

  it('recovers band thresholds in order top10 > top30 > page2', () => {
    const { top10, top30, page2 } = fit.thresholds;
    expect(top10).not.toBeNull();
    expect(top10!).toBeGreaterThan(top30!);
    expect(top30!).toBeGreaterThan(page2!);
    expect(top10!).toBeGreaterThan(1.5);
    expect(top10!).toBeLessThanOrEqual(4.5);
    expect(page2!).toBeGreaterThan(0.2);
    expect(page2!).toBeLessThanOrEqual(0.6);
    expect(fit.ordered).toBe(true);
  });

  it('derives visitor fractions from the comment-rate ratio between bands', () => {
    const f = fit.fractions;
    expect(f.top10).toBe(1);
    expect(f.top30).toBeCloseTo(0.5, 1);
    expect(f.page2).toBeCloseTo(0.2, 1);
    expect(f.newLate).toBeCloseTo(0.1, 1);
  });

  it('summarises medians and front-page share per 20-min step', () => {
    expect(fit.steps).toHaveLength(18);
    expect(fit.steps[0]).toMatchObject({ step: 0, stories: 40 });
    const late = fit.steps[17]!;
    expect(late.medianPoints).toBeGreaterThan(fit.steps[1]!.medianPoints);
    expect(late.frontShare).toBeGreaterThanOrEqual(0);
    expect(late.frontShare).toBeLessThanOrEqual(1);
    for (const row of fit.frontByPoints) {
      expect(row.share).toBeGreaterThanOrEqual(0);
      expect(row.share).toBeLessThanOrEqual(1);
    }
  });

  it('keeps fractions in [0,1] and never yields NaN on arbitrary timelines', () => {
    const snap = fc.record({
      t: fc.constant(''),
      ageMin: fc.integer({ min: 0, max: 359 }),
      points: fc.integer({ min: 0, max: 500 }),
      comments: fc.integer({ min: 0, max: 300 }),
      rankTop: fc.option(fc.integer({ min: 0, max: 499 }))
    });
    fc.assert(
      fc.property(
        fc.array(fc.array(snap, { maxLength: 12 }), { maxLength: 8 }),
        (raw) => {
          const fit = fitSchedule(
            raw.map((snapshots, i) => ({ id: String(i), snapshots }))
          );
          for (const v of Object.values(fit.fractions)) {
            if (v === null) continue;
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
          for (const v of Object.values(fit.thresholds))
            expect(Number.isNaN(v)).toBe(false);
          expect(fitMarkdown(fit)).not.toMatch(/NaN/);
        }
      )
    );
  });

  it('reports empty bands as null and renders a markdown summary', () => {
    const empty = fitSchedule([]);
    expect(empty.thresholds).toEqual({ top10: null, top30: null, page2: null });
    expect(fitMarkdown(fit)).toMatch(/BAND_THRESHOLDS/);
    expect(fitMarkdown(fit)).toMatch(/visitorFraction/);
  });
});
