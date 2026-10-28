---
type: concept
title: Plan parsing methods to test
updated: 2026-10-28
checked: 8a41f46
sources:
  - owner:2026-10-28
---
# Plan parsing methods to test

## Definition

A list of methods that can make the walls, doors, symbols and ways out of a plan photo better with no model call. The owner asked for all such methods, recorded and tested (2026-10-28). The full research is in the hub folder `docs/hereout-plan-parsing-2026-10-28/` (three English reports and a Korean summary).

Main points of the research:

- Good classical systems take out text, dashes, arcs, doors and fills before they decide on walls. None of them uses the stroke width alone.
- Test walls and the network apart: run the network on walls drawn by hand.
- Use two or three metrics with different methods, and trust a change only when they agree.
- The legend of the plan gives templates and colours for symbols and routes.
- No paper turns door arcs into openings or splits the levels of one sheet. These steps are new work.

Test order, with no model call:

| Step | Method | Problem |
|---|---|---|
| 0 | Small ground truth on the 7 review plans, and metrics | A result must not depend only on a look by eye |
| 1 | Opening by reconstruction; a thin line is a wall only when both ends touch walls | Door leaves, rail lines and platform edges become walls |
| 2 | Text and graphics layers; dashed lines grouped and made open | Dashed lines cut corridors |
| 3 | Building outline; outside of it is closed | Pavement and paper become floor |
| 4 | Split the drawings of one sheet | Two levels join |
| 5 | Door arcs found and made into openings | Door arcs close rooms |
| 6 | Legend box, legend colours, legend templates | Exits on the legend; fixed colour rules |
| 7 | Network: clearance funnel, corridor centre lines, spur pruning, arrow direction cost | Lines are not clean |

## Related

- [Take the walls from all drawn ink](../decisions/ink-walls.md)
- [Follow the printed escape routes in the way network](../decisions/printed-route-marks.md)
- [Show the ways out as straight lines from door to door](../decisions/way-network.md)
- [Check the exits with numbered marks](../decisions/exit-mark-check.md)
