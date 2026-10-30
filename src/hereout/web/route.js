"use strict";

// The escape field and the steps, as in route.py and steps.py. The same grid
// gives the same field, routes and steps in both (tests/test_route_parity.py).
// Change both together. The way network and the routes along it are browser
// only (tests/test_network.py).
const HereOutRoute = (() => {
  const SNAP_SHARE = 0.06;
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
      if (r && this.wing) r = { ...r, points: this.squareLocal(r.points) };
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
  const PASS_STEPS = 8;         // points on the line of one move that must be clear of walls
  const DR = [0, 1, 0, -1], DC = [1, 0, -1, 0];  // the four moves: right, down, left, up

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
    // short straight line joins the two cut ends.
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
      const used = new Set();
      for (const w of wingEnds) {
        let best = -1, bestD = reach;
        mainEnds.forEach((m, k) => {
          const d = Math.hypot(m.p[0] - w.p[0], m.p[1] - w.p[1]);
          if (!used.has(k) && d < bestD && open(w.p, m.p)) { best = k; bestD = d; }
        });
        if (best >= 0) {
          used.add(best);
          legs.push({ a: w.p, b: mainEnds[best].p, flow: Math.max(w.flow, mainEnds[best].flow), join: true });
        }
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
      // Add the sources one by one, the nearest first. Each branch is its
      // cells from the source to the tree cell it joins.
      const branches = [];
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
      }
      // The flow: how many sources drain through each tree cell.
      const below = new Float64Array(n);
      for (const cells of branches) for (let i = cells[0]; i >= 0; i = tnext[i]) below[i] += 1;
      const legs = [];
      const hook = HOOK_SHARE * Math.max(this.fw, this.fh);
      const stub = Math.round(STUB_SHARE * Math.max(this.fw, this.fh));
      const reach = REACH_SHARE * Math.max(this.fw, this.fh);
      // The size of each room, and the size of a hall.
      const area = new Map();
      let floor = 0;
      for (let i = 0; i < n; i++) if (open[i]) { floor++; area.set(this.room[i], (area.get(this.room[i]) || 0) + 1); }
      const hall = HALL_SHARE * floor;
      const drawn = new Uint8Array(n);
      for (let cells of branches) {
        // A short line that no other line joins is not drawn.
        if (cells.length < MIN_SPUR && below[cells[1]] === 1 && tnext[cells[cells.length - 1]] >= 0) continue;
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
      }
      // Joins: the tree cells where the flow changes, that is where another
      // line of the map joins.
      const joins = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (tnext[i] >= 0 && below[tnext[i]] !== below[i]) joins[tnext[i]] = 1;
      const t = { dist, prev, inTree, tcost, tnext, towner, legs, joins };
      this.trees.set(only, t);
      return t;
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
    // is clear of walls and long (STAIR_RUN). One short step in a line, or a
    // short staircase, stays: it is not a slanted corridor.
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
        let best = i + 1;
        for (let j = i + 2; j < pts.length; j++) {
          if (fixed[j - 1] || leg(j - 1) > longest || leg(i) > longest) break;
          if (j - 1 > i + 1 && turn(j - 1) !== -turn(j - 2)) break;
          if (j - i < STAIR_LEGS) continue;
          const dx = Math.abs(pts[j][0] - pts[i][0]), dy = Math.abs(pts[j][1] - pts[i][1]);
          if (Math.min(dx, dy) < STAIR_SLOPE * Math.max(dx, dy)) continue;
          if (Math.hypot(dx, dy) < run) continue;
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
      const corners = this.unstair(cs.map((q) => this.middle(q)), fs);
      const pts = [[start[0], start[1]], ...corners.slice(1, -1).map((q) => this.toPx(q))];
      pts.push(...this.toExit(end, k, cells.length > 1 ? cells[cells.length - 2] : -1));
      // A point on a straight line between its two neighbours is not a corner.
      const out = pts.filter((q, j) => j === 0 || dist(q, pts[j - 1]) > 1e-6)
        .filter((q, j, a) => j === 0 || j === a.length - 1 ||
          Math.abs((q[0] - a[j - 1][0]) * (a[j + 1][1] - q[1]) - (q[1] - a[j - 1][1]) * (a[j + 1][0] - q[0])) > 1e-6);
      if (out.length === 1) out.push([...this.field.exits[k]]);
      return { points: out, exitIndex: k, onNetwork: true };
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

  function simplify(points, planSize) {
    if (points.length < 3) return points.slice();
    const out = douglasPeucker(points, SIMPLIFY_SHARE * planSize);
    const kept = [out[0]];
    for (const p of out.slice(1, -1)) if (dist(kept[kept.length - 1], p) >= MIN_LEG_SHARE * planSize) kept.push(p);
    kept.push(out[out.length - 1]);
    return kept;
  }

  // Angle in degrees, 0 = up on the plan, clockwise positive.
  const heading = (a, b) => Math.atan2(b[0] - a[0], -(b[1] - a[1])) * (180 / Math.PI);

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

  function directions(points, planW, planH) {
    const planSize = Math.hypot(planW, planH);
    const pts = simplify(points, planSize);
    const steps = [];
    let prev = 0.0;  // facing the plan = facing "up"
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const head = heading(a, b);
      const turn = turnOf(head - prev);
      const length = lengthOf(dist(a, b), planSize);
      let text;
      if (i === 0) text = `Start toward the ${planSide(head)} of the plan and walk a ${length} way.`;
      else if (turn === "straight") text = `Keep going straight for a ${length} way.`;
      else if (turn === "back") text = `Turn around and go back a ${length} way.`;
      else text = `Turn ${turn.replace("slight", "slightly")} and walk a ${length} way.`;
      steps.push({ kind: "walk", turn, length, text, from: a, to: b });
      prev = head;
    }
    steps.push({ kind: "arrive", text: "Then you reach the exit.", at: pts[pts.length - 1] });
    return steps;
  }

  return { decodeGrid, Field, NoRoute, directions };
})();

if (typeof module !== "undefined") module.exports = HereOutRoute;
