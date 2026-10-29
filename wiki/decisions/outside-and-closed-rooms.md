---
type: decision
title: Close the outside of the building and give closed rooms a door
status: proposed
updated: 2026-10-29
checked: 985375d
sources:
  - owner:2026-10-29
  - commit:78dcaca
  - commit:8ce3579
  - commit:985375d
---
# Close the outside of the building and give closed rooms a door

## Context

- The second round of the way lines left wall errors (see [Draw the ways out as one tree of level and upright lines](orthogonal-way-tree.md)). Lines went outside the building on PT-commons_000107 and JP-commons_000365. On RU-commons_000346 the walls closed most rooms.
- The model put exits on a text panel (FR-web_more_000054) and in a legend with no frame (RU-commons_000346).
- On 2026-10-29 the owner asked to fix all open problems with code, as far as code can, with no model call.

## Decision

All changes are on branch `ortho-net`, in `ink_walls.py`. They make no model call.

- Grey fills: an area much darker than the paper around it, and wider than a line, is a wall (a track bed, a shaft). A green tint is a printed route band, not a fill. A thin paper gap between two fills closes. A plan has no fills when most exits stand on the dark tone. It also has none when the fills cover more than half of the open plan. In both cases the dark tone is the floor.
- Areas beyond the exits: an exit is a door in the outer wall. Its outer side is the side nearer to the edge of the drawing. An area that more exits have on their outer side than on their inner side is outside. Examples are a pavement, a street or a canopy. An exit votes only when its inner side is the larger area.
- Areas at the edge: an open area is outside when a quarter of its border touches the edge of the plan, with no line between. An area that touches an exit stays.
- Exits: the code drops an exit that is farther than a tenth of the image from every plan on the sheet. An exit on an area outside the building moves to the nearest open point of the building. It also drops a lone exit on a small separate shape: that shape is a text panel. At least one exit stays.
- Closed rooms: a room that no exit reaches gets a cut through its thinnest wall to an area that an exit reaches. A thin strip is not a room and gets no cut.
- A wing at an angle: `route.py` finds a second wall tilt and the cells where it leads. The browser makes a second way network along that tilt and uses its lines in the wing. See [Draw the ways out as one tree of level and upright lines](orthogonal-way-tree.md).

## Consequences

- On the ground truth of 7 plans: the share of floor points with a way out went from 0.918 to 0.98. The share of points off the floor with a way went from 0.319 to 0.105. The wall pair score stayed at 0.861.
- On 38 plans: the share of open floor with a way out went from 0.837 to 0.937. Plans under half went from 4 to 0, and plans under 0.8 from 9 to 2.
- No line crosses a hard wall, before or after.
- KR-commons_more_000036 is a photo map from the air. No test of texture, colour or wall shape separates it from a drawing, so its lines stay wrong. The model can name the kind of plan in its one read call; that needs a prompt test with a cost.
- The new steps add time to the wall step. The door arc search stays the slowest part.
- The owner gets a page of 15 plans at `/review/`: the lines of the second round next to the third. The decision waits for the result.

## Gallery check

- The owner asked for a check on new plans (2026-10-29). The code ran on the other 165 gallery plans with their saved readings. It made no model call.
- The share of open floor with a way out had a mean of 0.931 and a median of 0.97. No line crossed a hard wall. One plan was under half.
- The code dropped 2 of 723 exits. One drop was wrong: the stair exit of DE-commons_000008 sat on the middle of a round hall, a separate small shape. Commit 985375d drops a lone exit only when its shape is outside the bounds of the main drawing.
- A visual check of all 165 plans found these weak types:
  - photo maps from the air (7 tsunami maps of KR and US);
  - sheets with many floors, where lines show on few floors;
  - thin-line station diagrams, with few lines;
  - plans where lines go onto a street, a garden or a pitch;
  - exits that the model put on the margin of the sheet.
- Commit 8ce3579 finds the points of each skeleton branch in one pass. The door arcs stay the same. The wall step took 2.6 to 8.9 seconds on 10 plans, before 11 to 70 seconds.

## Causes of the weak types

- Sheets with many floors and thin-line station diagrams: the gallery readings are from 2026-10-27. The read rule for every level came on 2026-10-28 (see [Check the exits with numbered marks](exit-mark-check.md)). In these readings only one floor has exits, so the other floors get no lines. A new photo gets the rule. A new read of the gallery plans costs money, so it waits for the owner.
- Yards and streets inside a site outline: the area between the building and the site line joins the building through its doors. The thickness of the border does not separate a yard from a room: on US-commons_000225 the site line is thick too. No rule is in place.

