---
type: decision
title: Draw the ways out as one tree of level and upright lines
status: proposed
updated: 2026-10-30
checked: 6913303
sources:
  - owner:2026-10-29
  - commit:6920028
  - commit:828f6e4
  - commit:78dcaca
  - commit:bb987a5
  - commit:6913303
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

## Second round

- The owner asked for more refinement (2026-10-29). Commit 828f6e4 on `ortho-net` holds these changes:
  - A line that serves only one room stops a short way into the room, as the stub at a door of a printed plan.
  - A turn costs 30 cells of way, and a tree cell costs 0.25 of its way to the exit.
  - Corners between two joins become one straight line or one right angle when that has fewer turns and stays as far from the walls.
  - A staircase of four or more short legs becomes one straight line when that line is clear. This is the way along a wing at an angle.
  - The two main directions differ by 10 degrees at most. The direction with more wall edges leads.
- On 38 plans the small steps went from 156 to 47, and the turns from 602 to 377. No line crosses a hard wall.
- A wing at an angle (CN-commons_000279) still has stubs on the main directions. The wall errors of the first round stay.

## Third round

- The owner asked to fix all open problems with code (2026-10-29). Commit 78dcaca on `ortho-net` holds the changes. The wall changes are in [Close the outside of the building and give closed rooms a door](outside-and-closed-rooms.md).
- A wing at an angle: `route.py` finds a second wall tilt when walls agree on it in both square directions. The tilt must be at least 10 degrees from the main walls, and the wing must cover a tenth of the grid. Each cell goes with the tilt of its nearest wall edge.
- The browser makes a second network along the wing tilt. The map shows its lines inside the wing and the main lines outside it. A short line joins the cut ends at the edge of the wing.
- On 38 plans, only CN-commons_000279 has a wing. Its corridor is now one straight slanted line, with stubs at right angles to it.
- A staircase becomes one slanted line only when the line is long. Two short slanted lines in rooms of DE-commons_000012 went back to steps.
- The page did not send the wall directions to the network worker. The commit fixes that, so the browser draws the lines along the walls as the tests do.

## Start points of the lines

- The owner found the third round better on most plans (2026-10-29). The owner asked where the lines must start: inside a toilet, in each room, or on ways that all join. The owner said to fix this before the map uses the position of the user.
- A printed plan draws the shared ways (corridors, halls). It draws no line inside a toilet, a store or an office.
- Commit bb987a5 on `ortho-net`: a room under 3 percent of the open floor has no line of its own. Its door joins the line outside it. The way from its door shows only when it is long, as at the far end of a corridor.
- A hall or a lobby (3 percent of the open floor or more) keeps a short line into the room.
- A route from a tap still starts at the tap, also inside a small room. It goes out of the door to the line, then to the exit.
- On 38 plans the legs went from 2252 to 1768. No line crosses a hard wall.

## Position of the user

- The owner asked for the position of the user after the start points of the lines (2026-10-29). Commit 6913303 on `ortho-net` holds the change.
- A tap starts the route at the tap, also inside a small room. The route goes out by the door to the nearest line, then along the line to the exit.
- The first exit is the nearest exit by the cost of the way. A second exit shows as a dashed line, in case the first exit is blocked. Its way may not pass the door of the first exit. An exit at that door is the same door. The solid route is never the longer one.
- When no other exit keeps clear of that door, the page shows no second exit. After a swap of the two routes, the check runs again for the new first exit. Before 2026-10-30, the page showed the first other exit in this case. A fact check found dashed lines next to the blocked exit in 5 of 244 test routes.
- The status line, a line under the steps with a button, and the spoken steps name the second exit. A user who does not see the plan gets it from the text.
- Filled arrow heads on the lines of the map point to the exits. No arrow shows near a drawn route, because a route to a chosen exit can run against them.
- On a plan with a wing at an angle, a route follows the walls of each part that it crosses. On CN-commons_000279 the share of route length along the walls went from 0.85 to 0.95.
- The ux and a11y reviews of the first version found these problems:
  - arrows too small on a phone;
  - a hidden number of the second exit;
  - a dashed route shorter than the solid one;
  - a zigzag in the wing, and arrows against the route;
  - text out of view.
- The commit fixes all of them. The page goes to a new review before the deploy.

