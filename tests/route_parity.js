// Reads cases as JSON on stdin, prints what web/route.js finds for each.
// Used by test_route_parity.py.
const R = require("../src/hereout/web/route.js");

let input = "";
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  const out = JSON.parse(input).map((c) => {
    const blocked = R.decodeGrid(c.grid);
    const f = new R.Field(blocked, c.grid.w, c.grid.h, c.grid.scale, c.exits, c.clear);
    return {
      dist: Array.from(f.dist, (d) => (Number.isFinite(d) ? d : null)),
      owner: Array.from(f.owner),
      routes: c.starts.map((s) => {
        try {
          const r = f.route(s);
          return { points: r.points, exit_index: r.exitIndex, steps: R.directions(r.points, c.width, c.height).map((x) => x.text) };
        } catch (e) {
          if (e instanceof R.NoRoute) return { error: e.message };
          throw e;
        }
      }),
    };
  });
  process.stdout.write(JSON.stringify(out));
});
