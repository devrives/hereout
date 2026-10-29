---
type: decision
title: Draw the ways out as one tree of level and upright lines
status: proposed
updated: 2026-10-29
checked: 6920028
sources:
  - owner:2026-10-29
  - commit:6920028
---
# Draw the ways out as one tree of level and upright lines

## Context

- On 2026-10-29 the owner looked at the blind A/B page of 14 plans. The owner found both sides bad ("a total mess").
- The owner said that most buildings have almost no diagonal ways. The lines must be straight, with right angles, and they must join. The lines on the page did neither.
- The door-to-door network of [Show the ways out as straight lines from door to door](way-network.md) joins nodes with straight lines at any angle. It leaves out the lines of rooms with one door, so the map shows loose pieces.

## Decision

- Branch `ortho-net` (from `ink-walls`, commit 6920028) holds the change. It is not on main.
- `route.py` finds the two main wall directions with Hough lines on the wall edges, and sends them with the grid. A photo taken at an angle can tilt the two directions by different amounts.
- The network samples the grid again along these two directions. A move to the next cell is made only when its line on the grid is clear of walls.
- The tree grows from the exits in four directions. Each turn costs 8 cells of way, and cells near a wall cost more. So a line runs down the middle of a corridor and turns at a right angle.
- The middle of each room joins the tree, the nearest first. A cell of the tree costs 0.6 of its way to the exit, so a new line meets the old lines at a T.
- A short hook at the room end is not drawn. Where the lines to two exits come close, a straight bridge joins them.
- A route from a tap goes the same way to the tree, then along the tree to its exit.

## Consequences

- On the 14 plans of the A/B page, all lines are level or upright in the frame of the plan. No line crosses a hard wall.
- A route from a tap is level and upright too. The tests check both.
- Errors of the walls stay. Lines go outside the building where the outline is open (PT-commons_000107, JP-commons_000365). On RU-commons_000346 the walls close most rooms, so it has almost no lines.
- The owner gets a page of the 14 plans at `/review/`: the current service next to the new lines. The decision waits for the result.
