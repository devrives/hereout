---
type: decision
title: Show the ways out as straight lines from door to door
status: accepted
updated: 2026-10-27
sources:
  - owner:2026-10-27
  - src/hereout/web/route.js
  - src/hereout/web/network-worker.js
  - src/hereout/web/app.js
  - tests/test_network.py
  - https://www.mdpi.com/2220-9964/8/2/60
  - https://www.scitepress.org/Papers/2020/94889/94889.pdf
  - https://www.cs.columbia.edu/~pblaer/projects/path_planner
  - https://ieeexplore.ieee.org/abstract/document/5650794/figures
  - https://arxiv.org/pdf/1401.3843
  - https://ar5iv.arxiv.org/html/0804.3868
  - https://roboticslab.uc3m.es/research-topics/fast-marching/
  - https://www.isprs.org/proceedings/2011/Gi4DM/PDF/OP05.pdf
  - https://ieeexplore.ieee.org/abstract/document/7487234
---
# Show the ways out as straight lines from door to door

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

- The first version (2026-10-27) used the medial axis of the open space. The owner found it still messy, and the connections were not easy to see. Its arrow heads cluttered the lines. In a large hall, the medial axis makes a large X.
- The network is now a door-to-door network (Liu and Zlatanova, GI4DM 2011). The steps are in `Network` in `src/hereout/web/route.js`:
  - Split the open space into rooms where it narrows. Rooms grow from the cells farthest from the walls. Two rooms meet at a door when the way is much narrower than the smaller room. This is a distance-transform room segmentation (Bormann and others, ICRA 2016).
  - The nodes are the exits, the doors and the middle of each room.
  - Join two nodes of one room with a straight line when no wall is between them. Otherwise, use the cheapest way, made straight where it can be.
  - The map draws the tree of shortest ways from the doors to the exits. It draws no arrow heads and no line that ends in the middle of a room.
- Two rooms that meet at more than one opening get a door at each opening. Doors closer than 8 % of the grid are one door. Doors and exits closer than 2.5 cells are one node.
- The tree uses each way's length to the power 1.2. So doors near each other join into one trunk line, and fans of lines are fewer.
- A route from a tap looks for nodes in its room and in the rooms up to two doors away, through any opening. Then it follows the tree to the exit.
- The route is then pulled tight: from each point it goes straight to the last later point in sight. So it does not hook back at a door.
- A door with nothing behind it draws no line, unless it leads straight to an exit.
- A route to a chosen exit uses the same network with a tree from that exit only.
- The wall lines are lighter than the ways out, and the ways out are wider. A way and a wall differ in more than hue (a11y review, 2026-10-27).
- The network and its routes are in the browser only. `route.py` keeps the grid field for the gallery route check and the scripts.
- A Web Worker makes the network (`web/network-worker.js`), so the page does not stop while the network is made (owner request, 2026-10-27). The worker sends back the rooms, the nodes and the ways as data. The page makes the trees again from them. Until the data comes, the page shows no route. Why: [Plan reader](../components/plan-reader.md).

## Consequences

- On PT-commons_000107 the map has trunk lines from the doors to the exits. A tap in the hall goes in one straight line to the nearest exit.
- On a 40 px grid of 955 starts on that plan, no route is more than 30 % longer than the grid route.
- The first door-to-door version kept one door for each pair of rooms. In the lower hall, 21 of 65 starts went to a far exit (ux review, 2026-10-27).
- Of 400 random taps, 335 have a way out. No leg goes through ink.
- The rooms and the lines are made once for each plan, in about 0.6 s in node. A chosen exit only needs a new tree. A tap takes about 20 ms.

## Related

- [Find the routes in the browser from an escape field](browser-routing.md)
- [Find the walls as straight lines](wall-lines.md)
- [Plan reader](../components/plan-reader.md)
