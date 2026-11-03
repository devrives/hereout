---
type: decision
title: "Judge review 8: step dips, lines past exits, marks, hints, labels"
status: accepted
updated: 2026-11-03
checked: d547bea
sources:
  - owner:2026-11-03
  - src/hereout/web/route.js
  - src/hereout/steps.py
  - src/hereout/web/app.js
  - src/hereout/web/reading.js
  - src/hereout/translate.py
  - src/hereout/app.py
  - DESIGN.md
  - README.md
  - LICENSE
---
# Judge review 8: step dips, lines past exits, marks, hints, labels

## Context

- A judge agent scored the site of 2026-11-03 at 6.8 of 10, with the repository taken as public. The owner told the agent to fix every item with sub agents (2026-11-03).
- On RU-commons_000164 a tap in the middle gave 6 short walks round one column.
- On DE-commons_000022 a way line ran past Exit 2 into the blank paper outside the wall.
- A mark of an exit on blank paper, which the code reads as wall, removed every exit of the model.
- The ring round the exit of the last step hid the last short leg.
- On a phone the reading hint said "press Enter", and it said "route" with no route.
- A German label such as "Notausgang NE" stayed German in English.

## Decision

- A dip or a jog that comes back within 5 % of the plan (`DIP_SHARE`) is no step (`undip` in `route.js` and `steps.py`). An offset that stays is still a side step. This replaces the earlier rule that named a dip aside and back.
- A straightened line does not cross more soft lines than the steps it replaces.
- A wall can split the cells of an exit into pieces. Lines that reach the exit through a piece with at most half the flow of the main piece are not drawn (`pastSeeds`, `PAST_FLOW`). Routes do not change.
- A mark on a wall is refused before it replaces the exits. The exits stay, and marking goes on.
- The ring of the last step goes under the route line. The exit box stays over the route.
- Touch screens get a hint with no key. With no route, the hint says "plan".
- A Latin label on a plan that is not in English asks for an English name. A label with an English exit word does not (`needs_english`).
- The code has the MIT licence. The README links the sample run of all 203 photos through the photo button.
- Not fixed: the route across the grey walls of GR-commons_000104 and the lines on the roofs of DE-commons_000020. Both come from the wall reading in `ink_walls.py`. A change there is too wide before the deadline.

## Consequences

- On 12483 taps on the gallery plans, walk steps fell from 10411 to 9730. No route was lost and no exit changed.
- 16 of 3691 routes changed their line (the soft-line rule), with no new hard-wall crossing.
- About 25 gallery labels get one translation call on the live server, then the cache serves them.
- Known limit (ux review): a walk can bend round an obstacle with no word for the bend. On RU-commons_000164 the jog is 23 % of its walk. A step text that names the bend needs new words in 13 languages, so it waits.
- While marking, the marker line and the line under the plan say when a mark there is refused (ux review).
