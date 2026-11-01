// Reads a case as JSON on stdin, prints which wall lines route.js
// buildingLines keeps. Used by test_wall_lines.py.
const R = require("../src/hereout/web/route.js");

let input = "";
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  const c = JSON.parse(input);
  const f = new R.Field(R.decodeGrid(c.grid), c.grid.w, c.grid.h, c.grid.scale, c.exits);
  process.stdout.write(JSON.stringify(R.buildingLines(f, c.lines, c.width, c.height)));
});
