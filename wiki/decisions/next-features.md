---
type: decision
title: Features for after the submission, and a plan that turns with you
status: proposed
updated: 2026-11-03
checked: a1abeed
sources:
  - owner:2026-11-03
  - README.md
  - src/hereout/web/app.js
  - src/hereout/web/style.css
---
# Features for after the submission, and a plan that turns with you

## Context

- On 2026-11-03 the owner asked for two additions:
  - a record of the accuracy tests and their results in the public repository
  - a list of features to add, for example a plan that turns as in a map app, and small conveniences
- The event ends on 2026-11-04 ET. A new feature now changes the film, the submission text and the reviews again.
- A posted plan seldom has a north arrow. Thus "north up" has no meaning on most plans. A turn to the direction that the user faces is possible.
- The first step names a side of the plan. On some posted plans, "up" is not the direction that the reader faces ([Plan reader](../components/plan-reader.md)).
- The page has no Wake Lock, no vibration and no compass today (`src/hereout/web/app.js`). It keeps the open plan only in `sessionStorage` of the tab, and the page itself needs the network. The canvas has `touch-action: manipulation`, and the plan has a zoom button, but no zoom with two fingers inside the plan.

## Decision

- Before the submission, only the README changes. It gets the sections "Experiments" and "What's next". The facts of "Experiments" come from the decision pages of this wiki.
- The features come after the submission. The order is open.
- A plan that turns with you must be the choice of the user:
  - The user lines the plan up once with the room. Then the phone compass turns the plan as the user turns.
  - A compass inside a building can be wrong, near steel and electric equipment. A plan that turns to a wrong direction is worse than a plan that does not turn.
  - With the plan lined up, the first step can name a turn of the body ("turn left") in place of a side of the plan.
- Other features in the list:
  - the screen stays on while a route is open
  - a plan kept on the phone, for use with no network
  - zoom and move with two fingers
  - a short vibration at each new step

## Consequences

- The README lists the features as plans, not as parts of the product.
- No code changed for this decision.
