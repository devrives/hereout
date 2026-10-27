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
    constructor(blocked, gw, gh, scale, exits, clear = []) {
      Object.assign(this, { gw, gh, scale, exits });
      blocked = Uint8Array.from(blocked);
      // A "you are here" dot is ink too: clear a small disc so it does not
      // wall in its own point. An exit gets no disc, as in route.py: a disc
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

  // The network of the ways out (browser only): a door-to-door network
  // (Liu and Zlatanova 2011). The steps:
  // 1. Split the open space into rooms where it narrows: a door. The rooms
  //    grow from the places farthest from the walls, as water fills basins;
  //    two rooms meet at a door when the way between them is much narrower
  //    than the smaller room (a distance-transform room segmentation, as in
  //    Bormann and others 2016). Rooms that meet at more than one opening
  //    get a door at each one.
  // 2. The nodes are the exits, the doors and the middle of each room. Doors
  //    and exits close together are one node.
  // 3. Two nodes of one room are joined by the way between them, made
  //    straight where no wall is in the way. In a room that you can see
  //    across, that is one straight line.
  // 4. The lines on the map are the shortest ways from the doors to an exit:
  //    a tree from the exits, so each line leads on to an exit. A route
  //    follows the tree and is then pulled tight where the way is clear.
  const DOOR_RATIO = 0.7;       // a way narrower than this share of the smaller room is a door
  const MIN_ROOM = 2.5;         // cells from the wall; a smaller space is part of the room next to it
  const DOOR_GAP = 0.08;        // share of the grid between two doors of the same two rooms
  const NODE_GAP = 2.5;         // cells; doors and exits closer than this are one node
  const TRUNK = 1.2;            // a way costs its length to this power, so near ways join into one line
  const LINE_EPS = 1.2;         // cells off the straight line that a way can be

  class Network {
    constructor(field) {
      const { gw, gh } = field;
      const n = gw * gh;
      this.field = field;
      // Open: the cells with a way to an exit. The walls are lines already,
      // with no text or symbols, so every blocked cell is a wall.
      const open = new Uint8Array(n);
      for (let i = 0; i < n; i++) open[i] = field.owner[i] >= 0 ? 1 : 0;
      const ink = field.blocked;
      this.open = open;
      this.ink = ink;
      this.wd = wallDistance(ink, gw, gh);
      this.cost = new Float64Array(n);
      for (let i = 0; i < n; i++) this.cost[i] = 1.0 + WALL_COST / (1.0 + this.wd[i]);
      this.findRooms();

      // Nodes: exits, doors, the middle of each room.
      const nodes = [];
      this.nodeAt = new Int32Array(n).fill(-1);
      const add = (node) => {
        const r = Math.floor(node.cell / gw), c = node.cell - r * gw;
        const near = node.middle ? -1 : nodes.findIndex((o) => !o.middle &&
          Math.hypot(Math.floor(o.cell / gw) - r, (o.cell % gw) - c) < NODE_GAP);
        if (near >= 0) {
          for (const room of node.rooms) if (!nodes[near].rooms.includes(room)) nodes[near].rooms.push(room);
          return;
        }
        if (this.nodeAt[node.cell] >= 0) return;
        this.nodeAt[node.cell] = nodes.length;
        nodes.push(node);
      };
      field.exits.forEach((e, k) => {
        const g = field.snap(e);
        if (g !== null && open[g]) add({ cell: g, px: [...e], rooms: [this.room[g]], exit: k });
      });
      for (const d of this.doors) add({ cell: d.cell, px: field.toPx(d.cell), rooms: d.rooms });
      for (const [room, cell] of this.middles) add({ cell, px: field.toPx(cell), rooms: [room], middle: true });
      this.nodes = nodes;
      this.byRoom = new Map();
      nodes.forEach((nd, i) => nd.rooms.forEach((r) => {
        if (!this.byRoom.has(r)) this.byRoom.set(r, []);
        this.byRoom.get(r).push(i);
      }));

      // Ways between the nodes of each room.
      this.edges = nodes.map(() => new Map());  // j -> {pts, len}, pts from i to j
      nodes.forEach((nd, i) => {
        const others = new Set();
        for (const r of nd.rooms) for (const j of this.byRoom.get(r)) if (j > i) others.add(j);
        const join = (j, pts) => {
          pts[0] = [...nd.px];
          pts[pts.length - 1] = [...nodes[j].px];
          const len = polyLength(pts);
          this.edges[i].set(j, { pts, len });
          this.edges[j].set(i, { pts: pts.slice().reverse(), len });
        };
        // Nodes in sight get a straight line; the others the way around.
        const around = new Set();
        for (const j of others) {
          if (this.sees(nd.cell, nodes[j].cell)) join(j, [null, null]);
          else around.add(j);
        }
        if (!around.size) return;
        for (const [j, chain] of this.walk(nd.cell, nd.rooms, around)) {
          join(j, this.straighten(chain).map((t) => field.toPx(chain[t])));
        }
      });

      this.trees = new Map();
      Object.assign(this, this.tree(-1));
    }

    // The parts that take long to make, as plain data for postMessage. The
    // field and the trees are made again from them.
    toData() {
      return { room: this.room, nodeAt: this.nodeAt, open: this.open, wd: this.wd, cost: this.cost,
               nodes: this.nodes, doors: this.doors, nextRooms: [...this.nextRooms],
               middles: [...this.middles], byRoom: [...this.byRoom], edges: this.edges.map((m) => [...m]) };
    }

    static fromData(field, d) {
      const net = Object.create(Network.prototype);
      Object.assign(net, d, { field, ink: field.blocked, nextRooms: new Map(d.nextRooms), middles: new Map(d.middles),
                              byRoom: new Map(d.byRoom), edges: d.edges.map((e) => new Map(e)), trees: new Map() });
      Object.assign(net, net.tree(-1));
      return net;
    }

    // The shortest way from each node to an exit, or to exit only when only
    // is 0 or more, and the lines of the map: each node's way to the next
    // node, wider where more nodes drain through it.
    tree(only) {
      if (this.trees.has(only)) return this.trees.get(only);
      const nodes = this.nodes;
      const dist = new Float64Array(nodes.length).fill(Infinity);
      const next = new Int32Array(nodes.length).fill(-1);
      const owner = new Int32Array(nodes.length).fill(-1);
      const heap = new Heap();
      nodes.forEach((nd, i) => {
        if (nd.exit !== undefined && (only < 0 || nd.exit === only)) { dist[i] = 0; owner[i] = nd.exit; heap.push(0, i); }
      });
      while (heap.size) {
        const [d, i] = heap.pop();
        if (d > dist[i]) continue;
        for (const [j, e] of this.edges[i]) {
          const nd = d + e.len ** TRUNK;
          if (nd < dist[j]) { dist[j] = nd; next[j] = i; owner[j] = owner[i]; heap.push(nd, j); }
        }
      }
      const below = new Float64Array(nodes.length);
      const order = nodes.map((_, i) => i).filter((i) => Number.isFinite(dist[i])).sort((a, b) => dist[b] - dist[a]);
      for (const i of order) { below[i] += 1; if (next[i] >= 0) below[next[i]] += below[i]; }
      const legs = [];
      for (const i of order) {
        // The map shows the ways between doors and exits. A room middle or a
        // door with nothing behind it draws no line, unless the door leads
        // straight to an exit: such ends stop in the open.
        if (next[i] < 0 || (below[i] === 1 && (nodes[i].middle || nodes[next[i]].exit === undefined))) continue;
        const pts = this.edges[i].get(next[i]).pts;
        for (let k = 0; k < pts.length - 1; k++) legs.push({ a: pts[k], b: pts[k + 1], flow: below[i] });
      }
      const t = { dist, next, owner, legs };
      this.trees.set(only, t);
      return t;
    }

    // Rooms: grow from the cells farthest from the walls. Where two rooms
    // meet, they are one room unless the cell where they meet is much
    // narrower than the smaller room: then it is a door.
    findRooms() {
      const { gw, gh } = this.field;
      const n = gw * gh, wd = this.wd, open = this.open;
      // Farthest from the walls first, then by cell: one number for each cell.
      const keys = [];
      for (let i = 0; i < n; i++) if (open[i]) keys.push((1e6 - Math.round(wd[i] * 1000)) * 2 ** 20 + i);
      const order = Float64Array.from(keys).sort().map((k) => k % 2 ** 20);
      const parent = new Int32Array(n).fill(-1);
      const peak = new Float64Array(n), peakCell = new Int32Array(n);
      const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      const meets = [];  // [cell, room, room]
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
          else meets.push([c, main, other]);
        }
        parent[c] = main;
      }
      this.room = new Int32Array(n).fill(-1);
      for (const i of order) this.room[i] = find(i);
      // A door for each opening between two rooms: the widest place where
      // they meet, and another one only farther than DOOR_GAP from it.
      const gap = DOOR_GAP * Math.max(gw, gh);
      const byPair = new Map();
      this.doors = [];
      for (const [c, a0, b0] of meets) {
        const a = find(a0), b = find(b0);
        if (a === b) continue;
        const key = Math.min(a, b) * n + Math.max(a, b);
        if (!byPair.has(key)) byPair.set(key, []);
        const kept = byPair.get(key);
        const cr = Math.floor(c / gw), cc = c - cr * gw;
        if (kept.some((d) => Math.hypot(Math.floor(d / gw) - cr, (d % gw) - cc) < gap)) continue;
        kept.push(c);
        this.doors.push({ cell: c, rooms: [a, b] });
      }
      this.nextRooms = new Map();
      for (const d of this.doors) {
        for (const [a, b] of [d.rooms, [...d.rooms].reverse()]) {
          if (!this.nextRooms.has(a)) this.nextRooms.set(a, []);
          if (!this.nextRooms.get(a).includes(b)) this.nextRooms.get(a).push(b);
        }
      }
      this.middles = new Map();
      for (const i of order) if (find(i) === i) this.middles.set(i, peakCell[i]);
    }

    // The cheapest ways from cell s, inside the given rooms, to the cells of
    // the wanted nodes. A map from node to its chain of cells, s first.
    walk(s, rooms, wanted) {
      const { gw, gh } = this.field;
      if (!this.mark) {
        const n = gw * gh;
        Object.assign(this, { mark: new Int32Array(n), inRooms: new Int32Array(n), markId: 0,
                              wdist: new Float64Array(n), wprev: new Int32Array(n) });
      }
      const id = ++this.markId, mark = this.mark, wdist = this.wdist, wprev = this.wprev;
      const inRooms = this.inRooms;
      for (const r of rooms) inRooms[r] = id;
      const ways = new Map();
      let left = wanted.size;
      mark[s] = id; wdist[s] = 0; wprev[s] = -1;
      const heap = this.heap || (this.heap = new CellHeap());
      heap.size = 0;
      heap.push(0, s);
      const room = this.room, nodeAt = this.nodeAt, open = this.open, cost = this.cost;
      while (heap.size && left) {
        const i = heap.pop(), d = heap.topCost;
        if (d > wdist[i]) continue;
        const k = this.nodeAt[i];
        if (k >= 0 && i !== s && wanted.has(k) && !ways.has(k)) {
          const chain = [];
          for (let t = i; t >= 0; t = wprev[t]) chain.push(t);
          ways.set(k, chain.reverse());
          left--;
        }
        // A way goes on only through the rooms; it can end on the cell of a
        // door that belongs to the room next to them.
        if (i !== s && inRooms[room[i]] !== id) continue;
        const r = Math.floor(i / gw), c = i - r * gw;
        for (let q = 0; q < 8; q++) {
          const dr = NEIGHBOURS[q][0], dc = NEIGHBOURS[q][1];
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= gh || nc < 0 || nc >= gw) continue;
          const j = nr * gw + nc;
          if (!open[j]) continue;
          if (dr && dc && (!open[r * gw + nc] || !open[nr * gw + c])) continue;
          if (inRooms[room[j]] !== id && nodeAt[j] < 0) continue;
          const nd = d + NEIGHBOURS[q][2] * cost[j];
          if (mark[j] !== id || nd < wdist[j]) { mark[j] = id; wdist[j] = nd; wprev[j] = i; heap.push(nd, j); }
        }
      }
      return ways;
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
      if (chain.length < 2) return [0];
      const xy = (i) => [chain[i] % gw, Math.floor(chain[i] / gw)];
      const keep = new Array(chain.length).fill(false);
      keep[0] = keep[chain.length - 1] = true;
      const todo = [[0, chain.length - 1]];
      while (todo.length) {
        const [lo, hi] = todo.pop();
        if (hi - lo < 2) continue;
        if (this.sees(chain[lo], chain[hi])) continue;
        let far = -1, farI = -1;
        for (let i = lo + 1; i < hi; i++) {
          const g = lineGap(xy(i), xy(lo), xy(hi));
          if (g > far) { far = g; farI = i; }
        }
        keep[farI] = true;
        todo.push([lo, farI], [farI, hi]);
      }
      // A corner closer than LINE_EPS to the line from the last corner kept
      // to the next one goes, when that line is clear.
      const idx = keep.flatMap((k, i) => (k ? [i] : []));
      const out = [idx[0]];
      for (let k = 1; k < idx.length - 1; k++) {
        const prev = out[out.length - 1], t = idx[k], nxt = idx[k + 1];
        if (lineGap(xy(t), xy(prev), xy(nxt)) > LINE_EPS || !this.sees(chain[prev], chain[nxt])) out.push(t);
      }
      out.push(idx[idx.length - 1]);
      return out;
    }

    // The route from start (cell s) to an exit along the network, or to exit
    // only when only is 0 or more. Null when the network has no way.
    route(start, s, only = -1) {
      const f = this.field;
      const { dist: ndist, next, owner } = this.tree(only);
      // The start looks in its room and the rooms up to two doors away,
      // through any opening, as a door of the network is only one of the
      // openings between two rooms.
      const rooms = [this.room[s]];
      for (let hop = 0; hop < 2; hop++) {
        for (const r of rooms.slice()) for (const o of this.nextRooms.get(r) || []) if (!rooms.includes(o)) rooms.push(o);
      }
      const wanted = new Set();
      for (const r of rooms) for (const j of this.byRoom.get(r) || []) if (Number.isFinite(ndist[j])) wanted.add(j);
      if (!wanted.size) return null;
      const ways = this.walk(s, rooms, wanted);
      let best = null;
      for (const [j, chain] of ways) {
        const pts = this.straighten(chain).map((t) => f.toPx(chain[t]));
        pts[0] = [start[0], start[1]];
        pts[pts.length - 1] = [...this.nodes[j].px];
        const cost = polyLength(pts) ** TRUNK + ndist[j];
        if (!best || cost < best.cost) best = { cost, pts, j };
      }
      if (!best) return null;
      const pts = best.pts;
      for (let i = best.j; next[i] >= 0; i = next[i]) pts.push(...this.edges[i].get(next[i]).pts.slice(1));
      const k = owner[best.j];
      // Pull the route tight: from each point, go straight to the last later
      // point in sight, so the route does not hook back at a door.
      const cellOf = (q) => {
        const [r, col] = f.toCell(q);
        const c = r * f.gw + col;
        return this.ink[c] ? f.snap(q) : c;
      };
      const cells = pts.map((q, j) => (j === 0 ? s : cellOf(q)));
      const tight = [0];
      while (tight[tight.length - 1] < pts.length - 1) {
        const i = tight[tight.length - 1];
        let j = pts.length - 1;
        while (j > i + 1 && (cells[j] === null || cells[i] === null || this.ink[cells[j]] || !this.sees(cells[i], cells[j]))) j--;
        tight.push(j);
      }
      pts.splice(0, pts.length, ...tight.map((j) => pts[j]));
      const out = pts.filter((q, j) => j === 0 || dist(q, pts[j - 1]) > 1e-6);
      if (out.length === 1) out.push([...f.exits[k]]);
      return { points: out, exitIndex: k, onNetwork: true };
    }
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
