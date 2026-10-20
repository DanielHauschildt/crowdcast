# Backtest sets

Real Show HN threads the simulator is scored against (`pnpm crowdcast backtest`). One HN id per line,
`id  # title, points, comments`; points and comments are as fetched, the thread itself is cached under
`threads/<id>/` (gitignored). A line may carry platform options after the id, `id key=value …  # comment`; they
are applied to that thread's platform like extra `platform.yaml` keys (reddit: `subreddit=selfhosted`).

| File | Set | What |
|---|---|---|
| `threads.txt` | `train` | the 15 original threads (tuned on since round 1) plus ~70% of the 2023–2026 corpus |
| `holdout.txt` | `holdout` | ~30% of the corpus, never used while tuning |

The corpus is ~100 Show HN threads from 2023–2026 with ≥ 5 comments, stratified by final points (about a third each
< 30, 30–150, > 150) and mixing dev tools, AI/agent tools, design and consumer products. A corpus id goes to
`holdout.txt` exactly when `isHoldout(id)` (`src/scorecard.ts`, a fixed hash of the id) says so, so the split never
depends on who rebuilt the lists. The 15 original ids stay in train: they have been tuned on already.

## Rule: tune on train, report holdout

Change prompts or weights only against `--set train`. When a round is done, run `--set holdout` once and report that
number; a holdout run that drives the next change makes the holdout part of train.

```sh
pnpm crowdcast backtest                                   # train (default)
pnpm crowdcast backtest --set train --sample 20 --seed 3  # cheaper round: a fixed random 20
pnpm crowdcast backtest --set holdout                     # the number to report
pnpm crowdcast backtest --set all --limit 5               # first 5 ids of train followed by holdout
```

`--platform <id>` (default `hn`) backtests another platform: its lists, `segments.yaml`, cache and history live in
`simulations/backtests/<id>/`, the same layout as here; HN keeps this folder.

`--sample N` picks N ids at random from the set, `--limit N` keeps the first N after that. The sample uses `--seed`, which
also seeds the personas and the simulation, so the same seed gives the same subset. Ids given as positionals ignore
`--set` and are recorded as set `ids`.

## Reading the intervals

The scorecard and each history row show recall, objection-mix TV and the comment ratio as a mean with a bootstrap 90%
interval `[lo–hi]` (1000 resamples of the completed threads, seeded by `--seed`). The comment ratio mean is the
geometric mean (mean of the log ratio), with a ratio of 0 counted as 0.01; the median stays alongside it.

A round only improved a metric if its new mean lies outside the previous round's interval on the same set, and better
still if the intervals do not overlap. Small samples give wide intervals: check the width before calling a few points
of recall an improvement. The history row's `Set` and `n` columns say which list and how many threads a row covers; only
compare rows with the same set.
