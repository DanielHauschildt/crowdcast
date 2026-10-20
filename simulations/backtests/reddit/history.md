# Backtest history

| Stamp | Steps | Seed | Completed | Recall [90%] | TV [90%] | Spearman | Comment ratio | Sentiment gap | Note | Comment ratio geo. [90%] | Set | n |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 20261020-1731 | 2 | 1 | 2 | 50% [20%–80%] | 0.44 [0.40–0.48] | – | 1.71 | -0.50 | 2 threads | 1.62 [1.17–2.25] | train | 2 |
| 20261020-1912 | 8 | 7 | 1 | – | – | – | – | – | baseline: no change (sample 8 seed 7, first 3 by hand). Not scored: 2 of 3 runs hit max-calls 150 by step 5 (top5 by step 0–1, 87 and 112 points at 2.5 h vs real 15 and 125 final); post down/up 0.9, 0.0, 0.03 | – | train | 3 |
| 20261020-1928 | 8 | 7 | 3 | 27% [20%–33%] | 0.59 [0.53–0.65] | 1.00 | 2.56 | -0.31 | round 1: hot bands 2.0/1.3/0.6, visitor fractions halved | 2.36 [2.01–2.77] | train | 3 |
| 20261020-1940 | 8 | 7 | 3 | 20% [20%–20%] | 0.60 [0.50–0.71] | 1.00 | 1.33 | -0.32 | round 2: agent rules and voter prompt: most readers give no vote, downvote ads, ~1 in 10 votes down | 0.99 [0.69–1.40] | train | 3 |
| 20261020-1949 | 8 | 7 | 3 | 47% [20%–73%] | 0.58 [0.48–0.68] | 1.00 | 3.17 | -0.98 | holdout: final state (rounds 1+2) | 2.15 [1.30–3.54] | holdout | 3 |
