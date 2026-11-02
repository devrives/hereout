---
type: decision
title: One route colour and a smooth start pick
status: accepted
updated: 2026-11-02
checked: dc1d1b1
sources:
  - owner:2026-11-02
  - src/hereout/web/app.js
  - src/hereout/web/route.js
  - src/hereout/web/style.css
  - tests/test_tap.py
  - DESIGN.md
---
# One route colour and a smooth start pick

## Context

- The owner (2026-11-02) said that the start pick and the route flow are not consistent and not smooth.
- A record of the flow at 390 px and 1280 px showed these breaks:
  - The legend named the route blue, but the current step was amber. The route drew in blue, and then its first leg turned amber. The step number, the turn icon and the ring round the exit were amber too.
  - A tap on floor with no way out (a room whose door HereOut did not find) put the dot on the plan with no route. The old route went, and the step card went.
  - On the example plan, such a tap was 19 CSS px from a corridor, less than a fingertip.
  - The dot came in with no motion. At a new tap it jumped.
  - A plan opened from a link showed a focus frame round the plan until the first tap.

## Decision

- The route has one colour, `route` (blue). The current step is the full route line. The steps after it are a thin line of the same blue. The legs before it are `done` (grey). The step number, the turn icon and the ring round the exit at the last step are blue. The amber `lit` colour is gone. This replaces the amber of [The current step under the plan](current-step-card.md).
- The route draws in with the final widths, so nothing changes when it is in.
- A tap reaches floor with a way out within a fingertip (24 CSS px) or within the tap reach of `route.js`, whichever is larger.
- A tap with no floor with a way out in that reach gives no start. The old dot, route and steps stay, and the line under the plan says why. This is the same rule as for a tap off the plan.
- The dot grows in at the first tap. At a new tap it glides from the old start (220 ms). The route draws in from the dot as it lands. The step card fades in.
- The focus frame of the plan shows only after Tab, Enter or Space.
- After the ux and a11y reviews of this change:
  - A large closed area (a floor with no exit found) keeps the start and asks for the exit of that floor, as before. Only a small closed area gives no start.
  - A refused tap shows a ring at the tap and the reason in the pill on the plan for 3.5 s. Off the plan and on a wall give the same words.
  - The pill asks for the exit while the user marks one, and the step card hides then.
  - The motion clocks start at the first frame. The route draw eases out. The second way and the exit ring fade in after the route, and the ways out fade with the dot.
  - An exit button and a marked exit draw the new route in too. A new tap does not scroll the page.
  - The dashed second way shows only where it leaves the route. The nearest exit as a choice keeps "Nearest exit".

## Consequences

- The route reads as one thing on the plan, in the legend, in the step card and in the step list.
- A tap gives a dot with no route only on a floor with no exit found. Then the plan asks for the exit of that floor.
- With reduced motion, the dot and the route show at once, as before.
- `tests/test_tap.py` checks the new tap results: a closed area gives `noway`, and a closed area near floor with a way out moves there.
