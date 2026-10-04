# crowdcast

Rehearses a Show HN thread with LLM personas before the real launch. Output is synthetic —
hypotheses to test, not a forecast. Design: `specs/2026-10-03-crowdcast-design.md`.

Requires `claude` (Claude Code CLI) on PATH and logged in. Everything else runs locally.

```bash
pnpm --filter @imgly/crowdcast build
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
