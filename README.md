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
```

A run dir holds `events.jsonl` (source of truth), `thread.md`, `metrics.json`, `report.md`,
`labels.json`, `calls.jsonl`, `interviews.md`. Everything except `events.jsonl` can be
regenerated with `report`. Interrupted runs continue with `run <seed> --resume <runDir>`.
