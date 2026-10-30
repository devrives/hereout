// Reads cases as JSON on stdin, prints what the way network of web/route.js
// gives for each. Used by test_network.py.
const R = require("../src/hereout/web/route.js");

let input = "";
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  const out = JSON.parse(input).map((c) => {
    const f = new R.Field(R.decodeGrid(c.grid), c.grid.w, c.grid.h, c.grid.scale, c.exits, c.clear);
    const net = f.network();
    const cell = (p) => { const [r, col] = f.toCell(p); return r * f.gw + col; };
    // A leg is clear when the line between its ends has no ink. Ends in ink
    // (a start or an exit that snaps to the open space) are not checked.
    const clear = (a, b) => { const i = cell(a), j = cell(b); return net.ink[i] || net.ink[j] || net.sees(i, j); };
    // A field that waits for the network routes on the grid, and with the
    // network data that a worker sends, it routes as the field that made it.
    const copy = new R.Field(R.decodeGrid(c.grid), c.grid.w, c.grid.h, c.grid.scale, c.exits, c.clear);
    copy.waitForNetwork = true;
    const ask = (g, s) => { try { return JSON.stringify(g.wayRoute(s)); } catch (e) { return e.message; } };
    const waits = c.starts.every((s) => ask(copy, s) === (() => { try { return JSON.stringify(f.route(s)); } catch (e) { return e.message; } })());
    copy.adoptNetwork(structuredClone(net.toData()));
    const adopted = copy.network().legs.length === net.legs.length && c.starts.every((s) => ask(copy, s) === ask(f, s));
    // With the trees to single exits that the worker sends, a route to each exit is the same too.
    const maker = new R.Field(R.decodeGrid(c.grid), c.grid.w, c.grid.h, c.grid.scale, c.exits, c.clear);
    const sent = new R.Field(R.decodeGrid(c.grid), c.grid.w, c.grid.h, c.grid.scale, c.exits, c.clear);
    sent.waitForNetwork = true;
    sent.adoptNetwork(structuredClone(maker.network().toData()));
    c.exits.forEach((_, k) => sent.adoptTree(k, structuredClone(maker.network().treeData(k))));
    const askTo = (g, s, k) => { try { return JSON.stringify(g.wayRoute(s, k)); } catch (e) { return e.message; } };
    const treesAdopted = c.exits.every((_, k) => sent._network.trees.get(k).best) &&
      c.starts.every((s) => c.exits.every((_, k) => askTo(sent, s, k) === askTo(f, s, k)));
    // The drawn lines: pieces that touch (an end on another line) are one.
    const legs = net.legs;
    const tol = 1.5 / f.scale;
    const near = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
      return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) <= tol;
    };
    const group = legs.map((_, i) => i);
    const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
    legs.forEach((l, i) => legs.forEach((m, j) => {
      if (i < j && [l.a, l.b].some((p) => near(p, m.a, m.b)) || [m.a, m.b].some((p) => near(p, l.a, l.b))) group[find(i)] = find(j);
    }));
    const pieces = new Set(legs.map((_, i) => find(i))).size;
    return {
      pieces,
      waits,
      adopted,
      treesAdopted,
      legs: net.legs.length,
      legsClear: net.legs.filter((l) => !l.exit).every((l) => clear(l.a, l.b)),
      // With no tilt, every line of the map is level or upright.
      straight: net.axes.some((a) => a !== 0) ||
        net.legs.filter((l) => !l.exit).every((l) => Math.abs(l.a[0] - l.b[0]) < 1e-6 || Math.abs(l.a[1] - l.b[1]) < 1e-6),
      routes: c.starts.map((s) => {
        let grid, way;
        try { grid = f.route(s); } catch (e) { grid = { error: e.message }; }
        try { way = f.wayRoute(s); } catch (e) { return { error: e.message, gridError: grid.error || null }; }
        const p = way.points;
        return { gridError: grid.error || null, onNetwork: !!way.onNetwork, exitIndex: way.exitIndex,
                 end: p[p.length - 1], exit: c.exits[way.exitIndex],
                 clear: p.slice(1, -1).every((q, i) => clear(p[i], q)),
                 bad: p.slice(1, -1).flatMap((q, i) => (clear(p[i], q) ? [] : [i])), n: p.length,
                 // The legs between the first and the last are level or upright.
                 straight: net.axes.some((a) => a !== 0) || p.slice(2, -2).every((q, i) =>
                   Math.abs(q[0] - p[i + 1][0]) < 1e-6 || Math.abs(q[1] - p[i + 1][1]) < 1e-6) };
      }),
    };
  });
  process.stdout.write(JSON.stringify(out));
});
