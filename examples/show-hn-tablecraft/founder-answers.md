# Prepared answers (facts the founder agent may use)

- Licence: MIT, the whole CLI. No CLA.
- Telemetry: none. The binary makes no network calls.
- Business model: planned hosted team version (shared themes, scheduled renders, a web gallery). Price not decided yet. The CLI stays free and MIT.
- Why not matplotlib/ggplot/Vega: those are libraries for people writing code; Tablecraft is a CLI for pipelines where you want zero runtime dependencies and pinned output.
- Why not Vega-Lite + a headless renderer: works, but needs Node or a browser in CI; Tablecraft is one static binary (~8 MB).
- Performance: streams the file; a 2 GB CSV renders a line chart in ~6 s on an M2 laptop.
- Accessibility: SVG output includes title/desc elements; colour palettes are colour-blind safe by default. Not decided yet: alt-text generation.
- Fonts: bundles Inter and IBM Plex; any system font via config.
- Roadmap: HTML output with tooltips, maps (not decided yet), Windows ARM builds.
