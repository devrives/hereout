---
type: decision
title: Turn words from the main leg of a walk
status: accepted
updated: 2026-10-31
checked: 0425008
sources:
  - owner:2026-10-31
  - src/hereout/steps.py
  - src/hereout/web/route.js
  - src/hereout/route.py
  - src/hereout/web/app.js
  - tests/test_geometry.py
---
# Turn words from the main leg of a walk

## Context

- After the third round of the way lines, the owner said to go on (2026-10-31). The earlier rounds are in [Clean way lines](clean-way-lines.md), [Faded ends of walls are walls](faded-wall-ends.md) and [A walk outside from an exit mark to its door](exit-walk-outside.md).
- A rank of the gallery plans by faults for each length of line showed large steps on slanted corridors: RU-commons_000206, RU-commons_000230, HK-commons_000095 and JP-commons_000383.
- 87 of 203 gallery plans have more than 0.12 of their wall length off the main directions and no wing. `wall_wing` found no wing on them, because a slanted corridor has long walls along its tilt and few walls square to it.
- The a11y review of a try found an old fault in the steps. The steps called a short side step between two right angles a slight turn. The steps join short legs into one walk, and the straight line of that walk was at a slant.

## Decision

- The steps take the heading of each walk from its main way. Legs within 10 degrees of each other go the same way, and their lengths add up.
- When the legs of one way are 0.6 of the walk or more, the walk takes the heading of the longest of them. Else the walk starts on its first leg of a way with 0.35 of the walk, and ends on its last one. With no such way, it takes the heading of the straight line, as before.
- The turn word compares the start of a walk with the end of the walk before it. The second a11y review found square corners after a side step of two equal legs that the words called slight or a turn back.
- When two of these ways make a turn, the walk splits into two steps where the second way starts. The third a11y review found L-shaped walks whose inner turn the words left out, so a walker went the wrong way.
- A straight walk that ends more than 0.02 of the plan to one side of its start line names the side step: "Step right, then keep going straight". A turn back names it too. The ux and a11y reviews found side steps round a wall that the words called straight.
- The highlight of a selected step follows the points of its route, not the straight line from its start to its end. Its number goes at the middle of its longest leg, off the side step.
- `steps.py` and `web/route.js` do the same.
- The map of a wing can have a cut line end with no other cut end near. A short line now joins it to the nearest line of another piece (`mergeWing`). A join inside one piece made a small loop (ux review).
- Rejected: a wing for a slanted corridor, in these forms:
  - a wider staircase rule in `unstair`. It changed one plan. The tree breaks a slanted corridor at its joins, and the straight lines hit the walls.
  - a wing without walls square to the tilt. 30 more plans got a wing, and the joins at the wing edge made more pieces (111 to 138 on those plans). The lines of US-commons_000225 went at a slant through square rooms.
  - that wing kept only when its lines make the map simpler (no more pieces, fewer corners, the floor near a line kept). The lines of HK-commons_000095 and CN-commons_000097 got better. But their routes ran on the drawn lines for less of their length (0.92 to 0.70, 0.72 to 0.57). CN-commons_000097 got 4 more slight turns at right angles.
  - the same check on the 5 wings that `wall_wing` found before. IT-web_more_000013 got connected lines, but its 15 test routes went from 32 to 66 steps.

## Consequences

- On 2925 test routes of the 195 gallery plans (15 taps on each plan), the steps name 38 slight turns, before 292. 220 steps name a side step. The route points do not change. The steps go from 7225 to 7548.
- A test walker turns only by the words. It is more than 60 degrees off the main way of a walk on 2 routes, before 22.
- A check of each turn word against the route corners near it finds slight turns at a right angle: 3, before 71.
- Python and JS give the same words on all 2925 routes.
- DE-commons_000024 and IT-web_more_000013 have 2 pieces of lines, before 3. Against the third round, the gallery has pieces 272 to 270, bends 4066 to 4067, jogs 855 to 854 and dead ends 1570 to 1569. The routes run on the lines for 0.802 of their length, as before.
- Open: slanted corridors still get steps of lines (RU-commons_000206, RU-commons_000230). A fix must keep the routes on the lines and the turn words right.
- The next round, on pieces of lines and jogs: [Links start on the drawn lines](links-on-drawn-lines.md).
- Open: a walk with no way of 0.35 of its length (a fine staircase) still takes the heading of its straight line.
