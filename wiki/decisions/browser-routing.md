---
type: decision
title: Find the routes in the browser from an escape field
status: accepted
updated: 2026-10-27
sources:
  - owner:2026-10-27
  - src/hereout/route.py
  - src/hereout/web/route.js
  - tests/test_route_parity.py
---
# Find the routes in the browser from an escape field

## Context

- The owner asked on 2026-10-27 for all open ways to the exits, because the start of a person is not known before. The owner also asked for a map of these ways that the user can show and hide. Other requests: a view of the original photo, and a route from each spot that the user taps.
- Before this change, the server found one route with A* for each request. The server kept each upload for 15 minutes for a new route.

## Decision

- The server sends the wall grid with each plan: the blocked cells as packed bits.
- The browser finds the escape field: Dijkstra from all exits at the same time gives the cost to the nearest exit and the next cell for each open cell. A route from a tapped spot is a walk along the next cells.
- `route.js` does the same steps in the same order as `route.py` and `steps.py`. `tests/test_route_parity.py` runs node on the same grids and requires the same costs, routes and step text.
- The plan view has an "Escape map" layer, an "Original photo" view with no drawing, and exits with numbers.
- The server keeps no upload. The upload store and the route request were removed.

## Consequences

- A new start needs no server call. In node, the field for one gallery plan (320 by 226 cells, 15 exits) took about 100 ms. A route after a tap took less than 1 ms.
- A reload or a gallery link has all the data for new routes. The message "this photo is no longer on the server" is gone.
- A change of the route or step rules must change both files.
- The mark discs are now cleared in grid cells, not in image pixels. With this change, 185 of the 203 gallery plans have a route from "you are here". Before, 187 had a route.

## Related

- [Plan reader](../components/plan-reader.md)
- [Sample gallery](../components/gallery.md)
