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
  // A field with the wing network and the trees that the worker sends
  // routes as the field that made them, to the nearest exit and to each exit.
  const maker = new R.Field(R.decodeGrid(g), g.w, g.h, g.scale, c.exits, [], null, g.axes, wing);
  const sent = new R.Field(R.decodeGrid(g), g.w, g.h, g.scale, c.exits, [], null, g.axes, wing);
  sent.adoptNetwork(structuredClone(maker.network().toData()));
  if (wing) sent.adoptWingNetwork(structuredClone(maker.wingNetwork().toData()));
  c.exits.forEach((_, k) => {
    sent.adoptTree(k, structuredClone(maker.network().treeData(k)));
    if (wing) sent.adoptTree(k, structuredClone(maker.wingNetwork().treeData(k)), true);
  });
  const ask = (h, s, k) => { try { return JSON.stringify(h.wayRoute(s, k)); } catch (e) { return e.message; } };
  const starts = [];
  for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) starts.push([g.w / g.scale * x / 8, g.h / g.scale * y / 8]);
  let routes = 0;
  const treesAdopted = starts.every((s) => [-1, ...c.exits.keys()].every((k) => {
    const a = ask(sent, s, k);
    if (a.startsWith("{")) routes++;
    return a === ask(f, s, k);
  })) && routes > 20 && (!wing || !!sent._wingNet.trees.get(0).best);
  const inWing = (p) => { const [r, col] = f.toCell(p); return !!(wing && wing.mask[r * f.gw + col]); };
  process.stdout.write(JSON.stringify({
    wing: !!wing, wingAxes: g.wing_axes || null, axes: g.axes, adopted: copy.network().legs.length === net.legs.length, treesAdopted,
    legs: net.legs.filter((l) => !l.exit).map((l) => ({ a: l.a, b: l.b, inWing: inWing(l.a) && inWing(l.b),
                                                       outWing: !inWing(l.a) && !inWing(l.b) })),
  }));
});
