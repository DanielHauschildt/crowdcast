# linkedin-tablecraft

The `show-hn-tablecraft` seed (same context, founder answers and hypotheses) posted on LinkedIn by its founder.
`platform.yaml` picks the LinkedIn platform and sets the author's network (`author.followers`, `author.connections`),
audience and headline; the segments are a professional audience (buyers, peers, recruiters, competitors, the wider network).
LinkedIn mode is unvalidated: see `src/platforms/linkedin/README.md`.

```sh
pnpm crowdcast run examples/linkedin-tablecraft --steps 2
```
