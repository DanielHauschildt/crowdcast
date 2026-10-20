# Show HN timelines

Algolia only has a story's final points, so `crowdcast track` records our own points-over-time series for Show HN
stories in their first 6 hours. `track fit` turns them into proposed `BAND_THRESHOLDS` and `visitorFraction` values for
`src/schedule.ts`; applying them is a separate calibration round.

## What is collected

Every poll cycle (default every 5 min) reads `newstories.json` and `topstories.json` from the official
[HN Firebase API](https://github.com/HackerNews/API) and fetches each Show HN story younger than 6 h (at most 4 requests
in flight; non-Show-HN ids are fetched once and then skipped; errors double the wait, up to 30 min). Each story gets an
append-only `data/<id>.jsonl`, one line per cycle:

```json
{ "t": "2026-10-20T12:00:00.000Z", "ageMin": 95, "points": 12, "comments": 7, "rankTop": 1 }
```

`rankTop` is the index in `topstories` (0 = #1; < 30 = front page, < 60 = page 2), `null` when not listed.

## Run

```sh
nohup pnpm crowdcast track --hours 48 > simulations/timelines/data/track.log 2>&1 &
pnpm crowdcast track fit   # writes fit.md and fit.json here
```

`fit.md` has median points/comments per 20-min step, the front-page share by points at age, thresholds fitted on
`rankScore` (fewest misclassified snapshots per rank cut-off) and comment rates per band relative to top10. Thresholds
that come out unordered are flagged; don't apply them.

## Privacy

Only story ids, counts, ranks and timestamps are stored: no usernames, titles, links or comment text. `data/` is
gitignored; `fit.md`/`fit.json` hold aggregates only.
