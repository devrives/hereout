---
type: decision
title: Show the ways out as straight centre lines of the open space
status: accepted
updated: 2026-10-27
sources:
  - owner:2026-10-27
  - src/hereout/web/route.js
  - src/hereout/web/app.js
  - tests/test_network.py
  - https://www.mdpi.com/2220-9964/8/2/60
  - https://www.scitepress.org/Papers/2020/94889/94889.pdf
  - https://www.cs.columbia.edu/~pblaer/projects/path_planner
  - https://ieeexplore.ieee.org/abstract/document/5650794/figures
  - https://arxiv.org/pdf/1401.3843
  - https://ar5iv.arxiv.org/html/0804.3868
  - https://roboticslab.uc3m.es/research-topics/fast-marching/
---
# Show the ways out as straight centre lines of the open space

## Context

- On 2026-10-27 the owner looked at the escape map of PT-commons_000107. The ways out were not clean straight lines.
- The owner asked for lines that connect all open space to the exits and keep away from the walls. Routes must follow these lines.
- Before this change, the map drew the steps of the grid field where many routes join. These lines had steps of 45 degrees, and they went near the walls at corners.

## Options

We looked at these methods:

- Medial axis or Voronoi roadmap: the lines are the points that are at the same distance from two walls. Robot planners use it for the most clearance (Columbia path planner page; Lau, Sprunk and Burgard, IROS 2010). Indoor navigation networks from floor plans use the same idea (ISPRS IJGI 2019; Clementini and Pagliaro, GISTAM 2020).
- Theta*: a grid search whose paths can go at any angle (Daniel, Nash, Koenig and Felner, JAIR 2010). The paths are straight, but they touch the corners of the walls. It gives one path for each start, not a network.
- Fast marching and Fast Marching Square: a smooth distance field, with paths that keep away from walls (Kretz and others 2008; UC3M robotics lab). It gives smooth paths for each start, not lines to draw.

## Decision

- Use the medial axis of the open space as the network. The steps are in `Network` in `src/hereout/web/route.js`:
  - Thin the open cells with a way to an exit to lines one cell wide (Zhang and Suen thinning).
  - Ignore small islands of ink in the open space. They are text and symbols.
  - Make a tree of the shortest ways along the lines from the exits.
  - Cut the short branches into corners.
  - Make each branch straight with Douglas-Peucker. A straight leg never goes through ink.
- A route from a tap goes straight to the line point with the lowest total cost that the start can see. Then it follows the lines to the exit. The grid route is the fallback.
- A route skips to the last point of its way that the start can see. Without this, a start near an exit walked to a line and back (ux review, 2026-10-27).
- The map does not draw a leg with almost no open space behind it. A tap there still goes to a line.
- The lines are opaque, and the thinnest line is about 1 CSS px on a phone. Over a photo, the lines with alpha were below 3:1 contrast at many points (a11y review, 2026-10-27).
- The network and its routes are in the browser only. `route.py` keeps the grid field for the gallery route check and the scripts.

## Consequences

- On PT-commons_000107 the map shows straight lines along the hall, the corridors and the strip outside. The large hall has loops around the columns.
- Of 400 random taps on that plan, 243 have a way out. All 243 follow the network, and no leg goes through ink.
- For 598 routes to one chosen exit, the steps have 8 turns back. The grid routes had 33. 58 routes are longer than the grid route by more than 5 % of the plan diagonal.
- An exit button builds the network for its exit. On a slow phone this can take 0.7 s, so the page says "Finding the route" first.
- In headless Chromium, the network of that plan took 120 to 250 ms. A route after a tap took about 2 ms.
- A corner of a large room has no line, because the cut removes the branches into corners. A tap there goes straight to the nearest line that it can see.

## Related

- [Find the routes in the browser from an escape field](browser-routing.md)
- [Plan reader](../components/plan-reader.md)
