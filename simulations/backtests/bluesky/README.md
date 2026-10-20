# Bluesky reference posts

- `threads.txt` (train) and `holdout.txt`: launch/release posts by dev-tool makers, picked from their author feeds
  on the public AppView (2026-10-20), split by `isHoldout(id)`. A line is `<id>  # <at-uri>  # likes/reposts/quotes/replies, date`;
  the id is the 32-bit FNV-1a hash of the at-URI (`threadId`), since backtests key threads by number.
- `threads/<id>/`: cached `real.json`, `context.md` and `timeline.json` (followers, like times, reposter
  followers). Gitignored: it holds real handles and text.
- `fit.json`: reach constants fitted on the train list's likes in the first 4 hours (16 × 15-min steps);
  `src/platforms/bluesky/index.ts` reads them as defaults. Refit with `pnpm crowdcast fit bluesky simulations/backtests/bluesky/threads.txt`.
- `segments.yaml`: the backtest crowd (100 active + 150 voters = the platform's default `audiencePool`).

Run a backtest: `pnpm crowdcast backtest --platform bluesky --limit 2 --steps 2`.

Caveats: follower counts are today's, not at posting time; `getRepostedBy` has no timestamps, so the cascade
decays with the post's age; reposter followers are the mean of up to 25 reposters per post.
