---
type: decision
title: Afterglow redesign and the reveal of a plan
status: accepted
updated: 2026-11-01
checked: 8b4501f
sources:
  - owner:2026-11-01
  - DESIGN.md
  - src/hereout/web/style.css
  - src/hereout/web/index.html
  - src/hereout/web/app.js
  - scripts/example_marks.mjs
---
# Afterglow redesign and the reveal of a plan

## Context

- On 2026-11-01 the owner said that the start page was weak and that the interface must look refined. The demo video must use the real interface.
- The owner asked for a natural order: the exits, then all the ways out, then the tap of the user, then the route.
- The owner asked to start from `DESIGN.md` with the kit skill `core:design-foundation`.
- The agent made three directions on a design canvas: A Sign (safety-sign green panels), B Afterglow (a dark page, the ways out glow) and C Transit (the route as a line diagram). The owner took B, the agent's recommendation, and asked for no more canvas rounds.

## Decision

- The page has one dark scheme. The tokens and rules are in `DESIGN.md`. The font is Geist, with Geist Mono for numbers. Both are self-hosted.
- In the escape map the photo is under a dark veil. The ways out, the exits and the floor tint glow in green, and the route is a light blue line. "Photo only" and the reading view show the photo with no veil.
- The floor tint is a green glow near an exit that fades with the distance. The amber end of the old scale looked muddy on the dark ground.
- A plan opens in the order of the work. Each exit grows in. Then the ways out grow from the exits. Then the plan waits for the tap. A tap ends this reveal. After a tap the route draws in from YOU.
- A strip above the plan names the four parts: Exits, Ways out, You, Route. It lights the part that shows now. While the plan waits for the tap, a prompt on the plan says "Tap where you stand" (ux review: on a phone the card was below the fold).
- The start page example is now RU-commons_000164. Its four exits match the blind dev labels, and it has no false exit. The example plays the reveal, then draws its route.
- With reduced motion, the plan shows everything at once.
- The plan fits the screen height, so on a phone the answer heading shows under it.
- The samples show more as a faded row and a round chevron, 24 plans for each click (house rule).

## Consequences

- The UX and accessibility reviews (agents, 2026-11-01) found no blocker. axe found no violations at 390 and 1280.
- The stage strip is a row of four states. `DESIGN.md` records it as a gap from the house rules.
- `scripts/example_marks.mjs` crops in photo pixels of the frame and turns off motion.
- On RU-commons_000164 some ways out run below the building, into the legend panel. The floor box of the model holds that area. This did not change.
