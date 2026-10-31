---
type: decision
title: Faded ends of walls are walls
status: accepted
updated: 2026-10-31
checked: a7531a9
sources:
  - owner:2026-10-30
  - owner:2026-10-31
  - src/hereout/ink_walls.py
  - src/hereout/pipeline.py
  - src/hereout/route.py
  - tests/test_ink_walls.py
---
# Faded ends of walls are walls

## Context

- The owner asked for way lines that are clean and easy to follow, with a check after each change (2026-10-30). After the first round, the owner said to continue (2026-10-31). The first round is in [Clean way lines](clean-way-lines.md).
- On JP-commons_000066 the way lines crossed the thin partitions of the offices. The photo shows each partition dark in its middle and in broken dashes at its ends. Only the dark middle was a wall. The dashes stayed soft lines, and the lines went through them.
- IE-commons_000146 had the same fault: a line went through the soft end of a partition into the next hotel room.
- In 2026-10-30 a rule of short wall pieces at wall ends failed, because it closed doors. See [Inner walls much thinner than the outer walls](inner-wall-width.md).

## Decision

- `faded_ends` follows each straight wall past its end, along its line, through ink with small gaps. That ink becomes wall.
- A gap wider than 3 strokes, or wider than 0.8 % of the image, is a door. The walk stops there.
- These stay soft:
  - ink that joins the wall to another long wall (a sill across a door, AU-commons_000077);
  - a dashed line that is not in the line of a wall;
  - a faded end that cuts an open area in two. The check uses the grid of the routes, with 4 neighbours. A gap that is open in pixels can be shut in the grid (CN-commons_more_000022).
- `ink_walls` adds the faded ends last, after the outline, the outside areas and the doors. When the walls of the outline got the faded ends, large areas inside became outside (AU-commons_000077 lost 35 % of its floor).
- The wall axes and the wing come from the walls without the faded ends (`Plan.faded`, `grid_payload`). With the faded ends, 26 gallery plans got other axes, and their lines changed shape.

## Consequences

- On the 195 gallery plans, against the round 1 code:

| Measure | Before | After |
|---|---|---|
| Lines on soft ink | 1182 | 1165 |
| Bends | 4032 | 4047 |
| Jogs | 851 | 849 |
| Dead ends | 1561 | 1576 |
| Hooks | 43 | 49 |
| Pieces | 273 | 273 |
| Route share on lines | 0.804 | 0.803 |

- No plan changed its exits or its axes. No plan lost 5 % of the floor that reaches an exit. 13 small areas lost their way. The checked ones are the inside of thick or double walls and the bottom of a tunnel section, not floor.
- The ground truth of the 7 review plans did not change: floor 1.000, leak 0.105, walls 9 of 11.
- The lines no longer cross the partitions of JP-commons_000066 and IE-commons_000146. Each office of JP-commons_000066 gets a straight line from its door.
- Room 150 of IE-commons_000146 has no way out now. Its door had a closed sill before this change, and its only way was the gap at the partition end.
- Open: on RU-commons_000260 the printed green route lines are soft ink. Their colour is weak and they join the walls, so a colour rule does not find them.
