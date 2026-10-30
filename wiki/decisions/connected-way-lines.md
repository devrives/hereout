---
type: decision
title: "One network of way lines: links between exits, lines along corridors"
status: accepted
updated: 2026-10-30
checked: e28298f
sources:
  - owner:2026-10-30
  - src/hereout/web/route.js
  - tests/test_network.py
  - tests/network_check.js
---
# One network of way lines: links between exits, lines along corridors

## Context

- On 2026-10-30 the owner checked the samples. The exits were right, but the ways on the open floor did not connect.
- The map draws the tree of [Draw the ways out as one tree of level and upright lines](orthogonal-way-tree.md). All exits grow at the same time, so each exit gets a tree of its own. Nothing joins two of these trees, except a short straight bridge.
- Each room adds one line, from its middle. A long corridor that is one room gets one line, from its middle only. Its far part has no line.
- On a plan with many exits, each tree is small. US-web_more_000029 (12 exits) showed short pieces at the exits and no line in the corridors.
- A measure on 195 sample plans: the lines of 86 plans are one network, for each open area that holds an exit. On average, 64 % of the floor with a way out is near a line (6 % of the frame, along the open floor).

## Decision

- Links: the lines (and the exits) of all exits grow on the open floor at the same time, the cheapest cell first. Where two of them meet, that is a link between the two exits. The cheapest links join the trees, until the lines of each open area are one network.
- A link uses the cost of the tree, so it keeps to the middle of the way. The a11y review found that a link by the fewest cells ran along the walls, where its colour had less contrast on the photo.
- A link splits where both exits are equally near, with the way out from each end added. The two halves have arrows that point to their exits.
- A link to an exit with no line of its own goes on to that exit.
- Cover: a corridor is a room of 3 % of the floor or more that is at least 4 times longer than wide. The corridor cell farthest from the lines gets a line, until each corridor cell is near a line. The map draws a line of the cover in full.
- Rooms that are not long (offices, halls) get no lines of the cover. A first version with lines in all large rooms filled offices with lines (JP-commons_000066).
- A line of the cover is the way that a route from its far end takes to the tree. The map draws it, but the tree does not grow from it. So all routes stay as before: 39739 routes on the 195 plans are the same. A first version grew the tree from these lines. The ux review then found routes away from the exit (JP-commons_000066). It also found a far exit named as the nearest (US-web_more_000029).
- `tests/test_network.py` checks that the lines of each test plan are one network.

## Consequences

- On the 195 plans, 188 have one network for each open area, before 86. On average, 78 % of the floor is near a line, before 64 %.
- Open, from the ux review: on a plan with a wing (RU-commons_000210), a short piece can stay apart. A link along a slanted wall can show small steps.
- Errors of the walls stay. A later check of the walls: [Inner walls much thinner than the outer walls](inner-wall-width.md).
