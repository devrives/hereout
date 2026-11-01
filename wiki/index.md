---
type: index
title: HereOut wiki
updated: 2026-10-31
---
# HereOut wiki

This wiki records the decisions, the history and the reasons for HereOut. Git records each change. This wiki records why the change occurred.

Do not copy a fact value into this wiki. If the project has a fact registry (for example `products/<id>.yaml`), link to the fact.

Read `glossary.md` before you write. Read `log.md` to see the last operations.

## Decisions

- [Read plans with Muse Spark through Baseten](decisions/model-provider.md): model, endpoint and spend cap.
- [Find the routes in the browser from an escape field](decisions/browser-routing.md): escape map, routes from any spot, no upload store.
- [Upload as a job; no zoom call after a slow main call](decisions/slow-reads.md): no failed upload when the model is slow.
- [Page layout: plan beside the answer, with the logo](decisions/page-layout-a.md): header logo, answer card beside the plan.
- [Show the ways out as straight lines from door to door](decisions/way-network.md): door-to-door network, routes along it.
- [Draw the ways out as one tree of level and upright lines](decisions/orthogonal-way-tree.md): proposed; lines along the two wall directions, joined at right angles.
- [Close the outside of the building and give closed rooms a door](decisions/outside-and-closed-rooms.md): proposed; fills, outside areas, exit placement and room doors with no model call.
- [Fast processing of a new photo](decisions/photo-speed.md): accepted; one wall pass, text boxes during the model call, faster wall steps.
- [Short time limits for the model calls](decisions/call-timeouts.md): accepted; 45 s main call, 25 s zoom call, page stops at 3 minutes.
- [Polish for the judging criteria](decisions/judge-polish.md): accepted; a route example, plans open on the floor, tap checks, the Muse Spark reading.
- [Muse Spark reads the words on the plan and translates the plan view](decisions/plan-language.md): accepted; plan words, translation into 12 languages, plan card catalogue.
- [The second look on the gallery samples](decisions/second-look-on-samples.md): accepted; the zoom check on saved readings, crop sheets in the card.
- [Judge review 2](decisions/judge-round-2.md): accepted; test pages off, text-block exits, X-marked voids, step fixes, exit scores on labelled photos.
- [Demo video on the start page](decisions/demo-video.md): accepted; an MP4 file outside the repository, with the caption text and the photo credits.
- [Fast first tap and smaller sample plans](decisions/page-speed.md): accepted; the worker makes the trees to single exits, faster loops, sample images as WebP files.
- [One network of way lines: links between exits, lines along corridors](decisions/connected-way-lines.md): accepted; links join the exits, and corridors get lines.
- [Clean way lines: no jogs, closed gaps, routes on the lines](decisions/clean-way-lines.md): accepted; side steps, ticks and gaps go, and routes keep to the lines.
- [Inner walls much thinner than the outer walls](decisions/inner-wall-width.md): accepted; a long wide line is a wall, two other rules failed.
- [Faded ends of walls are walls](decisions/faded-wall-ends.md): accepted; ink in the line of a wall goes on as wall, unless it closes a door.
- [A walk outside from an exit mark to its door](decisions/exit-walk-outside.md): accepted; an exit mark on the street gets a way to its door.
- [Turn words from the main leg of a walk](decisions/step-turns-main-leg.md): accepted; a side step does not make a right angle a slight turn.
- [Links start on the drawn lines](decisions/links-on-drawn-lines.md): accepted; links join the drawn lines, and side steps get words in their place.
- [Fix the weak plan types](decisions/weak-plan-types.md): accepted; photo maps, outdoor words, floors with no exit, legends, a new read of 30 plans, gallery speed.
- [Find the walls as straight lines](decisions/wall-lines.md): wall lines and blocks from the wall mask.
- [Check the exits with numbered marks](decisions/exit-mark-check.md): a second call keeps, moves or drops each exit (proposed).
- [Take the start from a tap, not from the model](decisions/start-from-tap.md): the model finds only the exits; the user taps the start.
- [Follow the printed escape routes in the way network](decisions/printed-route-marks.md): rejected; the lines still crossed walls.
- [Take the walls from all drawn ink](decisions/ink-walls.md): proposed; better on 2 of 7 plans, not on the gallery.
- [Test the wall methods on a small ground truth](decisions/wall-method-tests.md): three scores on 7 plans and the result of each method.

## Timelines

- [Tests on photo sets](timelines/photo-set-tests.md): runs of the plan reader on photo sets, with time, cost and a check by eye.

## Components

- [Plan reader](components/plan-reader.md): from a plan photo to a route and steps.
- [Sample gallery](components/gallery.md): open-licensed plan photos with saved readings and saved answers.

## Incidents

## Concepts

- [Plan parsing methods to test](concepts/plan-parsing-methods.md): research of 2026-10-28 and the test order.
