---
type: decision
title: "Page layout: plan beside the answer, with the logo"
status: accepted
updated: 2026-10-30
checked: be5d7fc
sources:
  - owner:2026-10-30
  - src/hereout/web/index.html
  - src/hereout/web/style.css
  - src/hereout/web/app.js
---
# Page layout: plan beside the answer, with the logo

## Context

- The page had no logo. The name was a green heading.
- On a wide screen the page used one column of 760 px. With a plan open, the answer text was under the plan, out of view.
- On a phone, the result was about 3300 px long. Four view buttons, five legend lines, a long status sentence and seven exit buttons came before the end.
- The logo of HereOut is the angular labyrinth in one colour (hub wiki, `wiki/timelines/meta-hackathon-2026.md`, 2026-10-21).
- On 2026-10-30 the owner asked for a polish of the page with the logo, for desktop and mobile. The owner saw three directions as mockups and chose direction A.

## Decision

- The header shows the logo and the word mark. While a plan is open, the header also has a "New photo" button.
- The start page has a heading, one line, the big photo button and three short steps. On a wide screen the samples are at the right of this text.
- Only small previews of the samples are on the server, so the start page shows no large plan image.
- With a plan open, the start page text goes. On a wide screen the plan is at the left and the answer is at the right. On a phone the answer comes under the plan.
- The answer card shows the exit number and name first, then the second exit, the steps and the actions.
- The live status line keeps the full sentence for a screen reader. While a route shows, the line is not visible.
- The exit buttons show the number only, as the mark on the plan. The label of each button has the full name of the exit.
- The page uses the colours of the logo and the font of the word mark, Plus Jakarta Sans. The page serves the font file itself (SIL Open Font License).
- The marks on the plan keep their colours. The route stays blue and the exits stay green.
- The logo goes to the start page in a new history entry. Back after it opens the plan again. A plain link to the same address is a reload, and a reload keeps the plan.
- The plan of a photo of the user comes back only in its own history entry: with Back, Forward and a reload.

## Consequences

- On a wide screen the plan and the answer are in view together.
- On a phone, the answer card is directly under the plan and the legend.
- The page loads one font file of 27 KB.
- A second photo input is in the header. Both inputs get the same wait state.
- A new visit of the page shows the start page, also in a tab with a photo plan from before.
