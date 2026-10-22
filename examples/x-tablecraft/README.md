# x-tablecraft

The `show-hn-tablecraft` seed (same context, founder answers and hypotheses) posted on X by its maker with
2000 followers. The post fits in 280 characters; the repo link goes in the maker's follow-up reply, because X
mode penalises For You reach for a link in the post itself (an assumption, like the rest of X mode).

X mode is not validated against real data; its reach model is borrowed from the Bluesky fit and X's published
ranker weights.

```sh
pnpm crowdcast run examples/x-tablecraft --steps 2
```
