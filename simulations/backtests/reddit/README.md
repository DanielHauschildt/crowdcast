# Reddit backtest sets

Real launch posts ("I built…", releases, Showoff Saturday) from r/SideProject, r/selfhosted, r/webdev and
r/programming, 2023–2026, with ≥ 6 comments and final scores from 0 to 1330. Fetched from
[Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md) (post by id plus the full
comment tree); the thread itself is cached under `threads/<id>/` (gitignored).

| File | Set | What |
|---|---|---|
| `threads.txt` | `train` | 22 threads |
| `holdout.txt` | `holdout` | 13 threads, never used while tuning |

Thread lists are numeric, so each line holds `parseInt(<base36 post id>, 36)`, then `subreddit=<name>`; the comment
keeps the base36 id, month, title, points and comments. The split uses the same `isHoldout(id)` hash as the HN sets.

```sh
pnpm crowdcast backtest --platform reddit --sample 2 --steps 2
pnpm crowdcast backtest --platform reddit --set holdout
```

`segments.yaml` is one general Reddit dev audience for every thread, and personas are generated once with the
default subreddit's prompts (r/SideProject); each thread's simulation, labels and recall then use its own subreddit.
r/startups is missing on purpose: it forbids product promotion, so it has no launch posts to compare against.
