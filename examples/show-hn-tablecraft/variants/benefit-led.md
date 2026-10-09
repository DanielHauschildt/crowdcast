---
title: 'Show HN: Tablecraft – reproducible charts in CI, no Python or browser needed'
url: https://github.com/example/tablecraft
---

If your reports regenerate charts in CI, Tablecraft replaces the Python/matplotlib step with a
single static binary. Point it at a CSV or Parquet file and get an SVG or PDF; a TOML file next
to the data pins every visual choice, so the same data always produces the same chart.

<!-- first-comment -->

Hi HN, author here. I built this after our nightly report job broke for the third time on a
matplotlib upgrade. It's MIT-licensed Rust, no telemetry. Hard parts: time-zone-correct date
axes and identical text metrics in SVG and PDF. A hosted team version is planned; the CLI stays free.
