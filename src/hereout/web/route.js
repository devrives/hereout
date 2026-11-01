"use strict";

// The escape field and the steps, as in route.py and steps.py. The same grid
// gives the same field, routes and steps in both (tests/test_route_parity.py).
// Change both together. The way network and the routes along it are browser
// only (tests/test_network.py).
const HereOutRoute = (() => {
  const SNAP_SHARE = 0.06;
  const TAP_REACH_SHARE = 0.025;  // a tap on a wall moves to open floor this share of the grid away at most (Field.tapStart)
  const TAP_EDGE_SHARE = 0.01;    // a tap this share of the grid outside the open floor box still counts (its outer wall)
  const TAP_ISLAND_SHARE = 0.005; // ink apart from the walls up to this share of the grid cells is a symbol or a label on the floor
  const MARK_CLEAR_SHARE = 0.012;
  const SOFT_COST = 10.0;  // extra cost of a cell on a soft line, as in route.py
  const EXIT_REACH_SHARE = 0.015;  // an exit reaches the open cells this close, on each side of its line
  const WALL_COST = 2.0;
  const CHAMFER_A = 0.955, CHAMFER_B = 1.3693;
  const FAR = 1e9;
  const SQRT2 = Math.SQRT2;
  const ALONG_TILT = 0.035;   // radians (2 degrees): a leg this close to a wall direction runs along the walls
  const ALONG_MARGIN = 0.05;
  const LOCAL_LONGER = 1.15;  // a way along the local walls may be this much longer than the way it replaces  // share of the length: a smaller difference in alongWalls is a tie
  const EXIT_APART = 0.05;  // share of the grid: two exits closer than this are one door for the second exit
  const NEIGHBOURS = [[-1, 0, 1.0], [1, 0, 1.0], [0, -1, 1.0], [0, 1, 1.0],
                      [-1, -1, SQRT2], [-1, 1, SQRT2], [1, -1, SQRT2], [1, 1, SQRT2]];
  // The same moves as typed arrays, for the loops that run on every cell.
  const N_DR = Int8Array.from(NEIGHBOURS, (q) => q[0]);
  const N_DC = Int8Array.from(NEIGHBOURS, (q) => q[1]);
  const N_STEP = Float64Array.from(NEIGHBOURS, (q) => q[2]);
  const SIMPLIFY_SHARE = 0.015;
  const MIN_LEG_SHARE = 0.03;
  const MAIN_LEG_SHARE = 0.6;   // legs of one way this share of a walk or more give the walk its heading
  const SAME_WAY = 10;          // degrees: legs within this of each other go the same way
  const END_WAY_SHARE = 0.35;   // with no main way, a walk starts and ends on legs of a way this share of it or more
  const SPLIT_PASSES = 4;       // passes that split walks with a turn between their two ways
  const SIDE_STEP_SHARE = 0.02;  // a straight walk that ends farther than this share of the plan to one side has a side step
  const SLANT_ANGLE = 50;       // degrees: two ways this close that take turns are one slanted way drawn on the grid
  const SLANT_SHARE = 0.85;     // those two ways are this share of the walk or more
  const SLANT_TURNS = 3;        // and the walk changes between them this many times or more
  const STAIR_ANGLE = 90 + SAME_WAY;  // degrees: two square ways that take turns in short legs are a slanted way too (slanted)
  const STAIR_PART = 0.5;       // in such a staircase, no leg is more than this share of its way
  const STAIR_EVEN = 0.25;      // and the smaller way is this share of the two or more (a diagonal, not a walk with jogs)

  class NoRoute extends Error {}

  // Blocked cells from the packed bits the server sends, first bit high.
  function decodeGrid(grid) {
    const raw = atob(grid.bits);
    const n = grid.w * grid.h;
    const blocked = new Uint8Array(n);
    for (let i = 0; i < n; i++) blocked[i] = (raw.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
    return blocked;
  }

  // A binary heap of cells by cost in typed arrays, smallest cost first, then
  // smallest cell, the order of Python tuples in heapq. No two entries are
  // the same pair, so it pops in the same order as heapq.
  // pop() gives the cell and leaves its cost in topCost.
  class Heap {
    constructor(size = 1024) { this.d = new Float64Array(size); this.i = new Int32Array(size); this.size = 0; this.topCost = 0; }
    push(d, i) {
      if (this.size === this.d.length) {
        const d2 = new Float64Array(this.size * 2), i2 = new Int32Array(this.size * 2);
        d2.set(this.d); i2.set(this.i); this.d = d2; this.i = i2;
      }
      const D = this.d, I = this.i;
      let k = this.size++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (D[p] < d || (D[p] === d && I[p] < i)) break;
        D[k] = D[p]; I[k] = I[p]; k = p;
      }
      D[k] = d; I[k] = i;
    }
    pop() {
      const D = this.d, I = this.i;
      const top = I[0];
      this.topCost = D[0];
      const n = --this.size;
      const d = D[n], i = I[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && (D[c + 1] < D[c] || (D[c + 1] === D[c] && I[c + 1] < I[c]))) c++;
        if (D[c] > d || (D[c] === d && I[c] > i)) break;
        D[k] = D[c]; I[k] = I[c]; k = c;
      }
      D[k] = d; I[k] = i;
      return top;
    }
  }

  // A binary heap of cells by cost in typed arrays, for the network only:
  // pop() gives the cell and leaves its cost in topCost.
  class CellHeap {
    constructor(size = 1024) { this.d = new Float64Array(size); this.i = new Int32Array(size); this.size = 0; this.topCost = 0; }
    push(d, i) {
      if (this.size === this.d.length) {
        const d2 = new Float64Array(this.size * 2), i2 = new Int32Array(this.size * 2);
        d2.set(this.d); i2.set(this.i); this.d = d2; this.i = i2;
      }
      const D = this.d, I = this.i;
      let k = this.size++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (D[p] <= d) break;
        D[k] = D[p]; I[k] = I[p]; k = p;
      }
      D[k] = d; I[k] = i;
    }
    pop() {
      const D = this.d, I = this.i;
      const top = I[0];
      this.topCost = D[0];
      const n = --this.size;
      const d = D[n], i = I[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && D[c + 1] < D[c]) c++;
        if (D[c] >= d) break;
        D[k] = D[c]; I[k] = I[c]; k = c;
      }
      D[k] = d; I[k] = i;
      return top;
    }
  }

  function wallDistance(blocked, gw, gh) {
    const d = new Float64Array(gw * gh);
    for (let i = 0; i < d.length; i++) d[i] = blocked[i] ? 0 : FAR;
    // The moves of each pass (rows, then columns) and their weights: the
    // first pass looks at the cells it passed, the second the other way.
    const fwdR = Int8Array.of(0, -1, -1, -1), fwdC = Int8Array.of(-1, -1, 0, 1);
    const backR = Int8Array.of(0, 1, 1, 1), backC = Int8Array.of(1, 1, 0, -1);
    const weight = Float64Array.of(CHAMFER_A, CHAMFER_B, CHAMFER_A, CHAMFER_B);
    const pass = (r, c, mdr, mdc) => {
      const i = r * gw + c;
      let best = d[i];
      for (let q = 0; q < 4; q++) {
        const nr = r + mdr[q], nc = c + mdc[q];
        if (nr >= 0 && nr < gh && nc >= 0 && nc < gw) {
          const v = d[nr * gw + nc] + weight[q];
          if (v < best) best = v;
        }
      }
      d[i] = best;
    };
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) pass(r, c, fwdR, fwdC);
    for (let r = gh - 1; r >= 0; r--) for (let c = gw - 1; c >= 0; c--) pass(r, c, backR, backC);
    return d;
  }

  // Cost to the nearest exit and the next cell, for every open cell.
  class Field {
    // soft: the cells of soft lines (door swings, dashes), or null. They can
    // be crossed, at a cost; a straight line of the map never crosses them.
    // axes: the two main directions of the walls in radians (route.py, wall_axes).
    // wing: a wing at an angle, { mask: its cells, axes: its directions } (route.py, wall_wing), or null.
    constructor(blocked, gw, gh, scale, exits, clear = [], soft = null, axes = [0, 0], wing = null) {
      Object.assign(this, { gw, gh, scale, exits, soft, axes, wing });
      blocked = Uint8Array.from(blocked);
      // A start can sit on ink, for example the plan's own "you are here"
      // dot: clear a small disc so it does not wall in its own point. An exit gets no disc, as in route.py: a disc
      // would cut a door into the wall that the exit is on.
      const radius = MARK_CLEAR_SHARE * Math.max(gw, gh);
      const span = Math.trunc(radius) + 1;
      for (const [x, y] of clear) {
        const [r0, c0] = this.toCell([x, y]);
        for (let r = Math.max(0, r0 - span); r < Math.min(gh, r0 + span + 1); r++) {
          for (let c = Math.max(0, c0 - span); c < Math.min(gw, c0 + span + 1); c++) {
            if ((r - r0) ** 2 + (c - c0) ** 2 <= radius * radius) blocked[r * gw + c] = 0;
          }
        }
      }
      this.blocked = blocked;
      const wd = wallDistance(blocked, gw, gh);
      this.wd = wd;
      const n = gw * gh;
      const cost = new Float64Array(n);
      for (let i = 0; i < n; i++) cost[i] = 1.0 + WALL_COST / (1.0 + wd[i]) + (soft && soft[i] ? SOFT_COST : 0);
      const dist = new Float64Array(n).fill(Infinity);
      const next = new Int32Array(n).fill(-1);
      const owner = new Int32Array(n).fill(-1);
      Object.assign(this, { dist, next, owner, cost });

      const heap = new Heap();
      this.seeds = exits.map((e) => this.exitCells(e));
      this.seeds.forEach((cells, k) => {
        for (const [g, d] of cells) if (d < dist[g]) { dist[g] = d; owner[g] = k; heap.push(d, g); }
      });
      while (heap.size) {
        const i = heap.pop(), d = heap.topCost;
        if (d > dist[i]) continue;
        const r = Math.floor(i / gw), c = i - r * gw;
        const stepCost = cost[i];
        for (let q = 0; q < 8; q++) {
          const nr = r + N_DR[q], nc = c + N_DC[q];
          if (nr < 0 || nr >= gh || nc < 0 || nc >= gw) continue;
          const j = nr * gw + nc;
          if (blocked[j]) continue;
          // No corner cutting through the gap between two diagonal walls.
          if (q >= 4 && (blocked[r * gw + nc] || blocked[nr * gw + c])) continue;
          const nd = d + N_STEP[q] * stepCost;
          if (nd < dist[j]) { dist[j] = nd; next[j] = i; owner[j] = owner[i]; heap.push(nd, j); }
        }
      }
    }

    toCell([x, y]) {
      const c = Math.min(this.gw - 1, Math.max(0, Math.trunc(x * this.scale)));
      const r = Math.min(this.gh - 1, Math.max(0, Math.trunc(y * this.scale)));
      return [r, c];
    }

    toPx(i) {
      const r = Math.floor(i / this.gw), c = i - r * this.gw;
      return [(c + 0.5) / this.scale, (r + 0.5) / this.scale];
    }

    // The cell of a point, or the nearest open cell when it is in a wall.
    snap(xy) {
      const [r0, c0] = this.toCell(xy);
      if (!this.blocked[r0 * this.gw + c0]) return r0 * this.gw + c0;
      const limit = SNAP_SHARE * Math.max(this.gw, this.gh);
      const span = Math.trunc(limit);
      let best = null, bestD2 = Infinity;
      for (let r = Math.max(0, r0 - span); r < Math.min(this.gh, r0 + span + 1); r++) {
        for (let c = Math.max(0, c0 - span); c < Math.min(this.gw, c0 + span + 1); c++) {
          const d2 = (r - r0) ** 2 + (c - c0) ** 2;
          if (d2 < bestD2 && !this.blocked[r * this.gw + c]) { best = r * this.gw + c; bestD2 = d2; }
        }
      }
      if (best === null || Math.sqrt(bestD2) > limit) return null;
      return best;
    }

    // The share of all open cells in the open area of a point, or 0 when the
    // point is in a wall. A pocket of paper is small; a floor of the plan
    // with no exit on it is large.
    areaShare(xy) {
      const s = this.snap(xy);
      if (s === null) return 0;
      const { gw, gh, blocked } = this;
      const seen = new Uint8Array(gw * gh);
      const stack = [s];
      seen[s] = 1;
      let size = 0;
      while (stack.length) {
        const i = stack.pop();
        size++;
        const r = Math.floor(i / gw), c = i - r * gw;
        for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
          const j = rr * gw + cc;
          if (rr >= 0 && rr < gh && cc >= 0 && cc < gw && !blocked[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      let open = 0;
      for (let i = 0; i < gw * gh; i++) if (!blocked[i]) open++;
      return size / Math.max(1, open);
    }

    // The open cells that an exit reaches at once, with their distance in
    // cells, as in route.py: on each side of the line the exit is on, so no
    // hole is cut in the wall. Else the nearest open cell.
    exitCells(e) {
      const [r0, c0] = this.toCell(e);
      const reach = EXIT_REACH_SHARE * Math.max(this.gw, this.gh);
      const span = Math.trunc(reach);
      const out = [];
      for (let r = Math.max(0, r0 - span); r < Math.min(this.gh, r0 + span + 1); r++) {
        for (let c = Math.max(0, c0 - span); c < Math.min(this.gw, c0 + span + 1); c++) {
          const d = Math.sqrt((r - r0) ** 2 + (c - c0) ** 2);
          if (d <= reach && !this.blocked[r * this.gw + c]) out.push([r * this.gw + c, d]);
        }
      }
      if (out.length) return out;
      const g = this.snap(e);
      return g === null ? [] : [[g, 0]];
    }

    route(start) {
      if (!this.exits.length) throw new NoRoute("no exits");
      if (!this.owner.some((o) => o >= 0)) throw new NoRoute("every exit is inside a wall");
      const s = this.snap(start);
      if (s === null) throw new NoRoute("start is inside a wall");
      if (this.owner[s] < 0) throw new NoRoute("no open way to an exit");
      const cells = [s];
      while (this.next[cells[cells.length - 1]] >= 0) cells.push(this.next[cells[cells.length - 1]]);
      const k = this.owner[s];
      const pts = cells.map((i) => this.toPx(i));
      pts[0] = [start[0], start[1]];
      if (pts.length === 1) pts.push([...this.exits[k]]);
      else pts[pts.length - 1] = [...this.exits[k]];
      return { points: pts, exitIndex: k };
    }

    // A number for each open area: two cells with the same number have a way
    // between them, with the same moves as the field. Browser only.
    areas() {
      if (this._areas) return this._areas;
      const { gw, gh, blocked } = this;
      const area = new Int32Array(gw * gh).fill(-1);
      const todo = new Int32Array(gw * gh);  // each cell goes on it once
      let n = 0;
      for (let s = 0; s < area.length; s++) {
        if (blocked[s] || area[s] >= 0) continue;
        let top = 0;
        todo[top++] = s;
        area[s] = n;
        while (top) {
          const i = todo[--top];
          const r = Math.floor(i / gw), c = i - r * gw;
          for (let q = 0; q < 8; q++) {
            const nr = r + N_DR[q], nc = c + N_DC[q];
            if (nr < 0 || nr >= gh || nc < 0 || nc >= gw) continue;
            const j = nr * gw + nc;
            if (blocked[j] || area[j] >= 0) continue;
            if (q >= 4 && (blocked[r * gw + nc] || blocked[nr * gw + c])) continue;
            area[j] = n;
            todo[top++] = j;
          }
        }
        n++;
      }
      this._areas = area;
      return area;
    }

    // The cost of the way from a start to each exit (Infinity where there is
    // none): one Dijkstra from the start, with the moves and costs of the
    // field. Browser only.
    // avoid: [x, y, radius] in pixels, a disc that the ways may not enter
    // (the area of an exit that is blocked).
    exitCosts(start, avoid = null) {
      const s = this.snap(start);
      const out = this.exits.map(() => Infinity);
      if (s === null) return out;
      const { gw, gh, cost } = this;
      let blocked = this.blocked;
      if (avoid) {
        blocked = Uint8Array.from(blocked);
        const [ax, ay, ar] = avoid.map((v) => v * this.scale);
        for (let r = Math.max(0, Math.floor(ay - ar)); r <= Math.min(gh - 1, Math.ceil(ay + ar)); r++) {
          for (let c = Math.max(0, Math.floor(ax - ar)); c <= Math.min(gw - 1, Math.ceil(ax + ar)); c++) {
            if ((c + 0.5 - ax) ** 2 + (r + 0.5 - ay) ** 2 <= ar * ar && r * gw + c !== s) blocked[r * gw + c] = 1;
          }
        }
      }
      const dist = new Float64Array(gw * gh).fill(Infinity);
      const heap = new Heap();
      dist[s] = 0;
      heap.push(0, s);
      while (heap.size) {
        const i = heap.pop(), d = heap.topCost;
        if (d > dist[i]) continue;
        const r = Math.floor(i / gw), c = i - r * gw;
        for (let q = 0; q < 8; q++) {
          const nr = r + N_DR[q], nc = c + N_DC[q];
          if (nr < 0 || nr >= gh || nc < 0 || nc >= gw) continue;
          const j = nr * gw + nc;
          if (blocked[j]) continue;
          if (q >= 4 && (blocked[r * gw + nc] || blocked[nr * gw + c])) continue;
          const nd = d + N_STEP[q] * cost[i];
          if (nd < dist[j]) { dist[j] = nd; heap.push(nd, j); }
        }
      }
      this.seeds.forEach((cells, k) => { for (const [g, e] of cells) out[k] = Math.min(out[k], dist[g] + e); });
      return out;
    }

    // The radius in pixels of the area of one door: exits closer than this
    // to each other are the same door twice.
    doorRadius() {
      return EXIT_APART * Math.max(this.gw, this.gh) / this.scale;
    }

    // The nearest exit by the cost of the way from a start, or -1.
    nearestExit(start) {
      const costs = this.exitCosts(start);
      let best = -1;
      costs.forEach((c, k) => { if (Number.isFinite(c) && (best < 0 || c < costs[best])) best = k; });
      return best;
    }

    // Other exits for a start, nearest first, for the case that exit main is
    // blocked: the ways to them may not pass the door of exit main, and an
    // exit at that door is the same door. Empty when there is none.
    otherExits(start, main) {
      const apart = this.doorRadius();
      const [mx, my] = this.exits[main];
      const costs = this.exitCosts(start, Math.hypot(start[0] - mx, start[1] - my) > apart ? [mx, my, apart / 2] : null);
      return costs.map((c, k) => [c, k])
        .filter(([c, k]) => k !== main && Number.isFinite(c) && Math.hypot(this.exits[k][0] - mx, this.exits[k][1] - my) >= apart)
        .sort((a, b) => a[0] - b[0]).map(([, k]) => k);
    }

    // The second exit for a start, or -1 (the nearest of otherExits).
    otherExit(start, main) {
      const others = this.otherExits(start, main);
      return others.length ? others[0] : -1;
    }

    // Is there a way from a start to exit k?
    reaches(start, k) {
      const s = this.snap(start);
      if (s === null) return false;
      const area = this.areas();
      return this.seeds[k].some(([g]) => area[g] === area[s]);
    }

    // The box [x0, y0, x1, y1] in pixels round all open cells, or null when
    // no cell is open. Outside the floor box of the model every cell is
    // wall, so this is the floor drawing as HereOut reads it. Browser only.
    openBox() {
      if (this._openBox !== undefined) return this._openBox;
      const { gw, gh, blocked, scale } = this;
      let c0 = gw, r0 = gh, c1 = -1, r1 = -1;
      for (let r = 0; r < gh; r++) {
        for (let c = 0; c < gw; c++) {
          if (blocked[r * gw + c]) continue;
          if (c < c0) c0 = c;
          if (c > c1) c1 = c;
          if (r < r0) r0 = r;
          r1 = r;
        }
      }
      this._openBox = c1 < 0 ? null : [c0 / scale, r0 / scale, (c1 + 1) / scale, (r1 + 1) / scale];
      return this._openBox;
    }

    // Where a tap starts a route (browser only):
    // { at: "open", cell } for a tap on open floor;
    // { at: "moved", cell } for a tap on a wall or ink with open floor at
    //   most TAP_REACH_SHARE of the grid away, or on an island of ink (a
    //   symbol or a label on the floor, at most TAP_ISLAND_SHARE of the
    //   cells): the nearest cell with a way out first, else the nearest
    //   open cell;
    // { at: "outside" } for a tap off the floor box (openBox), with
    //   TAP_EDGE_SHARE of the grid to spare for its outer walls;
    // { at: "wall" } for a tap in the box with no open floor that near.
    tapStart(xy) {
      const box = this.openBox();
      const [x, y] = xy;
      const edge = TAP_EDGE_SHARE * Math.max(this.gw, this.gh) / this.scale;
      if (!box || x < box[0] - edge || y < box[1] - edge || x > box[2] + edge || y > box[3] + edge) return { at: "outside" };
      const [r0, c0] = this.toCell(xy);
      const { gw, gh, blocked, owner } = this;
      if (!blocked[r0 * gw + c0]) return { at: "open", cell: r0 * gw + c0 };
      const reach = Math.max(TAP_REACH_SHARE * Math.max(gw, gh), this.islandReach(r0 * gw + c0));
      const span = Math.trunc(reach);
      let open = -1, openD = Infinity, way = -1, wayD = Infinity;
      for (let r = Math.max(0, r0 - span); r < Math.min(gh, r0 + span + 1); r++) {
        for (let c = Math.max(0, c0 - span); c < Math.min(gw, c0 + span + 1); c++) {
          const i = r * gw + c;
          if (blocked[i]) continue;
          const d = (r - r0) ** 2 + (c - c0) ** 2;
          if (d > reach * reach) continue;
          if (d < openD) { open = i; openD = d; }
          if (owner[i] >= 0 && d < wayD) { way = i; wayD = d; }
        }
      }
      if (way >= 0) return { at: "moved", cell: way };
      if (open >= 0) return { at: "moved", cell: open };
      return { at: "wall" };
    }

    // For a blocked cell on an island of ink (blocked cells with open
    // floor all round, at most TAP_ISLAND_SHARE of the grid), the distance
    // in cells within which open floor is sure to be: the size of the
    // island. Else 0: the cell is on the walls or outside the drawing.
    islandReach(i0) {
      const { gw, gh, blocked } = this;
      const most = TAP_ISLAND_SHARE * gw * gh;
      const seen = new Set([i0]);
      const todo = [i0];
      let c0 = gw, r0 = gh, c1 = 0, r1 = 0;
      while (todo.length) {
        const i = todo.pop();
        const r = Math.floor(i / gw), c = i - r * gw;
        if (r === 0 || c === 0 || r === gh - 1 || c === gw - 1) return 0;
        c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
        for (const j of [i - 1, i + 1, i - gw, i + gw]) {
          if (!blocked[j] || seen.has(j)) continue;
          if (seen.size >= most) return 0;
          seen.add(j);
          todo.push(j);
        }
      }
      return Math.max(c1 - c0, r1 - r0) + 2;
    }

    // The ways out as straight lines. Browser only.
    network() {
      if (!this._network) this._network = new Network(this);
      return this._network;
    }

    // Use a network that a worker made for the same grid, exits and marks.
    adoptNetwork(data) {
      this._network = Network.fromData(this, data);
    }

    // The network along the directions of the wing. Browser only.
    wingNetwork() {
      if (!this._wingNet) this._wingNet = new Network(this, this.wing.axes);
      return this._wingNet;
    }

    // Use a wing network that a worker made. One made here already stays.
    adoptWingNetwork(data) {
      if (!this._wingNet) this._wingNet = Network.fromData(this, data);
    }

    // Use a tree to exit only that a worker made (Network.treeData), in
    // the network, or in the wing network when wing is true.
    adoptTree(only, data, wing = false) {
      const net = wing ? this._wingNet : this._network;
      if (net && !net.trees.has(only)) net.trees.set(only, data);
    }

    // A route along the ways out to the nearest exit, or to exit only when
    // only is 0 or more. Null when the network has no way to that exit (then
    // the grid route of a field to that exit is the answer). Browser only.
    wayRoute(start, only = -1) {
      if (!this.exits.length) throw new NoRoute("no exits");
      if (!this.owner.some((o) => o >= 0)) throw new NoRoute("every exit is inside a wall");
      const s = this.snap(start);
      if (s === null) throw new NoRoute("start is inside a wall");
      if (this.owner[s] < 0) throw new NoRoute("no open way to an exit");
      // While a worker makes the network (waitForNetwork), the grid route
      // is the answer.
      const net = this._network || (this.waitForNetwork ? null : this.network());
      let r = net ? net.route(start, s, only) : null;
      // With a wing at an angle, the way can also go along the wing's own
      // directions. The way that follows the walls of the part it is in over
      // more of its length is the one the map shows; then the fewer corners.
      if (r && this.wing) {
        const w = this.wingNetwork().route(start, s, only);
        if (w && (only < 0 ? w.exitIndex === r.exitIndex : true)) {
          const a = this.alongWalls(w.points), b = this.alongWalls(r.points);
          if (a > b + ALONG_MARGIN || (a > b - ALONG_MARGIN && w.points.length < r.points.length)) r = w;
        }
      }
      if (r && this.wing) {
        // The length of the way changes as much as the points do.
        const points = this.squareLocal(r.points);
        r = { ...r, points, length: r.length === undefined ? undefined : r.length - polyLength(r.points) + polyLength(points) };
      }
      return r || (only < 0 ? this.route(start) : null);
    }

    // The tilt of the walls at a pixel point: the wing's or the rest's.
    tiltAt([x, y]) {
      const [r, c] = this.toCell([x, y]);
      return this.wing && this.wing.mask[r * this.gw + c] ? this.wing.axes[0] : this.axes[0];
    }

    // Is the straight line between two pixel points clear of walls?
    clearPx(p, q) {
      const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * this.scale * 3) + 1;
      for (let k = 0; k <= n; k++) {
        const [r, c] = this.toCell([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]);
        if (this.blocked[r * this.gw + c]) return false;
      }
      return true;
    }

    // A way that crosses from the wing to the rest follows the walls of one
    // part only. In each part, from each corner, go to the farthest later
    // corner in the same part that one straight line or one right angle
    // along the walls of that part reaches, clear of walls and not much
    // longer than the way it replaces. The ends stay.
    squareLocal(pts) {
      const out = [pts[0]];
      const run = (i, j) => pts.slice(i + 1, j + 1).reduce((a, q, k) => a + dist(q, pts[i + k]), 0);
      let i = 0;
      while (i < pts.length - 1) {
        const tilt = this.tiltAt(pts[i]);
        const u = [Math.cos(tilt), Math.sin(tilt)], v = [-u[1], u[0]];
        let best = i + 1, via = null;
        for (let j = pts.length - 1; j > i + 1; j--) {
          if (this.tiltAt(pts[j]) !== tilt) continue;
          const d = [pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]];
          const a = d[0] * u[0] + d[1] * u[1], b = d[0] * v[0] + d[1] * v[1];
          if (Math.abs(a) + Math.abs(b) > run(i, j) * LOCAL_LONGER) continue;
          const straight = Math.min(Math.abs(a), Math.abs(b)) < 1e-6 * Math.max(1, Math.abs(a) + Math.abs(b));
          const corners = straight ? [null] : [[pts[i][0] + u[0] * a, pts[i][1] + u[1] * a], [pts[i][0] + v[0] * b, pts[i][1] + v[1] * b]];
          const ok = corners.find((c) => (c ? this.clearPx(pts[i], c) && this.clearPx(c, pts[j]) && this.tiltAt(c) === tilt
                                            : this.clearPx(pts[i], pts[j])));
          if (ok !== undefined) { best = j; via = ok; break; }
        }
        if (via) out.push(via);
        out.push(pts[best]);
        i = best;
      }
      return out;
    }

    // The share of the length of a way whose legs run along the walls of the
    // part of the plan they are in: the wing (wing.axes) or the rest (axes).
    alongWalls(pts) {
      let along = 0, total = 0;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (!len) continue;
        const tilt = this.tiltAt([(x0 + x1) / 2, (y0 + y1) / 2]);
        let d = (Math.atan2(y1 - y0, x1 - x0) - tilt) % (Math.PI / 2);
        if (d < 0) d += Math.PI / 2;
        if (Math.min(d, Math.PI / 2 - d) < ALONG_TILT) along += len;
        total += len;
      }
      return total ? along / total : 1;
    }
  }

  // The network of the ways out (browser only): one tree of straight lines
  // from the exits, as a printed evacuation plan draws it. The steps:
  // 1. The main directions. Most walls of a building run along two
  //    directions; the server finds them (route.py, wall_axes).
  // 2. The frame: the grid sampled again along the two main directions. A
  //    line along a row or a column of the frame runs along the walls.
  // 3. Rooms: grow from the cells farthest from the walls, as water fills
  //    basins. Two rooms meet at a door when the way between them is much
  //    narrower than the smaller room (a distance-transform room
  //    segmentation, as in Bormann and others 2016). The middle of each room
  //    is a source of the tree.
  // 4. The tree grows from the exits in the four directions of the frame.
  //    Each turn costs TURN_COST cells and a cell near a wall costs more, so
  //    a line runs straight down the middle of a corridor and turns at a
  //    right angle. The source nearest to the tree joins it first. A cell of
  //    the tree costs only TREE_SHARE of its way to the exit, so the next
  //    line joins the lines already there at a right angle, and does not run
  //    beside them.
  // 5. A route from a tap goes the same way to the tree, then along the
  //    tree to its exit.
  const TURN_COST = 30;         // cells of way that one turn costs
  const TREE_SHARE = 0.25;      // a cell of the tree costs this share of its way to the exit
  const DOOR_RATIO = 0.7;       // a way narrower than this share of the smaller room is a door
  const MIN_ROOM = 2.5;         // cells from the wall; a smaller space is part of the room next to it
  const MIN_SPUR = 3;           // cells; a shorter line to a room middle is not drawn
  const BRIDGE_SHARE = 0.06;    // share of the frame: the longest bridge between the lines to two exits
  const HOOK_SHARE = 0.02;      // share of the frame: a shorter first leg of a line from a room middle is not drawn
  const STUB_SHARE = 0.015;     // share of the frame: how far a line goes into a room that only it serves
  const HALL_SHARE = 0.03;      // share of the open floor: a room this large (a hall, a lobby) has a line of its own
  const REACH_SHARE = 0.03;     // share of the frame: a shorter way from the door of a small room to a line is not drawn
  const STAIR_LEGS = 4;         // legs of a staircase that become one straight line
  const STAIR_SHARE = 0.05;     // share of the frame: the longest leg of a staircase
  const STAIR_SLOPE = 0.25;     // a staircase line is at least this steep (about 14 degrees)
  const STAIR_RUN = 0.08;       // share of the frame: a shorter staircase stays in steps (a slanted line is for a long slanted corridor)
  const STAIR_MANY = 6;         // legs: a staircase of this many legs becomes a line at half of STAIR_RUN
  const STAIR_FINE = 2.5;       // cells: a staircase of legs this short is a slanted line at a quarter of STAIR_RUN
  const COVER_SHARE = 0.06;     // share of the frame: a hall or corridor cell farther than this from every line gets a line
  const MAX_COVER = 40;         // lines added for the cover, at most
  const CORRIDOR = 4;           // a room this many times longer than wide is a corridor
  const PASS_STEPS = 8;         // points on the line of one move that must be clear of walls
  const DR = [0, 1, 0, -1], DC = [1, 0, -1, 0];  // the four moves: right, down, left, up
  const JOG_SHARE = 0.025;      // share of the frame: a shorter side step between two parallel lines goes
  const JOG_CLEAR = 0.5;        // a line that moves keeps this share of its distance to the walls
  const JOG_STEP = 0.5;         // cells: the places between the two lines of a jog that both may move to
  const GAP_CELLS = 3;          // cells: a line that ends nearer than this to another line joins it
  const TRIM_SHARE = 0.04;      // share of the frame: the floor this near (in moves) to a line is near it
  const TRIM_LEFT = 2;          // cells: a dead end shorter than this after a trim goes
  const SNAP_PASSES = 3;        // passes of the move of route runs onto the drawn lines
  const FIRST_SHIFT = 0.25;     // the first piece of a route moves onto a line by this share of its length at most
  const JOG_SOFT = 4;           // points on soft lines that a moved line may gain: one crossing, not a run along one

  // The move of the state of cell i with the least cost in a tree (the
  // first on a tie), or -1 when every state of the cell costs Infinity.
  function bestMove(dist, i) {
    let bs = 4 * i;
    for (let m = 1; m < 4; m++) if (dist[4 * i + m] < dist[bs]) bs = 4 * i + m;
    return Number.isFinite(dist[bs]) ? bs & 3 : -1;
  }

  class Network {
    // axes: the directions of the frame; a second network along the
    // directions of a wing gives the lines inside the wing (mergeWing).
    constructor(field, axes = null) {
      this.field = field;
      this.ink = inkOf(field);
      const [a, b] = axes || field.axes;
      this.makeFrame(a, b);
      this.findRooms();
      // Sources: the middle of each room that is not too small.
      this.sources = [];
      for (const [root, cell] of this.middles) if (this.wd[cell] >= MIN_ROOM && root >= 0) this.sources.push(cell);
      this.exitSeeds = field.exits.map((e, k) => this.frameSeeds(k));
      this.trees = new Map();
      const t = this.tree(-1);
      if (!axes && field.wing) t.legs = this.mergeWing(t.legs, new Network(field, field.wing.axes).legs);
      Object.assign(this, { legs: t.legs });
    }

    // The lines of the map with a wing at an angle: the lines of this network
    // outside the wing, and the lines of the wing's own network inside it.
    // Where a line of each leaves the edge of the wing near the other, a
    // short straight line joins the two cut ends. A cut end with no other
    // cut end near joins the nearest line of the other part.
    mergeWing(main, wing) {
      const f = this.field, mask = f.wing.mask;
      const inWing = (p) => { const [r, c] = f.toCell(p); return mask[r * f.gw + c] === 1; };
      const clip = (legs, keep) => {
        const out = [], ends = [];
        for (const l of legs) {
          const n = Math.max(1, Math.ceil(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]) * f.scale * 2));
          let start = null, last = l.a;
          for (let k = 0; k <= n; k++) {
            const p = [l.a[0] + ((l.b[0] - l.a[0]) * k) / n, l.a[1] + ((l.b[1] - l.a[1]) * k) / n];
            if (inWing(p) === keep) {
              if (!start) { start = p; if (k > 0) ends.push({ p, flow: l.flow }); }
            } else if (start) {
              out.push({ ...l, a: start, b: last });
              ends.push({ p: last, flow: l.flow });
              start = null;
            }
            last = p;
          }
          if (start) out.push({ ...l, a: start, b: l.b });
        }
        return [out.filter((l) => l.a[0] !== l.b[0] || l.a[1] !== l.b[1]), ends];
      };
      const [outside, mainEnds] = clip(main, false);
      const [inside, wingEnds] = clip(wing, true);
      const legs = [...outside, ...inside];
      const reach = (BRIDGE_SHARE * Math.max(this.fw, this.fh)) / f.scale;
      const open = (p, q) => {
        const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * f.scale * 3) + 1;
        for (let k = 0; k <= n; k++) {
          const [r, c] = f.toCell([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
          if (f.blocked[r * f.gw + c]) return false;
        }
        return true;
      };
      const used = new Set(), joined = new Set();
      wingEnds.forEach((w, j) => {
        let best = -1, bestD = reach;
        mainEnds.forEach((m, k) => {
          const d = Math.hypot(m.p[0] - w.p[0], m.p[1] - w.p[1]);
          if (!used.has(k) && d < bestD && open(w.p, m.p)) { best = k; bestD = d; }
        });
        if (best >= 0) {
          used.add(best);
          joined.add(j);
          legs.push({ a: w.p, b: mainEnds[best].p, flow: Math.max(w.flow, mainEnds[best].flow), join: true });
        }
      });
      // A cut end with no cut end near joins the nearest point of a line of
      // the other part.
      const nearest = (p, lines) => {
        let best = null, bestD = reach;
        for (const l of lines) {
          const dx = l.b[0] - l.a[0], dy = l.b[1] - l.a[1], len2 = dx * dx + dy * dy;
          const t = len2 ? Math.max(0, Math.min(1, ((p[0] - l.a[0]) * dx + (p[1] - l.a[1]) * dy) / len2)) : 0;
          const q = [l.a[0] + t * dx, l.a[1] + t * dy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d < bestD && open(p, q)) { best = q; bestD = d; }
        }
        return best;
      };
      // Only to a line of another piece: a join inside one piece makes a
      // small loop, and a second join at the same end adds nothing.
      const tol = 1.5 / f.scale;
      const piece = legs.map((l, k) => k);
      const find = (k) => { while (piece[k] !== k) k = piece[k] = piece[piece[k]]; return k; };
      const onLeg = (p, l) => {
        const dx = l.b[0] - l.a[0], dy = l.b[1] - l.a[1], len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((p[0] - l.a[0]) * dx + (p[1] - l.a[1]) * dy) / len2)) : 0;
        return Math.hypot(l.a[0] + t * dx - p[0], l.a[1] + t * dy - p[1]) <= tol;
      };
      const pieceAt = (p) => { const k = legs.findIndex((l) => onLeg(p, l)); return k < 0 ? -1 : find(k); };
      for (let j = 0; j < legs.length; j++) {
        for (let k = 0; k < j; k++) {
          if (onLeg(legs[j].a, legs[k]) || onLeg(legs[j].b, legs[k]) || onLeg(legs[k].a, legs[j]) || onLeg(legs[k].b, legs[j])) piece[find(j)] = find(k);
        }
      }
      const loose = [...wingEnds.filter((w, j) => !joined.has(j)).map((w) => [w, outside]),
                     ...mainEnds.filter((m, k) => !used.has(k)).map((m) => [m, inside])];
      for (const [e, lines] of loose) {
        const from = pieceAt(e.p);
        const q = nearest(e.p, lines.filter((l) => { const k = pieceAt(l.a); return k < 0 || k !== from; }));
        if (!q) continue;
        const to = pieceAt(q);
        legs.push({ a: e.p, b: q, flow: e.flow, join: true });
        piece.push(legs.length - 1);
        if (from >= 0) piece[find(legs.length - 1)] = from;
        if (to >= 0) piece[find(to)] = find(legs.length - 1);
      }
      return legs;
    }

    // The frame: cell (r, c) of the frame has its middle at grid point
    // M (c + 0.5 + a0, r + 0.5 + b0), with M = [u v], u along the walls near
    // the x axis and v along the walls near the y axis.
    makeFrame(a, b) {
      const { gw, gh } = this.field;
      const u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(b), Math.cos(b)];
      const det = u[0] * v[1] - v[0] * u[1];
      const inv = [v[1] / det, -v[0] / det, -u[1] / det, u[0] / det];
      const ab = (x, y) => [inv[0] * x + inv[1] * y, inv[2] * x + inv[3] * y];
      const corners = [[0, 0], [gw, 0], [0, gh], [gw, gh]].map(([x, y]) => ab(x, y));
      const a0 = Math.min(...corners.map((q) => q[0])), b0 = Math.min(...corners.map((q) => q[1]));
      const fw = Math.ceil(Math.max(...corners.map((q) => q[0])) - a0 - 1e-9);
      const fh = Math.ceil(Math.max(...corners.map((q) => q[1])) - b0 - 1e-9);
      Object.assign(this, { axes: [a, b], u, v, inv, a0, b0, fw, fh });
      const n = fw * fh, f = this.field;
      const src = new Int32Array(n).fill(-1);
      const open = new Uint8Array(n), blocked = new Uint8Array(n), soft = new Uint8Array(n);
      for (let r = 0; r < fh; r++) {
        for (let c = 0; c < fw; c++) {
          const i = r * fw + c;
          const [x, y] = this.gridPoint(c + 0.5, r + 0.5);
          const gc = Math.floor(x), gr = Math.floor(y);
          if (gc < 0 || gc >= gw || gr < 0 || gr >= gh) { blocked[i] = 1; continue; }
          const g = gr * gw + gc;
          src[i] = g;
          blocked[i] = f.blocked[g];
          soft[i] = f.soft && f.soft[g] ? 1 : 0;
          open[i] = !blocked[i] && f.owner[g] >= 0 ? 1 : 0;
        }
      }
      // A move to the next cell of the frame is a short line on the grid.
      // In a turned frame it can cut the corner of a wall cell: such a move
      // is not made. pass: bit 1, the move right; bit 2, the move down.
      const pass = new Uint8Array(n);
      const clear = (i, j) => {
        const [x0, y0] = this.gridPoint(i % fw + 0.5, Math.floor(i / fw) + 0.5);
        const [x1, y1] = this.gridPoint(j % fw + 0.5, Math.floor(j / fw) + 0.5);
        for (let k = 1; k < PASS_STEPS; k++) {
          const t = k / PASS_STEPS;
          if (f.blocked[Math.floor(y0 + (y1 - y0) * t) * gw + Math.floor(x0 + (x1 - x0) * t)]) return false;
        }
        return true;
      };
      for (let i = 0; i < n; i++) {
        if (!open[i]) continue;
        const c = i % fw;
        if (c + 1 < fw && open[i + 1] && clear(i, i + 1)) pass[i] |= 1;
        if (i + fw < n && open[i + fw] && clear(i, i + fw)) pass[i] |= 2;
      }
      this.pass = pass;
      this.src = src;
      this.open = open;
      this.wd = wallDistance(blocked, fw, fh);
      this.cost = new Float64Array(n);
      for (let i = 0; i < n; i++) this.cost[i] = 1.0 + WALL_COST / (1.0 + this.wd[i]) + (soft[i] ? SOFT_COST : 0);
    }

    // Grid point of frame point (a, b), and the other way.
    gridPoint(a, b) {
      a += this.a0; b += this.b0;
      return [this.u[0] * a + this.v[0] * b, this.u[1] * a + this.v[1] * b];
    }

    framePoint(x, y) {
      const inv = this.inv;
      return [inv[0] * x + inv[1] * y - this.a0, inv[2] * x + inv[3] * y - this.b0];
    }

    // The pixel point of a frame point, and the frame cell of a pixel point.
    toPx([a, b]) {
      const [x, y] = this.gridPoint(a, b);
      return [x / this.field.scale, y / this.field.scale];
    }

    frameCell(px) {
      const [a, b] = this.framePoint(px[0] * this.field.scale, px[1] * this.field.scale);
      const c = Math.floor(a), r = Math.floor(b);
      if (c < 0 || c >= this.fw || r < 0 || r >= this.fh) return -1;
      return r * this.fw + c;
    }

    // The open frame cell nearest to a pixel point, at most `span` cells away.
    openNear(px, span = 3) {
      const i = this.frameCell(px);
      if (i >= 0 && this.open[i]) return i;
      const [a, b] = this.framePoint(px[0] * this.field.scale, px[1] * this.field.scale);
      let best = -1, bestD = Infinity;
      for (let r = Math.floor(b) - span; r <= Math.floor(b) + span; r++) {
        for (let c = Math.floor(a) - span; c <= Math.floor(a) + span; c++) {
          if (c < 0 || c >= this.fw || r < 0 || r >= this.fh || !this.open[r * this.fw + c]) continue;
          const d = (c + 0.5 - a) ** 2 + (r + 0.5 - b) ** 2;
          if (d < bestD) { bestD = d; best = r * this.fw + c; }
        }
      }
      return best;
    }

    // The frame cells that exit k reaches at once, with their cost.
    frameSeeds(k) {
      const f = this.field, seeds = new Map();
      for (const [g, d] of f.seeds[k]) {
        const i = this.openNear(f.toPx(g), 1);
        if (i >= 0 && (!seeds.has(i) || d < seeds.get(i))) seeds.set(i, d);
      }
      return [...seeds];
    }

    // The parts that take long to make, as plain data for postMessage.
    toData() {
      const t = this.tree(-1);
      return { axes: this.axes, room: this.room, open: this.open, pass: this.pass, wd: this.wd, cost: this.cost, src: this.src,
               middles: [...this.middles], sources: this.sources, exitSeeds: this.exitSeeds, tree: t };
    }

    // A tree to exit only as plain data for postMessage: only what route()
    // reads, one byte for each value. best: for each cell, the move of its
    // state with the least cost, or -1 when no state of the cell has a way.
    // prevMove: the move of the state before (its cell is one step back
    // along the move of the state), or -1. nextMove: the move to the next
    // cell of the tree, or -1. The owner of each tree cell is exit only.
    treeData(only) {
      const t = this.tree(only);
      const fw = this.fw, n = fw * this.fh;
      const best = new Int8Array(n), nextMove = new Int8Array(n), prevMove = new Int8Array(4 * n);
      const step = Int32Array.from(DR, (dr, m) => dr * fw + DC[m]);
      const moveOf = new Map([...step].map((d, m) => [d, m]));
      for (let i = 0; i < n; i++) {
        best[i] = bestMove(t.dist, i);
        const to = t.tnext[i];
        nextMove[i] = to < 0 ? -1 : moveOf.get(to - i);
      }
      for (let q = 0; q < 4 * n; q++) prevMove[q] = t.prev[q] < 0 ? -1 : t.prev[q] & 3;
      return { only, best, prevMove, nextMove, step };
    }

    static fromData(field, d) {
      const net = Object.create(Network.prototype);
      net.field = field;
      net.ink = inkOf(field);
      const [a, b] = d.axes;
      const u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(b), Math.cos(b)];
      const det = u[0] * v[1] - v[0] * u[1];
      const inv = [v[1] / det, -v[0] / det, -u[1] / det, u[0] / det];
      const corners = [[0, 0], [field.gw, 0], [0, field.gh], [field.gw, field.gh]]
        .map(([x, y]) => [inv[0] * x + inv[1] * y, inv[2] * x + inv[3] * y]);
      const a0 = Math.min(...corners.map((q) => q[0])), b0 = Math.min(...corners.map((q) => q[1]));
      const fw = Math.ceil(Math.max(...corners.map((q) => q[0])) - a0 - 1e-9);
      const fh = Math.ceil(Math.max(...corners.map((q) => q[1])) - b0 - 1e-9);
      Object.assign(net, { axes: d.axes, u, v, inv, a0, b0, fw, fh, room: d.room, open: d.open, pass: d.pass, wd: d.wd,
                           cost: d.cost, src: d.src, middles: new Map(d.middles), sources: d.sources,
                           exitSeeds: d.exitSeeds, trees: new Map([[-1, d.tree]]) });
      net.legs = d.tree.legs;
      return net;
    }

    // The tree from all exits, or from exit only when only is 0 or more:
    // the cost to the tree for each state (cell and the move that reached
    // it), the tree itself, and the lines of the map.
    tree(only) {
      if (this.trees.has(only)) return this.trees.get(only);
      const { fw, fh, open, cost, pass } = this;
      const n = fw * fh;
      const dist = new Float64Array(4 * n).fill(Infinity);
      const prev = new Int32Array(4 * n).fill(-1);
      const inTree = new Uint8Array(n);
      const tcost = new Float64Array(n);
      const tnext = new Int32Array(n).fill(-1);  // the next cell to the exit; -1 at an exit
      const towner = new Int32Array(n).fill(-1);
      const heap = new CellHeap();
      const seed = (i) => {
        const d = TREE_SHARE * tcost[i];
        for (let m = 0; m < 4; m++) {
          const s = 4 * i + m;
          if (d < dist[s]) { dist[s] = d; prev[s] = -1; heap.push(d, s); }
        }
      };
      this.exitSeeds.forEach((seeds, k) => {
        if (only >= 0 && k !== only) return;
        for (const [i, d] of seeds) {
          if (inTree[i] && tcost[i] <= d) continue;
          inTree[i] = 1; tcost[i] = d; towner[i] = k;
          seed(i);
        }
      });
      const grow = () => {
        while (heap.size) {
          const s = heap.pop(), d = heap.topCost;
          if (d > dist[s]) continue;
          const i = s >> 2, m = s & 3;
          const r = Math.floor(i / fw), c = i - r * fw;
          for (let m2 = 0; m2 < 4; m2++) {
            if (m2 === ((m + 2) & 3)) continue;
            const nr = r + DR[m2], nc = c + DC[m2];
            if (nr < 0 || nr >= fh || nc < 0 || nc >= fw) continue;
            const j = nr * fw + nc;
            if (!(m2 < 2 ? pass[i] & (m2 + 1) : pass[j] & (m2 - 1))) continue;
            const nd = d + cost[j] + (m2 === m ? 0 : TURN_COST);
            const s2 = 4 * j + m2;
            if (nd < dist[s2]) { dist[s2] = nd; prev[s2] = s; heap.push(nd, s2); }
          }
        }
      };
      grow();
      const best = (i) => {
        let s = -1;
        for (let m = 0; m < 4; m++) if (s < 0 || dist[4 * i + m] < dist[s]) s = 4 * i + m;
        return s;
      };
      // Each branch is its cells from the source to the tree cell it joins.
      const branches = [];
      const covers = new Set();  // the branches to the cover points
      const addBranch = (pickS) => {
        const cells = [];
        for (let s = pickS; s >= 0; s = prev[s]) {
          cells.push(s >> 2);
          if (inTree[s >> 2]) break;  // the first tree cell on the way is the join
        }
        for (let k = cells.length - 2; k >= 0; k--) {
          const i = cells[k], to = cells[k + 1];
          inTree[i] = 1; tnext[i] = to; towner[i] = towner[to];
          tcost[i] = tcost[to] + cost[i];
          seed(i);
        }
        branches.push(cells);
        grow();
        return cells;
      };
      // The size of each room, and the size of a hall.
      const area = new Map();
      let floor = 0;
      for (let i = 0; i < n; i++) if (open[i]) { floor++; area.set(this.room[i], (area.get(this.room[i]) || 0) + 1); }
      const hall = HALL_SHARE * floor;
      // Add the sources one by one, the nearest first.
      const left = new Set(this.sources.filter((i) => open[i]));
      while (left.size) {
        let pick = -1, pickS = -1;
        for (const i of left) {
          const s = best(i);
          if (inTree[i]) { pick = i; pickS = -1; break; }
          if (pickS < 0 || dist[s] < dist[pickS]) { pick = i; pickS = s; }
        }
        left.delete(pick);
        if (pickS < 0 || !Number.isFinite(dist[pickS])) continue;
        addBranch(pickS);
      }
      // The cover: one line for each room leaves long corridors with no line
      // at their far end. The cell of a corridor farthest from the lines (by
      // the moves of the tree) gets a line, until every corridor cell is
      // near a line. A room is a corridor when its floor is long for its
      // width: the width is twice the distance of its middle to the walls.
      // Rooms that are not long (offices, halls) get no lines of the cover.
      // A line of the cover is the way that a route from its far end takes
      // to the tree. It is drawn only: the tree does not grow from it, so
      // the routes stay as they are (the ux review found routes that went
      // the wrong way along lines of the cover).
      if (only < 0) {
        const covered = new Uint8Array(n);
        const corridor = new Set();
        for (const [root, cell] of this.middles) {
          const width = 2 * Math.max(1, this.wd[cell]);
          if ((area.get(root) || 0) >= hall && area.get(root) / (width * width) >= CORRIDOR) corridor.add(root);
        }
        const lim = COVER_SHARE * Math.max(fw, fh);
        const far = new Int32Array(n), q = new Int32Array(n);
        for (let round = 0; round < MAX_COVER; round++) {
          far.fill(-1);
          let h = 0, t = 0, pick = -1;
          for (let i = 0; i < n; i++) if (inTree[i] || covered[i]) { far[i] = 0; q[t++] = i; }
          while (h < t) {
            const i = q[h++];
            const r = Math.floor(i / fw), c = i - r * fw;
            for (let m2 = 0; m2 < 4; m2++) {
              const nr = r + DR[m2], nc = c + DC[m2];
              if (nr < 0 || nr >= fh || nc < 0 || nc >= fw) continue;
              const j = nr * fw + nc;
              if (far[j] >= 0 || !(m2 < 2 ? pass[i] & (m2 + 1) : pass[j] & (m2 - 1))) continue;
              far[j] = far[i] + 1;
              q[t++] = j;
              if (far[j] > lim && this.wd[j] >= MIN_ROOM && corridor.has(this.room[j]) && (pick < 0 || far[j] > far[pick])) pick = j;
            }
          }
          if (pick < 0) break;
          const s = best(pick);
          if (!Number.isFinite(dist[s])) break;
          const cells = [];
          for (let q2 = s; q2 >= 0; q2 = prev[q2]) {
            cells.push(q2 >> 2);
            if (inTree[q2 >> 2] || covered[q2 >> 2]) break;
          }
          for (let k = cells.length - 2; k >= 0; k--) {
            const i = cells[k], to = cells[k + 1];
            covered[i] = 1; tnext[i] = to; towner[i] = towner[to];
            tcost[i] = tcost[to] + cost[i];
          }
          branches.push(cells);
          covers.add(cells);
        }
      }
      // The flow: how many sources drain through each tree cell.
      const below = new Float64Array(n), belowTree = new Float64Array(n);
      for (const cells of branches) {
        for (let i = cells[0]; i >= 0; i = tnext[i]) { below[i] += 1; if (!covers.has(cells)) belowTree[i] += 1; }
      }
      const legs = [];
      const hook = HOOK_SHARE * Math.max(this.fw, this.fh);
      const stub = Math.round(STUB_SHARE * Math.max(this.fw, this.fh));
      const reach = REACH_SHARE * Math.max(this.fw, this.fh);
      const drawn = new Uint8Array(n);
      const lineOwner = new Int32Array(n).fill(-1);  // the exit of the line over each cell, or -1
      for (let cells of branches) {
        // A short line that no other line joins is not drawn.
        if (cells.length < MIN_SPUR && below[cells[1]] === 1 && tnext[cells[cells.length - 1]] >= 0) continue;
        // A line of the cover is there to reach the far part of a hall or a
        // corridor: all of it is drawn.
        if (!covers.has(cells)) {
          // A line from a room that no other line joins stops a short way
          // into the room, as the stub at a door of a printed plan.
          const home = this.room[cells[0]];
          let out = 0;
          while (out < cells.length && this.room[cells[out]] === home && below[cells[out]] === 1) out++;
          if (area.get(home) < hall) {
            // A small room (a toilet, a store, an office) has no line of its
            // own: its door joins the line outside, as on a printed plan. The
            // way from its door is drawn only when it is long: the far end of
            // a corridor. The part that other lines share stays.
            let k = out;
            while (k < cells.length && below[cells[k]] === 1) k++;
            cells = cells.slice(k - out >= reach ? out : k);
            if (cells.length < 2) continue;
          } else if (out < cells.length && this.room[cells[out]] !== home && out > stub) {
            cells = cells.slice(out - stub);
          } else {
            // A short last turn into the room middle is a hook: it goes too.
            let k = 1;
            while (k + 1 < cells.length && cells[k + 1] - cells[k] === cells[k] - cells[k - 1]) k++;
            if (k < hook && k + 1 < cells.length && below[cells[k]] === 1) cells = cells.slice(k);
          }
        }
        for (const i of cells) drawn[i] = 1;
        // Corners: where the line turns or its flow changes. A change of
        // flow is where another line joins: that point stays.
        const idx = [0], fixed = [true];
        for (let k = 1; k < cells.length - 1; k++) {
          const turn = cells[k + 1] - cells[k] !== cells[k] - cells[k - 1];
          const join = below[cells[k + 1]] !== below[cells[k]];
          if (turn || join) { idx.push(k); fixed.push(join); }
        }
        if (cells.length > 1) { idx.push(cells.length - 1); fixed.push(true); }
        const [cs, fs] = this.squareUp(idx.map((k) => cells[k]), fixed);
        // The flow of a leg is the flow at its end; a new corner takes the
        // flow of the next old one.
        const old = new Set(idx.map((k) => cells[k]));
        const flow = cs.map((c) => (old.has(c) ? below[c] : 0));
        for (let k = cs.length - 2; k >= 0; k--) if (!flow[k]) flow[k] = flow[k + 1];
        const pts = this.unstair(cs.map((c) => this.middle(c)), fs);
        for (let k = 0; k + 1 < pts.length; k++) {
          legs.push({ a: this.toPx(pts[k]), b: this.toPx(pts[k + 1]), flow: flow[pts[k + 1][2]] });
          this.cellsUnder(pts[k], pts[k + 1], (i) => { if (lineOwner[i] < 0) lineOwner[i] = towner[cells[cells.length - 1]]; });
        }
        const end = cells[cells.length - 1];
        if (tnext[end] < 0) {
          const pts = this.toExit(end, towner[end], cells.length > 1 ? cells[cells.length - 2] : -1);
          for (let k = 0; k < pts.length - 1; k++) legs.push({ a: pts[k], b: pts[k + 1], flow: below[end], exit: true });
        }
      }
      // Bridges: where the lines to two exits come close along a row or a
      // column of open cells, a straight line joins them, so the map shows
      // one network. The shortest bridge for each pair of exits.
      if (only < 0) {
        const reach = BRIDGE_SHARE * Math.max(fw, fh);
        const bridges = new Map();
        for (let i = 0; i < n; i++) {
          if (!drawn[i]) continue;
          const r = Math.floor(i / fw), c = i - r * fw;
          for (const [dr, dc] of [[0, 1], [1, 0]]) {
            for (let k = 1; k <= reach; k++) {
              const nr = r + dr * k, nc = c + dc * k;
              if (nr >= fh || nc >= fw) break;
              const j = nr * fw + nc;
              if (!open[j]) break;
              if (!inTree[j]) continue;
              if (drawn[j] && towner[j] !== towner[i] && k > 1) {
                const key = Math.min(towner[i], towner[j]) * 1e4 + Math.max(towner[i], towner[j]);
                if (!bridges.has(key) || k < bridges.get(key)[0]) bridges.set(key, [k, i, j]);
              }
              break;
            }
          }
        }
        for (const [, i, j] of bridges.values()) {
          legs.push({ a: this.toPx(this.middle(i)), b: this.toPx(this.middle(j)), flow: 1, bridge: true });
        }
        legs.push(...this.links(drawn, lineOwner, inTree, tnext, towner, tcost, [...bridges.keys()].map((key) => [Math.floor(key / 1e4), key % 1e4])));
      }
      // Joins: the tree cells where the flow changes, that is where another
      // line of the map joins.
      const joins = new Uint8Array(n);
      // Only the lines of the tree: a route keeps to these points.
      for (let i = 0; i < n; i++) if (inTree[i] && tnext[i] >= 0 && belowTree[tnext[i]] !== belowTree[i]) joins[tnext[i]] = 1;
      const t = { dist, prev, inTree, tcost, tnext, towner, legs: only < 0 ? this.schematize(legs) : legs, joins };
      this.trees.set(only, t);
      return t;
    }

    // Links: the lines to one exit make one tree. Where no bridge joins the
    // trees of two exits, the cheapest way on the open floor between their
    // lines (or their exits) joins them, the cheapest first, until all lines
    // that the floor connects are one network. The cost of a cell is the cost
    // of the tree, so a link keeps to the middle of the way, away from the
    // walls. A link splits where both exits are equally near (the cost of
    // the way out from each end added), and each half points to its exit.
    // joined: the pairs of exits that a bridge already joins. lineOwner:
    // the exit of the line over each cell, or -1.
    links(drawn, lineOwner, inTree, tnext, towner, tcost, joined) {
      const { fw, fh, pass, cost } = this;
      const n = fw * fh;
      const group = this.exitSeeds.map((_, k) => k);
      const find = (k) => { while (group[k] !== k) { group[k] = group[group[k]]; k = group[k]; } return k; };
      const unite = (a, b) => { a = find(a); b = find(b); if (a === b) return false; group[a] = b; return true; };
      for (const [a, b] of joined) unite(a, b);
      // Grow from all cells under the lines and exit cells at once, the
      // cheapest first. The cells under the lines, not the cells of the way
      // under them: a line goes straight where its way turns, and a link
      // must start on the line.
      const label = new Int32Array(n).fill(-1), from = new Int32Array(n).fill(-1);
      const dist = new Float64Array(n).fill(Infinity);
      const heap = new CellHeap();
      const lined = new Set();
      for (let i = 0; i < n; i++) {
        if (lineOwner[i] >= 0) lined.add(lineOwner[i]);
        const own = lineOwner[i] >= 0 ? lineOwner[i] : inTree[i] && tnext[i] < 0 ? towner[i] : -1;
        if (own >= 0) { label[i] = own; dist[i] = 0; heap.push(0, i); }
      }
      const moves = (i, visit) => {
        const r = Math.floor(i / fw), c = i - r * fw;
        for (let m = 0; m < 4; m++) {
          const nr = r + DR[m], nc = c + DC[m];
          if (nr < 0 || nr >= fh || nc < 0 || nc >= fw) continue;
          const j = nr * fw + nc;
          if (m < 2 ? pass[i] & (m + 1) : pass[j] & (m - 1)) visit(j);
        }
      };
      while (heap.size) {
        const i = heap.pop(), d = heap.topCost;
        if (d > dist[i]) continue;
        moves(i, (j) => {
          const nd = d + cost[j];
          if (nd < dist[j]) { dist[j] = nd; label[j] = label[i]; from[j] = i; heap.push(nd, j); }
        });
      }
      // Where the growths of two exits touch, that is a link between them.
      const meets = new Map();
      for (let i = 0; i < n; i++) {
        if (label[i] < 0) continue;
        moves(i, (j) => {
          if (label[j] < 0 || label[j] === label[i]) return;
          const a = Math.min(label[i], label[j]), b = Math.max(label[i], label[j]);
          const key = a * 1e4 + b, len = dist[i] + dist[j] + cost[j];
          if (!meets.has(key) || len < meets.get(key)[0]) meets.set(key, label[i] === a ? [len, i, j] : [len, j, i]);
        });
      }
      const legs = [];
      const back = (i) => { const out = []; for (let q = i; q >= 0; q = from[q]) out.push(q); return out; };
      const doors = [];
      for (const [, i, j] of [...meets.values()].sort((x, y) => x[0] - y[0])) {
        if (!unite(label[i], label[j])) continue;
        const cells = [...back(i).reverse(), ...back(j)];
        // Two doors side by side, of two exits with no lines: a line between
        // them only when other links join them to the lines (after the loop).
        if (cells.length < 3 && !lined.has(label[i]) && !lined.has(label[j])) doors.push(cells);
        else this.drawLink(cells, legs, drawn, inTree, tnext, towner, tcost);
      }
      for (const cells of doors) {
        if ([...lined].some((k) => find(k) === find(label[cells[0]]))) this.drawLink(cells, legs, drawn, inTree, tnext, towner, tcost);
      }
      return legs;
    }

    // The legs of a link along cells, in two halves that each point to their exit.
    drawLink(cells, legs, drawn, inTree, tnext, towner, tcost) {
      const cost = this.cost;
      // The split: the cost of the way out from each end, plus the link to it.
      const toA = [tcost[cells[0]]];
      for (let k = 1; k < cells.length; k++) toA.push(toA[k - 1] + cost[cells[k]]);
      const toB = new Array(cells.length);
      toB[cells.length - 1] = tcost[cells[cells.length - 1]];
      for (let k = cells.length - 2; k >= 0; k--) toB[k] = toB[k + 1] + cost[cells[k]];
      let mid = 1;
      for (let k = 1; k < cells.length - 1; k++) if (Math.abs(toA[k] - toB[k]) < Math.abs(toA[mid] - toB[mid])) mid = k;
      // Two cells side by side (the lines or the doors of two exits touch):
      // one short line, which goes on to the exit at each end.
      const halves = cells.length < 3 ? [[...cells].reverse(), [...cells]] : [cells.slice(0, mid + 1).reverse(), cells.slice(mid)];
      for (const half of halves) {
        if (half.length < 2) continue;
        const idx = [0], fixed = [true];
        for (let k = 1; k < half.length - 1; k++) {
          if (half[k + 1] - half[k] !== half[k] - half[k - 1]) { idx.push(k); fixed.push(false); }
        }
        idx.push(half.length - 1); fixed.push(true);
        const [cs, fs] = this.squareUp(idx.map((k) => half[k]), fixed);
        const pts = this.unstair(cs.map((c) => this.middle(c)), fs);
        for (let k = 0; k + 1 < pts.length; k++) legs.push({ a: this.toPx(pts[k]), b: this.toPx(pts[k + 1]), flow: 1, link: true });
        // A link to an exit with no line of its own goes on to the exit.
        const end = half[half.length - 1];
        if (!drawn[end] && inTree[end] && tnext[end] < 0) {
          const e = this.toExit(end, towner[end], half[half.length - 2]);
          for (let k = 0; k < e.length - 1; k++) legs.push({ a: e[k], b: e[k + 1], flow: 1, exit: true });
        }
      }
    }

    // Jogs: a short side step between two parallel lines (two lines that
    // meet a third one a cell or two apart, or a line that steps aside on
    // its way) makes the map look untidy. The whole straight line on one
    // side moves onto the other, when it stays clear of walls, crosses no
    // more soft lines and keeps JOG_CLEAR of its distance to the walls. When
    // neither side may move, both lines move to a place between them (a
    // door jamb on each side of a corridor). Lines that end at
    // the line only change their length. Exit marks do not move. Then
    // straight runs of the same flow become one line. Works in the frame,
    // on the drawn lines only: the tree and the routes stay.
    schematize(legs) {
      const f = this.field, s = f.scale, EPS = 0.35;
      const nodes = [], edges = [];
      const marks = f.exits.map((e) => this.framePoint(e[0] * s, e[1] * s));
      const nodeAt = (p) => {
        for (let k = 0; k < nodes.length; k++) if (Math.abs(nodes[k].p[0] - p[0]) < EPS && Math.abs(nodes[k].p[1] - p[1]) < EPS) return k;
        nodes.push({ p: [p[0], p[1]], fixed: marks.some((m) => Math.hypot(m[0] - p[0], m[1] - p[1]) < EPS) });
        return nodes.length - 1;
      };
      for (const l of legs) {
        const u = nodeAt(this.framePoint(l.a[0] * s, l.a[1] * s)), v = nodeAt(this.framePoint(l.b[0] * s, l.b[1] * s));
        if (u !== v) edges.push({ ...l, u, v });
      }
      // A node on the inside of a line splits it, so a T join is a node of both.
      for (let k = 0; k < nodes.length; k++) {
        const q = nodes[k].p;
        if (nodes[k].fixed) continue;  // an exit mark next to a line is not on it
        for (let e = 0; e < edges.length; e++) {
          const { u, v } = edges[e];
          if (u === k || v === k) continue;
          const a = nodes[u].p, b = nodes[v].p, dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
          const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L;
          if (t <= 0 || t >= 1 || Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]) > EPS) continue;
          edges.push({ ...edges[e], u: k });
          edges[e] = { ...edges[e], v: k };
        }
      }
      // Gaps: a line that ends a cell or two short of a line of another
      // piece (a link that ended on a step that became a slanted line) gets
      // a short line to it, when the way is clear of walls: straight, or
      // with one right angle when the gap is to the end of that line.
      // Only a gap between two pieces: a gap in one piece would make a loop.
      const gapInc = nodes.map(() => 0), piece = nodes.map((_, k) => k);
      const top = (k) => { while (piece[k] !== k) k = piece[k] = piece[piece[k]]; return k; };
      for (const E of edges) { gapInc[E.u]++; gapInc[E.v]++; piece[top(E.u)] = top(E.v); }
      for (let k = 0; k < nodes.length; k++) {
        if (gapInc[k] !== 1 || nodes[k].fixed) continue;
        const q = nodes[k].p, own = edges.find((E) => E.u === k || E.v === k);
        let best = null, bestD = GAP_CELLS;
        edges.forEach((E, e) => {
          if (E === own || top(E.u) === top(k)) return;
          const a = nodes[E.u].p, b = nodes[E.v].p, dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
          const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L));
          const p = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d > EPS && d < bestD) { best = [e, t, p]; bestD = d; }
        });
        if (!best) continue;
        const [e, t, p] = best, E = edges[e];
        // A slanted gap (to the end of the other line) becomes a right angle.
        let via = null;
        if (Math.abs(p[0] - q[0]) > 1e-6 && Math.abs(p[1] - q[1]) > 1e-6) {
          via = [[p[0], q[1]], [q[0], p[1]]].find((c) => this.clearLine(q, c) && this.clearLine(c, p));
          if (!via) continue;
        } else if (!this.clearLine(q, p)) continue;
        let m = t <= 0 ? E.u : t >= 1 ? E.v : -1;
        if (m < 0) {
          nodes.push({ p, fixed: false });
          m = nodes.length - 1;
          edges.push({ ...E, u: m });
          edges[e] = { ...E, v: m };
        }
        let from = k;
        if (via) {
          nodes.push({ p: via, fixed: false });
          edges.push(own.v === k ? { ...own, u: k, v: nodes.length - 1 } : { ...own, u: nodes.length - 1, v: k });
          from = nodes.length - 1;
        }
        edges.push(own.v === k ? { ...own, u: from, v: m } : { ...own, u: m, v: from });
        piece[top(k)] = top(m);
      }
      const axis = (e) => {
        const a = nodes[e.u].p, b = nodes[e.v].p;
        return Math.abs(a[1] - b[1]) < 1e-6 ? 0 : Math.abs(a[0] - b[0]) < 1e-6 ? 1 : -1;  // 0: along a, 1: along b
      };
      const at = () => {
        const m = nodes.map(() => []);
        edges.forEach((e, k) => { if (e) { m[e.u].push(k); m[e.v].push(k); } });
        return m;
      };
      // The lowest wall distance on a frame line, or -1 when it crosses a
      // wall, and the number of points on soft lines.
      const clearance = (p, q) => {
        const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * 3) + 1;
        let low = Infinity, soft = 0;
        for (let k = 0; k <= steps; k++) {
          const a = p[0] + ((q[0] - p[0]) * k) / steps, b = p[1] + ((q[1] - p[1]) * k) / steps;
          const c = Math.floor(a), r = Math.floor(b);
          if (c < 0 || c >= this.fw || r < 0 || r >= this.fh) return [-1, 0];
          const i = r * this.fw + c;
          if (this.src[i] < 0 || f.blocked[this.src[i]]) return [-1, 0];
          if (this.ink[this.src[i]]) soft++;
          low = Math.min(low, this.wd[i]);
        }
        return [low, soft];
      };
      const jog = JOG_SHARE * Math.max(this.fw, this.fh);
      // Moves the straight line through node m (across axis ax of the jog)
      // by d along ax. Gives false and changes nothing when it may not.
      const shift = (m, ax, d, inc) => {
        const line = new Set([m]), lineEdges = new Set(), todo = [m];
        while (todo.length) {
          const k = todo.pop();
          for (const e of inc[k]) {
            if (lineEdges.has(e) || axis(edges[e]) !== 1 - ax) continue;
            lineEdges.add(e);
            for (const o of [edges[e].u, edges[e].v]) if (!line.has(o)) { line.add(o); todo.push(o); }
          }
        }
        const moved = (k) => (line.has(k) ? (ax === 0 ? [nodes[k].p[0] + d, nodes[k].p[1]] : [nodes[k].p[0], nodes[k].p[1] + d]) : nodes[k].p);
        for (const k of line) if (nodes[k].fixed) return false;
        const touched = new Set(lineEdges);
        for (const k of line) for (const e of inc[k]) touched.add(e);
        for (const e of touched) {
          const E = edges[e], ea = axis(E);
          if (ea === -1) return false;
          const a = moved(E.u), b = moved(E.v);
          if (ea === ax && !lineEdges.has(e)) {
            // A line that ends at the moved line: it must not turn round.
            const before = nodes[E.v].p[ax] - nodes[E.u].p[ax], after = b[ax] - a[ax];
            if (Math.abs(after) > 1e-6 && Math.sign(after) !== Math.sign(before)) return false;
            if (Math.abs(after) < 1e-6) continue;  // the jog itself, or a line that the move closes
          }
          // A line to an exit mark ends on the wall of the door: it is not checked.
          const [was, softWas] = clearance(nodes[E.u].p, nodes[E.v].p);
          if (was < 0) continue;
          const [now, softNow] = clearance(a, b);
          if (now < 0 || softNow > softWas + JOG_SOFT || (now < JOG_CLEAR * was && now < was)) return false;
        }
        for (const k of line) nodes[k].p = moved(k);
        return true;
      };
      for (let round = 0; round < 4 * edges.length; round++) {
        const inc = at();
        let done = false;
        for (let e = 0; e < edges.length && !done; e++) {
          const E = edges[e];
          // The walk into an exit mark is not a jog: the route keeps it.
          if (!E || E.exit) continue;
          const ax = axis(E);
          if (ax < 0) continue;
          const len = Math.abs(nodes[E.v].p[ax] - nodes[E.u].p[ax]);
          if (len > jog) continue;
          // A jog has a line across it at both ends.
          const across = (k) => inc[k].some((o) => o !== e && axis(edges[o]) === 1 - ax);
          if (!across(E.u) || !across(E.v)) continue;
          // Move the side with less line first.
          const size = (k) => {
            const seen = new Set(), todo = [k];
            let len = 0;
            while (todo.length) {
              const j = todo.pop();
              for (const o of inc[j]) {
                if (seen.has(o) || axis(edges[o]) !== 1 - ax) continue;
                seen.add(o);
                len += Math.abs(nodes[edges[o].v].p[1 - ax] - nodes[edges[o].u].p[1 - ax]);
                todo.push(edges[o].u, edges[o].v);
              }
            }
            return len;
          };
          const order = size(E.u) <= size(E.v) ? [[E.u, E.v], [E.v, E.u]] : [[E.v, E.u], [E.u, E.v]];
          for (const [m, keep] of order) {
            if (shift(m, ax, nodes[keep].p[ax] - nodes[m].p[ax], inc)) { done = true; break; }
          }
          // Neither side can move onto the other: both lines move to a
          // place between them, the middle first.
          if (!done) {
            const pu = nodes[E.u].p[ax], pv = nodes[E.v].p[ax], n = Math.floor(Math.abs(pv - pu) / JOG_STEP);
            const ts = [];
            for (let k = 1; k < n; k++) ts.push(pu + ((pv - pu) * k) / n);
            ts.sort((x, y) => Math.abs(x - (pu + pv) / 2) - Math.abs(y - (pu + pv) / 2));
            for (const t of ts) {
              const was = nodes.map((q) => q.p);
              if (shift(E.u, ax, t - nodes[E.u].p[ax], inc) && shift(E.v, ax, t - nodes[E.v].p[ax], inc)) { done = true; break; }
              nodes.forEach((q, k) => { q.p = was[k]; });
            }
          }
        }
        if (!done) break;
        // Nodes that the move put on the same point become one; empty and
        // double lines go.
        for (let k = 0; k < nodes.length; k++) {
          for (let o = k + 1; o < nodes.length; o++) {
            if (Math.abs(nodes[k].p[0] - nodes[o].p[0]) < EPS && Math.abs(nodes[k].p[1] - nodes[o].p[1]) < EPS) {
              nodes[o].fixed = nodes[o].fixed || nodes[k].fixed;
              for (const E of edges) if (E) { if (E.u === k) E.u = o; if (E.v === k) E.v = o; }
            }
          }
        }
        const seen = new Map();
        edges.forEach((E, e) => {
          if (!E) return;
          if (E.u === E.v) { edges[e] = null; return; }
          const key = Math.min(E.u, E.v) * 1e6 + Math.max(E.u, E.v);
          if (seen.has(key)) { const o = edges[seen.get(key)]; o.flow = Math.max(o.flow, E.flow); edges[e] = null; } else seen.set(key, e);
        });
      }
      // Dead ends: the lines bring every part of the floor near a line. The
      // end of a line that brings little floor near a line that no other
      // line brings (a short tick after a turn, the way back of a hook, a
      // line beside another line) goes back to the last point that does.
      // The floor near a line: open cells that TRIM_SHARE of the frame of
      // moves reaches. A route still follows the tree there. Not on a plan
      // with a wing: the joins at the edge of the wing need the line ends.
      if (!this.field.wing) {
        const { fw, fh, open, pass } = this, n = fw * fh;
        const reach = TRIM_SHARE * Math.max(fw, fh);
        const cellsOf = (E) => {
          const a = nodes[E.u].p, b = nodes[E.v].p, out = new Set();
          const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 3) + 1;
          for (let k = 0; k <= steps; k++) {
            const c = Math.floor(a[0] + ((b[0] - a[0]) * k) / steps), r = Math.floor(a[1] + ((b[1] - a[1]) * k) / steps);
            if (c >= 0 && c < fw && r >= 0 && r < fh && open[r * fw + c]) out.add(r * fw + c);
          }
          return out;
        };
        const cache = new Map();
        const cellsOfEdge = (E) => { if (!cache.has(E)) cache.set(E, [...cellsOf(E)]); return cache.get(E); };
        const dist = new Int32Array(n).fill(-1), q = new Int32Array(n), seen = [];
        // The cells that the sources reach in the box [c0, c1) x [r0, r1).
        const near = (sources, c0, c1, r0, r1) => {
          for (const i of seen) dist[i] = -1;
          seen.length = 0;
          let h = 0, t = 0;
          for (const i of sources) if (dist[i] < 0) { dist[i] = 0; q[t++] = i; seen.push(i); }
          while (h < t) {
            const i = q[h++];
            if (dist[i] >= reach) continue;
            const r = Math.floor(i / fw), c = i - r * fw;
            for (let m = 0; m < 4; m++) {
              const nr = r + DR[m], nc = c + DC[m];
              if (nr < r0 || nr >= r1 || nc < c0 || nc >= c1) continue;
              const j = nr * fw + nc;
              if (dist[j] >= 0 || !(m < 2 ? pass[i] & (m + 1) : pass[j] & (m - 1))) continue;
              dist[j] = dist[i] + 1;
              q[t++] = j;
              seen.push(j);
            }
          }
          return new Set(seen);
        };
        for (let changed = true, guard = 0; changed && guard < edges.length; guard++) {
          changed = false;
          const inc = at();
          for (let k = 0; k < nodes.length; k++) {
            if (inc[k].length !== 1 || nodes[k].fixed) continue;
            const e = inc[k][0], E = edges[e];
            if (!E || E.exit || E.link || E.bridge || E.join) continue;
            const far = E.u === k ? nodes[E.v].p : nodes[E.u].p, tip = nodes[k].p;
            // Only cells this near to the line matter, and only lines this near to them.
            const pad = 2 * reach + 2;
            const c0 = Math.max(0, Math.floor(Math.min(far[0], tip[0]) - pad)), c1 = Math.min(fw, Math.ceil(Math.max(far[0], tip[0]) + pad));
            const r0 = Math.max(0, Math.floor(Math.min(far[1], tip[1]) - pad)), r1 = Math.min(fh, Math.ceil(Math.max(far[1], tip[1]) + pad));
            const inBox = (i) => { const r = Math.floor(i / fw), c = i - r * fw; return c >= c0 && c < c1 && r >= r0 && r < r1; };
            const others = [];
            edges.forEach((F, f) => { if (F && f !== e) for (const i of cellsOfEdge(F)) if (inBox(i)) others.push(i); });
            const byOthers = near(others, c0, c1, r0, r1);
            const byMe = near(cellsOfEdge(E), c0, c1, r0, r1);
            // The tip goes back to the farthest point on the line (from its
            // other end) beside a cell that only this line brings near.
            const dx = tip[0] - far[0], dy = tip[1] - far[1], L2 = dx * dx + dy * dy;
            let keep = 0, own = 0;
            for (const i of byMe) {
              if (byOthers.has(i)) continue;
              own++;
              const x = (i % fw) + 0.5 - far[0], y = Math.floor(i / fw) + 0.5 - far[1];
              keep = Math.max(keep, Math.min(1, (x * dx + y * dy) / L2));
            }
            const len = Math.sqrt(L2);
            if (own < reach || keep * len < TRIM_LEFT) {
              edges[e] = null;
              changed = true;
            } else if ((1 - keep) * len > 1) {
              nodes[k].p = [far[0] + dx * keep, far[1] + dy * keep];
              cache.delete(E);
              changed = true;
            }
          }
        }
      }
      // Straight runs: a node with one line in and one line out, on one
      // straight line with the same flow and kind, is not a corner.
      const inc = at();
      for (let k = 0; k < nodes.length; k++) {
        if (inc[k].length !== 2) continue;
        const [x, y] = inc[k].map((e) => edges[e]);
        const [i, o] = x.v === k && y.u === k ? [x, y] : y.v === k && x.u === k ? [y, x] : [null, null];
        if (!i || i.flow !== o.flow || !!i.link !== !!o.link || !!i.exit !== !!o.exit || !!i.bridge !== !!o.bridge || !!i.join !== !!o.join) continue;
        const a = nodes[i.u].p, b = nodes[k].p, c = nodes[o.v].p;
        if (Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-6) continue;
        i.v = o.v;
        edges[edges.indexOf(o)] = null;
        inc[o.v] = inc[o.v].map((e) => (edges[e] === null ? edges.indexOf(i) : e));
      }
      return edges.filter(Boolean).map(({ u, v, ...rest }) => ({ ...rest, a: this.toPx(nodes[u].p), b: this.toPx(nodes[v].p) }));
    }

    // The lines of the map lose their jogs (schematize), the tree does not.
    // A level or upright piece of a route that runs next to a parallel line
    // of the map, a jog or less away, moves onto that line, when the route
    // stays clear of walls. So the route runs on the drawn lines. exit: the
    // exit of the route; tap: the pixel point where it starts.
    snapToLines(pts, exit, tap = null) {
      const s = this.field.scale;
      // No corner that moves is in the door of another exit: the second exit
      // is the one whose way keeps its corners out of the door of the first.
      const door = this.field.doorRadius() / 2;
      const byDoor = (q) => { const p = this.toPx(q); return this.field.exits.some((e, j) => j !== exit && Math.hypot(p[0] - e[0], p[1] - e[1]) < door); };
      if (!this.frameLegs) {
        this.frameLegs = this.tree(-1).legs.map((l) => [this.framePoint(l.a[0] * s, l.a[1] * s), this.framePoint(l.b[0] * s, l.b[1] * s)]);
      }
      const jog = JOG_SHARE * Math.max(this.fw, this.fh);
      // The first point is there twice: the first piece can move too, and a
      // short step joins it to the tap. It moves only by a small share of
      // its length, so the way from the tap keeps its heading. The last
      // piece stays: a step back to the way to the exit makes a hook (ux
      // review).
      const out = [pts[0], ...pts].map((q) => [...q]);
      const last = out.length - 1;
      // A run can wait for the run after it: passes until nothing moves.
      for (let pass = 0, moves = 1; pass < SNAP_PASSES && moves; pass++) {
      moves = 0;
      for (let k = 1; k + 1 < last; ) {
        const ax = Math.abs(out[k][1] - out[k + 1][1]) < 1e-6 ? 0 : Math.abs(out[k][0] - out[k + 1][0]) < 1e-6 ? 1 : -1;  // 0: along a
        if (ax < 0) { k++; continue; }
        // A straight run of the route (corners where lines of the map join
        // are on it) moves as one piece (ux review).
        let m = k + 1;
        while (m + 1 < last && Math.abs(out[m + 1][1 - ax] - out[k][1 - ax]) < 1e-6) m++;
        const run = out.slice(k, m + 1);
        const lo = Math.min(...run.map((q) => q[ax])), hi = Math.max(...run.map((q) => q[ax]));
        // The part of the run that lines at each offset run beside.
        const beside = new Map();
        for (const [a, b] of this.frameLegs) {
          // Lines back from pixels are level or upright to a small error.
          if (Math.abs(a[1 - ax] - b[1 - ax]) > 1e-3) continue;
          const d = (a[1 - ax] + b[1 - ax]) / 2 - out[k][1 - ax];
          if (Math.abs(d) < 1e-6 || Math.abs(d) > jog) continue;
          const over = Math.min(hi, Math.max(a[ax], b[ax])) - Math.max(lo, Math.min(a[ax], b[ax]));
          const key = Math.round(d * 1e3);
          if (over > 0) beside.set(key, (beside.get(key) || 0) + over);
        }
        let best = 0;
        for (const [key, over] of beside) {
          if (over >= 0.5 * (hi - lo) && (!best || Math.abs(key) < Math.abs(best * 1e3))) best = key / 1e3;
        }
        const moved = run.map((q) => { const n = [...q]; n[1 - ax] += best; return n; });
        // The pieces before and after only change their length: they must
        // not turn round. A jog that the move closes goes. A piece along the
        // run would slant: no move. A slanted piece stays slanted.
        const keeps = (x, y, nx) => {
          const along = Math.abs(y[ax] - x[ax]) > 1e-6, across = Math.abs(y[1 - ax] - x[1 - ax]) > 1e-6;
          if (along) return across;
          return !across || Math.abs(nx[1 - ax] - x[1 - ax]) < 1e-6 || Math.sign(nx[1 - ax] - x[1 - ax]) === Math.sign(y[1 - ax] - x[1 - ax]);
        };
        // The far end of the straight piece before and after the run: the
        // points between are joins, which the move can pass.
        let i0 = k - 1, i1 = m + 1;
        while (i0 > 0 && Math.abs(out[i0 - 1][ax] - out[k][ax]) < 1e-6) i0--;
        while (i1 < last && Math.abs(out[i1 + 1][ax] - out[m][ax]) < 1e-6) i1++;
        // The bottom of a U moves out only when the U gets no deeper: a move
        // may add one side step to the way, not two (ux review).
        const longer = Math.abs(moved[0][1 - ax] - out[i0][1 - ax]) - Math.abs(out[k][1 - ax] - out[i0][1 - ax]) +
          Math.abs(moved[moved.length - 1][1 - ax] - out[i1][1 - ax]) - Math.abs(out[m][1 - ax] - out[i1][1 - ax]);
        const ok = best && longer <= Math.abs(best) + 1e-6 && !(k === 1 && Math.abs(best) > FIRST_SHIFT * (hi - lo)) &&
          keeps(out[i0], out[k], moved[0]) && keeps(out[i1], out[m], moved[moved.length - 1]) &&
          this.clearLine(out[k - 1], moved[0]) && this.clearLine(moved[0], moved[moved.length - 1]) &&
          this.clearLine(moved[moved.length - 1], out[m + 1]) && !moved.some(byDoor) &&
          // The route starts at the tap: a moved first run is clear from there.
          !(k === 1 && tap && !this.field.clearPx(tap, this.toPx(moved[0])));
        if (ok) { moved.forEach((q, j) => { out[k + j] = q; }); moves++; }
        k = m;
      }
      }
      const same = (x, y) => Math.abs(x[0] - y[0]) < 1e-6 && Math.abs(x[1] - y[1]) < 1e-6;
      if (same(out[0], out[1])) out.splice(1, 1);
      // A join that the move left outside its straight piece goes, so the
      // route does not go forward and back on one line.
      for (let j = 1; j + 1 < out.length; j++) {
        const [x, y, z] = [out[j - 1], out[j], out[j + 1]];
        for (const a of [0, 1]) {
          if (Math.abs(x[a] - y[a]) < 1e-6 && Math.abs(z[a] - y[a]) < 1e-6 && (y[1 - a] - x[1 - a]) * (z[1 - a] - y[1 - a]) < -1e-9) {
            out.splice(j, 1);
            j = Math.max(0, j - 2);
            break;
          }
        }
      }
      return out;
    }

    // Fewer turns: from each corner (a frame cell), go to the farthest later
    // corner that one straight line or one right angle reaches, clear of
    // walls and no nearer to them than the way it replaces. A fixed corner
    // is never passed. Gives the corners and their fixed flags.
    squareUp(corners, fixed) {
      const fw = this.fw;
      const out = [corners[0]], outFixed = [fixed[0]];
      let i = 0;
      while (i < corners.length - 1) {
        let best = i + 1, via = -1;
        let lim = i + 1;
        while (lim < corners.length - 1 && !fixed[lim]) lim++;
        // The clearance of the way from corner i: its nearest approach to a wall.
        let near = Infinity;
        const clearance = [Infinity];
        for (let j = i + 1; j <= lim; j++) {
          near = Math.min(near, this.lineClearance(corners[j - 1], corners[j]));
          clearance.push(near);
        }
        // Turns: the way in to corner i comes from the last point out.
        const dir = (p, q) => (Math.floor(p / fw) === Math.floor(q / fw) ? Math.sign(q - p) : 2 * Math.sign(q - p));
        const din = out.length > 1 ? dir(out[out.length - 2], out[out.length - 1]) : 0;
        for (let j = lim; j > i + 1; j--) {
          const a = corners[i], b = corners[j];
          const need = clearance[j - i] - 0.5;
          const dend = dir(corners[j - 1], b);
          const before = j - i - 1 + (din && din !== dir(a, corners[i + 1]) ? 1 : 0);
          const ar = Math.floor(a / fw), ac = a - ar * fw, br = Math.floor(b / fw), bc = b - br * fw;
          const tries = ar === br || ac === bc ? [-1] : [ar * fw + bc, br * fw + ac];
          let pick, fewest = before;
          for (const m of tries) {
            const d1 = m < 0 ? dir(a, b) : dir(a, m), d2 = m < 0 ? d1 : dir(m, b);
            const turns = (m < 0 ? 0 : 1) + (din && din !== d1 ? 1 : 0) + (d2 !== dend ? 1 : 0);
            if (turns >= fewest) continue;
            if (m < 0 ? this.walkable(a, b, need) : this.walkable(a, m, need) && this.walkable(m, b, need)) { pick = m; fewest = turns; }
          }
          if (pick !== undefined) { best = j; via = pick; break; }
        }
        if (via >= 0) { out.push(via); outFixed.push(false); }
        out.push(corners[best]); outFixed.push(fixed[best]);
        i = best;
      }
      return [out, outFixed];
    }

    // Calls f for each open frame cell under the straight line between two frame points.
    cellsUnder(p, q, f) {
      const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * 3) + 1;
      for (let k = 0; k <= steps; k++) {
        const c = Math.floor(p[0] + ((q[0] - p[0]) * k) / steps), r = Math.floor(p[1] + ((q[1] - p[1]) * k) / steps);
        if (c >= 0 && c < this.fw && r >= 0 && r < this.fh && this.open[r * this.fw + c]) f(r * this.fw + c);
      }
    }

    // The smallest wall distance on the straight frame line between two cells.
    lineClearance(a, b) {
      let low = Infinity;
      this.cellsOn(a, b, (i) => { low = Math.min(low, this.wd[i]); });
      return low;
    }

    // Can a line go straight along a row or a column from cell a to cell b,
    // with every cell open, every move clear and no cell nearer than need to a wall?
    walkable(a, b, need) {
      const fw = this.fw;
      if (Math.floor(a / fw) !== Math.floor(b / fw) && a % fw !== b % fw) return false;
      const step = Math.floor(a / fw) === Math.floor(b / fw) ? Math.sign(b - a) : Math.sign(b - a) * fw;
      for (let i = a; i !== b; i += step) {
        const j = i + step;
        if (!this.open[j] || this.wd[j] < need) return false;
        const lo = Math.min(i, j), bit = Math.abs(step) === 1 ? 1 : 2;
        if (!(this.pass[lo] & bit)) return false;
      }
      return true;
    }

    // Calls f for each cell on the row or column line from a to b.
    cellsOn(a, b, f) {
      const fw = this.fw;
      const step = Math.floor(a / fw) === Math.floor(b / fw) ? Math.sign(b - a) : Math.sign(b - a) * fw;
      if (!step) { f(a); return; }
      for (let i = a; ; i += step) { f(i); if (i === b) break; }
    }

    // A staircase of short legs is a way along walls that are not on the
    // two main directions, as in a wing of a building at an angle. Corners
    // (frame points, fixed ones stay) of STAIR_LEGS or more short legs that
    // turn left and right in turn become one straight line, when that line
    // is clear of walls and long (STAIR_RUN, half of it for STAIR_MANY legs
    // or more). One short step in a line, or a short staircase, stays: it is
    // not a slanted corridor. Steps of a cell or two (STAIR_FINE) are the
    // cells of a slanted way: they become a line at a quarter of STAIR_RUN.
    // Each point that stays gets the index of its corner as a third item.
    unstair(corners, fixed) {
      const pts = corners.map((q, k) => [q[0], q[1], k]);
      const longest = STAIR_SHARE * Math.max(this.fw, this.fh);
      const run = STAIR_RUN * Math.max(this.fw, this.fh);
      const leg = (k) => Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
      const turn = (k) => Math.sign((pts[k][0] - pts[k - 1][0]) * (pts[k + 1][1] - pts[k][1]) -
                                    (pts[k][1] - pts[k - 1][1]) * (pts[k + 1][0] - pts[k][0]));
      const out = [pts[0]];
      let i = 0;
      while (i < pts.length - 1) {
        let best = i + 1, step = leg(i);
        for (let j = i + 2; j < pts.length; j++) {
          if (fixed[j - 1] || leg(j - 1) > longest || leg(i) > longest) break;
          if (j - 1 > i + 1 && turn(j - 1) !== -turn(j - 2)) break;
          step = Math.max(step, leg(j - 1));
          if (j - i < STAIR_LEGS) continue;
          const dx = Math.abs(pts[j][0] - pts[i][0]), dy = Math.abs(pts[j][1] - pts[i][1]);
          if (Math.min(dx, dy) < STAIR_SLOPE * Math.max(dx, dy)) continue;
          if (Math.hypot(dx, dy) < (step <= STAIR_FINE ? run / 4 : j - i >= STAIR_MANY ? run / 2 : run)) continue;
          if (this.clearLine(pts[i], pts[j])) best = j;
        }
        out.push(pts[best]);
        i = best;
      }
      return out;
    }

    // Is the straight line between two frame points clear of walls on the grid?
    clearLine(p, q) {
      const { gw, gh, blocked } = this.field;
      const [x0, y0] = this.gridPoint(p[0], p[1]), [x1, y1] = this.gridPoint(q[0], q[1]);
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3) + 1;
      for (let k = 0; k <= steps; k++) {
        const x = Math.floor(x0 + (x1 - x0) * k / steps), y = Math.floor(y0 + (y1 - y0) * k / steps);
        if (x < 0 || x >= gw || y < 0 || y >= gh || blocked[y * gw + x]) return false;
      }
      return true;
    }

    middle(i) {
      const r = Math.floor(i / this.fw);
      return [i - r * this.fw + 0.5, r + 0.5];
    }

    // Pixel points from exit cell i to the mark of exit k: a right angle,
    // in the direction of the last move (from cell before) first.
    toExit(i, k, before) {
      const mark = this.field.exits[k];
      const [a1, b1] = this.middle(i);
      const [a2, b2] = this.framePoint(mark[0] * this.field.scale, mark[1] * this.field.scale);
      const across = before >= 0 && Math.abs(before - i) === 1;  // the last move was along a row
      const corner = across ? [a2, b1] : [a1, b2];
      const other = across ? [a1, b2] : [a2, b1];
      const free = (q) => { const j = this.frameCell(this.toPx(q)); return j >= 0 && this.open[j]; };
      const pts = [this.toPx([a1, b1])];
      if (Math.abs(a2 - a1) > 0.5 && Math.abs(b2 - b1) > 0.5) {
        if (free(corner)) pts.push(this.toPx(corner));
        else if (free(other)) pts.push(this.toPx(other));
      }
      pts.push([...mark]);
      return pts;
    }

    // Rooms: grow from the cells farthest from the walls. Where two rooms
    // meet, they are one room unless the cell where they meet is much
    // narrower than the smaller room. The middle of a room is its cell
    // farthest from the walls.
    findRooms() {
      const { fw: gw, fh: gh, wd, open } = this;
      const n = gw * gh;
      const keys = [];
      for (let i = 0; i < n; i++) if (open[i]) keys.push((1e6 - Math.round(wd[i] * 1000)) * 2 ** 21 + i);
      const order = Float64Array.from(keys).sort().map((k) => k % 2 ** 21);
      const parent = new Int32Array(n).fill(-1);
      const peak = new Float64Array(n), peakCell = new Int32Array(n);
      const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      for (const c of order) {
        const r = Math.floor(c / gw), col = c - r * gw;
        const roots = [];
        for (const [dr, dc] of NEIGHBOURS) {
          const nr = r + dr, nc = col + dc;
          if (nr < 0 || nr >= gh || nc < 0 || nc >= gw) continue;
          const j = nr * gw + nc;
          if (parent[j] < 0) continue;
          const root = find(j);
          if (!roots.includes(root)) roots.push(root);
        }
        if (!roots.length) { parent[c] = c; peak[c] = wd[c]; peakCell[c] = c; continue; }
        roots.sort((a, b) => peak[b] - peak[a] || a - b);
        const main = roots[0];
        for (const other of roots.slice(1)) {
          if (peak[other] < MIN_ROOM || wd[c] >= DOOR_RATIO * peak[other]) parent[other] = main;
        }
        parent[c] = main;
      }
      this.room = new Int32Array(n).fill(-1);
      for (const i of order) this.room[i] = find(i);
      this.middles = new Map();
      for (const i of order) if (find(i) === i) this.middles.set(i, peakCell[i]);
    }

    // Is the straight line between two grid cells clear of ink?
    sees(a, b) {
      const { gw } = this.field;
      const ar = Math.floor(a / gw), ac = a - ar * gw, br = Math.floor(b / gw), bc = b - br * gw;
      const steps = Math.ceil(Math.max(Math.abs(br - ar), Math.abs(bc - ac)) * 3);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const r = Math.floor(ar + 0.5 + (br - ar) * t), c = Math.floor(ac + 0.5 + (bc - ac) * t);
        if (this.ink[r * gw + c]) return false;
      }
      return true;
    }

    // The route from start (grid cell s) to an exit along the tree, or to
    // exit only when only is 0 or more. Null when the tree has no way.
    route(start, s, only = -1) {
      const t = this.tree(only);
      let i = this.openNear(start);
      if (i < 0) i = this.openNear(this.field.toPx(s));
      if (i < 0) return null;
      const m = t.best ? t.best[i] : bestMove(t.dist, i);
      if (m < 0) return null;
      const bs = 4 * i + m;
      // A tree from a worker (treeData) has moves in place of cell numbers.
      const before = t.best
        ? (q) => (t.prevMove[q] < 0 ? -1 : 4 * ((q >> 2) - t.step[q & 3]) + t.prevMove[q])
        : (q) => t.prev[q];
      const after = t.best ? (c) => (t.nextMove[c] < 0 ? -1 : c + t.step[t.nextMove[c]]) : (c) => t.tnext[c];
      const cells = [];
      for (let q = bs; q >= 0; q = before(q)) cells.push(q >> 2);
      for (let q = after(cells[cells.length - 1]); q >= 0; q = after(q)) cells.push(q);
      const end = cells[cells.length - 1];
      const k = t.best ? t.only : t.towner[end];
      // Corners only: where the way turns. A point where another line of
      // the map joins stays, so the route keeps to the lines of the map. The
      // map shows the tree of all exits; the joins of the tree of one exit
      // are not on it, so a route to one exit keeps none.
      const join = (q) => only < 0 && t.joins[q] === 1;
      const keep = cells.filter((q, j) => j === 0 || j === cells.length - 1 ||
        q - cells[j - 1] !== cells[j + 1] - q || join(q));
      const [cs, fs] = this.squareUp(keep, keep.map((q, j) => j === 0 || j === keep.length - 1 || join(q)));
      const pointsOf = (corners) => {
        const pts = [[start[0], start[1]], ...corners.slice(1, -1).map((q) => this.toPx(q))];
        // A slanted first piece is clear from the middle of the start cell:
        // from the tap it can cross a wall (ux review). Then it starts there.
        const slant = corners.length > 1 && Math.abs(corners[0][0] - corners[1][0]) > 1e-6 && Math.abs(corners[0][1] - corners[1][1]) > 1e-6;
        if (slant && pts.length > 1 && !this.field.clearPx(pts[0], pts[1])) pts.splice(1, 0, this.toPx(corners[0]));
        pts.push(...this.toExit(end, k, cells.length > 1 ? cells[cells.length - 2] : -1));
        // A point on a straight line between its two neighbours is not a corner.
        const out = pts.filter((q, j) => j === 0 || dist(q, pts[j - 1]) > 1e-6)
          .filter((q, j, a) => j === 0 || j === a.length - 1 ||
            Math.abs((q[0] - a[j - 1][0]) * (a[j + 1][1] - q[1]) - (q[1] - a[j - 1][1]) * (a[j + 1][0] - q[0])) > 1e-6);
        if (out.length === 1) out.push([...this.field.exits[k]]);
        return out;
      };
      const plain = pointsOf(this.unstair(cs.map((q) => this.middle(q)), fs));
      // The route on the drawn lines, unless its steps then name a slight
      // turn more: the steps leave out short side steps, and a right angle
      // must not read as a slight turn (a11y review).
      const onLines = pointsOf(this.snapToLines(this.unstair(cs.map((q) => this.middle(q)), fs), k, start));
      // The first step starts the walk: its heading is not a turn.
      const f = this.field, slight = (pts) => directions(pts, f.gw / f.scale, f.gh / f.scale).slice(1).filter((st) => st.turn && st.turn.startsWith("slight")).length;
      const points = slight(onLines) > slight(plain) ? plain : onLines;
      // length: of the way before the move onto the lines, so the move does
      // not change which of two exits is nearer (ux review).
      return { points, exitIndex: k, onNetwork: true, length: polyLength(plain) };
    }
  }

  // The cells that a straight line of the map may not cross: walls and soft lines.
  function inkOf(field) {
    if (!field.soft) return field.blocked;
    return field.blocked.map((b, i) => (b || field.soft[i] ? 1 : 0));
  }

  const polyLength = (pts) => pts.slice(1).reduce((a, q, i) => a + dist(q, pts[i]), 0);

  // Steps, as in steps.py.
  function lineGap(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const n = Math.sqrt(dx * dx + dy * dy);
    if (n === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / n;
  }

  function douglasPeucker(points, eps) {
    const keep = new Array(points.length).fill(false);
    keep[0] = keep[points.length - 1] = true;
    const todo = [[0, points.length - 1]];
    while (todo.length) {
      const [lo, hi] = todo.pop();
      let far = -1, farI = -1;
      for (let i = lo + 1; i < hi; i++) {
        const g = lineGap(points[i], points[lo], points[hi]);
        if (g > far) { far = g; farI = i; }
      }
      if (farI >= 0 && far > eps) { keep[farI] = true; todo.push([lo, farI], [farI, hi]); }
    }
    return points.filter((p, i) => keep[i]);
  }

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mod = (a, m) => ((a % m) + m) % m;

  // The indices of the route points that stay.
  function simplify(points, planSize) {
    if (points.length < 3) return points.map((p, i) => i);
    const out = douglasPeucker(points.map((p, i) => [p[0], p[1], i]), SIMPLIFY_SHARE * planSize);
    const kept = [out[0]];
    for (const p of out.slice(1, -1)) if (dist(kept[kept.length - 1], p) >= MIN_LEG_SHARE * planSize - 1e-9) kept.push(p);
    kept.push(out[out.length - 1]);
    return kept.map((p) => p[2]);
  }

  // Angle in degrees, 0 = up on the plan, clockwise positive.
  const heading = (a, b) => Math.atan2(b[0] - a[0], -(b[1] - a[1])) * (180 / Math.PI);

  // The headings of the walk from route point i to route point j, as
  // [where it starts, where it ends]. Its legs that go the same way (within
  // SAME_WAY degrees of each other) add up. A walk on a slanted staircase of
  // two close ways (slanted) has the heading of the straight line. When the
  // legs of one way are MAIN_LEG_SHARE of the walk or more, both are the heading of the longest
  // of them: a short side step does not tilt the walk, so a right angle
  // after it stays a right angle. Else the walk starts on its first leg of
  // a way with END_WAY_SHARE of the walk and ends on its last one, as on a
  // side step of two equal legs. With no such way, both are the heading of
  // the straight line. A third item is the route point where the walk must
  // split, when two of its ways make a turn.
  function walkHeadings(points, i, j, planSize) {
    const legs = [];
    for (let k = i; k < j; k++) legs.push({ d: dist(points[k], points[k + 1]), h: heading(points[k], points[k + 1]) });
    const total = legs.reduce((a, l) => a + l.d, 0);
    const ways = legs.map((l) => legs.reduce((a, m) => a + (Math.abs(mod(m.h - l.h + 180, 360) - 180) <= SAME_WAY ? m.d : 0), 0));
    let best = -1;
    legs.forEach((l, k) => {
      if (best < 0 || ways[k] > ways[best] + 1e-9 || (Math.abs(ways[k] - ways[best]) <= 1e-9 && l.d > legs[best].d)) best = k;
    });
    if (best >= 0 && slanted(legs, ways, best, total, MIN_LEG_SHARE * planSize)) { const h = heading(points[i], points[j]); return [h, h]; }
    if (best >= 0 && ways[best] > 0 && ways[best] >= MAIN_LEG_SHARE * total) return [legs[best].h, legs[best].h];
    const ends = [];
    legs.forEach((l, k) => { if (l.d > 0 && ways[k] >= END_WAY_SHARE * total) ends.push(k); });
    if (!ends.length) { const h = heading(points[i], points[j]); return [h, h]; }
    const first = legs[ends[0]].h, last = legs[ends[ends.length - 1]].h;
    // A turn between two of these ways is a step of its own: the walk
    // splits where the second way starts.
    for (let k = 1; k < ends.length; k++) {
      if (turnOf(legs[ends[k]].h - legs[ends[k - 1]].h) !== "straight") return [first, last, i + ends[k]];
    }
    return [first, last];
  }

  // True when the legs of a walk take turns between two close ways (a
  // slanted corridor drawn on the grid as a staircase of short legs). Its
  // heading is then that of the straight line, with no turn and no side step.
  // Two square ways (up to STAIR_ANGLE apart) count too when each of their
  // legs is shorter than short (MIN_LEG_SHARE of the plan) and at most
  // STAIR_PART of its way, and the smaller way is STAIR_EVEN of the two or
  // more: the drawn lines are level and upright, so a diagonal corridor
  // gives a staircase of right angles too small to be steps (judge review 3,
  // DE-commons_000022). An L with a small jog has one long leg on a way, and
  // a walk with small jogs has a small second way, so both keep their words.
  function slanted(legs, ways, best, total, short) {
    const near = (g, h) => Math.abs(mod(g - h + 180, 360) - 180) <= SAME_WAY;
    const a = legs[best].h;
    let o = -1;
    legs.forEach((l, k) => {
      if (l.d > 0 && !near(l.h, a) && (o < 0 || ways[k] > ways[o] || (ways[k] === ways[o] && l.d > legs[o].d))) o = k;
    });
    if (o < 0) return false;
    const b = legs[o].h;
    const wayB = legs.reduce((s, l) => s + (near(l.h, b) ? l.d : 0), 0);
    const stair = wayB >= STAIR_EVEN * (ways[best] + wayB) && legs.every((l) => !(near(l.h, a) || near(l.h, b)) ||
      (l.d < short && l.d <= STAIR_PART * (near(l.h, a) ? ways[best] : wayB)));
    if (Math.abs(mod(b - a + 180, 360) - 180) > (stair ? STAIR_ANGLE : SLANT_ANGLE)) return false;
    if (ways[best] + wayB < SLANT_SHARE * total) return false;
    const seq = legs.filter((l) => l.d > 0 && (near(l.h, a) || near(l.h, b))).map((l) => (near(l.h, a) ? 0 : 1));
    let turns = 0;
    for (let k = 1; k < seq.length; k++) if (seq[k] !== seq[k - 1]) turns++;
    return turns >= SLANT_TURNS;
  }

  // The first route point after point i that is more than SIDE_STEP_SHARE
  // of the plan to one side of the line with this heading through point i,
  // when it comes before point j and on the side where the walk ends. Else -1.
  function sideEnd(points, i, j, head, planSize) {
    const h = head * (Math.PI / 180), lim = SIDE_STEP_SHARE * planSize, a = points[i];
    const off = points.slice(i, j + 1).map((p) => (p[0] - a[0]) * Math.cos(h) + (p[1] - a[1]) * Math.sin(h));
    const end = off[off.length - 1];
    if (Math.abs(end) <= lim) return -1;
    const k = off.findIndex((o) => o * end > 0 && Math.abs(o) > lim);
    return k > 0 && k < off.length - 1 ? i + k : -1;
  }

  function turnOf(delta) {
    delta = mod(delta + 180, 360) - 180;
    const a = Math.abs(delta);
    if (a < 25) return "straight";
    const side = delta > 0 ? "right" : "left";
    if (a < 60) return `slight ${side}`;
    if (a < 135) return side;
    return "back";
  }

  const SIDES = ["top", "top right", "right", "bottom right", "bottom", "bottom left", "left", "top left"];
  const planSide = (h) => SIDES[Math.floor(mod(mod(h, 360) + 22.5, 360) / 45)];

  function lengthOf(d, planSize) {
    const share = d / planSize;
    if (share < 0.12) return "short";
    if (share < 0.35) return "medium";
    return "long";
  }

  // "left" or "right" when a walk from a to b with this heading ends to
  // one side of its start line by more than SIDE_STEP_SHARE of the plan: a
  // side step round a wall that the walk leaves out. Else null.
  function sideStep(a, b, head, planSize) {
    const h = head * (Math.PI / 180);
    const right = (b[0] - a[0]) * Math.cos(h) + (b[1] - a[1]) * Math.sin(h);
    if (Math.abs(right) <= SIDE_STEP_SHARE * planSize) return null;
    return right > 0 ? "right" : "left";
  }

  // The route point where a walk from point i to point j must split, when it
  // goes more than SIDE_STEP_SHARE of the plan to one side of its start line
  // and comes back: the last point out on that side. Else -1.
  function detour(points, i, j, head, planSize) {
    const h = head * (Math.PI / 180), lim = SIDE_STEP_SHARE * planSize, a = points[i];
    const off = points.slice(i, j + 1).map((p) => (p[0] - a[0]) * Math.cos(h) + (p[1] - a[1]) * Math.sin(h));
    const far = off.reduce((m, o) => (Math.abs(o) > Math.abs(m) ? o : m), 0);
    if (Math.abs(off[off.length - 1]) > lim || Math.abs(far) <= lim) return -1;
    let k = off.length - 1;
    while (!(off[k] * far > 0 && Math.abs(off[k]) > lim)) k--;
    return i + k;
  }

  // The route point where the side step of a walk from point i to point j
  // starts: the last point from which the walk still goes more than
  // SIDE_STEP_SHARE of the plan to the side where it ends, so the walk after
  // it names the side step (two small jogs count as one). -1 when the walk
  // has no side step.
  function sideMove(points, i, j, head, planSize) {
    const h = head * (Math.PI / 180), lim = SIDE_STEP_SHARE * planSize, a = points[i];
    const off = points.slice(i, j + 1).map((p) => (p[0] - a[0]) * Math.cos(h) + (p[1] - a[1]) * Math.sin(h));
    const end = off[off.length - 1];
    if (Math.abs(end) <= lim) return -1;
    let k = off.length - 1;
    while (Math.abs(end - off[k]) <= lim) k--;
    return i + k;
  }

  function directions(points, planW, planH) {
    const planSize = Math.hypot(planW, planH);
    let idx = simplify(points, planSize);
    for (let pass = 0; pass < SPLIT_PASSES; pass++) {
      const out = [idx[0]];
      for (let k = 0; k + 1 < idx.length; k++) {
        const w = walkHeadings(points, idx[k], idx[k + 1], planSize);
        // A walk that steps aside and back (round a wall) splits where it
        // is farthest out, so both side steps get words (a11y review).
        // A walk with a side step splits where the side step starts, so
        // the words give it in its place (ux and a11y reviews).
        let split = w.length === 3 ? w[2] : detour(points, idx[k], idx[k + 1], w[0], planSize);
        if (split < 0) split = sideMove(points, idx[k], idx[k + 1], w[0], planSize);
        if (split > idx[k] && split < idx[k + 1]) out.push(split);
        out.push(idx[k + 1]);
      }
      if (out.length === idx.length) break;
      idx = out;
    }
    const steps = [];
    let prev = 0.0;  // facing the plan = facing "up"
    for (let i = 0; i < idx.length - 1;) {
      const a = points[idx[i]], b = points[idx[i + 1]];
      const [head, end] = walkHeadings(points, idx[i], idx[i + 1], planSize);
      const turn = turnOf(head - prev);
      if (i > 0 && turn === "back") {
        // A turn back round the end of a wall: the side step and the way
        // back are two turns to the same side, so the walk splits where
        // the side step ends.
        const k = sideEnd(points, idx[i], idx[i + 1], prev, planSize);
        if (k >= 0) { idx.splice(i + 1, 0, k); continue; }
      }
      const length = lengthOf(dist(a, b), planSize);
      // A side step is at the start of its walk (the walk split there). The
      // first step names it in the plan frame, the others for the walker.
      const aside = sideStep(a, b, head, planSize);
      // say: the parts of the text, for the page in other languages (i18n.js stepText).
      let text, say;
      if (i === 0) {
        text = `Start toward the ${planSide(head)} of the plan and walk a ${length} way.`;
        say = { key: "start", side: planSide(head), length };
        if (aside) {
          text = `Move over toward the ${planSide(head + (aside === "right" ? 90 : -90))} of the plan, then start toward the ${planSide(head)} of the plan and walk a ${length} way.`;
          say = { key: "start_aside", side2: planSide(head + (aside === "right" ? 90 : -90)), side: planSide(head), length };
        }
      }
      else if (turn === "straight") {
        text = aside ? `Step ${aside}, then keep going straight for a ${length} way.` : `Keep going straight for a ${length} way.`;
        say = aside ? { key: "straight_aside", aside, length } : { key: "straight", length };
      }
      else if (turn === "back") {
        // The side step comes before the turn: its side is that of the way the walker still faces.
        const side = sideStep(a, b, prev, planSize);
        text = side ? `Step ${side}, then turn around and go back a ${length} way.` : `Turn around and go back a ${length} way.`;
        say = side ? { key: "back_aside", aside: side, length } : { key: "back", length };
      }
      else {
        text = aside ? `Turn ${turn.replace("slight", "slightly")}, step ${aside}, then walk a ${length} way.` : `Turn ${turn.replace("slight", "slightly")} and walk a ${length} way.`;
        say = aside ? { key: "turn_aside", turn, aside, length } : { key: "turn", turn, length };
      }
      steps.push({ kind: "walk", turn, length, text, say, from: a, to: b, path: points.slice(idx[i], idx[i + 1] + 1) });
      prev = end;
      i++;
    }
    steps.push({ kind: "arrive", text: "Then you reach the exit.", say: { key: "arrive" }, at: points[idx[idx.length - 1]] });
    return steps;
  }

  // The wall lines of the server (wall_lines.py) that Routes only draws
  // (app.js wallLayer): true for each line on the building. The server finds
  // lines in all the ink of the plan box, so a line can be on a legend, a
  // text panel or a title bar (judge review 3, DE-commons_000022). A line is
  // on the building when a line of its group (lines that touch, a line at a
  // time) has floor with a way out (owner) at most FLOOR_NEAR cells from
  // it: an outer wall past a strip of closed floor joins at its corners
  // (JP-commons_000066). A long group stays too: the other floors of a
  // sheet with many floors have no way out but are walls (FR-web_more_000003).
  // With no floor with a way out, all lines stay.
  const FLOOR_NEAR = 3;          // cells
  const LINE_TOUCH_SHARE = 0.02; // share of the long side of the plan: two lines this close touch
  const HULL_NEAR_SHARE = 0.01;  // share of the long side: a line this close to an outline is in it
  const ISLAND_SHARE = 0.25;     // a group of touching lines this long (share of the long side) is a drawing of its own: it stays
  function buildingLines(field, lines, planW, planH) {
    const { gw, gh, owner, scale } = field;
    if (!owner.some((o) => o >= 0)) return lines.map(() => true);
    const nearFloor = ([x0, y0, x1, y1]) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * scale));
      for (let s = 0; s <= n; s++) {
        const c0 = Math.floor((x0 + (x1 - x0) * s / n) * scale), r0 = Math.floor((y0 + (y1 - y0) * s / n) * scale);
        for (let r = Math.max(0, r0 - FLOOR_NEAR); r <= Math.min(gh - 1, r0 + FLOOR_NEAR); r++) {
          for (let c = Math.max(0, c0 - FLOOR_NEAR); c <= Math.min(gw - 1, c0 + FLOOR_NEAR); c++) {
            if (owner[r * gw + c] >= 0) return true;
          }
        }
      }
      return false;
    };
    const touch = LINE_TOUCH_SHARE * Math.max(planW, planH);
    // Groups of lines that touch, a line at a time.
    const group = lines.map(() => -1);
    const groups = [];
    lines.forEach((_, i) => {
      if (group[i] >= 0) return;
      const g = { lines: [i], floor: false, length: 0 };
      group[i] = groups.length;
      for (let k = 0; k < g.lines.length; k++) {
        const a = lines[g.lines[k]];
        lines.forEach((b, j) => {
          if (group[j] < 0 && segmentGap(a, b) <= touch) { group[j] = groups.length; g.lines.push(j); }
        });
      }
      for (const j of g.lines) {
        const [x0, y0, x1, y1] = lines[j];
        g.length += Math.hypot(x1 - x0, y1 - y0);
        if (!g.floor && nearFloor(lines[j])) g.floor = true;
      }
      groups.push(g);
    });
    // The kept groups: those by the floor, and long ones. A line inside the
    // outline (convex hull) of the floor groups or of a long group stays
    // too: the walls of a hatched room or a stub in a room touch nothing.
    const island = ISLAND_SHARE * Math.max(planW, planH);
    const kept = groups.map((g) => g.floor || g.length >= island);
    const ends = (g) => g.lines.flatMap((j) => [[lines[j][0], lines[j][1]], [lines[j][2], lines[j][3]]]);
    const hulls = [convexHull(groups.filter((g) => g.floor).flatMap(ends))];
    groups.forEach((g, k) => { if (kept[k] && !g.floor) hulls.push(convexHull(ends(g))); });
    const near = HULL_NEAR_SHARE * Math.max(planW, planH);
    const inside = ([x0, y0, x1, y1]) => hulls.some((h) => inHull(h, [(x0 + x1) / 2, (y0 + y1) / 2], near));
    return group.map((k, i) => kept[k] || inside(lines[i]));
  }

  // The convex hull of points, counterclockwise in screen axes (monotone chain).
  function convexHull(points) {
    const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (pts) => {
      const h = [];
      for (const q of pts) {
        while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
        h.push(q);
      }
      h.pop();
      return h;
    };
    return [...half(p), ...half(p.reverse())];
  }

  // True when point q is in the convex hull h, or at most tol from it.
  function inHull(h, q, tol) {
    if (!h.length) return false;
    let inside = h.length >= 3;
    let gap = Infinity;
    for (let k = 0; k < h.length; k++) {
      const a = h[k], b = h[(k + 1) % h.length];
      if (inside && (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) < 0) inside = false;
      gap = Math.min(gap, segmentGap([...a, ...b], [...q, ...q]));
    }
    return inside || gap <= tol;
  }

  // The shortest distance between two segments [x0, y0, x1, y1].
  function segmentGap(a, b) {
    const toSeg = (p, s) => {
      const dx = s[2] - s[0], dy = s[3] - s[1], L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / L)) : 0;
      return Math.hypot(s[0] + t * dx - p[0], s[1] + t * dy - p[1]);
    };
    const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
    const a0 = [a[0], a[1]], a1 = [a[2], a[3]], b0 = [b[0], b[1]], b1 = [b[2], b[3]];
    if (cross(a0, a1, b0) * cross(a0, a1, b1) < 0 && cross(b0, b1, a0) * cross(b0, b1, a1) < 0) return 0;
    return Math.min(toSeg(a0, b), toSeg(a1, b), toSeg(b0, a), toSeg(b1, a));
  }

  return { decodeGrid, Field, NoRoute, directions, buildingLines };
})();

if (typeof module !== "undefined") module.exports = HereOutRoute;
