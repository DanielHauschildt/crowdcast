# reddit-tablecraft

The `show-hn-tablecraft` seed (same context, founder answers and hypotheses) posted to r/SideProject instead of
Show HN. `platform.yaml` picks the Reddit platform and subreddit; the post is rewritten as a Reddit self post
by its maker.

```sh
pnpm crowdcast run examples/reddit-tablecraft --steps 2
```
