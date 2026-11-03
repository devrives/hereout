---
type: decision
title: "Exit accuracy tests of 2026-11-03: green snap, error prompt, crop check"
status: rejected
updated: 2026-11-03
checked: d547bea
sources:
  - owner:2026-11-03
  - src/hereout/exit_fix.py
  - src/hereout/reader.py
  - scripts/score_exits.py
---
# Exit accuracy tests of 2026-11-03: green snap, error prompt, crop check

## Context

- After judge review 8, the owner asked for more exit accuracy with Muse Spark, with a focus on the most common errors (2026-11-03).
- An agent sorted the false exits of the dev set and of the holdout run of 2026-11-01 by type, at a radius of 5 %.
- The largest type: the right exit, with the point beside it, a little outside the radius. That point is on the sign, in the stair or in the corridor in front of the door. It gave 39 of 57 false exits on the dev set and 17 of 55 on the holdout.
- Other types on the holdout: corridor direction signs (11), points off the building (9), passed stairs (7), one exit twice (6).
- The median distance from a point to its label is 0.045 of the long side of the floor box, so it is near the radius. The error has no steady direction, so a shift rule cannot help.

## Decision

Nothing ships. Three ideas were tested on the dev set. One went once to the holdout photos.

| Idea | Dev set, 5 % | Holdout, 5 % |
|---|---|---|
| Code: move a point onto the nearest green ink within 4 % of the long side, then drop a second exit within 2 % of the floor box | better on all 7 reads, for example precision 0.467 to 0.495 | precision and recall the same (0.47, 0.53); photos all right 6 to 5 |
| Muse Spark: a prompt line that names the error types | within the noise; recall at 10 % lower | not run |
| Muse Spark: a check call on numbered crops (exit, corridor sign, passed stair, outside) | it answered "outside" for 18 points, 11 of them within 10 % of a labelled exit; recall at 5 % fell from 0.386 to 0.311 | not run |

- The code rule moved 393 of the 826 gallery exits on 133 plans. It dropped 20 exits as repeats on 16 plans. Two changes looked wrong: it joined two exits on RU-commons_000213, and it kept a point near the legend on DE-commons_000013. With no gain on the holdout, this change is not worth the risk before the deadline.
- The model calls cost 1.71 USD on the local ledger. The API was slow that day, and some calls timed out.

## Consequences

- The holdout numbers in `products/hereout.yaml#holdout_accuracy` stay as they are.
- The patch of the code rule, the reads and the scores are in the hub folder `_workspace/hereout-exit-tests-2026-11-03/`. They are kept for a later test with more labelled photos.
