**Synthetic LLM simulation — hypotheses, not a forecast.**

# Show HN rehearsal: Show HN: Tablecraft – turn any CSV into a publication-ready chart from the terminal

Run `20261009-0855-show-hn-tablecraft-default-r1` · seed `show-hn-tablecraft` · variant `default` · rng 1

## Numbers

| Peak band | Front page | Final points | Comments | Founder replies | Max depth | Flag share | Calls (failed) |
| --------- | ---------- | ------------ | -------- | --------------- | --------- | ---------- | -------------- |
| top10     | yes        | 78           | 51       | 6               | 2         | 0%         | 122 (0)        |

| Label              | Share |
| ------------------ | ----- |
| question           | 33%   |
| other              | 18%   |
| integration-effort | 18%   |
| pricing/licensing  | 14%   |
| trust/telemetry    | 12%   |
| praise             | 6%    |

Founder replies: no-response 2, neutral 2, escalated 1

## Top objections

These are hypotheses from a synthetic thread. They are ordered by how much attention and score each one drew.

1. **Downsampling may make big-file line charts misleading.** This is the top thread by score. People worry that per-bucket mean or median hides spikes, that the aggregation and bucket width aren't pinned, and that bucketing could run before timezone conversion [c6][c16][c17][c29][c33]. Follow-ups go deeper. Quantiles don't merge across chunks, and unsorted input keeps every bucket open in memory until EOF [c31][c45]. A min/max envelope depends on how many rows are in each bucket [c41], and readers can mistake it for a confidence interval [c55]. The prepared "2 GB in ~6 s on M2" line answers none of this, and c29 says outright that throughput numbers alone tell them little. _Add to the prepared answers:_ what each bucket keeps, whether bucket width and aggregation can be set in tablecraft.toml, what happens on input that isn't sorted by x (hard error or in-memory fallback), and peak memory (RSS), not just wall time. If any of these aren't decided yet, say "not decided yet" rather than guessing.

2. **Type and date inference guesses when it should refuse.** Several people ask about 01/02/2025-style dates, numeric-looking zip codes and IDs, naive vs UTC timestamps, and whether a column's type can be forced in the TOML. The consistent ask is to fail loudly [c2][c4][c24][c32][c15][c39][c46]. On the CSV side, people ask about mixed encodings, a BOM, UTF-16, semicolon delimiters, and what happens on a bad byte: error, replace or skip [c13][c28][c29]. _Add:_ the actual behaviour on ambiguous columns and bad bytes, and how to override a column's type in the TOML.

3. **"Reproducible" is claimed but not defined.** c30 separates byte-identical output from visually identical output, and names the things that usually break it: PDF CreationDate and /ID, font subset tags, float formatting. It asks for SOURCE_DATE_EPOCH support and a sha256 check in CI. c34 asks whether the TOML schema is versioned, so a default change can't quietly alter last quarter's report. c27 and c38 add hash-pinning and font discovery that depends on the build machine. _Add:_ whether output is byte-identical today, which fields vary, and whether the schema or tool version is recorded in the output.

4. **The static binary and supply-chain claims can't be checked yet.** People ask about musl vs glibc, the target triple, full arrow vs the parquet crate alone, dependency-tree size, an SBOM, signed checksums, a committed Cargo.lock and cargo-deny or cargo-audit [c20][c21][c23][c37][c48][c49][c51]. c51 says the build target and allocator also bear on the multi-GB memory claim. _Add:_ the `ldd`/`file` output, the release target triple, the Parquet dependency choice, and whether checksums and an SBOM ship with releases. These are one-minute checks, so answer them with facts, not "see the repo".

5. **Licence and contribution terms aren't settled before the hosted tier.** People want DCO vs CLA decided before the first outside PR, the hosted code kept in a separate repo, and no source-available carve-out inside this repo [c8][c23][c39][c40][c42]. Others argue AGPL [c7], against AGPL [c52], or that stated intent doesn't bind future owners [c56]. One asks about bus factor [c9], and one asks that the CLI never "grow a nag" [c4]. c39 also warns that charging for "shared themes" looks like charging for something a TOML file in git already does. _Add:_ a committed decision, or a date by which it will be decided, plus a no-nag pledge. Consider dropping "shared themes" from the paid list.

6. **"Publication-ready" doesn't cover what publishers need yet.** Requests include annotations and direct labels [c47], figure size in mm and font size in pt [c53], whether text stays as text or is outlined [c10][c53], error bars or CIs [c18], tabular figures [c5], colour-blind safety at 40 series [c54], low-resolution or high-contrast themes [c36], and a gallery of ugly cases [c4][c19]. _Add:_ the tabular-figures answer from checking the default theme (c57 dodged it), a short "not supported yet" list, and the existing fact that palettes are colour-blind safe by default, with the honest limit on how many series that holds for.

## Changes to post / README / demo

**Title.** Lead with the angle that actually landed, and avoid a claim you can't fully back yet. For example: "Show HN: Tablecraft – pinned, reproducible charts from CSV/Parquet in CI (single Rust binary)". Consider softening "publication-ready" until annotations and mm sizing exist, since that phrase invited [c47][c53].

**Post body**

- One sentence on how big inputs work: "Line charts over large files are bucketed. Bucket width and aggregation are set in tablecraft.toml." This heads off [c6][c16].
- One sentence on inference: "Ambiguous dates and ID-like columns ___ (error / require TOML type)." This answers [c2][c4][c32].
- State the licence plan concretely: "CLI MIT forever. Hosted features in a separate repo. Contributions under DCO/CLA (decided)." This answers [c8][c42][c56].

**README sections to add**

- _Aggregation and large files._ Say what each bucket keeps (ideally min/max/mean/count), how bucket boundaries relate to timezone conversion, and what happens on unsorted input (a hard error with a `--sort` hint, per [c45]). Include a worked spike example where mean and max disagree [c16]. Label the envelope in words, e.g. "min to max per 1h bucket" [c55], and record per-bucket n [c41].
- _Determinism._ Say whether output is byte-identical, support SOURCE_DATE_EPOCH, version the schema, and stamp the tool version in output metadata. Add a CI job that renders twice on Linux and macOS and compares sha256 [c30][c34].
- _Verify no network._ Include the strace/pf/lsof recipe from [c27], answering [c14].
- _Build and supply chain._ Give the target triple, `ldd` output, Parquet crate choice, `cargo tree | wc -l`, signed checksums, an SBOM, and cargo-deny in CI [c23][c37][c49][c51].
- _Input handling._ Cover encodings, BOM, delimiter sniffing, bad-byte policy with a row number on error, and the type override syntax [c13][c28][c29].
- _Benchmarks._ Give hardware, file shape, wall time and peak RSS, cold and warm cache, a DuckDB baseline [c29][c51], and a hyperfine number for a 100-row CSV [c38].
- _LLM-assisted code._ One line, as [c23] asks.

**Features and demo**

- Ship `--emit-config`, which writes the inferred choices to TOML [c19][c32][c35][c46], and `--explain --json` [c22][c44]. Make "emit, commit, edit" the documented way to start.
- Build a gallery of ugly cases: 40 series, long labels, negatives, dense date and log axes. Put matplotlib or seaborn equivalents next to each, and show a CVD simulation of the default palette [c4][c19][c46][c54].
- In the demo GIF, use a messy file that fails loudly on an ambiguous date, then fix it in TOML and render. This shows the "refuses to guess" stance commenters asked for [c4][c24][c39].

## Riskiest comments

- **[c16] (34 pts, top in the highest-scoring subthread).** "Internally consistent and wrong for the question being asked" is a quotable takedown of the core large-file promise. Together with [c17] (18 pts) and [c33], it frames the line chart as something that "lies on big inputs". No founder reply exists under [c6], so it currently stands unanswered.
- **[c30] (17 pts).** This is a detailed argument that "reproducible" isn't true in the strict, byte-identical sense. It attacks the headline hook directly, and an expert reader at the top would make the README look overclaimed.
- **[c45] and [c31].** Unsorted input means everything sits in memory until the end, which risks a silent OOM. That is "the few GB claim falls over on exactly the files I'd feed it". If this becomes top comment, the performance claim reads as false.
- **[c37], [c48] and [c49] (the cluster under [c26]).** "I want to see ldd … not take it on trust" turns a dodged one-minute question into a credibility problem. A pile of near-duplicate replies looks like a pile-on.
- **[c56].** "I've watched three projects go BSL" is the rug-pull story. It is low-scored now, but this kind of comment can climb fast, and the founder's non-committal [c11] gives it room.
- **[c24] (19 pts) and [c13] (13 pts).** "Every CSV tool looks great on the demo dataset" plus the mainframe-era point that the date format is a fact about whoever produced the file. Both are dismissive framings that would land badly if no answer appears.

## Founder replies that helped / hurt

These are hypotheses based on the sim's founder-effect metrics.

**Helped or held steady**

- **[c25]** (on [c14], neutral). It is concrete, uses only prepared facts (no network calls, fonts bundled), and invites a check with egress blocked. [c27] then supplied a ready-made verification recipe that the founder should acknowledge and adopt. This is the strongest reply.
- **[c12]** (on [c8], neutral). It is honest about what isn't decided and commits to settling it before merging outside PRs, which [c42] explicitly welcomed. The weakness is that "I'll settle it" has no date, so the [c40]/[c52]/[c56] debate kept running unanswered.

**Hurt or missed**

- **[c26]** (on [c20], escalated, delta −0.67). "The Cargo.toml and release workflow are the authoritative answer" reads as homework for the asker on facts the author can check in a minute. It directly spawned [c37], [c48], [c49] and [c51]. [c51] defends not guessing, but still wants the answer in the README. Fix: run `file`/`ldd` and `cargo tree`, then reply with the facts.
- **[c11]** (on [c7], no response). It is honest but non-committal three times over ("haven't decided", "can't say", "can't tell you"). It doesn't hurt directly, but it leaves the vacuum that [c52] and [c56] filled.
- **[c57]** (on [c5], no response). "I'm not going to claim anything about tabular figures from memory" about the author's own default theme suggests they don't know their own product. Check it and edit the reply.

**Gaps.** No reply under the highest-signal threads: [c6]/[c16] on aggregation, [c4] (40 pts), [c30] on determinism, [c13]/[c28] on CSV robustness, [c47]/[c53] on publication specs, and [c9] on bus factor. The opening post [c1] mentions the timezone and text-metrics difficulties, but no follow-up addressed them.

## Mapping to experiments.md hypotheses

**H1 – "Reproducible charts in CI" is the hook. Supported, with a caveat.** Commenters raise the pinned TOML and CI use without prompting, and praise it: [c2][c3][c4][c19][c22][c33][c38], and [c35] with "run once, edit, commit". However, the hook also attracts the hardest scrutiny. People test whether reproducibility survives downsampling [c6][c17][c29], byte-level determinism [c30], and schema drift [c34]. So the hook gets attention, but it must be backed in the README or it becomes the main line of attack.

**H2 – "No Python" is a selling point. Mostly supported.** Several commenters frame the tool as replacing their matplotlib boilerplate [c3][c4][c32][c35], and [c33] calls Dash/plotly heavy for a nightly PDF. Direct "just use matplotlib" pushback is rare. [c44] says they just ask an LLM for seaborn code, but asks how to make the TOML LLM-friendly rather than dismissing the tool. Softer signals of Python pull remain: [c50] wants a Python binding or in-memory bytes, and [c46] wants seaborn comparisons in the gallery. The sim's python-loyalists segment is the most positive one (mean +0.36), consistent with this.

**H3 – A paid hosted tier doesn't hurt trust in the MIT CLI. Partly contradicted, still open.** Nobody accuses the project of a rug pull. [c4] and [c42] accept the hosted tier on conditions (no nag, separate terms). But licensing became a major sub-debate: pricing/licensing is about 14% of the objection mix. People raise pre-emptive concerns about contribution terms and relicensing [c7][c8][c23][c39][c40][c42], with explicit BSL history in [c56] and a bus-factor worry in [c9]. Trust appears to depend on a concrete DCO/CLA and separate-repo decision, which the founder replies [c11][c12] have not yet made.
