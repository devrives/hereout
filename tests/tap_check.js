// Reads { grid, exits, taps } as JSON on stdin, prints what Field.tapStart
// of web/route.js gives for each tap, and the route from there. Used by test_tap.py.
const R = require("../src/hereout/web/route.js");

let input = "";
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  const c = JSON.parse(input);
  const f = new R.Field(R.decodeGrid(c.grid), c.grid.w, c.grid.h, c.grid.scale, c.exits);
  const taps = c.taps.map((p) => {
    const t = f.tapStart(p);
    const out = { at: t.at };
    if (t.cell !== undefined) {
      out.cell = [Math.floor(t.cell / f.gw), t.cell % f.gw];
      out.way = f.owner[t.cell] >= 0;
      try { f.route(t.at === "open" ? p : f.toPx(t.cell)); out.route = "route"; } catch (e) { out.route = e.message; }
    }
    return out;
  });
  process.stdout.write(JSON.stringify({ box: f.openBox(), taps }));
});
