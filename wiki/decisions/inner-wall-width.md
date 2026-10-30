---
type: decision
title: Inner walls much thinner than the outer walls
status: accepted
updated: 2026-10-30
checked: 342fd10
sources:
  - owner:2026-10-30
  - src/hereout/ink_walls.py
  - tests/test_ink_walls.py
---
# Inner walls much thinner than the outer walls

## Context

- On 2026-10-30 the owner asked for a check of the wall reader, after [One network of way lines](connected-way-lines.md). That page said that on 42 of 195 plans one room holds half of the floor or more.
- A check by eye found that this count does not show missed walls. RU-commons_000001 is an open hall with a printed route loop (green ink, not a wall). Other plans of the 42 are halls, decks or station platforms.
- The map lines never cross soft lines (door swings, thin lines), so a thin wall that stays soft still stops the lines.
- One real error: RU-commons_000167 draws its outer walls 30 px thick and its inner walls 10 px thick. `split_strokes` takes the thickest stroke as the wall stroke, so the inner walls were thin ink and soft.

## Decision

- A long piece of ink (at least `STRAIGHT` of the image) is a wall too when it is wide. The least width is `MID_SHARE` (a quarter) of the wall stroke.
- `tests/test_ink_walls.py` checks it with an inner wall of a third of the outer wall width.

## Consequences

- On RU-commons_000167 the upper walls and the inner wall are walls now. Only 2 of 195 gallery plans changed. The share of the floor that reaches an exit stays at 0.928 on average.
- The ground truth of the 7 review plans did not change: floor 0.980, leak 0.105, walls 9 of 11.
- Two other rules did not go on:
  - Short straight wall pieces on the ends of walls, on plans of thin strokes. They closed doors: the floor of the ground truth went from 0.980 to 0.899, and the walls stayed at 9 of 11.
  - Long straight lines under a text box. Most of these lines were the top and the bottom of large title letters, not walls.
