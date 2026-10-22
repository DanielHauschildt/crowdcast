# Tablecraft

Turn a CSV or Parquet file into a clean SVG or PDF chart with one command.

```sh
cargo install tablecraft        # or download a static binary from Releases
tablecraft sales.csv -o sales.svg
tablecraft sales.csv --kind line --x date --y revenue --title "Revenue" -o revenue.pdf
```

## Features

- Chart type inferred from column types (time series → line, categories → bar, two numerics → scatter)
- `tablecraft.toml` next to your data pins every choice (colours, fonts, axis ranges) for reproducible output
- Label layout by a small constraint solver: no overlapping tick labels or legends
- SVG and PDF output with identical text metrics; fonts embedded in PDF
- Reads CSV, TSV and Parquet; handles files up to a few GB with streaming aggregation

## Not yet

- Interactive output (HTML)
- Maps
- Windows ARM builds

## Licence

MIT. No telemetry. A paid hosted version for teams (shared themes, scheduled renders) is planned.
