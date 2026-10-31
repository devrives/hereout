// Gives drawn lines to the jog, gap and dead-end steps of web/route.js
// (Network.schematize) on an open floor and prints what comes out. Used by
// test_network.py. All points are pixels; one cell is one pixel.
const R = require("../src/hereout/web/route.js");

const W = 100, H = 100;
const blocked = new Uint8Array(W * H);
for (let i = 0; i < W; i++) { blocked[i] = blocked[(H - 1) * W + i] = 1; blocked[i * W] = blocked[i * W + W - 1] = 1; }
// Walls two cells right of and below the end of the line with the tick.
for (let y = 60; y < 84; y++) blocked[y * W + 54] = 1;
for (let x = 40; x < 55; x++) blocked[83 * W + x] = 1;
const f = new R.Field(blocked, W, H, 1, [[50, 1]]);
const net = f.network();
const leg = (a, b, more = {}) => ({ a, b, flow: 1, ...more });
const out = {
  // Two lines that meet a third one a cell apart: one moves onto the other.
  jog: net.schematize([leg([10.5, 40.5], [50.5, 40.5]), leg([50.5, 41.5], [90.5, 41.5]), leg([50.5, 20.5], [50.5, 70.5])]),
  // A line that ends two cells short of another piece gets a short line to it.
  gap: net.schematize([leg([10.5, 30.5], [80.5, 30.5]), leg([40.5, 70.5], [40.5, 32.5])]),
  // A short tick at the end of a line, towards a wall near the line, goes.
  tick: net.schematize([leg([10.5, 50.5], [90.5, 50.5]), leg([50.5, 50.5], [50.5, 80.5]), leg([52.5, 80.5], [50.5, 80.5])]),
};
process.stdout.write(JSON.stringify(out));
