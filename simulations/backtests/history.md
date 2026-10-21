# Backtest history

| Stamp | Steps | Seed | Completed | Recall [90%] | TV [90%] | Spearman | Comment ratio | Sentiment gap | Note | Comment ratio geo. [90%] | Set | n |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 20261004-0516 | 2 | 1 | 1 | 0% | 1.00 | – | 0.00 | – | smoke: 1 thread, 2 steps | – | train | 1 |
| 20261004-0519 | 6 | 1 | 15 | 13% | 0.59 | 0.72 | 0.09 | -0.91 | baseline (calibrated votes, founder fixes, flamewar) | – | train | 15 |
| 20261004-0621 | 6 | 1 | 15 | 19% | 0.67 | 0.79 | 0.13 | -0.42 | round 1: visibility new .3/.12 page2 .4 top30 .75 + tone baseline | – | train | 15 |
| 20261004-0737 | 6 | 2 | 10 | 28% | 0.46 | 0.81 | 0.51 | -0.25 | round 2: 100 active personas (seed 2, fresh persona set) | – | train | 10 |
| 20261004-0940 | 6 | 2 | 5 | 32% | 0.60 | 0.90 | 4.22 | -0.71 | round 2 completion: 5 threads cut off by session limit | – | train | 5 |
| 20261004-round2-combined | 6 | 2 | 15 | 29% | 0.51 | 0.77 | 0.69 | -0.40 | round 2 combined: 0737 (10 ok) + 0940 (5 rerun) | – | train | 15 |
| 20261020-1913 | 6 | 7 | 2 | 0% [0%–0%] | 0.53 [0.45–0.62] | – | 11.29 | -0.90 | baseline: integration 805f08e (sample 10 seed 7, first 5) | 7.75 [3.08–19.50] | train | 5 |
| 20261020-1933 | 6 | 7 | 5 | 16% [4%–28%] | 0.60 [0.55–0.68] | 0.10 | 1.50 | -0.27 | round 1: HN visitor fractions x0.4 (top10 .4, top30 .3, page2 .16, new .12/.05) | 1.94 [0.63–5.75] | train | 5 |
| 20261020-1948 | 6 | 7 | 5 | 8% [0%–24%] | 0.77 [0.65–0.91] | 0.15 | 2.22 | 0.07 | holdout: final state after round 1 (fractions x0.4) | 1.34 [0.48–3.06] | holdout | 5 |
| 20261021-2120 | 6 | 7 | 4 (1 skipped) | 20% [10%–30%] | 0.67 [0.50–0.84] | -0.63 | 0.54 | -0.08 | round 2 (rejected, reverted): timeline fit, new .06/.02 page2 .12; big thread never left new, Spearman -0.63 | 0.43 [0.09–1.44] | train | 5 |
