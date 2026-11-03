---
type: log
title: Wiki log
updated: 2026-10-27
---
# Wiki log

Add one entry for each operation. Put the newest entry at the bottom.

## [2026-10-26] init | Wiki created

- Created `index.md`, `log.md`, `glossary.md` and `config.json`.

## [2026-10-27] ingest | Plan reader and model provider

- Added `components/plan-reader.md` and `decisions/model-provider.md`.
- Source: the first version of `src/hereout/` and the first test with six plan photos.

## [2026-10-27] ingest | First step names a side of the plan

- Updated `components/plan-reader.md`: the first step names a side of the plan, not a side of the body.
- Source: the copy review of the step texts.

## [2026-10-27] ingest | Web demo after the first reviews

- Updated `components/plan-reader.md`: keyboard marks, buttons for other exits, session storage, time limit that starts again.
- Source: the UX, accessibility and copy reviews of the web demo.

## [2026-10-27] ingest | Sample gallery

- Added `components/gallery.md`.
- Source: `scripts/run_set.py`, `src/hereout/gallery.py` and the first batch run on the open-licensed photo set.

## [2026-10-27] ingest | Gallery after the first full run and the reviews

- Updated `components/gallery.md`: credit details, gallery ids, sample address, the sheet check, the results of the first run.
- Source: the run on 203 photos and the ux, a11y and copy reviews.

## [2026-10-27] ingest | Low reasoning effort

- Updated `decisions/model-provider.md`: both model calls use low reasoning effort, with the test on 30 plans.
- Source: the owner request about time and cost, and the test.

## [2026-10-27] ingest | Escape map and routes in the browser

- Added `decisions/browser-routing.md`.
- Updated `components/plan-reader.md` (escape field, map, thick faint ink, known limits) and `components/gallery.md` (no server state, route results found again).
- Source: the owner request for all ways to the exits, the parity test and the check on PT-commons_000107.

## [2026-10-27] ingest | Routes only view

- Updated `decisions/browser-routing.md`: the "Routes only" view, with the walls of the routing grid in grey.
- Source: the owner request to see the routes without the photo.

## [2026-10-27] ingest | Ways out as straight centre lines

- Added `decisions/way-network.md`. Linked it from `index.md` and `decisions/browser-routing.md`.
- Source: the owner request of 2026-10-27, the research of methods, and the network in `src/hereout/web/route.js`.
- Recorded the review fixes: shortcut from the start, no legs with almost no flow, opaque lines, status before an exit route.

## [2026-10-27] ingest | Wall lines and a door-to-door network

- Added `decisions/wall-lines.md`. Rewrote `decisions/way-network.md` for the door-to-door network. Updated `index.md` and `decisions/browser-routing.md`.
- Source: the owner request of 2026-10-27, `src/hereout/wall_lines.py` and the network in `src/hereout/web/route.js`.
- Recorded the review fixes: a door at each opening, taps that look two rooms away, trunk lines, lighter walls and wider ways.

## [2026-10-27] ingest | Doors over blank paper, stairs, bent walls

- Updated `decisions/wall-lines.md`: joins and line ends only over ink, stair treads are not walls, one line for a wavy wall of one thin stroke. The PT hall walls still give no line.
- Source: the owner request of 2026-10-27 and `src/hereout/wall_lines.py`.

## [2026-10-27] ingest | Known problems, recorded only

- Updated `components/plan-reader.md`: Known limits lists the open problems after the wall-line and door-to-door changes. The old item about exit signs in the doorways is gone, because symbols are no longer walls.
- Source: the owner request of 2026-10-27 (record only, no fix now) and the ux reviews of 2026-10-27.

## [2026-10-27] ingest | Fixes with no model call

- Updated `components/plan-reader.md`: no clear disc for exit marks, a free place for the "YOU" label, the network worker, and the known limits after the fixes.
- Updated `decisions/wall-lines.md`: the colour rule for printed routes, and why HSV saturation did not work.
- Updated `decisions/way-network.md`: the network comes from a Web Worker.
- Source: the owner request of 2026-10-27 (fix what needs no model call), `src/hereout/wall_lines.py`, `src/hereout/web/route.js`, `src/hereout/web/network-worker.js`, `src/hereout/web/app.js` and the gallery route check.

## [2026-10-28] ingest | Exit check with numbered marks

- Added `decisions/exit-mark-check.md`: research on coordinate formats, the failed local candidates, and the 30-plan test of a second call with numbered marks.
- Updated `components/plan-reader.md`: the PT exit limit links the test.
- Source: the owner requests of 2026-10-27 and 2026-10-28, and the test outputs.

## [2026-10-28] ingest | Read prompt in the Meta style, clamp on the grid

- Updated `decisions/exit-mark-check.md`: the Meta grounding rules, the 5-plan pilot of a one-call prompt, the square-image check, and the clamp.
- Source: the owner request of 2026-10-28, the Meta image understanding page, `src/hereout/reader.py`.

## [2026-10-28] ingest | Review pages at /review/

- Updated `components/plan-reader.md`: the server shows the gallery `review/` folder at `/review/`.
- Source: the owner request of 2026-10-28 (check the samples on the subdomain), `src/hereout/app.py`.

## [2026-10-28] ingest | Country hints test

- Updated `decisions/exit-mark-check.md`: the 20-call test of one prompt for all countries against one prompt for each country.
- Source: the owner request of 2026-10-28 and the test outputs.

## [2026-10-28] ingest | New read prompt in the product

- Updated `decisions/exit-mark-check.md`: the first call uses the Meta-style prompt with the floor rule.
- Source: the owner approval of 2026-10-28, `src/hereout/reader.py`.

## [2026-10-28] ingest | Zoom on suspect exits

- Updated `decisions/exit-mark-check.md`: ideas from similar work, the Baseten image limit, and the 6-plan test of a gated zoom.
- Source: the owner request of 2026-10-28, the Sensors 2023 paper, the DiMo-GUI paper, the test outputs.

## [2026-10-28] ingest | Exit zoom in the product, review set

- Updated `decisions/exit-mark-check.md`: the zoom is a separate call at the same time as the "you are here" zoom, with its numbers.
- Updated `components/plan-reader.md`: the two second looks and the review set.
- Source: the owner request of 2026-10-28, `src/hereout/reader.py`, `src/hereout/app.py`, `src/hereout/web/app.js`.

## [2026-10-28] ingest | Exits of every level, open problems

- Updated `decisions/exit-mark-check.md`: the owner check of the review set and the test of the rule for every level (branch `exit-level-rule`).
- Updated `components/plan-reader.md`: the known limits after the exit zoom.
- Source: the owner check of 2026-10-28 and the test outputs.

## [2026-10-28] ingest | Start from a tap, exits of every level on main

- Created `decisions/start-from-tap.md`: the model gives no start, and the gallery check has no start.
- Updated `components/plan-reader.md`: the read stage and the second call.
- Updated `decisions/exit-mark-check.md`: the rule for every level is on main.
- Source: the owner words of 2026-10-28, `src/hereout/reader.py`, `src/hereout/web/app.js`, `scripts/run_set.py`.

## [2026-10-28] ingest | Printed route marks rejected

- Created `decisions/printed-route-marks.md`: the owner found no plan better, and the lines crossed walls before and after.
- Source: the owner check of 2026-10-28, branch `route-marks`, the crossed-line count on the 7 review plans.

## [2026-10-28] ingest | Walls from all drawn ink (test)

- Created `decisions/ink-walls.md`: the test, the 7-plan check and the gallery count.
- Source: the owner request of 2026-10-28, local branch `ink-walls`, the scratchpad evaluation.

## [2026-10-28] ingest | Plan parsing methods to test

- Created `concepts/plan-parsing-methods.md`: the research summary and the test order.
- Source: the owner request of 2026-10-28, the hub folder `docs/hereout-plan-parsing-2026-10-28/`.

## [2026-10-28] ingest | Wall method tests

- Created `decisions/wall-method-tests.md`: the ground truth, the scores and the result of each method.
- Source: the owner request of 2026-10-28, the test scripts of the session.

## [2026-10-28] ingest | Wall method tests: dashes, look at the best set

- Updated `decisions/wall-method-tests.md`: method 2 does not go on; a look at the ways out of the best set.
- Source: the test scripts of the session.

## [2026-10-28] ingest | Best wall set and blind A/B page

- Updated `decisions/wall-method-tests.md`: the best set on the branch, the gallery numbers and the A/B page.
- Source: branch `ink-walls`, the gallery check, the A/B page.

## [2026-10-29] ingest | Level and upright way lines

- Created `decisions/orthogonal-way-tree.md`: the owner verdict on the A/B page and the new tree of lines on branch `ortho-net`.
- Updated `decisions/wall-method-tests.md`: the owner verdict on the A/B page.
- Source: the owner words of 2026-10-29, commit 6920028.

## [2026-10-29] ingest | Way lines, second round

- Updated `decisions/orthogonal-way-tree.md`: the second round of refinement (commit 828f6e4) and its numbers.
- Source: the owner words of 2026-10-29, commit 828f6e4.

## [2026-10-29] ingest | Way lines, third round: outside areas, exit placement, room doors, wing

- Created `decisions/outside-and-closed-rooms.md`: grey fills, areas beyond the exits and at the edge, exit placement, room doors.
- Updated `decisions/orthogonal-way-tree.md`: third round (wing network, long staircases only, the worker gets the axes).
- Updated `index.md`.
- Source: the owner words of 2026-10-29, commit 78dcaca on `ortho-net`, the ground truth and the 38-plan comparison.

## [2026-10-29] ingest | Start points of the way lines

- Updated `decisions/orthogonal-way-tree.md`: small rooms join the line at their door; halls keep a line.
- Source: the owner words of 2026-10-29, commit bb987a5 on `ortho-net`.

## [2026-10-29] ingest | Gallery check of the new walls and lines

- Updated `decisions/outside-and-closed-rooms.md`: the result on 165 gallery plans, the exit fix and the speed fix.
- Source: the owner words of 2026-10-29, commits 8ce3579 and 985375d on `ortho-net`, the gallery run.

## [2026-10-29] ingest | Position of the user and causes of the weak types

- Updated `decisions/orthogonal-way-tree.md`: the second exit, the arrows, the routes in a wing, the review findings.
- Updated `decisions/outside-and-closed-rooms.md`: why sheets with many floors and yards stay weak.
- Source: the owner words of 2026-10-29, commit 6913303 on `ortho-net`, the ux and a11y reviews.

## [2026-10-29] ingest | Fixes for the weak plan types

- Created `decisions/weak-plan-types.md`: photo maps, outdoor words, floors with no exit, legend frames, the new read of 30 plans.
- Updated `decisions/outside-and-closed-rooms.md`: a link to the fixes.
- Source: the owner words of 2026-10-29, commit 6d5f2fb on `ortho-net`, the gallery run, the ux and a11y reviews.

## [2026-10-29] ingest | Deploy and the remaining weak cases

- Updated `decisions/weak-plan-types.md`: accepted; the merge to main, the gallery speed, legend headings, the tests that were not kept, the open limits.
- Updated `index.md`: the new summary.
- Source: the owner words of 2026-10-29, commits ef7ebe6 and 1fd3209, the gallery run.

## [2026-10-29] ingest | Saved gallery answers

- Updated `components/gallery.md`: the saved answers, their key and the script.
- Updated `index.md`: the gallery summary.
- Source: the owner words of 2026-10-29, `scripts/save_answers.py`.

## [2026-10-29] ingest | Fast processing of a new photo

- Added `decisions/photo-speed.md`: the times, the changes, the check on the gallery.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-29, the measurement in the container image, the gallery check.

## [2026-10-29] ingest | Smaller upload of a large photo

- Updated `decisions/photo-speed.md`: the resize in the page, the times in the container, the reviews.
- Source: the browser checks, the ux and a11y reviews.

## [2026-10-29] ingest | Test on photos outside the eval set

- Added `timelines/photo-set-tests.md`: the set of 28 photos, the result, the times and the check by eye.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-29, the run in `_workspace/hereout-holdout/`.

## [2026-10-30] ingest | Upload as a job; no zoom call after a slow main call

- Added `decisions/slow-reads.md`: the job flow, the second try of the main call, the zoom skip.
- Updated `components/plan-reader.md`: the server keeps an answer in memory for 10 minutes at most.
- Updated `timelines/photo-set-tests.md` and `index.md`.
- Source: the owner words of 2026-10-30, the code and the tests.

## [2026-10-30] ingest | Page layout with the logo

- Added `decisions/page-layout-a.md`: the owner chose direction A of three mockups.
- Updated `index.md`.
- Updated `decisions/orthogonal-way-tree.md`: no second exit when every other way passes the door of the first exit.
- Updated `components/gallery.md`: countries and regions.
- Source: the owner words of 2026-10-30, the page code and the fact check of the page.

## [2026-10-30] ingest | Page check after the layout change

- Updated `decisions/page-layout-a.md`: the logo goes to the start page, and a photo plan comes back only in its own history entry.
- Source: the owner request of 2026-10-30 to check the page for problems, and a code review of the page.

## [2026-10-30] ingest | Fast first tap and smaller sample plans

- Added `decisions/page-speed.md`: the times, the trees in the worker, the faster loops, the WebP images and the cache time.
- Updated `components/gallery.md`: the WebP file beside each saved answer.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-30, the browser measurements, the output check on the gallery plans, the code, ux and a11y reviews.

## [2026-10-30] ingest | One network of way lines

- Added `decisions/connected-way-lines.md`: the links, the cover of corridors, the measure on 195 plans, the open wall errors.
- Updated `decisions/orthogonal-way-tree.md`: a link to the new page.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-30, the measure on the gallery plans, the code and the tests.

## [2026-10-30] ingest | Status after a reload with a start

- Updated `decisions/page-speed.md`: the status line after the second wait.
- Source: the ux review of 2026-10-30, the reload check on the live site.

## [2026-10-30] ingest | Check of the wall reader

- Added `decisions/inner-wall-width.md`: the check by eye, the inner wall rule, the two rules that failed.
- Updated `decisions/connected-way-lines.md`: a link to the check.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-30, the ground truth of the review plans, the gallery check.

## [2026-10-30] ingest | Clean way lines

- Added `decisions/clean-way-lines.md`: the measure of the lines alone, the jog, gap, tick and staircase steps, routes on the lines, the soft cost that failed.
- Updated `decisions/connected-way-lines.md`: a link to the new page.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-30, the measure on 195 gallery plans, the code and the tests.

## [2026-10-31] ingest | Faded ends of walls

- Added `decisions/faded-wall-ends.md`: the faded partition ends, the rules that keep doors open, the axes from the walls without faded ends, the gallery numbers.
- Updated `decisions/clean-way-lines.md`: a link to the new page.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-30 and 2026-10-31, the gallery check, the ground truth, the code and the tests.

## [2026-10-31] ingest | A walk outside from an exit mark to its door

- Added `decisions/exit-walk-outside.md`: the count of areas with no way out, the walk from an exit mark on the street and its limits.
- The same page has the colour edge rule that failed.
- Updated `decisions/faded-wall-ends.md`: a link to the new page.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-31, the gallery check, the ground truth, the code and the tests.

## [2026-10-31] ingest | Turn words from the main leg of a walk

- Added `decisions/step-turns-main-leg.md`: the heading of a walk from its longest leg, the joins at the wing edge, and the wing for slanted corridors that failed.
- Updated `decisions/exit-walk-outside.md`: a link to the new page.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-31, the gallery check, the a11y review, the code and the tests.

## [2026-10-31] ingest | Links start on the drawn lines

- Added `decisions/links-on-drawn-lines.md`: links from the drawn lines, short links at doors side by side, jog moves of both lines.
- The same page has the link rule for exits with lines that failed.
- The same page has the steps that split where a side step starts, and the arrow and step number places.
- Updated `decisions/step-turns-main-leg.md`: a link to the new page.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-31, the gallery check, the code and the tests.

## [2026-10-31] ingest | Short time limits for the model calls

- Added `decisions/call-timeouts.md`: shorter call limits, the page wait times, and the speed and step tests that failed.
- Updated `decisions/slow-reads.md`: a link to the new page.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-31, the paid call test, the timed full reads, the code and the tests.

## [2026-10-31] ingest | Polish for the judging criteria

- Added `decisions/judge-polish.md`: the start page example, the gallery order, the frame, the tap checks and the model reading view, with the review results.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-10-31, the judge review, the agent branches, the ux and a11y reviews and the tests.

## [2026-11-01] ingest | Demo video on the start page

- Added `decisions/demo-video.md`: the video file, the mount, the caption text and the credits.
- Updated `index.md`: the new page.
- Source: the owner words of 2026-11-01, the code and the tests.

## [2026-11-01] ingest | Demo video with large captions

- Updated `decisions/demo-video.md`: the captions are in a strip under the page picture, and the video is 2 min 20 s long.
- Source: the owner words of 2026-11-01 and the new video.

## [2026-11-01] ingest | Judge review 2

- Added `decisions/plan-language.md`: the text read, the translation endpoint and cache, the plan card catalogue in 12 languages.
- Added `decisions/second-look-on-samples.md`: the zoom check on the saved gallery readings and the crop sheets in the card.
- Added `decisions/judge-round-2.md`: test pages off, text-block exits, X-marked voids, step fixes, gallery order, exit labels and scores.
- Updated `components/plan-reader.md`, `timelines/photo-set-tests.md` and `index.md`.
- Source: the owner words of 2026-11-01, the judge review, the agent branches and the tests.

## [2026-11-01] ingest | Review fixes of judge review 2

- Updated `decisions/plan-language.md`: three hand fixes of the catalogue, English names for labels in another script, the language row on a phone.
- Source: the ux and a11y reviews of 2026-11-01 and the code.

## [2026-11-01] ingest | Exit y fix from a dev set

- Added `decisions/exit-y-fix.md`: the dev set, the fix, the checks on the point of the model, the rules and the prompt that did not ship.
- Updated `index.md`: the new page.
- Source: the agent branch judge2-acc, the dev labels and the tests.

## [2026-11-01] ingest | Demo video at phone size

- Updated `decisions/demo-video.md`: the phone layout, the reasons from the second judge review, the owner choice of samples only.
- Source: the owner words of 2026-11-01, the judge review and the new video.

## [2026-11-01] ingest | Third judge review

- Updated `decisions/judge-round-2.md`: the score of the third judge agent and the change of the first plans.
- Source: the judge report of 2026-11-01.

## [2026-11-01] ingest | Demo video as a motion graphic

- Updated `decisions/demo-video.md`: the owner request, the motion graphic and the check of the route.
- Source: the owner words of 2026-11-01 and the fact-check of the first render.

## [2026-11-02] ingest | Judge review 3

- Added `decisions/judge-round-3.md`: far zoom points, wall lines off the building, staircase walks, and why item 2 did not ship.
- Updated `decisions/second-look-on-samples.md` and `index.md`.
- Source: the third judge report, the agent branches judge3-exits and judge3-polish, the dev scores and the tests.

## [2026-11-01] ingest | DESIGN.md in the Google format

- Added `DESIGN.md` at the root: the design file of the page in the Google DESIGN.md format. It holds the tokens from `src/hereout/web/style.css`, the short design rules, the gaps from the house rules and the table of screens.
- Reason: the kit skill `core:design-foundation` (owner request, 2026-11-01).
- Source: `src/hereout/web/style.css`, `src/hereout/web/index.html` and `decisions/page-layout-a.md`.

## [2026-11-01] ingest | Afterglow redesign

- Added `decisions/afterglow-redesign.md`: the dark Afterglow look, the reveal of a plan, the stage strip, the tap prompt and the new example.
- Rewrote `DESIGN.md` for direction B (owner, 2026-11-01).
- Source: the owner request of 2026-11-01, the direction canvas, the UX and accessibility reviews, and the code.
- Updated `decisions/demo-video.md`: the fifth video records the real page after the redesign (RU-commons_000164, hub `film.mjs`).

## [2026-11-01] ingest | Vote of several reads

- Added `decisions/exit-vote.md` (rejected): three main reads and a vote on the dev set, at temperatures 0 and 0.7.
- Source: `scripts/vote_reads.py`, the saved dev reads and the owner request of 2026-11-01.

## [2026-11-01] ingest | Start page loop, header and credits page

- Added `decisions/start-page-loop.md`: the header links, the phone loop, the sample plans, the counts, the page `/credits` and one disclosure.
- Updated `decisions/afterglow-redesign.md` (Consequences) and `DESIGN.md`.
- Source: the owner request of 2026-11-01, the research brief of 2026-11-01 and the code.
## [2026-11-01] ingest | The current step under the plan

- Added `decisions/current-step-card.md`: the card of the current step under the plan, turn icons and the leg highlight with progress.
- The same page has the step dots and the arrow at YOU.
- It also has the tap on the dashed second way and the words on the exit buttons.
- Updated `DESIGN.md`: the token `done`, three components and the rules for them.
- Source: the research brief of 2026-11-01 (sections 0 and 2), the owner request, the browser checks at 390 and 1280.

## [2026-11-01] ingest | Fix round after the judge, UX and accessibility reviews

- Added `decisions/plan-page-fixes.md`: 20 fixes of the plan page and the start page.
- Updated `decisions/current-step-card.md` (the walk count, the dots, no card on wide screens) and `decisions/start-page-loop.md` (the lead, the loop with no header, no layout shift).
- Updated `DESIGN.md`: the token `done`, the view control, the steps, the card, the dots and the start page parts.
- Source: the findings of the judge agent and the two reviewers (owner, 2026-11-01), the browser checks at 195, 390 and 1280, and the code.

## [2026-11-01] ingest | One sample run on /review

- Added `decisions/sample-run.md`: the 203 sample photos once through the page of a local server. The results are on `/review/`, and the live server has `HEREOUT_REVIEW` set to 1.
- Source: `scripts/site_run.mjs`, the run output and the owner request of 2026-11-01.

## [2026-11-02] ingest | New example plan, main way lines, short motion

- Added `decisions/example-de023-main-lines.md`: the proposed example DE-commons_000023, the ways out as main lines, no step dots, a short reveal.
- Updated `DESIGN.md`: the ways out, the motion, the floor size of the marks, no step dots.
- Source: the owner request of 2026-11-02, the exit scores of `scripts/score_exits.py` and checks by eye.

## [2026-11-02] ingest | Connected way lines and a location dot

- Updated `decisions/example-de023-main-lines.md`: every way line shown joins an exit (only short spurs go), and the start is a location dot with no text.
- Updated `DESIGN.md`: the ways out and the start mark.
- Source: the owner verdict of 2026-11-02 on the first preview.

## [2026-11-02] ingest | One route colour and a smooth start pick

- Added `decisions/start-pick-flow.md`: one route colour, the tap reach of a fingertip, no dot with no route, the dot motion, the focus frame after a key.
- Updated `DESIGN.md`: the route colour, the turn icons, the plan marks and the start pick.
- Source: the owner request of 2026-11-02 and a frame record of the flow at 390 px and 1280 px.
- Updated `decisions/start-pick-flow.md` and `DESIGN.md` after the ux and a11y reviews: refusal on the plan, mark prompt, motion timing, dashed way.

## [2026-11-02] ingest | The Dresden example accepted

- Updated `decisions/example-de023-main-lines.md`: status accepted; the start page, the hero loop and the demo video use the new example.
- Source: the owner verdict of 2026-11-02 on preview 3.

## [2026-11-02] ingest | One route line, an iPhone frame and an About part

- Added `decisions/one-route-line.md`: one route width, no way lines under a route, a quiet second way, a phone frame.
- Updated `DESIGN.md`.
- Source: the owner verdict of 2026-11-02 on the demo video.

## [2026-11-03] ingest | Judge review 7

- Added `decisions/judge-round-7.md`: closed and lift exits dropped by label, and one number in exit names.
- The same page: a refused tap clears the route, a share card, and the view buttons on one row.
- Source: the judge 7 report of 2026-11-02 and the owner go-ahead of 2026-11-03.

## [2026-11-03] ingest | Exit accuracy tests

- Added `decisions/exit-snap-and-checks.md`: three accuracy ideas, none shipped.
- Source: the owner request of 2026-11-03 and the agent run on the dev set and the holdout photos.

## [2026-11-03] ingest | Judge review 8

- Added `decisions/judge-round-8.md`: step dips, lines past exits, refused marks, touch hints, English names for Latin labels, the code licence.
- Source: the judge 8 report and the owner request of 2026-11-03.

## [2026-11-03] ingest | Public docs cut down

- Updated `components/plan-reader.md`: an upload over 1 MB passes through a temporary file, deleted with the request.
- The README now opens with the diagram `docs/how-it-works.png` and three tables. The detail is in folded parts.
- Source: the owner request of 2026-11-03 and the fact check of the new text.
