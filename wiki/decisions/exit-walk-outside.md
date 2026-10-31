---
type: decision
title: A walk outside from an exit mark to its door
status: accepted
updated: 2026-10-31
checked: b9da45a
sources:
  - owner:2026-10-31
  - src/hereout/ink_walls.py
  - tests/test_ink_walls.py
---
# A walk outside from an exit mark to its door

## Context

- After the second round of the way lines, the owner said to go on with the improvements and not to ask (2026-10-31). The first rounds are in [Clean way lines](clean-way-lines.md) and [Faded ends of walls are walls](faded-wall-ends.md).
- A count of open areas with no way out found 395 areas on 119 of the gallery plans. Most of them are legends, text panels and seats. The real floor among them has two causes:
  - an exit mark on the street, away from its door;
  - a room with no door gap in the drawing.
- 38 exits on 27 plans were on a small island of paper: no large open area reached them. Often the mark is at the head of an arrow outside the building (DE-commons_000231, IT-web_more_000048). The island is the open circle round the mark ([Close the outside of the building and give closed rooms a door](outside-and-closed-rooms.md)). The cut of `exit_doors` reaches only 6 % of the image.

## Decision

- `outdoor_ways` makes a narrow way over the paper outside the building. It starts round each exit that no large open area reaches, and goes to the nearest large open area. It runs after `exit_doors` and before `room_doors`.
- The way never crosses a drawn line, hard or soft. So it goes round an arrow and in through a gap of the outer wall.
- These walks are refused:
  - a walk longer than 2 times the straight distance to the building, plus the open circle of the exit. A walk round the building to another door is no way to this exit (AQ-openverse_000033, CN-commons_000098);
  - a walk longer than 0.25 of the image;
  - a walk past an exit that reaches the building, or a walk that ends near one. Such a walk ends outside at that exit (SE-commons_000314).
- The way opens only the outside paper. It never removes ink.
- Rejected: the grey edges of printed coloured routes taken out of the walls. On US-openverse_000109 the edges of a red route closed a corridor, and the rule opened it. But on JP-commons_000356 a red route runs along a wall, and its edge is that wall. The rule lost a passage there, and opened an outside area on JP-commons_000369.

## Consequences

- Island exits on the gallery: 38 before, 32 after. The pictures show a way along the arrow to the exit on DE-commons_000231, IT-web_more_000048, US-openverse_000113 and RU-commons_000303.
- On the 195 gallery plans, against the code of the second round:

| Measure | Before | After |
|---|---|---|
| Lines on soft ink | 1165 | 1165 |
| Bends | 4047 | 4066 |
| Jogs | 849 | 855 |
| Dead ends | 1576 | 1570 |
| Hooks | 49 | 48 |
| Pieces | 273 | 272 |
| Route share on lines | 0.803 | 0.802 |

- No plan changed its exits. No area lost its way to an exit. The ground truth of the 7 review plans did not change: floor 1.000, leak 0.105, walls 9 of 11.
- On CN-commons_000097 the way to the escalator exit goes on the paper beside the escalator. The line on the corridor to the escalator is not drawn now.
- Open: on US-openverse_000109 a printed red route closes a corridor, and the rooms behind it have no way out.
