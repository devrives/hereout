"use strict";

// The escape field and the steps, as in route.py and steps.py. The same grid
// gives the same field, routes and steps in both (tests/test_route_parity.py).
// Change both together.
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
