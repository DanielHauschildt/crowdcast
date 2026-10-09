---
title: 'Show HN: Tablecraft – turn any CSV into a publication-ready chart from the terminal'
url: https://github.com/example/tablecraft
---

Tablecraft is a single-binary CLI (Rust) that reads a CSV or Parquet file and writes an SVG or
PDF chart. It guesses a sensible chart from the column types, and every choice can be
overridden with flags or a small TOML file that lives next to your data, so charts are
reproducible in CI. No Python, no browser, no account.

<!-- first-comment -->

Hi HN, I built this because I kept rebuilding the same matplotlib boilerplate for reports.
How it works: column types are inferred on read, a rule table picks the chart type, and
layout is done by a small constraint solver so labels don't overlap. It's MIT-licensed. What's
hard: date axes across time zones, and keeping text metrics identical between SVG and PDF.
There is no telemetry. A paid hosted version for teams is planned; the CLI stays free.
