# crowdcast — rehearse your launch before you launch

**crowdcast simulates a Show HN thread for your product before you post it.** Around a hundred LLM
personas — skeptical seniors, domain experts, licence hawks, drive-by commenters — open your
post, read your landing page, vote, comment and argue with each other while an agent playing
you answers from your prepared notes. You get the thread, the numbers, a cited report of what
to fix, and you can interview any simulated commenter afterwards.

It is a rehearsal, not a forecast. Its job is to surface the objections, confusions and
risky questions you'd otherwise meet live, on the one day you can't afford them.

## Why it's worth it

- **You find the landmines while you can still fix them.** On its first real use (an MCP server
  launch) the simulated crowd found two genuine product problems — a documented opt-out that
  didn't work on release builds, and an agent tool with broader file access than the docs
  implied. Both were then confirmed in the code — weeks before launch instead of in a top
  comment.
- **You test messaging on a crowd, not on yourself.** Run two or three versions of the title
  and post against the same personas and see which framing draws curiosity and which draws
  "why not just use X".
- **You rehearse the founder's side.** The report tells you which of your answers defused a
  thread and which made it worse, and which questions you had no answer for.
- **It's backtested.** Simulated against 15 real Show HN threads from their posts alone, the
  current calibration ranks hits above flops (Spearman ρ 0.77), produces realistic comment
  volume, and recovers about 30% of each real thread's main discussion themes. See
  [Limits](#limits) for what that does and doesn't mean.
- **It's cheap to run and easy to audit.** Everything runs locally through `claude -p`; every
  simulated action is one line in `events.jsonl`, and every claim in the report cites the
  comment it's based on.

## When to use it — and when not

Use it for: a Show HN or similar launch post, a pricing or licence announcement, a positioning
change, a README rewrite — anything where a skeptical technical crowd will react in public.

Don't use it for: predicting points, installs or revenue; replacing real user interviews;
audiences that look nothing like Hacker News (the personas are HN-shaped).

## How it works

```
seed folder (you write)            simulation (12 × 20 min, or 6 for the first 2 h)        outputs
─────────────────────────          ─────────────────────────────────────────────────        ─────────────────
post.md + variants/       ──►      HN-style rank → who visits this step                ──►  thread.md
context.md (landing page)          personas read the thread → vote / comment / reply        metrics.json
founder-answers.md                 silent voters vote in batches                             report.md (cited)
segments.yaml (audience)           founder agent answers ≤ 2 comments per step               compare.md
hypotheses.md                      everything appended to events.jsonl                      interviews.md
```

Personas are generated per audience segment with their own expertise, attitude to AI,
verbosity, contrarianism and a sample of their writing voice; 60 % run on Haiku, 40 % on
Sonnet. Ranking follows the HN formula including a flamewar penalty, and heavily flagged
comments go dead.

## Worked example

`examples/show-hn-tablecraft/` is a complete seed for a fictional product — Tablecraft, a CLI
that turns CSVs into charts — with two versions of the post. Copy it as the starting point
for your own launch.

### 1. Install

Requires Node ≥ 22, pnpm, and the Claude Code CLI (`claude`) on your PATH and logged in.

```bash
git clone https://github.com/DanielHauschildt/crowdcast && cd crowdcast
pnpm install
```

### 2. Write the seed

| File                 | What goes in it                                                                                          | Tip                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `post.md`            | Front matter `title`, `url`; the post body; then `<!-- first-comment -->` and your opening comment       | Write it exactly as you'd post it.                                                                                 |
| `variants/<name>.md` | Alternative versions, same format                                                                        | Change one thing per variant (headline, lead benefit) so the comparison means something.                           |
| `context.md`         | What someone sees after clicking the link: README intro, install, features, pricing — ≤ 8,000 characters | Copy, don't polish. The crowd reacts to what's really there.                                                       |
| `founder-answers.md` | Facts the founder agent may use: licence, pricing, telemetry, "why not X", roadmap                       | Write "not decided yet" rather than leaving gaps — gaps produce evasive replies, and evasive replies sink threads. |
| `segments.yaml`      | Audience mix: `active` personas (use ~100), `voters`, and segments with share + leanings                 | Include the segment you fear most.                                                                                 |
| `hypotheses.md`      | What you want to learn (optional)                                                                        | The report maps the thread to each hypothesis.                                                                     |

### 3. Check the cost, then run

```bash
pnpm crowdcast run examples/show-hn-tablecraft --dry-run      # generates personas once, prints estimated calls
pnpm crowdcast run examples/show-hn-tablecraft --steps 6       # first 2 simulated hours
```

The first command creates and caches the persona set; later runs reuse it so variants face
the same crowd. A run lands in `runs/<timestamp>-<seed>-<variant>-r1/`.

### 4. Read the report

Open `report.md` first. It always starts with the numbers (peak band, points, comments,
objection mix, how founder replies landed), then:

- **Top objections** — each with the comments that raised it and a suggested addition to your
  prepared answers
- **Changes to post / README / demo**
- **Riskiest comments** — the ones that would hurt most as the top comment
- **Founder replies that helped / hurt**
- **Mapping to your hypotheses**

Then skim `thread.md` — reading the thread is where the intuition comes from.

### 5. Ask the crowd follow-up questions

```bash
pnpm crowdcast interview runs/<run> python-loyalists "What would make you switch from matplotlib?"
pnpm crowdcast interview runs/<run> p17 "Why did you flag the post?"
```

A segment gets one answer per persona plus a tally of positive / neutral / negative stances.

### 6. Compare framings

```bash
pnpm crowdcast compare examples/show-hn-tablecraft --variants default,benefit-led --runs 3 --parallel 3 --steps 6
```

`compares/<…>/compare.md` puts the variants side by side and marks a winner only when it wins
in **every** run; anything else is reported as noise.

### 7. Iterate

Fix the answers and the copy the report points at, then rerun the same variant with the same
`--seed`. The before/after difference is the most trustworthy signal crowdcast gives.

### What the example produced

Real output from one run per variant (60 personas, 6 steps, ~125 calls each, about 10 minutes),
saved in [`examples/show-hn-tablecraft/sample-output/`](../examples/show-hn-tablecraft/sample-output/):

|                | default ("turn any CSV into a chart")                      | benefit-led ("reproducible charts in CI")                                               |
| -------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Comments       | 51                                                         | 51                                                                                      |
| Mean sentiment | −0.02                                                      | +0.08                                                                                   |
| Top comment    | likes the static binary; worries downsampling hides spikes | "_the same data always produces the same chart_ is a strong claim — state it precisely" |

What a founder would take away, straight from `report-benefit-led.md`:

1. **The headline claim needs a contract.** "Reproducible" became the top thread: byte-identical
   on one platform, across platforms, or only visually similar? Commenters asked for a
   cross-platform hash test in the repo. Either add it, or soften the title.
2. **Prepared answers were missing for predictable questions:** peak memory on a CI runner,
   what happens to a category that isn't in the pinned palette, what metadata ends up in the
   SVG/PDF (a healthcare user raised patient data), release signing and an SBOM.
3. **"The CLI stays free" needs a written list of what stays free**, and a firm no-CLA decision,
   or "rug pull" comments follow.
4. **Riskiest comments:** the two top-voted questions about determinism had no founder reply —
   left unanswered, the thread's verdict becomes "reproducible is unverified".

The follow-up interview (`interview-python-loyalists.md`) asked the matplotlib loyalists what
it would take to switch: 5 positive, 7 neutral, 0 negative. Nearly every one named the same
three conditions — a written determinism guarantee backed by a test, a hard fail on unpinned
categories, and the metadata audit. That is a to-do list, not a vibe.

Note: the benefit-led variant "won" both points and sentiment here, but with one run per
variant the margins (80 vs 78 points, +0.08 vs −0.02) are noise. Use `--runs 3` before
deciding on a title.

## Reading the numbers

| Number                 | Meaning                                                                                                                          | Use it for                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Mean sentiment (−2…+2) | How the average comment leans toward the product. −0.5 is "mildly critical questions", not hostility; HN is critical by default. | Comparing variants and segments, never in absolute terms. |
| Objection mix          | Share of comments per type: pricing/licensing, trust/telemetry, vs-competitor, integration effort, praise, question…             | Finding what dominates the conversation.                  |
| Points / peak band     | Simulated ranking over the first hours.                                                                                          | Relative comparison only — see Limits.                    |
| Founder effect         | Whether the thread's tone rose or fell after each founder reply.                                                                 | Rewriting prepared answers.                               |

## Limits

- **Points are relative, not a forecast.** Weak posts get inflated: in the backtest a real
  3-point flop simulated at ~48 points. Compare runs with each other, never with real HN numbers.
- **It finds the predictable concerns, not every tangent.** ~30 % theme recall means it reliably
  surfaces cost, trust, licensing and "why not X" — and misses thread-specific digressions.
- **The crowd is HN-shaped.** Other audiences need other segments and a fresh backtest.
- **It costs calls.** A 6-step run with 100 personas is ~300–400 `claude -p` calls (10–40 min
  depending on load); a full backtest round is several thousand and can hit a subscription's
  session limit. Use `--dry-run`, `--steps 6` and `--max-calls`.
- **It's synthetic.** Treat every finding as a hypothesis and check the important ones against
  the code, the docs, or a real person.

## Calibrating against real threads

```bash
pnpm crowdcast backtest --steps 6 --note "what I changed"
```

Simulates every thread in `simulations/backtests/threads.txt` from its post alone and scores it
against the real thread (theme recall, objection-mix distance, rank correlation, comment ratio,
sentiment gap). Each run appends a row to `simulations/backtests/history.md`; keep a model or
prompt change only if that row improves.
