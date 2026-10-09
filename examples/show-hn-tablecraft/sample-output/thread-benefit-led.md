**Synthetic LLM simulation — hypotheses, not a forecast.**

```text
Show HN: Tablecraft – reproducible charts in CI, no Python or browser needed (https://github.com/example/tablecraft)
80 points | 60 comments

If your reports regenerate charts in CI, Tablecraft replaces the Python/matplotlib step with a
single static binary. Point it at a CSV or Parquet file and get an SVG or PDF; a TOML file next
to the data pins every visual choice, so the same data always produces the same chart.

---
[c18] p25 · 44 points
The pitch says the same data always produces the same chart, and that is a stronger claim than the README seems to make. I would like it stated precisely, because a CI job that diffs artifacts needs to know which of these holds: (a) byte-identical SVG/PDF for the same binary version on the same platform, (b) byte-identical across platforms for the same version, (c) identical rendered pixels across versions, or (d) only visually similar. Those are four different guarantees, and the answer decides whether people should pin the release tag, pin the output hashes, or diff rendered PNGs instead. The usual culprits are float formatting in path coordinates, PDF creation timestamps and document IDs, and any HashMap iteration that leaks into output order. If you already strip the timestamps and make the ordering deterministic, say so, because that is the detail I would look for first. A short test in the repo that renders a fixture on two machines and compares hashes would make the claim checkable instead of asserted. The tabular-figures question from the other comment belongs in the same section, since the solver's inputs are part of the reproducibility contract too.

[c14] p2 · 36 points
The byte-for-byte question has come up a few times, and I think a test in the repo would answer it better than a README sentence. Something like: render a fixed CSV and tablecraft.toml on a Linux runner and a macOS runner, then cmp the SVG and PDF outputs (or at least the SVG path data) across two tablecraft versions. If the output drifts, that's a fact people can see. If it holds, it's a guarantee you can state. Either way it covers the float-formatting and font-fallback concerns raised above. We already do something like this for dbt output snapshots and it caught a locale issue that nothing else would have.

  [c44] p4 · 0 points
  Agree that a cross-platform cmp test in the repo is the right shape, and I'd add one more axis to it: build the binary itself reproducibly. Byte-identical output from a binary you can't rebuild bit-for-bit is only half a guarantee, because then "pin the release tag" really means "trust the maintainer's CI runner at that moment". Commit Cargo.lock, use --locked, set SOURCE_DATE_EPOCH, pass --remap-path-prefix so build paths don't leak into the binary, and publish the sha256 of each release artifact. If the static musl build comes out identical on two machines, that is something I can pin in a Nix derivation and forget about.

  The other thing I'd check first in the output is the PDF /ID and CreationDate, and whether any HashMap iteration order (Rust randomises it per process) leaks into the SVG element order or the font subset glyph order. Running the same render 50 times in a loop and comparing hashes catches that one cheaply, even before you get to cross-platform. I'd be happy to be wrong here, since the pitch is good, but right now "reproducible" in the title is a claim and not yet a tested property.

[c6] p43 · 29 points
The win here is the single static binary replacing the Python stack, not the Rust. The toml pins the visual choices, but if a new tablecraft release changes text layout or date-axis rounding, the output still diffs. Is the binary version part of the reproducibility story, or should people pin the release tag themselves? Would be worth a line in the README either way.

  [c27] p56 · 1 points
  We ran into this on the build farm years ago. A release tag alone wasn't enough, because the libraries underneath moved. We ended up pinning the compiler version, the runtime library and the locale in the build manifest, then diffing outputs against stored checksums. For a chart tool I'd want the README to say which of three things it guarantees: identical bytes, identical layout, or identical visual result. The pinning advice differs for each. If it's bytes, people should pin the binary by hash, not just the tag.

  [c25] p52 · 0 points
  Pinning the binary version is the right default, but the reproducibility claim gets much easier to check with a version key in tablecraft.toml plus golden-file tests that run against each release. If a layout or date-axis change lands, the golden diff shows up in the PR instead of in the nightly report. It would also give the "CLI stays free" line something concrete to point at: a documented toml schema with a version field people can rely on.

[c15] p6 · 16 points · ↳ answered by OP
For us the first question is where the data goes, so the no-network-calls and no-telemetry point is the main thing I'd want to see backed up. Two things I'd check before a pilot: whether the SVG or PDF metadata embeds the input path or any column values (titles and legend labels come from the data, and a chart built from patient-level rows can carry identifiers into a file that gets emailed around), and whether there's a documented way to confirm the binary makes no network calls, like a CI run with egress blocked. A README line on both would make the pilot much easier to approve.

  [c28] founder (OP) · 31 points
  The binary makes no network calls and has no telemetry. Nothing phones home, for updates or anything else. You don't have to take my word for it. Run it in a CI job with egress blocked, or under strace/dtruss, and check that it renders normally. I'll put that in the README.

  On metadata: the SVG output includes title and desc elements. I haven't audited what ends up in the SVG or PDF metadata (input path, column values, producer strings). So for patient-level data, please don't assume it's clean. Run strings or grep on a rendered file for your identifiers and your input path before the pilot. I'll check this and document exactly what gets embedded.

[c5] p32 · 12 points
Does the default tick-label font use tabular figures? The label collision solver depends on text widths, and with proportional digits a value change can shift widths between runs, which can flip overlap decisions and make a nightly chart's layout jitter. Tabular numerals would keep the solver's inputs stable. A tablecraft.toml option to pin font-variant-numeric would be a nice touch too. Also curious how you keep SVG and PDF metrics identical when the PDF embeds subset fonts. The no-browser, single-binary route for CI charts is a useful niche.

[c7] p46 · 11 points · ↳ answered by OP
The "CLI stays free" line is a promise, and MIT can't enforce it. Under MIT anyone can run a hosted team version of this themselves, and you'd have nothing to point to except the roadmap. If you want that promise to mean something, AGPL on the CLI is the license that actually backs it up, since a hosted fork then has to publish its changes. A static binary replacing the matplotlib step in CI is a real use case, though, so I'd like to see how this holds up.

  [c12] founder (OP) · 2 points
  That's true. MIT can't enforce the promise, and a fork could host it. The CLI is MIT with no CLA, and I'm not planning to change that. The hosted version would be a separate team product with shared themes, scheduled renders and a web gallery. The CLI doesn't depend on it: the binary makes no network calls and has no telemetry. I haven't decided the hosted price yet. I understand the AGPL argument. Even so, for a tool that runs inside CI pipelines, I'd rather not make people's legal teams look at a copyleft licence.

    [c39] p47 · 0 points
    On the MIT versus AGPL back and forth, I think you're right to stay MIT for something that lives inside CI pipelines. We went through the same thing, and the copyleft conversation with a customer's legal team costs more than any fork ever will. The real protection isn't the licence, it's that the hosted product has to be something a fork can't cheaply replicate: accounts, access control, a gallery with permissions, retention. Those are the things a procurement department actually pays for.

    One pricing caution, since you said you haven't set the price yet. Scheduled renders is a weak thing to charge for. Your free users already have a scheduler, it's called CI, and that is literally the pitch of this tool. Shared themes is better, because it solves a team coordination problem that a single developer never has. But I'd guess the paid tier only really works once there's something like SSO, an audit trail of who changed a theme, and private sharing of the rendered output. Keep everything one developer needs in the free CLI, and charge for what only matters once there are many people involved. It's also an easier thing to say honestly in the README, which helps with the 'CLI stays free' trust question people keep raising here.

    [c42] p60 · 0 points
    MIT with no CLA is the honest setup for a CLI you want in CI, and I'd rather see that than a CLA bolted on later. But "the CLI stays free" is a roadmap item, not a licence term, so I wouldn't lean on it. The thing that protects users is that the binary works with no network and the code is already out under MIT. If the hosted tier ever drifts toward open-core, anyone can fork the last good release. Keep the hosted bits in a separate repo so the line stays clear.

    [c55] p51 · 0 points
    For what it's worth, I think MIT with no CLA is the honest choice here, and I'd say so even though the AGPL suggestion upthread is well meant. Open source means anybody can run your code, including a competitor hosting it. We had this argument in 1998 and again in 2008. If the business only works when nobody else can host the thing, the licence is the wrong place to fix that. The fix is to make the hosted product worth paying for.

    The thing to watch is the day the CLI starts losing features to the paid tier. That is the point where 'the CLI stays free' stops being true, whatever the licence file says. Decide now what stays in the CLI and write it down.

    Separately, a no-CLA project can't be relicensed without asking every contributor. That's a feature for the people using it. Please keep it that way.

[c8] p48 · 8 points · ↳ answered by OP
Licence question for the PDF side. Fonts get embedded, so which fonts ship as defaults, and do their licences allow embedding in generated documents? Some fonts restrict embedding or subsetting, and OFL fonts with reserved names need care if you rename or modify them. A line in the README listing the default fonts and their licences would save users a check. Separately, since a hosted tier is planned, a CLA or DCO on outside contributions is much easier to set up now than after the codebase has grown. It's what keeps your future licensing options open.

  [c24] p48 · 10 points
  On the fonts: OFL lets you embed and subset in generated documents, which covers the PDF output. Bundling Inter and IBM Plex inside the static binary is different, though. That is redistribution of the font software, so the OFL copyright notice and licence text need to travel with it. Ship the OFL text next to the binary in the Release archives, not only in the README, so anyone who copies the binary gets it too.

  [c11] founder (OP) · 2 points
  The bundled fonts are Inter and IBM Plex. Both are under the SIL OFL 1.1, which allows embedding in documents. I'll add a fonts and licences section to the README. Any other font comes from the system through config, so its licence is the user's to check.

  There's no CLA today, and the whole CLI is MIT. I agree it's easier to set one up before there are many outside contributors than after. I haven't changed that, and I'm not going to claim a decision I haven't made.

[c9] p53 · 4 points · ↳ answered by OP
Is it just you? Not trying to be snarky, I've just been burned by solo projects going quiet after six months. The CI use case is a real one, and the "CLI stays free" line matters a lot for that. Do you have a plan if the hosted side ends up taking most of your time?

  [c52] founder (OP) · 0 points
  I can't promise anything about my time six months out, so here is what doesn't depend on me. The whole CLI is MIT with no CLA, so anyone can fork it. The binary makes no network calls and has no telemetry, so it doesn't depend on any hosted service to keep working. If the hosted side stalled or went away, the CLI you pinned in CI would behave the same. The hosted team version (shared themes, scheduled renders, a web gallery) is planned but not built, and I haven't decided its price. It would be a separate product from the CLI.

[c1] founder (OP) · 2 points
Hi HN, author here. I built this after our nightly report job broke for the third time on a
matplotlib upgrade. It's MIT-licensed Rust, no telemetry. Hard parts: time-zone-correct date
axes and identical text metrics in SVG and PDF. A hosted team version is planned; the CLI stays free.

  [c4] p19 · 28 points
  I'll grant the pitch is aimed at a real problem. A nightly job that breaks on a matplotlib upgrade is usually a pinning problem rather than a matplotlib problem, but I've also watched people lose a week to a changed default (the 2.0 style change comes to mind), so I won't lecture you. A single static binary with a TOML file that pins every visual choice is a reasonable answer, and I like that the config sits next to the data.

  Two specific questions, since you say identical text metrics between SVG and PDF was the hard part. First, how do you get the metrics? Do you shape the text yourself with something like rustybuzz and embed the subset font, or do you lean on a font's hmtx table? Kerning and fallback fonts are where I'd expect the two outputs to drift. Second, is the output byte-for-byte reproducible across machines and versions, or only visually identical? If a CI job diffs the SVGs, that distinction matters a lot, and I'd want a stated guarantee about it in the README. Floating point formatting in path coordinates is the usual culprit.

  On the time-zone-correct date axes: how do you handle DST transitions when choosing tick positions? That is the part that always bites me. A daily tick across the spring-forward boundary should still land on local midnight.

  The planned hosted tier doesn't bother me as long as the CLI really stays free and the format of tablecraft.toml is documented and stable. Pin that down early.

  [c10] p57 · 4 points · ↳ answered by OP
  Identical text metrics between SVG and PDF is the part I'd care about. Do you ship font metrics yourself or shape text with something like rustybuzz? SVG renders in whatever font the viewer has, so I'm curious how you keep layout stable when the font is missing.

    [c60] founder (OP) · 0 points
    What I can say for sure: the default fonts are Inter and IBM Plex, bundled in the binary, and any system font can be selected through the config. The bundled fonts are the ones the defaults are laid out with, so a default-config run doesn't depend on what's installed on the CI image. I haven't written up the missing-font behaviour for a custom system font in SVG, or the shaping and kerning details, so I won't describe them from memory. I'll document both in the README.

  [c33] p16 · 0 points
  The matplotlib upgrade breaking a nightly job is real, I maintain a big styling module and rcParams default changes have bitten me more than once. Genuinely asking: how much of matplotlib's layout do you expect people to reproduce with the toml? In my experience the long tail is things like twin axes, annotations and per-figure tweaks. Is the plan to cover those, or is this deliberately for the 80% of charts that are plain line/bar/scatter? Either is fine, but it decides whether I could swap it in for a report job.

  [c38] p45 · 0 points
  Since you said the binary is about 8 MB static, one thing I'd be curious about from the CI side is startup latency, which nobody has asked about yet. For a tool that runs once a night it hardly matters, but people will also bind something like this to a watch loop or an editor save hook, and then you feel every millisecond. On a small CSV it would be worth measuring how long it takes to render a trivial chart with no data at all, and seeing what that time is made of. In my experience with Rust CLIs the surprise is rarely your own code. It's usually font database scanning (if you enumerate system fonts eagerly to resolve a family name, that can cost tens of milliseconds on a machine with lots of fonts installed), locale initialisation, and any eager parsing of the bundled fonts you don't end up using. If you load Inter and IBM Plex lazily, only when the toml actually references them or the default is needed, and skip the system font scan entirely unless a non-bundled family is requested, you can probably stay well under 10ms for small inputs. It also helps the reproducibility story, because a system font scan is exactly the kind of environment-dependent input that makes output differ between a laptop and a CI runner. Worth putting a number in the README next to the binary size.

  [c40] p50 · 0 points
  Nice, a static 8 MB binary instead of matplotlib plus fonts in the image is a real win. I ship small paid tools and a hosted tier on top of an MIT CLI is a perfectly normal path. Honest answers in this thread on the metadata audit and the CLA make me trust it more. One small ask: a --strict flag that fails on unpinned categories, and a one-paragraph determinism statement in the README. That would sell it to the CI crowd.

  [c47] p22 · 0 points
  Matplotlib upgrades breaking nightly jobs is real, I've had rcParams defaults shift under a report pipeline too. Pinning is the boring answer, but a static binary does remove the font and backend mess from the image. My question is the one that kills most new chart tools: a datetime index with gaps, say 20 million rows of sensor data with missing shifts and a DST change. Does the date axis draw a flat line across the gap, or break it? Does the streaming aggregation bin by wall-clock or by UTC? matplotlib users get burned there, so I'd like to see that fixture in the repo.

  [c51] p44 · 0 points
  Static binary is the right call. Which target is it, x86_64-unknown-linux-musl and aarch64 both? Please publish sha256 sums and sign the release archives, and ship the OFL texts in the tarball. Also a homebrew formula or nix package would help; cargo install on prod hosts isn't going to happen.

[c36] p36 · 2 points
Does it have a fixed-size output mode with minimum stroke widths and font sizes? Our charts end up on 1280x800 panels, rendered SVG to bitmap. Thin gridlines and 9px tick labels that look fine in a PDF disappear on a dusty touchscreen. A toml option for min stroke width and min font size would be useful.

[c3] p12 · 1 points
This fits a real gap. I have a Dagster job that renders a few report charts and the matplotlib plus fonts dependency is the flakiest part of the image. A static binary that reads Parquet directly is appealing.

Two questions. When you say streaming aggregation for multi-GB files, what does it aggregate by? Is it bucketing time series by the x axis, or do I have to pre-aggregate in DuckDB first? And is the output byte-for-byte deterministic across machines, or only visually identical? That matters if you diff artifacts in CI.

  [c13] p1 · 14 points
  Related to the streaming question: for time series the memory story is mostly fine, since bucketing by x keeps the group count small and Parquet row group min/max stats on the x column can skip most of the file. The harder case is a group-by on a high-cardinality column like a free-text category or customer id. That behaves like a naive pandas groupby: the hash table grows with the number of distinct keys, not the file size. Does it spill to disk, or is there a hard ceiling? The README says 'a few GB', which doesn't tell me whether a 30GB Parquet with 10M distinct keys will work or just get OOM-killed in CI.

    [c31] p9 · 17 points · ↳ answered by OP
    This is the question I'd want answered with numbers before trusting the "few GB" line. Time series bucketed by x is easy, since state is bounded by the number of bins. The high-cardinality group-by is where tools quietly die, because the hash table grows with distinct keys and not with file size, and a CI runner with 4 or 8 GB will OOM-kill it with no useful error. I'd like to see three things in the repo: peak RSS for a fixed dataset at, say, 1M, 10M and 100M distinct keys, whether there is a hard cap that fails with a clear message instead of getting killed, and whether a bar chart of 10M categories makes sense at all, or whether it should refuse and ask for a top-N. Top-N with an "other" bucket can be done in bounded memory with a sketch, so that might be the honest answer. Publish the generator script and the exact command lines, and report cold and warm cache separately, because a Parquet read from page cache and one from a network volume are different benchmarks. The author was straightforward about not having audited the metadata and not having the dependency tree written down, which I appreciate, but the same treatment is needed for the memory ceiling.

      [c56] founder (OP) · 1 points
      The only measurement I have is a line chart from a 2 GB CSV: about 6 s on an M2 laptop, streaming the file rather than loading it. I don't have peak RSS for high-cardinality group-bys, and I don't have cold and warm cache runs. Please don't read that number as covering the 10M-key case, because it doesn't. I agree a clear failure on a memory cap, or a top-N with an "other" bucket, is better than an OOM kill in CI. I'd rather publish the generator script, the command lines and the RSS numbers than describe the ceiling in prose, so I'll start there.

[c16] p10 · 1 points
Does tablecraft.toml carry a schema version? If the file pins the visual choices and the binary pins the release, a mismatch should fail loudly instead of silently re-laying out the chart.

[c17] p11 · 1 points
Question on the streaming claim. Choosing tick positions and bins for a date axis usually needs the global min and max of x before you can bucket anything, so either the first pass is a scan just for bounds or the tool keeps per-bin state for a range it doesn't know yet. Which one is it? It matters for a 3GB CSV versus a Parquet file with row groups you can prune by stats.

Also, what does the CSV reader do with the messy real exports? A UTF-8 BOM, CRLF mixed with LF, quoted fields that contain newlines, and a European decimal comma would each break a naive reader quietly. A test fixture with a couple of those would tell people more than the feature list does. On the Parquet side, timestamps with a tz annotation versus naive timestamps are where I'd check the date axis first.

  [c30] p8 · 4 points
  Adding to the messy-export list: does the CSV reader check the field count on every row against the header, and fail if it differs? A semicolon file read with a comma delimiter doesn't error, it gives you one column per row, and the chart renders with a series called 'date;revenue' and nothing else looks wrong. Same for a decimal comma: '1.234,56' sometimes parses as 1.234 and the rest goes into the next field. A sniffed delimiter from the first line is fine until the header has a comma in a quoted name. For the fixture, I'd add a semicolon file with decimal commas and one row with an embedded newline in a quoted field, and assert on the exact numbers, not just that it renders.

  [c41] p58 · 2 points
  There's a third option besides a pre-scan or unbounded per-bin state. Keep a fixed number of bins over a provisional x range, and when a value falls outside it, double the bin width and merge adjacent pairs. Memory stays O(bins), it's one pass, and the tick positions are computed from the final range at the end. Counts and sums merge exactly, so means are fine too. Quantiles would only be approximate. When Parquet row-group min/max stats exist, which is usually true for files written by Spark or DuckDB, you can skip the pre-scan entirely.

    [c54] p38 · 1 points
    This is the right shape for the one-pass case, with one caveat for date axes. Doubling the bin width and merging pairs is exact for counts, sums, min and max, but if the bins are anchored to a provisional range they can straddle local midnight or month boundaries, and then you can't re-bucket by wall clock at the end without losing information. For a series that crosses a DST change I'd bin at a fine fixed UTC resolution (say 1 second or 1 minute) and only map to local-time ticks at render time. Otherwise daily bars are approximate across the transition. That's cheap in memory, but it's a real design choice. It decides whether the time-zone-correct claim holds for the streaming path or only the in-memory one.

    When the author publishes the memory numbers c31 asks for, I'd like them reported separately for Parquet with row-group pruning and for a fully parsed multi-GB CSV, each with cold and warm cache on its own line. The CSV case is probably CPU- and allocator-bound on parsing long before it's IO-bound, and a single 'a few GB' figure would hide that.

[c21] p37 · 1 points · ↳ answered by OP
Nice. What's the release binary size with lto=true and strip? And what does the dependency tree look like for the Parquet path? I've been burned by tools that pull in arrow plus tokio just to read a file. A static binary is the selling point, so a size number in the README would help.

  [c29] founder (OP) · 2 points
  The release binary is about 8 MB, static. I'll put that number in the README. I don't have the Parquet dependency tree written down, so I won't summarise it from memory. `cargo tree` on the repo will show exactly what the Parquet path pulls in. I'll add that to the README too, since it's a fair thing to check.

    [c37] p41 · 2 points
    Fair answer on not summarising the tree from memory. Please do publish it, and commit Cargo.lock. For a tool whose selling point is one static binary, the number of crates behind the Parquet reader and the PDF writer is part of the pitch. If Parquet pulls in the full arrow stack, consider making it a cargo feature so the CSV-only build stays small. 8 MB is fine, but I'd want to know what it was before Parquet went in.

  [c45] p5 · 0 points
  Which Parquet reader is it, the parquet crate directly or arrow-rs? If it's arrow-rs, is the aggregation done on RecordBatches internally? For a Polars shop that matters, because a CSV-only build without arrow would be a smaller pitch than the full stack.

[c48] p23 · 1 points
Congrats on shipping! As someone who has fought matplotlib upgrades in Snakemake pipelines, a static binary plus a pinned toml is appealing. One concrete suggestion: ship a small examples/ directory with a CSV, a tablecraft.toml and the expected SVG, and have CI render it and diff against the committed file. That doubles as the determinism test people are asking for above, and as a README gallery. Also a side-by-side of the equivalent matplotlib/seaborn code for a line chart would help people like me judge how much of our styling code the toml actually replaces.

[c2] p7 · 0 points
The tablecraft.toml sitting next to the data is the part I'd want. Pinning colours and axis ranges in a file that lives with the data also makes it easy for a coding agent to regenerate a chart after a schema change, without anyone clicking through a dashboard. Curious how it behaves when the data picks up a new category that isn't in the pinned palette: does it fall back to a default colour, or fail the render? For CI that choice matters a lot.

  [c23] p42 · 28 points
  On the unpinned category case, I'd want a fallback that prints a warning to stderr, plus a flag that turns it into a hard failure for CI. Silent defaults are how a nightly chart drifts without anyone noticing. The other thing I'd want is a --json summary of what got inferred and which fallbacks fired: chart type, palette entries used, axis ranges chosen. That's easy for a script or an agent to check, and when the byte-level question comes up you can diff that summary instead of the SVG.

    [c32] p13 · 2 points
    I'd go one step further with the --json summary and make it a lineage record rather than just a list of what the renderer decided. For us the useful property is that a chart can be traced back to exactly what produced it. So the summary should carry the sha256 of the input file (or for Parquet, the file path plus the row group count and the min/max of the x column, since those are what the date axis was chosen from), the sha256 of tablecraft.toml after parsing and normalising, the tablecraft version and a build identifier for the binary, and the sha256 of the rendered SVG or PDF. Then the auditor question "why does last March differ from today's rerun" has a concrete answer: either an input hash changed, a config hash changed, or the binary changed, and nothing else is left to explain it. That also gives the fallback warnings a place to be recorded, so a nightly run that silently used a generated palette is visible in the artefact itself and not only in a log that gets rotated away. The fact that the same chart comes out of the same inputs is a claim I'd want to check myself, but the manifest is what lets someone check it later without rerunning anything.

    [c35] p27 · 0 points
    Agree on fail-by-default for unknown categories. A --json summary of inferred type and fallbacks is also handy. Diffing that in CI beats diffing SVGs, and it saves an afternoon of chasing noise.

  [c20] p33 · 2 points
  Same question from the other side: I generate chart specs with LLMs a lot, and the failure mode that hurts is a silent default. For CI I'd want unknown categories to fail the render by default, with an opt-in flag to fall back to a generated palette. A rendered chart where a new category quietly gets a near-duplicate colour is worse than a red build.

  [c46] p20 · 0 points
  Honestly I just ask Claude to write the plotting code now and tweak it. For that to work in an agent loop the toml schema has to be stable and versioned, which is what c16 is asking about. A validate mode that prints config errors as JSON, without rendering, would let the model fix its own file in one pass. Is the toml format documented anywhere yet?

  [c58] p29 · 0 points
  A generated fallback palette needs the same colour-vision check as a hand-picked one, and distinct hex codes aren't enough. Two colours that differ mainly in hue can collapse into one swatch under deuteranopia, so 'no near-duplicates' has to be measured under CVD, not just in sRGB. Put the chosen hex values in the warning and in the --json summary, so the check can run against what the renderer actually produced.

[c19] p31 · 0 points
Does the bar kind take an error or interval column? The feature list says categories become bars but says nothing about uncertainty. A bar chart of group means with no interval shown is a decoration, not a figure. For a nightly report that regenerates from new data, the TOML should let you pin the interval type and level (SE, or 95% CI from a column) as well as the colours.

[c22] p40 · 0 points
This is really cool! Curious which constraint solver you use for the label layout. Is it a crate like cassowary, or something homegrown? I'd love to see how you modeled tick labels and legends as constraints, since that's the part I'd struggle with first if I tried it in Rust.

[c26] p54 · 0 points
Useful niche. For us, adopting this means answering a few things for security and legal: does the release ship an SBOM (CycloneDX or SPDX), and are the binaries signed with a provenance attestation? With cargo install, is Cargo.lock committed and are the dependencies audited with cargo-deny or cargo-vet? The font licence answer in the thread is good. Since the constraint solver and PDF writer are the core, how much of the code was LLM-generated? I'm not saying it's a problem. Auditors are starting to ask, and a line in the README would settle it.

[c34] p18 · 0 points · ↳ answered by OP
Static binary in CI is a fair niche. But for time series, Dash/plotly with kaleido already gives static SVG/PDF. Main thing I'd want is a stated determinism guarantee (bytes vs visual) with a cross-platform test in the repo. Without that, "reproducible" is just marketing.

  [c43] founder (OP) · 0 points
  Plotly with kaleido does give you static SVG/PDF, and if you're already in Python it's a reasonable choice. The difference is what has to be in the CI image: kaleido still needs a Chromium build behind it, plus the Python environment. Tablecraft is one static binary of about 8 MB with no runtime dependencies, so the only things that can change are the binary and the TOML file.

  I haven't published a determinism statement yet, so I won't claim more than that here. A cross-platform fixture test in the repo is a fair thing to ask for.

[c49] p28 · 0 points
The thread is all CI plumbing, so one thing from the chart side. Your feature list says the solver prevents overlapping tick labels and legends. Does it also place direct labels on the series, so I can label the line at its end instead of using a legend? In newsroom work that's the first thing I reach for, and most CLI chart tools skip it. If the toml could pin a text annotation to a data coordinate ("this is the spike, label it here"), you'd cover most of what keeps people dropping into D3 or Illustrator for the last 10%. Also agree with c36: a minimum stroke width and font size matters for anything shown on small screens.

[c50] p39 · 0 points
Static binary, no telemetry, offline. Good. Commit Cargo.lock and publish sha256 for release binaries. Does the build use vendored deps, so it builds without network?

[c53] p24 · 0 points
Does it read from stdin or a pipe? I'd like to call it from a Dagster op with a DuckDB query output and not write a temp file first.

[c57] p17 · 0 points
The README says fonts are embedded in the PDF, but for journal work the issue is usually exact panel dimensions in mm and font sizes in pt at final print size. Can the toml pin figure width/height in physical units and a font size that stays fixed when the figure is resized? Also, are PDF text objects kept as real text (not outlined), so I can open it in Inkscape and edit a label? If yes, that covers most of my matplotlib rcParams file.

[c59] p35 · 0 points
A chart-side point on the inference rules, since the feature list says categories become bars and two numerics become scatter. Those defaults are reasonable, but a few of the choices underneath them carry perceptual weight that a CLI should make visible. For bars, the length encoding is judged well by people, but only if the baseline is zero. Cleveland & McGill (1984) put length near the top of the ranking, and that advantage disappears if the axis starts at a nonzero value, which many auto-scaling tools do. I'd want the README to say whether the bar axis is pinned to zero by default. The ordering of categories matters just as much. Alphabetical order makes readers search for values, while sorting by value makes the comparison task a matter of reading the ranking. Heer & Bostock (2010) found that people do the length judgment fairly well, but ordering is what determines whether the chart answers the question someone actually has. For the 10M-category case raised upthread, a top-N with an other bucket should also be sorted by value, or the bucket will look like the largest item. For scatter, the default point size and opacity decide whether overplotting hides the structure, and I would not want a silent default there either. None of this is a reason to hold the release back. It is just that the inference rules are a perceptual choice as well as a type-dispatch one, and the toml should be able to pin the baseline and the sort order the same way it pins colours.

```
