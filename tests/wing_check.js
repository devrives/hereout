// Reads one case as JSON on stdin, prints the lines of the way network of
// web/route.js with a wing at an angle. Used by test_network.py.
const R = require("../src/hereout/web/route.js");

let input = "";
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  const c = JSON.parse(input), g = c.grid;
  const wing = g.wing ? { mask: R.decodeGrid({ ...g, bits: g.wing }), axes: g.wing_axes } : null;
  const f = new R.Field(R.decodeGrid(g), g.w, g.h, g.scale, c.exits, [], null, g.axes, wing);
  const net = f.network();
  const copy = new R.Field(R.decodeGrid(g), g.w, g.h, g.scale, c.exits, [], null, g.axes, wing);
  copy.adoptNetwork(structuredClone(net.toData()));
  const inWing = (p) => { const [r, col] = f.toCell(p); return !!(wing && wing.mask[r * f.gw + col]); };
  process.stdout.write(JSON.stringify({
    wing: !!wing, wingAxes: g.wing_axes || null, axes: g.axes, adopted: copy.network().legs.length === net.legs.length,
    legs: net.legs.filter((l) => !l.exit).map((l) => ({ a: l.a, b: l.b, inWing: inWing(l.a) && inWing(l.b),
                                                       outWing: !inWing(l.a) && !inWing(l.b) })),
  }));
});
