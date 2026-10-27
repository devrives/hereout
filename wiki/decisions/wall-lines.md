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
  - Join the pieces on one line when the gap is smaller than a door.
  - Remove a line or a block much fainter than the usual wall line.
- The routing grid comes from these lines and blocks, not from the raw mask. Each line is drawn a little longer at its ends, so corners have no leak.
- The plan payload has `walls`: the lines and the blocks. Routes only draws them.

## Consequences

- On PT-commons_000107 the result is 167 lines and a few blocks, in about 2 s on the server. The edges of the escape bands are gone, because their contrast is about half that of the walls.
- A wall that is not straight gives no line, for example the wavy side walls of the PT hall. A test drew such walls as simplified outlines, but door swings and symbols came out too, so that step was removed.
- Symbols, columns, text and door swings are no longer walls. Routes can pass through small symbols now.
- Gallery route check with no model call: 188 of 203 plans have a route, against 185 before. Five plans gained a route. Two small-scale plans lost one (TW-commons_000049, US-openverse_000109). The join of wall pieces closes their narrow doors.

## Related

- [Show the ways out as straight lines from door to door](way-network.md)
- [Plan reader](../components/plan-reader.md)
