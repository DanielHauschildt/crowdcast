# LinkedIn platform — unvalidated

There is no public LinkedIn data and scraping breaks its terms, so this mode models the commonly reported mechanism
with **assumed constants** (`reach.ts`), and every report and `thread.md` says so. Calibrate it with your own posts'
analytics.

## Reach model

2-hour steps, 18 by default (36 h).

1. **Test slice.** Steps 0–1 show the post to `testSlice` (5 %) of the author's network, split evenly. The network
   is the larger of `author.followers` and `connections` in `platform.yaml` (LinkedIn followers already include
   connections), else 1000.
2. **Expansion.** From step 2, impressions per step are the test slice × `expansion` (1.5) × gain × ½^(age /
   `halfLifeHours` (10 h)). Gain is the engagement rate per simulated reader divided by `baselineRate` (1; simulated agents engage far more than real feed readers),
   clamped to 0.1–4. Engagement: 1 per reaction, 3 per comment, plus 1 per 600 characters of comments (a dwell proxy);
   the founder's replies don't count. Only agents log visits, so readers and their reactions are agents only;
   silent voters' reactions don't drive expansion.
3. **Visitors.** Impressions / `audiencePool` (250) is the share of the simulated personas and voters that sees the
   post in that step, capped at 1. Bands: `test`, then by impressions relative to the test slice: `viral` ≥ 3×,
   `expanding` ≥ 1×, `network` ≥ 0.2×, else `fading`.

Reactions: `like`, `celebrate`, `support`, `love`, `insightful`, `funny`, `repost`; comments and replies.

## platform.yaml

```yaml
platform: linkedin
author:
  followers: 1800
connections: 1200 # optional
headline: Founder at Tablecraft # optional; how prompts name the author
testSlice: 0.05 # optional reach constants: testSlice, expansion, halfLifeHours, audiencePool
```

`run.json` keeps these keys and the author, so report and interview reload them.

## Fitting to your own post analytics

Export a post's analytics from LinkedIn (XLSX), save the daily sheet as CSV with the columns `Date`, `Impressions`,
`Reactions`, `Comments`, `Reposts` (any order, extra columns ignored; see `fixtures/analytics-synthetic.csv`), then:

```sh
pnpm build && node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { fit, parseAnalyticsCsv } from './dist/platforms/linkedin/analytics.js';
console.log(fit(parseAnalyticsCsv(readFileSync('my-post.csv', 'utf8')), 1800));"
```

with your follower count as the last argument. `fit` drives the model with each day's real engagement rate
((reactions + 2 × reposts + 3 × comments) / impressions, against an assumed 4 % baseline), searches `testSlice` and
`expansion` that best match log daily impressions, and returns them with the error before and after. Put them in
`platform.yaml`. One post is a weak fit; prefer constants that hold across several posts. Never commit your export.
