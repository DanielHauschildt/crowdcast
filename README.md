# crowdcast

Rehearses a Show HN thread (or a Reddit, Bluesky, X or LinkedIn post) with LLM personas before
the real launch: what people will object to, which framing lands, which of your answers help.
Output is synthetic — hypotheses to test, not a forecast.

**Start here: [docs/guide.md](docs/guide.md)** — purpose, value, and a worked example
(`examples/show-hn-tablecraft`). Design: `docs/design.md`.

Requires `claude` (Claude Code CLI) on PATH and logged in. Everything else runs locally.

```bash
pnpm install
pnpm crowdcast run simulations/seeds/codesign-show-hn --dry-run
pnpm crowdcast run simulations/seeds/codesign-show-hn
pnpm crowdcast compare simulations/seeds/codesign-show-hn --variants default,editable-files,local-first --runs 3 --parallel 3
pnpm crowdcast interview simulations/runs/<run> skeptical-seniors "What would make you try it?"
pnpm crowdcast report simulations/runs/<run>
pnpm crowdcast personas-from-hn simulations/seeds/codesign-show-hn --threads 30529262,21887848 --max 80
pnpm crowdcast run simulations/seeds/codesign-show-hn --persona-file simulations/seeds/codesign-show-hn/personas/hn.json
```

`personas-from-hn` builds anonymous personas from the commenters of real HN threads (their recent
public comments, summarised by Opus; generated handles, no usernames, quotes or links) and writes
`personas/hn.json`. Each persona records its `sourceThreads`; `excludeThread` drops them when
simulating one of those threads. Personas run on haiku or sonnet (60/40, fixed per persona id).

A run dir holds `events.jsonl` (source of truth), `thread.md`, `metrics.json`, `report.md`,
`labels.json`, `calls.jsonl`, `interviews.md`. Everything except `events.jsonl` can be
regenerated with `report`. Interrupted runs continue with `run <seed> --resume <runDir>`.

## Platforms

A seed picks its platform with an optional `platform.yaml` (`platform`, `author: {followers, audience,
connections}`, other keys are the platform's options); `--platform <id>` on `run`/`compare` overrides it. `run.json`
keeps all of it, so `report`, `interview` and `compare` reload the same options.

| Platform   | Example seed                   | Reach model                                                        | Status                                  |
| ---------- | ------------------------------ | ------------------------------------------------------------------ | --------------------------------------- |
| `hn`       | `examples/show-hn-tablecraft`  | HN rank formula, front-page bands (default)                        | backtested (108 threads)                |
| `reddit`   | `examples/reddit-tablecraft`   | Reddit hot in one subreddit (`subreddit`, `flair`), downvotes      | backtested (35 threads, Arctic Shift)   |
| `bluesky`  | `examples/bluesky-tablecraft`  | follower reach plus reposts and quotes, fitted on real likes       | backtested (44 posts, public AppView)   |
| `x`        | `examples/x-tablecraft`        | Bluesky follower reach plus a For You ranker from X's open weights | unvalidated: disclaimer on every report |
| `linkedin` | `examples/linkedin-tablecraft` | test slice of the network, expansion on early engagement           | unvalidated: disclaimer on every report |

```bash
pnpm crowdcast run examples/reddit-tablecraft --steps 2
pnpm crowdcast fit bluesky simulations/backtests/bluesky/threads.txt   # refit fit.json from real posts
pnpm crowdcast fit linkedin my-post-analytics.csv --followers 1800      # constants for your own platform.yaml
```

Persona caches are per platform (`personas/<platform>-seed-N.json`; HN keeps `personas/seed-N.json`). To add a
platform, see "Platforms" in `docs/design.md`.

## Backtest

`backtest` checks the simulator against real Show HN threads. Each thread in
`simulations/backtests/threads.txt` is fetched once from the HN Algolia API (cached in
`simulations/backtests/threads/<id>/`), simulated from its post alone with the general audience in
`simulations/backtests/segments.yaml`, and the real OP's own comments as the founder's answers.

```bash
pnpm crowdcast backtest                       # the train set (threads.txt)
pnpm crowdcast backtest 44638842 --steps 2    # one thread
pnpm crowdcast backtest --set holdout         # train, holdout or all; tune on train, report holdout
pnpm crowdcast backtest --set all --sample 10 --limit 5   # a seeded sample (--seed), then the first 5
pnpm crowdcast backtest --platform reddit     # lists under simulations/backtests/<platform>/
```

A list line is an id, optionally followed by platform options (`2611669540 subreddit=selfhosted  # comment`).
Platforms that know the poster (Bluesky) pass their follower count into the simulation.

The scorecard (`simulations/backtests/<stamp>/scorecard.md`) reports theme recall, objection-mix
total-variation distance, Spearman correlation of simulated vs real points, comment-count ratio and
sentiment gap, with bootstrap 90% intervals; each run appends one row to
`simulations/backtests[/<platform>]/history.md`, so a calibration change is kept only if the aggregate improves
(`--note` labels the row).

Each thread gets `--max-calls` calls (default 400), of which `--score-reserve` (default 30) are kept for scoring. When the
simulation would overrun its share it stops before the next step, and the thread is still scored on what it produced.
The scorecard marks it `†` (status: truncated at step N), and the Completed count shows `(k†)`. Threads with fewer than
`--min-real-comments` (default 3) real replies are skipped without a call (`skipped: 0 real replies`). If theme extraction
fails on a thread, its recall is n/a and the thread is still scored.

## Track

`track` polls the HN Firebase API for live Show HN stories (ids, points, comments, rank; no text) into
`simulations/timelines/data/`, and `track fit` fits the step schedule's band thresholds from them:

```bash
pnpm crowdcast track --hours 48
pnpm crowdcast track fit      # writes simulations/timelines/fit.md and fit.json (gitignored)
```
