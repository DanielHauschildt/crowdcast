**Synthetic LLM simulation — hypotheses, not a forecast.**

# Show HN rehearsal: Show HN: Tablecraft – reproducible charts in CI, no Python or browser needed

Run `20261009-0855-show-hn-tablecraft-benefit-led-r1` · seed `show-hn-tablecraft` · variant `benefit-led` · rng 1

## Numbers

| Peak band | Front page | Final points | Comments | Founder replies | Max depth | Flag share | Calls (failed) |
| --------- | ---------- | ------------ | -------- | --------------- | --------- | ---------- | -------------- |
| top10     | yes        | 80           | 51       | 9               | 3         | 0%         | 123 (0)        |

| Label              | Share |
| ------------------ | ----- |
| question           | 35%   |
| other              | 18%   |
| integration-effort | 16%   |
| pricing/licensing  | 12%   |
| trust/telemetry    | 12%   |
| praise             | 6%    |
| vs-design-tools    | 2%    |

Founder replies: no-response 6, defused 1, neutral 1

## Top objections

1. **"Reproducible" isn't defined or tested.** This was the dominant thread and the highest-voted one. [c18] (44 pts) asks which of four guarantees holds: bytes on the same platform, bytes across platforms, identical pixels across versions, or only visually similar. [c14] (36 pts) asks for a cross-platform `cmp` test. [c44] adds that the binary itself should build reproducibly, and points to PDF /ID and CreationDate and to HashMap ordering. [c6], [c27] and [c25] ask how this interacts with pinning the binary version. [c4], [c3], [c34] and [c40] ask for a written statement, and [c34] calls the claim "just marketing" until one exists. [c5] and [c10] add font metrics and tabular figures as further inputs to the guarantee. The founder never stated a guarantee ([c43], [c60]). Hypothesis: this is the main credibility gap.
   _Add to prepared answers:_ the exact guarantee level, whether PDF timestamps and IDs are stripped, whether output order is deterministic, how the default fonts handle tabular figures and shaping, and a link to the fixture test. If you can't verify these yet, say "visually stable, byte-identity untested" and give a date for the test.

2. **Memory ceiling and streaming semantics are unknown.** [c13] and [c31] (17 pts) ask what happens with a high-cardinality group-by on a 4–8 GB CI runner, and whether it gets OOM-killed without a useful error. [c17] asks how bounds get chosen in one pass. [c41] and [c54] argue that binning can break the time-zone-correct claim on the streaming path. [c47] and [c4] ask about DST and gaps in the data. [c3] asks whether users need to pre-aggregate. [c56] admitted there is no data beyond the 2 GB/6 s line chart.
   _Add:_ peak RSS at 1M/10M/100M keys, what happens at the cap (a clear error, or top-N with an "other" bucket), whether there is a pre-scan or a single pass, whether binning uses UTC or wall-clock time, and how DST and gaps are drawn.

3. **Silent defaults and config drift.** [c2] and [c23] (28 pts) ask what happens when a new category isn't in the pinned palette. [c20] and [c35] want the render to fail by default. [c58] wants fallback colours checked for colour-vision deficiency. [c16], [c46] and [c25] want a schema version in the TOML and a validate mode. [c40] asks for `--strict`. [c23] and [c32] ask for a `--json` manifest with hashes. [c59] and [c19] ask about inference defaults: zero baseline, sort order, error bars. No founder answer here.
   _Add:_ the unknown-category behaviour, the schema version field, whether `--strict`, `--json` and validate exist or are planned, and the bar baseline and sort defaults.

4. **Data leakage and supply-chain trust.** [c15] raised patient-level identifiers ending up in SVG/PDF metadata. [c28] admitted this hasn't been audited. [c26] asks for an SBOM, provenance, cargo-deny or cargo-vet, and how much code was LLM-generated. [c44], [c50], [c51] and [c37] ask for a committed Cargo.lock, sha256 sums, signing, vendored builds and musl targets. [c21], [c37] and [c45] ask how big the Parquet/arrow dependency tree is.
   _Add:_ the audit result listing exactly what metadata gets embedded, release signing and checksums, the SBOM plan, the cargo tree summary, and whether Parquet is behind a cargo feature.

5. **Whether "CLI stays free" can be trusted.** [c7] says MIT can't enforce the promise. [c9] raises the solo-maintainer risk. [c42] and [c55] say to write down now which features stay in the CLI. [c8] suggests a CLA, and [c55] warns that a CLA would undo the no-relicensing guarantee. [c24] says the OFL texts have to ship inside the release archives. [c39] argues that scheduled renders are a weak thing to charge for, since free users already have CI.
   _Add:_ a public list of what stays in the CLI, a firm "no CLA" (or a DCO) decision, and that the OFL texts ship in the archives.

6. **Scope compared with matplotlib.** [c33] asks whether twin axes and annotations are covered or only the common 80% of charts. [c57] asks for physical units and editable PDF text. [c36] and [c49] ask for minimum stroke and font sizes and for direct labels. [c53] asks about stdin input. [c48] asks for a side-by-side with matplotlib code.
   _Add:_ an explicit scope statement, plus whether stdin, physical units and text annotations are supported.

## Changes to post / README / demo

- **Title.** Keep "reproducible" only if you can back it with a stated, tested level. Otherwise use something like "Show HN: Tablecraft – pinned, config-as-file charts from CSV/Parquet in CI (one static binary)". [c34] and [c44] are both reacting to the claim as it stands.
- **Body.** Add one sentence on the determinism level and how it is tested ([c18], [c14]). Add one sentence on scope: line, bar and scatter, with no twin axes yet ([c33]). Add the measured numbers: 8 MB, 2 GB CSV in 6 s, and an RSS figure ([c21], [c31], [c38]).
- **README "Determinism" section.** Cover the guarantee level, PDF /ID and CreationDate handling, ordering, font handling (bundled fonts, tabular figures, shaping), and whether to pin the binary by tag or by hash ([c18], [c44], [c5], [c10], [c27]).
- **README "Data handling" section.** List exactly what is embedded in SVG and PDF metadata, and give an egress-blocked CI recipe ([c15], [c28]).
- **README "Release integrity" section.** Commit Cargo.lock, publish sha256 sums, sign releases, ship an SBOM, list the musl/aarch64 targets, offer Homebrew and Nix packages, ship the OFL texts in the tarball, and publish the cargo tree output ([c26], [c44], [c50], [c51], [c24], [c37]).
- **README "Config contract" section.** Document the `version` key, the unknown-category behaviour with a `--strict` flag, a `--json` manifest with input/config/binary/output hashes, and a validate mode ([c16], [c23], [c32], [c40], [c46], [c58]).
- **README "Limits" section.** Explain the streaming algorithm, UTC versus wall-clock binning, what happens at the memory cap, the supported CSV dialects, and stdin input ([c17], [c54], [c31], [c30], [c53]).
- **README "Licence & roadmap" section.** List what stays in the CLI and confirm there is no CLA ([c42], [c55]).
- **Demo / repo.** Add an `examples/` golden-file test that runs on Linux and macOS and compares hashes ([c48], [c14]). Add a fixture that renders 50 times in a loop ([c44]). Add a DST fixture with gaps ([c4], [c47]). Add a messy-CSV fixture (semicolons, decimal commas, BOM, embedded newlines) that asserts exact values ([c17], [c30]). Publish the memory benchmark script with cold and warm cache results ([c31], [c54]). Add a side-by-side with matplotlib code ([c48]).

## Riskiest comments

- **[c18]** (44 pts, already the top comment) and **[c14]** (36 pts). Neither has a founder reply. If they stay unanswered, the thread's verdict becomes "reproducible is unverified", and that undercuts the headline claim.
- **[c34]** ("just marketing") and **[c44]** ("a claim and not yet a tested property"). These are the same point, phrased in a way that is easy to quote. [c43] did not answer it.
- **[c15]** together with **[c28]**. The founder admitted the metadata hasn't been audited for patient-level data. That reply was honest and well received (31 pts), but if someone finds a leaked input path or column values, the story becomes "leaks PHI".
- **[c31]** and **[c13]**. An OOM kill with no useful error on a CI runner is a concrete failure people can picture, and [c56] confirms there are no numbers yet.
- **[c7]** and **[c9]**. If the CLA idea in [c8] gets picked up, these turn into "rug pull" fears. Right now [c39], [c42] and [c55] are holding that line.
- **[c60]**. This is a hypothesis: [c1] calls identical SVG/PDF text metrics a "hard part", but [c60] doesn't explain how it was solved. That gap could get called out.

## Founder replies that helped / hurt

Note: 7 of the 8 founder effects in the metrics are "no-response" (the parent didn't reply), so most of the effects below are inferred from the thread, not measured.

**Helped:**

- [c12] is the only measured effect, and it defused [c7] (delta +1.67). It conceded that MIT can't enforce the promise and gave a reason for staying MIT. [c39], [c42] and [c55] then backed it up.
- [c28] (31 pts) gave a verifiable test (egress blocked, strace) and was honest about the missing metadata audit.
- [c29] (neutral delta) and [c56] refused to guess. Other commenters explicitly credit this honesty in [c31] and [c40].
- [c52] answered the sustainability worry with structural facts (MIT, no CLA, works offline) instead of making promises.

**Mixed or hurt:**

- [c60] answered the founder's own "hard part" with "I'll document it", which reads as evasive on the product's core claim.
- [c43] was a fair answer on kaleido but skipped the determinism request that was [c34]'s main point.
- [c11] left the CLA undecided ("not going to claim a decision"). That is honest, but it leaves open the risk [c55] warns about. It also missed the point in [c24] that the OFL texts must ship inside the release archives.

**Missing:** The highest-value gaps are the top comments with no reply: [c18], [c14], [c23], [c4] (DST), [c13], [c26] and [c16]. One determinism reply to [c18] would probably matter more than all the existing founder replies combined.

## Mapping to experiments.md hypotheses

- **H1 (CI hook lands): supported, with a cost.** Commenters bring up pipelines and pinned output on their own ([c3], [c6], [c25], [c27], [c47], [c48], Dagster in [c53]). But the hook also invites the strictest scrutiny: the top comments [c18], [c14] and [c44] turn the claim into a demand for proof. The hook works, and the evidence behind it is what's missing.
- **H2 ("No Python" is a selling point): mostly supported.** There is almost no "just use matplotlib" pushback. [c4] says it's really a pinning problem but concedes the point. [c33] and [c47] confirm the pain of matplotlib upgrades. [c34] suggested plotly/kaleido, and [c43] answered that reasonably. Python loyalists are mildly positive (+0.3 in the metrics). The negative segment, dataviz practitioners at −0.43, objects on chart semantics, not on Python ([c19], [c59], [c58], [c49]).
- **H3 (paid hosted version doesn't hurt trust): supported, conditionally.** No one alleged a rug pull. [c40], [c39], [c42] and [c55] endorse MIT plus a hosted tier. The risks are structural, not emotional: enforceability ([c7]), a solo maintainer ([c9]), and CLI features drifting into the paid tier ([c55], [c42]). Adopting the CLA suggested in [c8] would probably turn this into a contradiction. Because this thread is synthetic, treat all three verdicts as hypotheses.
