# crowdcast

Rehearses a Show HN thread with LLM personas before the real launch. Output is synthetic —
hypotheses to test, not a forecast. Design: `specs/2026-10-03-crowdcast-design.md`.

Requires `claude` (Claude Code CLI) on PATH and logged in. Everything else runs locally.

```bash
pnpm --filter @imgly/crowdcast build
pnpm crowdcast run simulations/seeds/codesign-show-hn --dry-run
pnpm crowdcast run simulations/seeds/codesign-show-hn
pnpm crowdcast compare simulations/seeds/codesign-show-hn --variants default,editable-files,local-first --runs 2
pnpm crowdcast interview simulations/runs/<run> skeptical-seniors "What would make you try it?"
pnpm crowdcast report simulations/runs/<run>
```

A run dir holds `events.jsonl` (source of truth), `thread.md`, `metrics.json`, `report.md`,
`labels.json`, `calls.jsonl`, `interviews.md`. Everything except `events.jsonl` can be
regenerated with `report`. Interrupted runs continue with `run <seed> --resume <runDir>`.

## Backtest

`backtest` checks the simulator against real Show HN threads. Each thread in
`simulations/backtests/threads.txt` is fetched once from the HN Algolia API (cached in
`simulations/backtests/threads/<id>/`), simulated from its post alone with the general audience in
`simulations/backtests/segments.yaml`, and the real OP's own comments as the founder's answers.

```bash
pnpm crowdcast backtest                       # every thread in threads.txt
pnpm crowdcast backtest 44638842 --steps 2    # one thread
```

The scorecard (`simulations/backtests/<stamp>/scorecard.md`) reports theme recall, objection-mix
total-variation distance, Spearman correlation of simulated vs real points, comment-count ratio and
sentiment gap; each run appends one row to `simulations/backtests/history.md`, so a calibration
change is kept only if the aggregate improves (`--note` labels the row).
