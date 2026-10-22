---
title: 'I built Tablecraft, a CLI that turns any CSV into a publication-ready chart'
url: ''
---

I kept rebuilding the same matplotlib boilerplate for reports, so I built Tablecraft: a single-binary
CLI (Rust) that reads a CSV or Parquet file and writes an SVG or PDF chart. It guesses a sensible
chart from the column types, and every choice can be overridden with flags or a small TOML file
that lives next to your data, so charts are reproducible in CI. No Python, no browser, no account.

It's MIT-licensed and has no telemetry. A paid hosted version for teams is planned; the CLI stays
free. Hardest parts so far: date axes across time zones, and identical text metrics between SVG
and PDF.

Repo: https://github.com/example/tablecraft

Would love feedback, especially on the defaults it picks for your data.
