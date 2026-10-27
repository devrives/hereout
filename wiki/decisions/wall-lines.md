---
type: decision
title: Find the walls as straight lines
status: accepted
updated: 2026-10-27
sources:
  - owner:2026-10-27
  - src/hereout/wall_lines.py
  - src/hereout/pipeline.py
  - src/hereout/web/app.js
  - tests/test_wall_lines.py
---
# Find the walls as straight lines

## Context

- On 2026-10-27 the owner said that the walls came out as whole blocks of ink. The owner asked for walls as simple straight lines.
- The wall mask of a plan photo holds walls, but also door swings, symbols, columns, text and the edges of painted escape bands. On PT-commons_000107, the edges of the green escape bands in the hall were read as walls.

## Decision

- `src/hereout/wall_lines.py` turns the wall mask into straight lines and filled blocks. The steps:
  - Open the ink with a horizontal and a vertical bar. Fit one line to each piece.
  - Keep a long piece. Keep a short piece only on the line of a long wall, as between doors.
  - Make dense ink over a large area (hatching, a filled room) into a block.
  - Find diagonal walls with a Hough transform in the ink that is left.
  - Join the pieces on one line when the gap is smaller than a door and the photo has ink in the gap. Blank paper in the gap is a door.
  - Remove a line or a block much fainter than the usual wall line.
  - Make one straight line for a wavy wall. It is long, dark ink of one thin stroke that no line covers and no line runs beside. The line stops where the ink stops.
  - Remove the treads of stairs: four or more short parallel lines, close together and evenly spaced. A tread that spans two flights can be up to three times longer. Stairs are a way out.
  - Make each line longer at its ends only over ink, so a corner has no leak and a door stays open.
- The routing grid comes from these lines and blocks, not from the raw mask.
- The plan payload has `walls`: the lines and the blocks. Routes only draws them.

## Consequences

- On PT-commons_000107 the result is 167 lines and a few blocks, in about 2 s on the server. The edges of the escape bands are gone, because their contrast is about half that of the walls.
- The wavy side walls of the PT hall still give no line. There, the wavy wall touches columns, dashed lines and door swings, and their ink is one piece. Rules could not split them: a looser rule drew a line across a double door and two escape bands (ux review, 2026-10-27). A wrong wall that closes a door is worse than a missing wall, so the rule takes only one thin stroke. With it, 63 gallery plans get wavy-wall lines, for example the curved walls of RU-commons_000031 and the curved seat rows of DE-commons_000154.
- Symbols, columns, text and door swings are no longer walls. Routes can pass through small symbols now.
- Gallery route check with no model call: 188 of 203 plans had a route with the first version, against 185 before. Two small-scale plans lost their route (TW-commons_000049, US-openverse_000109). In US, the longer line ends closed a narrow door. In TW, the treads of the stairs closed the exits. The ink check and the stair rule give both plans a route again (owner request, 2026-10-27).
- With these rules, 191 of 203 gallery plans have a route. No plan lost its route.

## Related

- [Show the ways out as straight lines from door to door](way-network.md)
- [Plan reader](../components/plan-reader.md)
