# crowdcast — synthetic Show HN rehearsal

Date: 2026-10-03 · Status: approved design, pending spec review

## Intent

**Outcome.** Before the one-shot Show HN launch of CoDesign MCP
(`gtm/Marketing/hackernews-launch/overview.md`), rehearse the thread with LLM agents: which
objections come up, how the post/README/demo should change, which prepared founder answers defuse
or escalate, and which post variant does best.

**Who.** The CoDesign team (founders on comment duty, marketing owners of `gtm/`).

**Success.** A run produces a readable HN-style thread plus a report whose findings feed straight
into `gtm/Marketing/experiments.md` (objection types, hypotheses H1/H9/H10) and
`founder-answers.md`. Quality is judged by reading the output ("eyeball"); no backtest in v1.

**Non-goals (v1).** Forecasting real installs/rank; other platforms (X, Reddit, PH); backtesting
against real threads; dashboard UI; mid-run event injection. Output is synthetic hypothesis
generation, never a forecast — every report states this on line one.

**Origin.** A rebuild of the MiroFish idea (analysis: `simulations/mirofish-analysis.md`), dropping
Zep and OASIS: personas come from audience segments rather than extracted document entities, and
the world is one purpose-built HN thread.

## Constraints

- LLM backend: `claude -p` only (user's choice). Calls use `--model`, `--system-prompt`,
  `--json-schema`, `--output-format json`, `--tools ""`, `--no-session-persistence`,
  `--strict-mcp-config`, `--setting-sources ""` so each call is a bare model call with validated
  JSON. Concurrency default 8.
- Models: Haiku for agent turns, voter batches and comment labelling; Sonnet for founder turns;
  Opus for persona generation, report and interviews.
- TypeScript, Node 22, pnpm workspace package; vitest + fast-check.
- All inputs and results under `simulations/`.

## Layout

```
packages/crowdcast/
  src/
    llm.ts        LLM interface + ClaudeCli impl: spawn `claude -p`, semaphore, retry ×2,
                  schema-validate, backoff on rate limit, log every call to calls.jsonl
    personas.ts   segments.yaml → Opus generates active personas + silent-voter pool (cached)
    thread.ts     pure state: post, comment tree, votes, flags; HN rank score
    agents.ts     agent turn: persona + rendered thread → action JSON
    founder.ts    founder turn: founder-answers.md + thread → ≤3 replies
    voters.ts     silent-voter batches (20 personas/call) → votes on post + comments
    engine.ts     step loop: visibility, activation, turns, scoring, event log, resume
    label.ts      objection-type label per comment
    metrics.ts    pure: events → metrics.json
    report.ts     Opus narrative over metrics + thread, citations to comment IDs
    compare.ts    variants × runs → compare.md
    interview.ts  rehydrate agent(s) from events → answers
    cli.ts        crowdcast run | compare | interview | report
simulations/
  seeds/codesign-show-hn/
    post.md              default title + body + first comment
    variants/<name>.md   alternative post files (same format)
    context.md           what a visitor sees when clicking through: README + landing excerpts
    founder-answers.md   prepared answers (pricing, telemetry, vs image-gen, vs Canva/Figma …)
    hypotheses.md        hypothesis rows from gtm/Marketing/experiments.md, for the report mapping
    segments.yaml        segment mix and counts
  runs/<YYYYMMDD-HHMM>-<seed>-<variant>-r<n>/
    run.json (seed name, variant, rng seed, founder answers, hypotheses snapshot)
    personas.json  labels.json  events.jsonl  thread.md  metrics.json  report.md  calls.jsonl
  compares/<YYYYMMDD-HHMM>-<seed>/compare.md
```

`events.jsonl` is the single source of truth; thread.md, metrics, report and interviews are
derived from it and can be regenerated without re-simulating.

## Personas

`segments.yaml` (defaults, editable):

| Segment             | Share | Leanings                                             |
| ------------------- | ----- | ---------------------------------------------------- |
| agent-builders      | 20%   | curious, technical, "how does it work"               |
| skeptical-seniors   | 20%   | "why not an image generator / just HTML", AI fatigue |
| design-engineers    | 15%   | Figma/Canva comparisons, output quality              |
| oss-licensing-hawks | 10%   | open source?, telemetry, pricing traps               |
| indie-marketers     | 15%   | ads use, cost                                        |
| designers           | 10%   | "AI replaces us", craft                              |
| drive-by            | 10%   | one-liners, jokes, tangents                          |

Defaults: 60 active personas, 200 silent voters.

Active persona (Opus, generated in batches of 10 per segment call):
`{id, segment, handle, bio, expertise[], aiAttitude: -2..2, verbosity: 1..3, contrarian: 0..1,
activity: 0..1, voiceSample}`. The voice sample is one short example comment in that person's
style, to counter uniform "Claude voice".

Silent voter: `{id, segment, oneLiner}`; votes only.

Personas are generated once per (seed folder, persona-seed) and cached in `personas.json`;
variants of one compare share the same personas.

## Platforms

The engine is platform-neutral; everything a platform changes lives behind `Platform`
(`src/platform.ts`): step length and default steps, `visibility(state, step, author?)` → band and
visitor fraction, `rankScore` for step ends, the bands best first (for peak band / front page), the
reaction vocabulary (`votes`, `commentVote`) and every prompt piece (agent, voter, founder,
persona, label, report, backtest themes/recall). Votes keep their event shape; `value` is the
platform's reaction (HN: `up`/`flag`; `flag` counts against a target, any other reaction for it).
Optional: `fetchReference(id)` for backtests, `withOptions` for extra platform.yaml keys.

HN (`src/platforms/hn/`) is the default and the reference implementation; its golden test pins
events and prompt hashes. A seed picks a platform with an optional `platform.yaml`
(`platform: hn`, `author: {followers, audience}`, other keys → options); `--platform` on
`run`/`compare` overrides it, and `run.json` records it (older runs without it are HN).

To add one: create `src/platforms/<id>/index.ts` with a default-exported `Platform`. No shared file
changes — `loadPlatform(id)` (`src/platforms/index.ts`) imports the folder dynamically and lists the
known folders when an id is missing.

## Simulation loop

12 steps × 20 simulated minutes (first 4 hours). Deterministic scheduling from `--seed`; LLM text
still varies.

Per step `s` (post age `t` hours):

1. **Rank.** `score = (votes − 1) / (t + 2)^1.8 × 0.8^flags`. Rank band = position of `score`
   against a fixed reference table of front-page scores (constant in code, documented). Band →
   visitor fraction (front page top-10: 100%, 11–30: 60%, page 2: 25%, new only: 10% at s<3 else
   5%).
2. **Visitors.** Sample that fraction of not-yet-departed active personas and silent voters.
   Additionally every persona with an unseen reply to its comment returns.
3. **Agent turns** (Haiku), visiting personas with probability `activity` (returners always).
   Input: persona, post, `context.md`, thread rendered HN-style (comments sorted by score, depth >4
   collapsed, at most ~6k tokens, oldest low-score leaves truncated first). Output schema:
   `{vote: "up"|"none"|"flag", comment: null | {parent: "post"|commentId, text}, leave: bool}`.
   At most one comment per turn.
4. **Voter batches** (Haiku), visiting silent voters in groups of 20: each returns
   `{postVote, commentVotes: {commentId: "up"|"none"|"flag"}}` over the top 15 visible comments.
5. **Founder turn** (Sonnet), once after each step: input founder-answers.md, post, thread, its own
   prior replies; output ≤3 replies `{parent, text}` or none. System prompt enforces HN norms:
   technical, modest, no marketing language, disclose plainly.
6. **Comment scores** = upvotes − flags×2; used for next step's sort.

Every turn appends one event: `{step, actor, kind, input digest, output, ts}`; errors are events
too.

Expected volume per variant-run: ~60–90 agent turns, ~30 voter batches, 12 founder turns, plus
labelling and report ≈ 150–200 calls; ~10–15 min at concurrency 8.

## Outputs

- **thread.md** — HN-style rendering with points and nesting, comment IDs `[c17]`, founder marked.
- **metrics.json** (pure code over events + labels):
  - post score per step, peak rank band, front-page yes/no
  - comment count, max depth, flag share
  - objection mix: label per comment ∈ {`vs-image-gen`, `vs-design-tools`, `pricing/licensing`,
    `trust/telemetry`, `ai-replaces-designers`, `integration-effort`, `other`, `praise`,
    `question`, `off-topic`} (types mirror `experiments.md`); shares sum to 1
  - sentiment (−2..2, from the same label call) per segment
  - founder effect per founder reply: mean sentiment of the 3 subsequent comments in that subtree
    minus the parent comment's sentiment → defused (>0.5), neutral, escalated (<−0.5)
- **report.md** (Opus): line 1 disclaimer ("Synthetic LLM simulation — hypotheses, not a
  forecast."). Fixed sections: Top objections (with suggested additions to founder-answers.md) ·
  Changes to post / README / demo · Riskiest comments · Founder replies that helped / hurt ·
  Mapping to experiments.md hypotheses. Every claim cites comment IDs; report generation fails
  validation if a cited ID doesn't exist in the run.

## Variants

`crowdcast compare <seed> --variants default,a,b --runs 2`: same personas and seed for every
variant; each variant run `--runs` times. `compare.md`: per-variant score curves, peak band,
objection mix, top 3 comments, and a "consistent across runs?" flag — a difference counts only if
it holds in every run.

## Interviews

`crowdcast interview <run> <personaId|segment> "<question>"`: rebuild each persona from
`personas.json` + every event it saw and produced; Opus answers in character. For a segment, ask
all its personas and append a short tally. Output printed and appended to `<run>/interviews.md`.
No live process needed.

## Errors and cost guards

- Invalid JSON despite schema → retry ×2 → `error` event, actor skips the step.
- > 10% failed calls in one step → abort, keep the log; `report` works on partial runs.
- Rate-limit output from `claude -p` → exponential backoff, halve concurrency.
- Resume: steps are flushed on completion; `run --resume <runDir>` continues from the last full
  step with cached personas.
- `--max-calls` (default 400 per run) hard cap; `--dry-run` prints planned call counts.
- `calls.jsonl`: model, latency, token usage as reported by `claude -p`.

## Testing

- Pure core with unit + fast-check property tests: rank score monotonic in votes and decaying in
  time; comment tree replies always attach to existing parents and depth is consistent; scheduler
  deterministic per seed; objection shares sum to 1; thread rendering never exceeds the token
  budget.
- `LLM` interface with a scripted fake: full 12-step run, compare and interview end-to-end in
  <1 s.
- Live smoke test as a separate script (`pnpm test:live`, own vitest config; `pnpm test` never
  collects it): 5 personas, 2 steps through real `claude -p`.

## Seed content (first run)

Drafted from `gtm/` (strategy, Marketing/overview, hackernews-launch, experiments objection log,
soft-launch messaging matrix), the `codesign-mcp` README, and the website copy. The team reviews
`post.md`, `founder-answers.md` and `segments.yaml` before the first real run.

## Addendum 2026-10-04 — realism round

Motivation: v1 runs could not be judged for realism; LLM voters saturated (~90% upvotes) until
base rates were added; the founder agent over-replied (22 replies, duplicates, "can't confirm"
chains); one run per variant can't separate signal from noise.

### A. Backtest (`crowdcast backtest <hn-id…>`)

- `hn.ts` fetches a real thread from the HN Algolia items API (`/api/v1/items/<id>`): post
  (title, url, text), comment tree (author, created_at, parent, text with HTML stripped), final
  points. The linked page's text (HTML stripped, ≤ 8,000 chars; GitHub repos via the README) is
  the thread's `context.md`. Cached in `simulations/backtests/threads/<id>/real.json`.
- Each thread is simulated from its post alone with a general HN audience
  (`simulations/backtests/segments.yaml`), founder answers = the real OP's own comments in that
  thread (what the real founder actually said), same steps and calibration as product runs.
- Scorecard per thread and aggregated (`simulations/backtests/<date>/scorecard.md`):
  - theme recall — Opus extracts the real thread's top 5 themes, then judges for each whether the
    simulated thread raises it (share recalled);
  - objection-mix distance — same labeller on both threads; total-variation distance of the label
    distributions;
  - points rank correlation — Spearman between simulated 4 h points and real final points across
    the set (order, not absolute);
  - comment-count ratio and mean-sentiment gap.
- Thread set: comparable creative/design and MCP/agent tools with mixed outcomes, including low
  performers (< 20 points) and proprietary launches, listed in
  `simulations/backtests/threads.txt`.
- Calibration loop: tune vote base rates, visitor fractions and persona mix; keep a change only
  if the aggregate scorecard improves; record each tuning run in the scorecard history.

### B. Founder agent

- One founder reply per parent comment, enforced in the engine.
- Priority: unanswered top-level comments by score; at most 2 replies per step.
- The rendered thread marks comments the OP already answered (`↳ answered by OP`).
- A prepared answer marked `TODO(team)` is stated as "not decided yet" plus what is known; no
  chains of "I can't confirm".

### C. Personas from real HN commenters + model mix

- `crowdcast personas-from-hn <hn-id…>` collects commenters of the given threads, fetches each
  one's recent public comments (Algolia `search_by_date`, tags `comment,author_<name>`, ≤ 40),
  and Opus summarises them into a persona (segment assigned by classification against the seed's
  segments). Handles are replaced by generated ones; no real username, quote or link is stored.
  A persona derived from thread X is never used to simulate thread X (backtest leakage guard).
- Personas carry a `tier`: 60% haiku, 40% sonnet, assigned deterministically by persona id.

### D. Runs and HN mechanics

- `compare` runs variant×run combinations in parallel processes (`--parallel N`, default 3),
  `--runs` default 3.
- Flamewar penalty: when a post has > 40 comments and more comments than points, its rank score
  is multiplied by 0.6.
- Dead comments: a comment with ≥ 3 flags is hidden from every rendered view (`[dead]`) and from
  voters.
