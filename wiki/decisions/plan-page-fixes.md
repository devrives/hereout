---
type: decision
title: Fixes of the plan page and the start page after three reviews
status: accepted
updated: 2026-11-01
checked: fb84cde
sources:
  - owner:2026-11-01
  - DESIGN.md
  - src/hereout/web/app.js
  - src/hereout/web/index.html
  - src/hereout/web/style.css
  - src/hereout/web/i18n.js
  - src/hereout/web/early.js
  - src/hereout/app.py
  - tests/test_app.py
---
# Fixes of the plan page and the start page after three reviews

## Context

- On 2026-11-01 a judge agent, the UX reviewer and the accessibility reviewer checked the page again. The page had the changes of [The current step under the plan](current-step-card.md) and [Start page with a header, a phone loop and a credits page](start-page-loop.md). The owner sent their 20 reports for one fix round.
- Before each fix, the agent made the defect occur again in a local browser. Each report was true.

## Decision

### Steps

- The steps are the walks of the route. "Then you reach the exit." is no step: RU-commons_000164 has 4 steps, not 5. The list shows the sentence after the walks, with the exit door and no number. The card adds it to the words of the last walk. The exit door takes the place of the next button.
- A walk that steps aside and goes straight on has a side-step glyph: the line jogs to that side. A turn with a side step keeps its turn glyph, because the turn is the larger move.
- The step dots are round and smaller than the exit marks. Their fill is a colour of the route (`route`, `lit`, `done`). A dot keeps clear of every exit mark, not only the exit of the route. It moves along its walk to a free place, or it does not show. Reason: on SE-commons_000314 the numbered dots beside the exit squares read as more exits.
- The `done` colour is a light grey blue. The old value had almost no contrast on the dimmed photo.
- At 960 px and wider there is no card of the current step. The list beside the plan already shows the lit step.

### Scroll and focus

- After a tap the page scrolls only as far as it must. It stops in a gap between the header, the stage strip, the view buttons and the plan, so no part is cut. On RU-commons_000164 at 390 × 844 the page scrolls 65 px: the header goes out whole. At 1280 × 800 the page does not scroll.
- When a step button reaches the first or the last step, the focus goes to the words of the step (`tabindex="-1"`). Before, a held Enter on "Next" moved the focus to "Previous" and the steps went back.
- After an exit button on a narrow screen, the plan and the card come into view, and the next button takes the focus. Before, the focus went to the step list, far below the screen.
- The card does not stick to the foot of the screen when it is taller than 40 % of the screen. It also does not stick while the plan has the keyboard focus. While the arrow keys move the cross, the page scrolls to keep the cross in view.
- Under 300 px (a phone at 200 % zoom) the words of the step have their own row. The header, the view buttons and the second look wrap. Nothing scrolls to the side at 195 px.

### Plan controls

- "Escape map", "Photo only" and "Routes only" are one choice of three. Exactly one button is pressed. "Routes only" shows the walls with the ways out. A button is never disabled. A photo map keeps "Escape map" (the photo with the exit marks) and "Photo only".
- The larger plan is 1.4 to 2.2 times the frame. It is only as large as keeps the route, YOU and its exit in view, and it is centred on them.
- The tap prompt goes to the edge of the plan where it covers the fewest points of the ways out and no exit. It tries the foot first, then the top.
- After the user chose an exit, a dashed way to the nearest exit says "The dashed line leads to the nearest exit, Exit 4". Before, it said "If it is blocked, use Exit 4", but the button of the chosen exit said "If blocked".
- The name of an exit button starts with its visible words: "Exit 4, Nearest: ВЫХОД" (WCAG 2.5.3).
- Three new texts are in `i18n.js` with notes, and in the 12 catalogues.

### Start page

- The lead of the start page names the moment of use: "New hotel or station? Photograph the evacuation plan by the door and see your way out before you need it."
- The link of the phone has a hidden line that tells a screen reader what the loop shows.
- The sample row is in `index.html`, with fixed ids. The server puts the counts in the page (`app.py` `proof_page`). The page does not move when the gallery comes (layout shift 0.115 before, 0 after, at 390 px with a slow gallery).
- `early.js` adds the class `js`. Without it, the sample row, the count row and the samples link do not show, and the phone shows the poster (`noscript`) with no video.
- Later (2026-11-03), the count row went: see [Fewer repeated lines on the start page](start-page-trims.md).
- The hero loop has no page header, so the hero has one call to action. The hub script `hero_loop.mjs` hides the header in the video. The agent made the loop again after this round.

## Consequences

- `src/hereout/app.py` changed, so the code hash of the gallery changed. Run `scripts/save_answers.py` again before a deploy (see `CLAUDE.md`).
- axe found no violations after a tap, at the last step and in "Routes only". The test used RU-commons_000164 (English), DE-commons_000022 (Arabic) and SE-commons_000314 (Korean) at 390 and 1280. The house rules lint is clean.
- The card of the current step, the step dots and the walk count in [The current step under the plan](current-step-card.md) changed as this page says.
