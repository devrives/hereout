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
  const NEIGHBOURS = [[-1, 0, 1.0], [1, 0, 1.0], [0, -1, 1.0], [0, 1, 1.0],
                      [-1, -1, SQRT2], [-1, 1, SQRT2], [1, -1, SQRT2], [1, 1, SQRT2]];
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

  // A binary heap of [cost, cell], smallest cost first, then smallest cell,
  // the order of Python tuples in heapq.
  class Heap {
    constructor() { this.d = []; this.i = []; }
    get size() { return this.d.length; }
    less(a, b) { return this.d[a] < this.d[b] || (this.d[a] === this.d[b] && this.i[a] < this.i[b]); }
    swap(a, b) {
      [this.d[a], this.d[b]] = [this.d[b], this.d[a]];
      [this.i[a], this.i[b]] = [this.i[b], this.i[a]];
    }
    push(d, i) {
      this.d.push(d); this.i.push(i);
      let k = this.d.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (!this.less(k, p)) break;
        this.swap(k, p); k = p;
      }
    }
    pop() {
      const top = [this.d[0], this.i[0]];
      const last = this.d.length - 1;
      this.swap(0, last);
      this.d.pop(); this.i.pop();
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < this.d.length && this.less(l, m)) m = l;
        if (r < this.d.length && this.less(r, m)) m = r;
        if (m === k) break;
        this.swap(k, m); k = m;
      }
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
      let k = this.size++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (this.d[p] <= d) break;
        this.d[k] = this.d[p]; this.i[k] = this.i[p]; k = p;
      }
      this.d[k] = d; this.i[k] = i;
    }
    pop() {
      const top = this.i[0];
      this.topCost = this.d[0];
      const n = --this.size;
      const d = this.d[n], i = this.i[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && this.d[c + 1] < this.d[c]) c++;
        if (this.d[c] >= d) break;
        this.d[k] = this.d[c]; this.i[k] = this.i[c]; k = c;
      }
      this.d[k] = d; this.i[k] = i;
      return top;
    }
  }

  function wallDistance(blocked, gw, gh) {
    const d = new Float64Array(gw * gh);
    for (let i = 0; i < d.length; i++) d[i] = blocked[i] ? 0 : FAR;
    const fwd = [[0, -1, CHAMFER_A], [-1, -1, CHAMFER_B], [-1, 0, CHAMFER_A], [-1, 1, CHAMFER_B]];
    const back = [[0, 1, CHAMFER_A], [1, 1, CHAMFER_B], [1, 0, CHAMFER_A], [1, -1, CHAMFER_B]];
    const pass = (r, c, mask) => {
      const i = r * gw + c;
      let best = d[i];
      for (const [dr, dc, w] of mask) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < gh && nc >= 0 && nc < gw) {
          const v = d[nr * gw + nc] + w;
          if (v < best) best = v;
        }
      }
      d[i] = best;
    };
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) pass(r, c, fwd);
    for (let r = gh - 1; r >= 0; r--) for (let c = gw - 1; c >= 0; c--) pass(r, c, back);
    return d;
  }

  // Cost to the nearest exit and the next cell, for every open cell.
  class Field {
    // soft: the cells of soft lines (door swings, dashes), or null. They can
    // be crossed, at a cost; a straight line of the map never crosses them.
    // axes: the two main directions of the walls in radians (route.py, wall_axes).
    constructor(blocked, gw, gh, scale, exits, clear = [], soft = null, axes = [0, 0]) {
      Object.assign(this, { gw, gh, scale, exits, soft, axes });
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
      Object.assign(this, { dist, next, owner });

      const heap = new Heap();
      this.seeds = exits.map((e) => this.exitCells(e));
      this.seeds.forEach((cells, k) => {
        for (const [g, d] of cells) if (d < dist[g]) { dist[g] = d; owner[g] = k; heap.push(d, g); }
      });
      while (heap.size) {
        const [d, i] = heap.pop();
        if (d > dist[i]) continue;
        const r = Math.floor(i / gw), c = i - r * gw;
        const stepCost = cost[i];
        for (const [dr, dc, step] of NEIGHBOURS) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= gh || nc < 0 || nc >= gw) continue;
          const j = nr * gw + nc;
          if (blocked[j]) continue;
          // No corner cutting through the gap between two diagonal walls.
          if (dr && dc && (blocked[r * gw + nc] || blocked[nr * gw + c])) continue;
          const nd = d + step * stepCost;
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
      let n = 0;
      for (let s = 0; s < area.length; s++) {
        if (blocked[s] || area[s] >= 0) continue;
        const todo = [s];
        area[s] = n;
        while (todo.length) {
          const i = todo.pop();
          const r = Math.floor(i / gw), c = i - r * gw;
          for (const [dr, dc] of NEIGHBOURS) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= gh || nc < 0 || nc >= gw) continue;
            const j = nr * gw + nc;
            if (blocked[j] || area[j] >= 0) continue;
            if (dr && dc && (blocked[r * gw + nc] || blocked[nr * gw + c])) continue;
            area[j] = n;
            todo.push(j);
          }
        }
        n++;
      }
      this._areas = area;
      return area;
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
      const r = net ? net.route(start, s, only) : null;
      return r || (only < 0 ? this.route(start) : null);
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
  const TURN_COST = 8;          // cells of way that one turn costs
  const TREE_SHARE = 0.6;       // a cell of the tree costs this share of its way to the exit
  const DOOR_RATIO = 0.7;       // a way narrower than this share of the smaller room is a door
  const MIN_ROOM = 2.5;         // cells from the wall; a smaller space is part of the room next to it
  const MIN_SPUR = 3;           // cells; a shorter line to a room middle is not drawn
  const BRIDGE_SHARE = 0.06;    // share of the frame: the longest bridge between the lines to two exits
  const HOOK_SHARE = 0.02;      // share of the frame: a shorter first leg of a line from a room middle is not drawn
  const PASS_STEPS = 8;         // points on the line of one move that must be clear of walls
  const DR = [0, 1, 0, -1], DC = [1, 0, -1, 0];  // the four moves: right, down, left, up

  class Network {
    constructor(field) {
      this.field = field;
      this.ink = inkOf(field);
      const [a, b] = field.axes;
      this.makeFrame(a, b);
      this.findRooms();
      // Sources: the middle of each room that is not too small.
      this.sources = [];
      for (const [root, cell] of this.middles) if (this.wd[cell] >= MIN_ROOM && root >= 0) this.sources.push(cell);
      this.exitSeeds = field.exits.map((e, k) => this.frameSeeds(k));
      this.trees = new Map();
      Object.assign(this, { legs: this.tree(-1).legs });
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
      const drawn = new Uint8Array(n);
      for (let cells of branches) {
        // A short line that no other line joins is not drawn. A short last
        // turn into the room middle is a hook: it goes too.
        if (cells.length < MIN_SPUR && below[cells[1]] === 1 && tnext[cells[cells.length - 1]] >= 0) continue;
        let k = 1;
        while (k + 1 < cells.length && cells[k + 1] - cells[k] === cells[k] - cells[k - 1]) k++;
        if (k < hook && k + 1 < cells.length && below[cells[k]] === 1) cells = cells.slice(k);
        for (const i of cells) drawn[i] = 1;
        const run = [cells[0]];
        const flush = () => {
          if (run.length > 1) legs.push({ a: this.toPx(this.middle(run[0])), b: this.toPx(this.middle(run[run.length - 1])), flow: below[run[0]] });
        };
        for (let k = 1; k < cells.length; k++) {
          const p = run[run.length - 1], q = cells[k];
          const same = run.length < 2 || (q - p === p - run[run.length - 2] && below[q] === below[p]);
          if (!same) { flush(); run.splice(0, run.length, p); }
          run.push(q);
        }
        flush();
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
      const t = { dist, prev, inTree, tcost, tnext, towner, legs };
      this.trees.set(only, t);
      return t;
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
      let bs = -1;
      for (let m = 0; m < 4; m++) if (bs < 0 || t.dist[4 * i + m] < t.dist[bs]) bs = 4 * i + m;
      if (!Number.isFinite(t.dist[bs])) return null;
      const cells = [];
      for (let q = bs; q >= 0; q = t.prev[q]) cells.push(q >> 2);
      for (let q = t.tnext[cells[cells.length - 1]]; q >= 0; q = t.tnext[q]) cells.push(q);
      const end = cells[cells.length - 1];
      const k = t.towner[end];
      // Corners only: where the way turns.
      const keep = cells.filter((q, j) => j === 0 || j === cells.length - 1 ||
        q - cells[j - 1] !== cells[j + 1] - q);
      const pts = [[start[0], start[1]], ...keep.slice(1, -1).map((q) => this.toPx(this.middle(q)))];
      pts.push(...this.toExit(end, k, cells.length > 1 ? cells[cells.length - 2] : -1));
      const out = pts.filter((q, j) => j === 0 || dist(q, pts[j - 1]) > 1e-6);
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
