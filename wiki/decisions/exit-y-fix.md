---
type: decision
title: Move the low exits of the main call up a little
status: accepted
updated: 2026-11-01
checked: 8b9768a
sources:
  - owner:2026-11-01
  - src/hereout/exit_fix.py
  - src/hereout/reader.py
  - src/hereout/pipeline.py
  - scripts/score_exits.py
  - tests/test_exit_fix.py
---
# Move the low exits of the main call up a little

## Context

- The exit scores on the 28 holdout photos were low: precision 0.42 and recall 0.52 at a radius of 5 % ([Judge review 2](judge-round-2.md)).
- The holdout is the test set. So an agent made a separate dev set: 30 gallery plans, picked at random by country (seed 20261101).
- Three agents (Claude) labelled the dev plans by eye, before they opened any reading. They found 132 sure and 14 unsure exits. One plan is an aerial map and cannot be judged.

## Decision

- Many false exits of the dev set were the right exit, but 5 to 10 % too low. The error grew toward the bottom of the image, in all four reads.
- `exit_fix.py` moves the y of each main-call exit below the middle of the image up by 10 % of its distance below the middle. Points in the upper half and all x values do not move.
- The fix runs in `read_plan`, before the second look. A saved gallery reading keeps its points.
- Each fixed exit keeps the point of the model. The card "What Muse Spark read" shows that point, and the fix as a move by HereOut.
- The legend check and the text-block check also look at the point of the model. Without this, 4 false exits on 203 plans moved out of a text panel and stayed.
- A version that also moved the upper half pushed upper exits away from the route marks. A fix of the floor box was a little worse on the labels.
- A merge of close exits never helped on the dev set. At 3 % it deleted correct exits.
- A new prompt (door opening, one point for each exit, no direction signs) scored within the noise between two reads with the current prompt. It did not ship.

## Consequences

- Dev set, four reads together, precision and recall at 5 %: 0.357 and 0.348 before, 0.391 and 0.383 after. At 10 %: 0.680 and 0.648 before, 0.706 and 0.674 after.
- The fix was better on both random halves of the dev set, and no read got worse.
- Most of the remaining errors are where exactly to point (the sign or the door) and direction signs along a corridor. No rule without a model call fixed them.
- The agent spent 0.592 USD on dev reads.
