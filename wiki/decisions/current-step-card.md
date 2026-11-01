---
type: decision
title: The current step under the plan
status: accepted
updated: 2026-11-01
checked: fb84cde
sources:
  - owner:2026-11-01
  - DESIGN.md
  - src/hereout/web/app.js
  - src/hereout/web/route.js
  - src/hereout/web/index.html
  - src/hereout/web/style.css
  - src/hereout/web/i18n.js
---
# The current step under the plan

## Context

- The research brief of 2026-11-01 (hub `_workspace/hereout-research/brief.md`, section 0) found the main defect of the plan page. On a phone (390 × 844), the answer card starts at y = 901 after the tap, and the steps at y = 1063. Both are below the fold. A tapped step lights its leg on the plan, but its words are off the screen. The user never sees the plan and the instruction together.
- Section 2 of the brief ranks the patterns of indoor and street navigation. The first is a card of the current step at the foot of the map (Google Maps, Apple Maps, Citymapper). Others are turn icons, a leg highlight with progress (Mappedin), a tappable second route and an arrow at the start.
- The owner asked for these changes in this order, with quality before quantity.

## Decision

- After a tap, a card of the current step is right under the plan. Since the fix round of the same day, the card shows only under 960 px ([plan-page-fixes](plan-page-fixes.md)). It shows a small exit badge, "Exit 4 · Step 2 of 4", a speaker button, the turn icon and the words of the step. A previous and a next button are at the two sides of the words, 56 × 64 px, in the thumb zone.
- After a tap, the page scrolls only as far as the card needs. The top of the plan stays in view. While its place is below the screen, the card sticks to the foot of the screen. On RU-commons_000164 at 390 × 844, the card is at y = 683 to 835 after the tap, and the plan at y = 161 to 683.
- Step 1 is the current step when a route shows. Its leg lights after the route draws in. A tap on a step in the list makes that step the current step. A second tap no longer turns the light off, because the card always shows one step.
- The card does not change its height from step to step. At the first and the last step, the button that has nothing to show keeps its place and does not show. If it had the focus, the focus goes to the words of the step ([plan-page-fixes](plan-page-fixes.md)). Each step change goes once to the live line of the plan ("Step 2 of 5: ..."). The speaker button reads only the current step. "Read the steps aloud" stays in the answer card.
- Each step has a turn icon in the list and in the card. The icons are straight, left, right, slight left, slight right and back. The end of the route has an exit door. The steps are the walks only ([plan-page-fixes](plan-page-fixes.md)). Step 1 names a side of the plan, so its arrow points to that side.
- On the plan, the legs before the current step have the `done` colour (a light grey blue since the fix round). The current leg is amber, and the rest keeps its glow. A small numbered dot marks where each step starts, with the number of the list. Step 1 starts at YOU and has no dot. The plan shows no dot where it covers YOU, its label, an exit or another dot. Since the fix round, a dot is round and small, and it moves along its walk to a free place. These dots replace the one number at the middle of the lit leg (see [Links start on the drawn lines](links-on-drawn-lines.md)). On the last walk, an amber ring goes round the exit.
- A short white arrow at YOU points the first move. It takes the heading of step 1 from `route.js` `directions()`, so it agrees with the words of step 1. Each walk has the new fields `head` and `aside` for this.
- A tap on the dashed second way, or on an exit mark, routes to that exit, as its exit button does. The start stays. A tap where the dashed line runs beside the route is a new start, as before.
- The exit buttons of the nearest exit and of the second way have a word beside the number: "Nearest" and "If blocked". The words come from the route with no chosen exit, so they do not move when the user chooses an exit. The name of the button starts with these visible words ([plan-page-fixes](plan-page-fixes.md)).
- Nine new texts of the plan card are in `i18n.js` with notes, and in the 12 catalogues.

## Not done

- A staged wait while a photo reads ("Step 2 of 4: finding walls"). The server reports only that the job works (`/api/plan/{job}` answers 202 with `{"working": true}`). A stage on the page is then a guess. An honest stage needs the server to report the parts of its work. That is a change of `src/hereout/*.py`, and then the merger must save the gallery answers again.
- A draggable YOU pin, and a card that the user drags up for the full list. The full list stays in the answer card.

## Consequences

- axe found no violations after a tap and a step change. The test used RU-commons_000164, DE-commons_000022, JP-commons_000268 and SE-commons_000314 at 390 and 1280. The languages were English, Korean, Arabic and German. The house rules lint is clean.
- On a wide screen the tap scrolls the page by about 160 px. The header goes out of view, and the plan and the card show.
- `DESIGN.md` has the new token `done`, the components `now-card`, `badge-now` and `button-now-step`, and the rules for the card, the icons and the dots.
- The example image of the start page (`scripts/example_marks.mjs`) is from before this change. It shows no dots and no arrow at YOU.
