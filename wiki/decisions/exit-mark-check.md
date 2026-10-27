---
type: decision
title: Check the exits with numbered marks
status: proposed
updated: 2026-10-28
checked: 386176c
sources:
  - owner:2026-10-27
  - owner:2026-10-28
  - src/hereout/reader.py
  - https://arxiv.org/abs/2310.11441
  - https://simonw.substack.com/p/metas-new-model-is-muse-spark-and
---
# Check the exits with numbered marks

## Context

- The model sometimes puts an exit outside the building. On PT-commons_000107, ten exits were on the pavement, about 80 px below the exit signs.
- The owner asked if research shows the best way to ask a model for a point (2026-10-27).
- No study compares 0 to 1000 coordinates with pixel coordinates on one model. Each model family uses the format of its training.
- The grounding tool of Muse Spark gives points and boxes in 0 to 1000 coordinates. One public test shows this; Meta gives no document. The prompt in `reader.py` uses the same format, so it stays.
- Set-of-Mark prompting draws numbered marks on the image. The model then names a mark and gives no coordinates. The paper shows a large gain on GPT-4V.

## Decision

- Local candidates do not work. A detector for green exit signs found all 16 signs on PT-commons_000107. On the 203 gallery plans, it found no candidate on 115 plans. Only 80 of 866 saved exits had a candidate near them.
- The test used the saved exits as the marks. A second call sees the marks and keeps, moves or drops each one. The call can also add an exit.
- The owner approved the model calls (2026-10-28). The test read 30 plans: PT-commons_000107 and 29 plans from a shuffle with seed 30.
- The test result, judged by eye on each overlay:

| Change | Plans |
|---|---|
| Keep, move and drop made the exits better | 15 |
| No clear change | 14 |
| Better and worse changes on one plan | 1 |
| Worse | 0 |

- The moves put exits from the pavement or the paper back on the building line. The drops removed exits in the legend and outside the plan.
- About half of the 58 added exits were wrong. They were on an arrow, on the paper, in the legend or on a stair with no exit. So the check must not add exits.
- The check is not in the product. The owner decides on it.

## Consequences

- PT-commons_000107: of 762 tap routes, 55 walked along the pavement with the old exits. With the checked exits, 3 did. The mean route length went from 451 px to 330 px.
- On the 29 plans with a "you are here" point, the route counts did not change.
- The check costs one more call for each plan, about 0.008 USD. The call can run at the same time as the zoomed "you are here" call.
- The moved PT exits are still about 30 px outside the building line. The check makes the error smaller but does not remove it.
