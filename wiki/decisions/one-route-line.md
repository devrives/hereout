---
type: decision
title: One route line, an iPhone frame and an About part
status: accepted
updated: 2026-11-02
checked: ea9132a
sources:
  - owner:2026-11-02
  - src/hereout/web/app.js
  - src/hereout/web/route.js
  - src/hereout/web/style.css
  - src/hereout/app.py
  - DESIGN.md
---
# One route line, an iPhone frame and an About part

## Context

- The owner watched the demo video (2026-11-02). The route must be one clean line that moves from the dot and reaches the exit.
- Frames of the video showed three faults:
  - The current step was a thick line and the next step a thin line. So a thick line stopped, and a thin line went on to the exit.
  - A faded green way line ran beside the route, a few pixels off. It looked like a second line stuck to the route.
  - The dashed second way faded in after the route was in, as a separate line. A later try put the dashed line in with the dot. It still showed a second line before the route (ux review), so the dashed line went.
- On other samples, some routes went up a corridor and came back down beside themselves.
- The owner also asked for a real iPhone frame in the demo, and for the intro parts that other hackathon entry sites show.

## Decision

- The route is one line of one width. It draws in from the dot with one moving end. From step 2 on, the walked legs are grey.
- With a route, the way lines go. The soft field near the exits stays at 50 %.
- The plan draws no second way. The card names the next exit, and its "If blocked" exit button draws it in as the route (owner, 2026-11-02).
- A route piece that comes back within 4 % of the long side of an earlier piece is cut straight across. The cut needs a clear way between the two pieces. A route around a real wall keeps its shape, for example on JP-commons_000268.
- The phone frame is an iPhone 14 Pro frame after devices.css (MIT) in graphite, with a status bar. The start page and the demo film use it.
- Apple's own bezels are not used. Their licence permits mock-ups only of software that runs only on Apple systems, and HereOut runs in any browser.
- The start page ends with "About HereOut": three short cards (why, Muse Spark, accuracy) and one line with who built it, with what, and links. These are the usual parts of a hackathon entry page.

## Consequences

- The route reads as one thing in the video and on the site.
- The hero loop, the example marks and the demo film are made again.
- [One route colour and a smooth start pick](start-pick-flow.md) keeps its colour rule. Its thin line for the later steps is gone.
