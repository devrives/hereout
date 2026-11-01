---
type: decision
title: "Judge review 3: far zoom points on route marks, wall lines off the building, staircase walks"
status: accepted
updated: 2026-11-02
checked: 1fa7335
sources:
  - owner:2026-11-01
  - src/hereout/reader.py
  - scripts/far_points.py
  - src/hereout/web/route.js
  - src/hereout/web/app.js
  - src/hereout/web/reading.js
  - src/hereout/steps.py
  - scripts/score_exits.py
---
# Judge review 3: far zoom points on route marks, wall lines off the building, staircase walks

## Context

- The third judge agent (2026-11-01) gave 6.4 of 10 ([Judge review 2](judge-round-2.md)). Its list had five changes.
- The owner chose a motion graphic for the video ([Demo video](demo-video.md)). The owner agreed to items 1, 2 and 5 after the video (2026-11-01).
- Item 1: the 7 % move limit of the second look refused correct points. Item 2: exits off the paper. Item 5: wall pieces outside the building in "Routes only", and runs of short turns in the steps.

## Decision

- Item 1: HereOut uses a second-look point past the 7 % limit when two things hold. A green or red mark is within 1.5 % of the long side, and the point is inside the floor box. The first point failed that mark test.
- `scripts/far_points.py` applies the same rule to the saved gallery readings. It rebuilds the crops from the saved first points, so it makes no model call.
- Item 2 did not ship. A floor-box margin, a paper mask, the sheet edges and the building outline each moved or dropped correct exits on the dev set.
- Item 5, walls: "Routes only" draws a wall line only near floor with a way out, inside the outline of those lines, or in a long group.
- Item 5, steps: a staircase of short right angles on a diagonal is one walk. The rule looks at runs of legs, and the smaller way must be 0.35 of the two or more.
- The route choice on the drawn lines counts slight turns without the staircase rule, so no route point changes.

## Consequences

- Item 1 on the dev set: precision 0.458 to 0.472 and recall 0.371 to 0.386 at 5 %. At 10 %: 0.757 to 0.778 and 0.614 to 0.636. No dev plan got worse.
- Item 1 on the gallery: 45 of 60 refused points pass, 34 plans change, and no exit goes. Two of the 45 got worse (HK-commons_more_000027, JP-commons_000374).
- RU-commons_000033 Exit 3 moves from the stone under the sheet to the door. On PT-commons_000107, six exits move from the pavement to the exit signs.
- Walls: 167 of 11373 lines go on 79 plans, mostly legends, text panels and frames. A few real wall pieces also go, for example on FR-web_more_000047.
- Steps: on 2926 routes of 195 plans, 22 routes on 8 plans get new steps and no route point changes. The checks found none worse.
