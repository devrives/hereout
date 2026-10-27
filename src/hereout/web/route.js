"use strict";

// The escape field and the steps, as in route.py and steps.py. The same grid
// gives the same field, routes and steps in both (tests/test_route_parity.py).
// Change both together. The way network and the routes along it are browser
// only (tests/test_network.py).
const HereOutRoute = (() => {
  const SNAP_SHARE = 0.06;
  const MARK_CLEAR_SHARE = 0.012;
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
    constructor(blocked, gw, gh, scale, exits, clear = []) {
      Object.assign(this, { gw, gh, scale, exits });
      blocked = Uint8Array.from(blocked);
      // A mark is ink too: clear a small disc so it does not wall in its own point.
      const radius = MARK_CLEAR_SHARE * Math.max(gw, gh);
      const span = Math.trunc(radius) + 1;
      for (const [x, y] of [...clear, ...exits]) {
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
      for (let i = 0; i < n; i++) cost[i] = 1.0 + WALL_COST / (1.0 + wd[i]);
      const dist = new Float64Array(n).fill(Infinity);
      const next = new Int32Array(n).fill(-1);
      const owner = new Int32Array(n).fill(-1);
      Object.assign(this, { dist, next, owner });

      const heap = new Heap();
      exits.forEach((e, k) => {
        const g = this.snap(e);
        if (g !== null && owner[g] < 0) { dist[g] = 0; owner[g] = k; heap.push(0, g); }
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
      const s = this.snap(start), g = this.snap(this.exits[k]);
      if (s === null || g === null) return false;
      const area = this.areas();
      return area[s] === area[g];
    }

    // For each open cell, how many cells have their way out through it.
    // Large values are the main ways to the exits.
    flow() {
      const n = this.gw * this.gh;
      const order = [];
      for (let i = 0; i < n; i++) if (this.owner[i] >= 0) order.push(i);
      order.sort((a, b) => this.dist[b] - this.dist[a]);
      const acc = new Float64Array(n);
      for (const i of order) {
        acc[i] += 1;
        if (this.next[i] >= 0) acc[this.next[i]] += acc[i];
      }
      return { acc, order };
    }

    // The ways out as straight lines. Browser only.
    network() {
      if (!this._network) this._network = new Network(this);
      return this._network;
    }

    // A route that goes straight to the nearest way out and then along it.
    // Where no way out is in sight, the grid route. Browser only.
    wayRoute(start) {
      if (!this.exits.length) throw new NoRoute("no exits");
      if (!this.owner.some((o) => o >= 0)) throw new NoRoute("every exit is inside a wall");
      const s = this.snap(start);
      if (s === null) throw new NoRoute("start is inside a wall");
      if (this.owner[s] < 0) throw new NoRoute("no open way to an exit");
      return this.network().route(start, s) || this.route(start);
    }
  }

  // The network of the ways out (browser only). Its lines are the medial axis
  // of the open space: the cells that are as far from the walls on two sides.
  // Every open point has a line in sight, and each line is as far from the
  // walls as the space lets it be. The steps:
  // 1. Thin the open cells that have a way to an exit to lines one cell wide
  //    (Zhang and Suen 1984). Small islands of ink in the open space are text
  //    or symbols, so the lines go through them.
  // 2. Find the shortest way along the lines from each line cell to an exit.
  //    The ways make a tree from the exits, so a loop around an obstacle
  //    breaks where the ways to two sides meet.
  // 3. Cut the short branches that go into corners, as the medial axis has
  //    one for each corner.
  // 4. Make each branch straight with Douglas-Peucker, but never through a wall.
  const ISLAND_SHARE = 0.0004;  // ink islands up to this share of the cells are not walls here
  const SPUR_CLEARANCE = 2.0;   // a branch to a corner is shorter than this times the room at its root
  const SPUR_MIN = 4;           // cells
  const LINE_EPS = 1.2;         // cells off the straight line that a branch can be
  const ATTACH_SHARE = 0.1;     // how far, as a share of the grid, a start or an exit looks for a line

  // Zhang-Suen thinning of the cells where open is 1, in place.
  function thin(open, gw, gh) {
    const nb = new Uint8Array(8);
    const del = [];
    for (let changed = true; changed;) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        del.length = 0;
        for (let r = 1; r < gh - 1; r++) {
          for (let c = 1; c < gw - 1; c++) {
            const i = r * gw + c;
            if (!open[i]) continue;
            // P2..P9: north, then clockwise.
            nb[0] = open[i - gw]; nb[1] = open[i - gw + 1]; nb[2] = open[i + 1]; nb[3] = open[i + gw + 1];
            nb[4] = open[i + gw]; nb[5] = open[i + gw - 1]; nb[6] = open[i - 1]; nb[7] = open[i - gw - 1];
            let b = 0, a = 0;
            for (let k = 0; k < 8; k++) { b += nb[k]; if (!nb[k] && nb[(k + 1) & 7]) a++; }
            if (b < 2 || b > 6 || a !== 1) continue;
            if (pass === 0 ? (nb[0] && nb[2] && nb[4]) || (nb[2] && nb[4] && nb[6])
                           : (nb[0] && nb[2] && nb[6]) || (nb[0] && nb[4] && nb[6])) continue;
            del.push(i);
          }
        }
        for (const i of del) open[i] = 0;
        if (del.length) changed = true;
      }
    }
  }

  class Network {
    constructor(field) {
      const { gw, gh } = field;
      const n = gw * gh;
      this.field = field;
      // Open: the cells with a way to an exit, and the small islands among
      // them. An island is ink and the closed space in it, as in a symbol.
      const open = new Uint8Array(n);
      for (let i = 0; i < n; i++) open[i] = field.owner[i] >= 0 ? 1 : 0;
      const ink = Uint8Array.from(field.blocked);
      const seen = new Uint8Array(n);
      const limit = ISLAND_SHARE * n;
      for (let s = 0; s < n; s++) {
        if (open[s] || seen[s]) continue;
        const cells = [s], todo = [s];
        seen[s] = 1;
        let inside = true;
        while (todo.length) {
          const i = todo.pop();
          const r = Math.floor(i / gw), c = i - r * gw;
          if (r === 0 || c === 0 || r === gh - 1 || c === gw - 1) inside = false;
          for (const [dr, dc] of NEIGHBOURS) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= gh || nc < 0 || nc >= gw) continue;
            const j = nr * gw + nc;
            if (open[j] || seen[j]) continue;
            seen[j] = 1;
            if (cells.length <= limit) cells.push(j);
            else inside = false;
            todo.push(j);
          }
        }
        if (inside && cells.length <= limit) for (const i of cells) { open[i] = 1; ink[i] = 0; }
      }
      this.ink = ink;
      this.open = Uint8Array.from(open);
      thin(open, gw, gh);
      const line = open;

      // The shortest way along the lines to an exit.
      const dist = new Float64Array(n).fill(Infinity);
      const next = new Int32Array(n).fill(-1);
      const owner = new Int32Array(n).fill(-1);
      const heap = new Heap();
      this.links = [];  // from each exit to its first line cell
      field.exits.forEach((e, k) => {
        const g = field.snap(e);
        if (g === null || field.owner[g] < 0) return;
        const p = this.attach(g, (j) => line[j], () => 0);
        if (!p) return;
        const d = p.cost;
        if (d < dist[p.cell]) { dist[p.cell] = d; owner[p.cell] = k; next[p.cell] = -1; heap.push(d, p.cell); }
        this.links.push({ exit: k, cell: p.cell });
      });
      this.links = this.links.filter((l) => owner[l.cell] === l.exit);
      while (heap.size) {
        const [d, i] = heap.pop();
        if (d > dist[i]) continue;
        const r = Math.floor(i / gw), c = i - r * gw;
        for (const [dr, dc, step] of NEIGHBOURS) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= gh || nc < 0 || nc >= gw) continue;
          const j = nr * gw + nc;
          if (!line[j]) continue;
          const nd = d + step;
          if (nd < dist[j]) { dist[j] = nd; next[j] = i; owner[j] = owner[i]; heap.push(nd, j); }
        }
      }
      for (let i = 0; i < n; i++) if (line[i] && owner[i] < 0) line[i] = 0;
      let onLine = [];
      for (let i = 0; i < n; i++) if (line[i]) onLine.push(i);

      // Cut the short branches into corners, until none is left. A branch
      // into a corner ends where the line ends. A branch that ends next to
      // other line cells is half of a loop, where the ways to two sides meet:
      // keep it.
      const lineEnd = (i) => {
        const r = Math.floor(i / gw), c = i - r * gw;
        let k = 0;
        for (const [dr, dc] of NEIGHBOURS) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < gh && nc >= 0 && nc < gw && line[nr * gw + nc]) k++;
        }
        return k <= 1 || (k === 2 && next[i] >= 0 && this.adjacentPair(i, line));
      };
      const kids = new Int32Array(n);
      const countKids = () => {
        kids.fill(0);
        onLine = onLine.filter((i) => line[i]);
        for (const i of onLine) if (next[i] >= 0) kids[next[i]]++;
      };
      for (let cut = true; cut;) {
        cut = false;
        countKids();
        for (const i of onLine) {
          if (!line[i] || kids[i] !== 0) continue;
          const branch = [i];
          let j = next[i];
          while (j >= 0 && kids[j] === 1 && next[j] >= 0) { branch.push(j); j = next[j]; }
          // j is where the branch joins the others, or the cell at the exit.
          if (j < 0 || kids[j] < 2) continue;
          if (branch.length <= 2 || (lineEnd(i) && branch.length < Math.max(SPUR_MIN, SPUR_CLEARANCE * field.wd[j]))) {
            for (const b of branch) line[b] = 0;
            cut = true;
          }
        }
      }
      countKids();

      // Branches: from a cell where branches join (or a leaf) to the next one
      // toward the exit, made straight.
      const isJoin = (i) => next[i] < 0 || kids[i] !== 1;
      this.segA = new Int32Array(n).fill(-1);  // for each line cell: its straight leg, away from the exit
      this.segB = new Int32Array(n).fill(-1);  // and toward the exit
      this.key = new Uint8Array(n);
      this.legs = [];
      const below = new Float64Array(n);  // line cells that drain through this one
      const order = onLine.slice();
      order.sort((a, b) => dist[b] - dist[a]);
      for (const i of order) { below[i] += 1; if (next[i] >= 0) below[next[i]] += below[i]; }
      for (const s of order) {
        if (!isJoin(s) || next[s] < 0) continue;
        const chain = [s];
        let j = next[s];
        while (!isJoin(j)) { chain.push(j); j = next[j]; }
        chain.push(j);
        const keep = this.straighten(chain);
        for (let a = 0; a < keep.length - 1; a++) {
          for (let t = keep[a]; t < keep[a + 1]; t++) { this.segA[chain[t]] = chain[keep[a]]; this.segB[chain[t]] = chain[keep[a + 1]]; }
          this.legs.push({ a: field.toPx(chain[keep[a]]), b: field.toPx(chain[keep[a + 1]]),
                           da: dist[chain[keep[a]]], db: dist[chain[keep[a + 1]]], flow: below[chain[keep[a + 1]]] });
        }
        for (const t of keep) this.key[chain[t]] = 1;
      }
      for (const l of this.links) {
        this.key[l.cell] = 1;
        this.segA[l.cell] = this.segB[l.cell] = l.cell;
        this.legs.push({ a: field.toPx(l.cell), b: [...field.exits[l.exit]], da: dist[l.cell], db: 0, flow: below[l.cell], exit: true });
      }
      Object.assign(this, { line, dist, next, owner });
    }

    // Are the two line cells next to cell i next to each other too? Then i
    // is the tip of a line, at a step of a diagonal.
    adjacentPair(i, line) {
      const { gw, gh } = this.field;
      const r = Math.floor(i / gw), c = i - r * gw;
      const two = [];
      for (const [dr, dc] of NEIGHBOURS) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < gh && nc >= 0 && nc < gw && line[nr * gw + nc]) two.push([nr, nc]);
      }
      return Math.max(Math.abs(two[0][0] - two[1][0]), Math.abs(two[0][1] - two[1][1])) === 1;
    }

    // Is the straight line between two cells clear of ink?
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

    // Indexes into chain of the corners of a straight version of it: no cell
    // more than LINE_EPS off a leg, and no leg through ink.
    straighten(chain) {
      const { gw } = this.field;
      const xy = (i) => [chain[i] % gw, Math.floor(chain[i] / gw)];
      const keep = new Array(chain.length).fill(false);
      keep[0] = keep[chain.length - 1] = true;
      const todo = [[0, chain.length - 1]];
      while (todo.length) {
        const [lo, hi] = todo.pop();
        if (hi - lo < 2) continue;
        let far = -1, farI = -1;
        for (let i = lo + 1; i < hi; i++) {
          const g = lineGap(xy(i), xy(lo), xy(hi));
          if (g > far) { far = g; farI = i; }
        }
        if (far > LINE_EPS || !this.sees(chain[lo], chain[hi])) {
          keep[farI] = true;
          todo.push([lo, farI], [farI, hi]);
        }
      }
      return keep.flatMap((k, i) => (k ? [i] : []));
    }

    // The best line cell in sight of cell s: the one with the smallest walk
    // to it plus the way from it. use(j) says if j is a line cell, way(j) is
    // the cost from it. It looks near first, then twice as far each time.
    // Null when no line is in sight.
    attach(s, use, way) {
      const size = Math.max(this.field.gw, this.field.gh);
      for (let reach = ATTACH_SHARE * size; reach < 2 * size; reach *= 2) {
        const p = this.attachWithin(s, use, way, reach);
        if (p) return p;
      }
      return null;
    }

    attachWithin(s, use, way, reach) {
      const { gw, gh } = this.field;
      const sr = Math.floor(s / gw), sc = s - sr * gw;
      const cands = [];
      // A mark for each cell seen in this call, so no set is made for each call.
      if (!this.mark) { this.mark = new Int32Array(gw * gh); this.markId = 0; }
      const mark = this.mark, id = ++this.markId;
      mark[s] = id;
      const todo = [s];
      while (todo.length) {
        const i = todo.pop();
        const r = Math.floor(i / gw), c = i - r * gw;
        if (use(i)) cands.push([Math.hypot(r - sr, c - sc) + way(i), i]);
        for (const [dr, dc] of NEIGHBOURS) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= gh || nc < 0 || nc >= gw) continue;
          const j = nr * gw + nc;
          if (mark[j] === id || !this.open[j] || Math.hypot(nr - sr, nc - sc) > reach) continue;
          mark[j] = id;
          todo.push(j);
        }
      }
      cands.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [cost, i] of cands) if (this.sees(s, i)) return { cost, cell: i };
      return null;
    }

    // The route from start (cell s) to an exit along the lines, or null.
    route(start, s) {
      const f = this.field;
      const p = this.attach(s, (j) => this.line[j], (j) => this.dist[j]);
      if (!p) return null;
      const pts = [[start[0], start[1]]];
      // Join the leg of p at the foot of the start on it. When the start or
      // the end of the leg does not see that point, join at the end of the
      // leg, or at p and then along the line.
      const b = this.segB[p.cell];
      const foot = footOn([start[0], start[1]], f.toPx(this.segA[p.cell]), f.toPx(b));
      const footCell = f.snap(foot);
      if (footCell !== null && !this.ink[footCell] && this.sees(s, footCell) && this.sees(footCell, b)) pts.push(foot);
      else if (!this.sees(s, b)) {
        const chain = [p.cell];
        while (chain[chain.length - 1] !== b) chain.push(this.next[chain[chain.length - 1]]);
        for (const t of this.straighten(chain).slice(0, -1)) pts.push(f.toPx(chain[t]));
      }
      let i = b;
      for (; i >= 0; i = this.next[i]) if (this.key[i]) pts.push(f.toPx(i));
      const k = this.owner[p.cell];
      pts.push([...f.exits[k]]);
      // Go straight to the last point of the way that the start sees, so the
      // route does not walk to a line and back when a later point or the
      // exit is in plain sight.
      for (let j = pts.length - 1; j > 1; j--) {
        // The cell of the point. Line points can be on an ink island; an
        // exit can be in a wall, and then its open cell counts.
        const [r, col] = f.toCell(pts[j]);
        let c = r * f.gw + col;
        if (this.ink[c]) c = f.snap(pts[j]);
        if (c !== null && !this.ink[c] && this.sees(s, c)) { pts.splice(1, j - 1); break; }
      }
      const out = pts.filter((q, j) => j === 0 || dist(q, pts[j - 1]) > 1e-6);
      return { points: out, exitIndex: k, onNetwork: true };
    }
  }

  // The point on segment ab nearest to p.
  function footOn(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const n2 = dx * dx + dy * dy;
    const t = n2 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / n2)) : 0;
    return [a[0] + dx * t, a[1] + dy * t];
  }

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
