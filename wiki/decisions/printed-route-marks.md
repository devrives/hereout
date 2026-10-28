---
type: decision
title: Follow the printed escape routes in the way network
status: rejected
updated: 2026-10-28
checked: 6267545
sources:
  - owner:2026-10-28
  - commit:3d6310b
---
# Follow the printed escape routes in the way network

## Context

- The owner asked for lines that join the exits along the correct ways, with no model call (2026-10-28).
- Many plans print their escape routes as green bands, green lines, arrows or red lines.

## Decision

- Rejected. The branch `route-marks` (commit 3d6310b) is not on main.
- The test found the printed routes by colour. A chain of nodes ran along them, and a way along the chain cost less.
- The owner checked 7 plans at `/review/` and found no plan better. The lines still went through walls and did not follow the ways.

## Consequences

- A measure on the 7 plans counted the drawn lines of the photo that the ways out cross. Before and after the change, a way crossed one drawn line for each 25 to 65 px of length.
- Most crossed lines are walls that the wall grid does not have. A change to the network cannot fix that. The open space must come from the drawing first.
- Before the next owner review, a test must count the crossed lines on the review plans. A change that does not lower the count does not go to the owner.
