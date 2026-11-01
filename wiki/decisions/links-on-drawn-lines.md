---
type: decision
title: Links start on the drawn lines
status: accepted
updated: 2026-10-31
checked: 35290c2
sources:
  - owner:2026-10-31
  - src/hereout/web/route.js
  - tests/test_network.py
  - tests/schematize_check.js
  - tests/test_geometry.py
  - src/hereout/steps.py
  - src/hereout/web/app.js
---
# Links start on the drawn lines

## Context

- After the fourth round of the way lines, the owner said to go on (2026-10-31). The fourth round is in [Turn words from the main leg of a walk](step-turns-main-leg.md).
- A check of the lines alone found pieces of lines that share one open floor area. 12 of the 195 gallery plans had them, 13 pieces in all. The other pieces are on separate areas, for example two floors on one sheet.
- The links of [One network of way lines](connected-way-lines.md) grew from the cells of the ways of the tree. The drawn line cuts corners of its way (`squareUp`, `unstair`), so some of these cells are not under the line. A link that started there ended a few cells from the line (US-openverse_000113).
- Where the growths of two exits touched at once, the code drew no link. It took the two lines as one. But the cells that touched were often two exit doors side by side, with the lines apart. On DE-commons_000017 an exit mark next to another one had no line at all.
- A check of the routes alone found short side steps (jogs) in 816 of 2925 test routes. Most of them are jogs of the drawn lines. A jog stayed when the whole line on each side hit a wall when it moved onto the other line.

## Decision

- The tree keeps the exit of the line over each cell, from the cells under each drawn line (`lineOwner`, `cellsUnder`). Links grow from these cells and from the exit cells.
- Two cells side by side of two exits get a short link. The link goes on to the exit mark at each end, when that end is a door with no line.
- Two such doors of exits with no lines get the link only when other links join them to the lines. Else two exit marks in a small closed area got a short line between them (JP-commons_000374).
- Rejected: links that start only on the lines for an exit with lines. On RU-commons_000166 a corridor reaches the rest of the floor only through the door of an exit. Its link went, and the corridor became a piece of its own.
- Jogs: when neither line can move onto the other, both lines move to one place between them. The middle comes first, then steps of half a cell (`JOG_STEP`). The rules of a move stay: clear of walls, no more soft lines, `JOG_CLEAR` of the wall distance.
- The walk into an exit mark is not a jog. The ux review found a line that moved off the route at an exit (DE-web_more_000051). The route keeps its last piece, so the line keeps it too.
- Steps: a walk with a side step splits where the side step starts. The words then give each side step in its place: "Step right, then keep going straight for a medium way."
- The split point is the last point from which the walk still goes more than `SIDE_STEP_SHARE` of the plan to that side. So two small jogs to one side are one side step. A split before the first jog left both parts under the limit, with no words for the side step (fourth ux and a11y reviews).
- A walk that goes to one side and comes back splits where it is farthest out. Both side steps get words.
- A side step at the start of the first walk: "Move over toward the left of the plan, then start toward the bottom of the plan and walk a medium way." At the start of a turn walk: "Turn left, step left, then walk a medium way."
- Why: the a11y review found side steps on the map that the words left out. The lines moved, and a side step went into a turn step. Detours round a wall in a straight walk were not in the words before this round.
- Rejected: a clause at the end of the walk ("with a step right on the way", then "moving over to your right partway"). The ux review found two frames in one sentence and the noun "step" read as a stair. In 61 of 118 first steps the move came at the start, not partway.
- Arrow heads: no head nearer than 4 head sizes to another head. A head that is too near slides along its line. A line of 5 plan units or more keeps one head. No head is nearer than 8 plan units to the start. The ux review found two heads that made one shape at a link split. It also found an arrow beside YOU that pointed away from the route.
- The step number goes above, below, right or left of its leg, at the first place that covers neither YOU nor an exit mark. With no such place, step 1 has no number. Since 2026-11-01, a numbered dot at the start of each step replaces this number: see [The current step under the plan](current-step-card.md). After an exit button, the old step selection goes before the plan is drawn. Smooth scrolls follow the setting for less motion (a11y review).

## Consequences

- On the 195 gallery plans, against the fourth round:

| Measure | Before | After |
|---|---|---|
| Pieces | 270 | 258 |
| Pieces that share one floor area | 13 | 2 |
| Bends away from exit marks | 3043 | 2966 |
| Jogs away from exit marks | 523 | 480 |
| Bends at exit marks | 1024 | 1279 |
| Jogs at exit marks | 331 | 490 |
| Dead ends | 1569 | 1562 |
| Lines on soft ink | 1165 | 1164 |
| Route share on lines | 0.8025 | 0.8098 |

- At an exit mark: nearer than 1.5 times the half size of the mark. The square of the mark covers these steps.
- On 3757 routes (to the nearest exit and to the first exits), the steps go from 15082 to 15592. "Step left" or "Step right" steps go from 318 to 570, and 389 first steps start with "Move over". Two plain "Keep going straight" steps in a row: 11, as before. Python and JS give the same words on all of them.
- A test walker turns only by the words. It is more than 60 degrees off on 1 of 2925 routes, before 2.
- No plan changed its exits or the floor that reaches an exit.
- The 2 pieces left are on plans with a wing (DE-commons_000024, IT-web_more_000013). The joins at the wing edge do not reach them.
- Short side steps in 2925 test routes: 1213 to 1194. Most jogs that stay are real: a door jamb on one side of a corridor and a wall on the other.
- On US-openverse_000113 the line goes through a row of shops, as before. The walls of the shop fronts are not found.
- Open: a route can end in two or three short steps of a few units into an exit (RU-commons_000140, Exit 2). A route can start with a short move back from its first heading (HK-commons_more_000020).
- Open: a route to an exit that is not the nearest can run beside a line near the exit (DE-web_more_000051 Exit 8). The lines keep the walk into the nearest exits.
