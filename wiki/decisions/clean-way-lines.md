---
type: decision
title: "Clean way lines: no jogs, closed gaps, routes on the lines"
status: accepted
updated: 2026-10-30
checked: 171c2fc
sources:
  - owner:2026-10-30
  - src/hereout/web/route.js
  - tests/test_network.py
  - tests/schematize_check.js
  - src/hereout/web/app.js
---
# Clean way lines: no jogs, closed gaps, routes on the lines

## Context

- On 2026-10-30 the owner asked for a check of the way lines alone: are they connected, clean and easy to follow? The check must repeat after each change.
- The check draws the lines of each gallery plan without the photo, with the walls in light grey. A script counts these faults on 195 plans:
  - jogs: a short side step between two parallel lines;
  - bends, dead ends, and hooks (a dead end that turns back);
  - separate pieces of lines;
  - the share of route length on the drawn lines, for 15 taps on each plan.
- The first count: 1320 jogs, 4905 bends, 1747 dead ends, 56 hooks and 278 pieces. Routes ran on the lines for 0.809 of their length.
- The pictures showed three faults. Two or three parallel lines met one line a cell or two apart. A slanted corridor got a staircase of small steps. A link ended a cell short of a line after the line became slanted.

## Decision

- The map lines get a last step in the frame of the network (`schematize`). The tree and the costs do not change.
- Jogs: a side step shorter than 2.5 % of the frame goes. The whole straight line on one side moves onto the other line. The shorter line moves first.
- A line moves only when it stays clear of walls and crosses at most one more soft line. It must keep half of its distance to the walls. Exit marks do not move.
- Gaps: a line that ends less than 3 cells from a line of another piece gets a short line to it. The short line is straight, or has one right angle. A gap in one piece stays open, because a line there makes a small loop.
- Dead ends: the end of a line goes back when it brings no floor near a line that other lines do not already bring near. Near means 4 % of the frame in moves. This removes short ticks at the end of a line. It does not apply on a plan with a wing, because the joins at the edge of the wing need the line ends.
- Staircases: steps of 2.5 cells or less are the cells of a slanted way. They become one slanted line when the line is at least a quarter of the old length limit.
- Routes: a straight run of a route next to a parallel map line, a jog or less away, moves onto that line. The run moves as one piece with the joins on it. The ux review found a corridor run in parts that did not move (JP-commons_000066).
- The first piece can move too, and a short step then joins it to the tap. The last piece stays, because a step back to the way to the exit makes a hook (ux review).
- A move can add one side step to the length of the way, not two. So the bottom of a U does not move farther out (ux review).
- The page picks the nearer of two exits by the length of the way before the moves. The ux review found exits that changed at 1.5 % of taps.
- A slanted first piece that crosses a wall from the tap starts at the middle of the start cell (ux review).
- The steps leave out a short side step. So the first piece moves by a quarter of its length at most. A route keeps the moves only when its steps name no more slight turns. The a11y review found right angles that the steps called a slight turn.
- A corner that moves does not go into the door of another exit. The page picks the second exit by that door, and the a11y review found second exits that went away.
- Rejected: a higher cost of soft lines for the network (30 and 80 in place of 10). Fewer lines crossed soft lines, but bends, hooks and pieces went up.

## Consequences

- On the 195 plans: jogs 1320 to 851, bends 4905 to 4032, dead ends 1747 to 1561, hooks 56 to 43, pieces 278 to 273. No plan has more pieces.
- Routes run on the drawn lines for 0.804 of their length, before 0.809. Lines that moved and that a route cannot follow without a hook give the loss.
- On 2925 routes the steps name 286 slight turns, before 304. Routes with a turn back go from 106 to 100.
- On 4475 taps no second exit goes away.
- `tests/test_network.py` checks a jog, a gap and a tick on a test floor.
- Open: most dead ends are lines into rooms and halls that no other line reaches. The office walls of JP-commons_000066 are thin, so the reader keeps them as soft lines, and lines cross them. The exit marks of PT-commons_000107 are on the pavement in front of the doors. See [Inner walls much thinner than the outer walls](inner-wall-width.md).
