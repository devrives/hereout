---
type: index
title: HereOut wiki
updated: 2026-10-29
---
# HereOut wiki

This wiki records the decisions, the history and the reasons for HereOut. Git records each change. This wiki records why the change occurred.

Do not copy a fact value into this wiki. If the project has a fact registry (for example `products/<id>.yaml`), link to the fact.

Read `glossary.md` before you write. Read `log.md` to see the last operations.

## Decisions

- [Read plans with Muse Spark through Baseten](decisions/model-provider.md): model, endpoint and spend cap.
- [Find the routes in the browser from an escape field](decisions/browser-routing.md): escape map, routes from any spot, no upload store.
- [Show the ways out as straight lines from door to door](decisions/way-network.md): door-to-door network, routes along it.
- [Draw the ways out as one tree of level and upright lines](decisions/orthogonal-way-tree.md): proposed; lines along the two wall directions, joined at right angles.
- [Close the outside of the building and give closed rooms a door](decisions/outside-and-closed-rooms.md): proposed; fills, outside areas, exit placement and room doors with no model call.
- [Fix the weak plan types](decisions/weak-plan-types.md): proposed; photo maps, outdoor words, floors with no exit, legend frames, a new read of 30 plans.
- [Find the walls as straight lines](decisions/wall-lines.md): wall lines and blocks from the wall mask.
- [Check the exits with numbered marks](decisions/exit-mark-check.md): a second call keeps, moves or drops each exit (proposed).
- [Take the start from a tap, not from the model](decisions/start-from-tap.md): the model finds only the exits; the user taps the start.
- [Follow the printed escape routes in the way network](decisions/printed-route-marks.md): rejected; the lines still crossed walls.
- [Take the walls from all drawn ink](decisions/ink-walls.md): proposed; better on 2 of 7 plans, not on the gallery.
- [Test the wall methods on a small ground truth](decisions/wall-method-tests.md): three scores on 7 plans and the result of each method.

## Timelines

## Components

- [Plan reader](components/plan-reader.md): from a plan photo to a route and steps.
- [Sample gallery](components/gallery.md): open-licensed plan photos with saved readings.

## Incidents

## Concepts

- [Plan parsing methods to test](concepts/plan-parsing-methods.md): research of 2026-10-28 and the test order.
