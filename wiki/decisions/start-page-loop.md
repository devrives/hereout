---
type: decision
title: Start page with a header, a phone loop and a credits page
status: accepted
updated: 2026-11-01
checked: 4fc0f50
sources:
  - owner:2026-11-01
  - src/hereout/app.py
  - src/hereout/web/index.html
  - src/hereout/web/credits.html
  - src/hereout/web/app.js
  - src/hereout/web/style.css
  - DESIGN.md
  - tests/test_app.py
---
# Start page with a header, a phone loop and a credits page

## Context

- On 2026-11-01 the owner said that the start page was better after the [Afterglow redesign](afterglow-redesign.md). The owner asked for these changes:
  - Remove the disclosures that do not help.
  - Play a motion of the page in use in the empty area at the right of the hero. This motion is not the demo video.
  - Use the header. Do not add a footer.
- A research brief of the same day compared other landing pages. It gave these items:
  - sample plans under the main button
  - a row of counts
  - a pause button for the motion (WCAG 2.2.2)
  - a page for the photo credits
  - one disclosure for the text of the video, right under the video

## Decision

- The header has links to How it works, Samples, Demo and Code (the GitLab repository). The links are not buttons, so the photo button in the hero stays the one primary action. The header stays at the top of the start page. With a plan open, it scrolls away and has the "New photo" button. Narrow screens show fewer links.
- The hero has a phone that plays a loop of the real page at 390 px with one sample plan (RU-commons_000164, tap 720, 950). The loop shows the exits, the ways out, the tap, the route and the steps. Its last frames fade into its first frame, so the loop has no seam.
- The hub script `docs/hackathon-hereout-submission-2026-10-31/hero_loop.mjs` records the loop with the Playwright clock, as for the demo video. The files are outside the repository, in `../_workspace/hereout-video/site`: `hero-loop.mp4`, `hero-loop.webm` and the poster `hero-loop.webp`.
- The server shows the phone only when `hero-loop.mp4` is there and the gallery has the credit of the plan. Else it shows the still example picture.
- The phone is the link that opens the same plan. The credit line under it names the recording as a change.
- The page starts the loop only while the phone is on the screen. With reduced motion, the page shows the poster. A round button on the phone pauses and plays the loop.
- Three sample plans show under the photo button. Their exits are right. A row of counts (plans, countries and regions, languages) links to the samples.
- The photo credits of all samples are on the page `/credits`, with one anchor for each sample id. A link beside the heading of the samples opens it. The open plan and the hero keep their own credit lines.
- The start page has one disclosure: the text of the video, right under the video. The credit of the photo in the video is in the caption line under the video.

## Consequences

- The loop has no autoplay attribute: `app.js` starts it. Thus a page with reduced motion never shows motion before the script runs.
- The loop shows the plan view of this branch. A later change of the plan view needs a new recording.
- A change of `src/hereout/app.py` changes the code hash of the gallery. Before a deploy, run `scripts/save_answers.py` (see `CLAUDE.md`).
