// Draw the marks of the start page example: what HereOut draws on one sample
// plan from one start (escape map, ways out, route, YOU, exits), with no photo
// under them. The page puts the saved photo of the plan under this image
// (app.py example_page), so the repository keeps no photo of a plan.
//
// Usage, with the local server running on a gallery folder:
//   node scripts/example_marks.mjs http://127.0.0.1:8031 <id> <x>,<y> <x0>,<y0>,<x1>,<y1> src/hereout/web/example-marks.webp [preview.png]
// <x>,<y> is the start, <x0>,...,<y1> the part of the plan to show, both in plan pixels.
// Run it again after a change of the drawing or the route code, with the same
// numbers as data-start and the crop in index.html.
// playwright-core comes from the hub kit (kit/plugins/core) or from PLAYWRIGHT_CORE.
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// The hub kit is in a folder above the repository (a worktree is deeper than the submodule).
function kit() {
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const p = path.join(dir, "kit/plugins/core/package.json");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("playwright-core not found: set PLAYWRIGHT_CORE to a package.json beside it");
}
const require = createRequire(process.env.PLAYWRIGHT_CORE || kit());
const { chromium } = require("playwright-core");

const [, , base, id, startArg, viewArg, out, preview] = process.argv;
if (!out) {
  console.error("usage: example_marks.mjs <server> <id> <x>,<y> <x0>,<y0>,<x1>,<y1> <out.webp> [preview.png]");
  process.exit(2);
}
const start = startArg.split(",").map(Number);
const view = viewArg.split(",").map(Number);
const WIDTH = 1000;  // px of the image: sharp at 2x on the widest place it shows

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/?sample=${encodeURIComponent(id)}`);
await page.waitForFunction(() => typeof state !== "undefined" && state && view && view.field
  && (!view.field.waitForNetwork || view.field._network), null, { timeout: 60000 });
await page.evaluate(([x, y]) => setStart(x, y), start);
await page.waitForFunction(() => !view.pending && (view.route || view.error), null, { timeout: 60000 });
const result = await page.evaluate(({ v, width, withPhoto }) => {
  if (!view.route) return { error: view.error };
  const exit = view.route.exitIndex + 1;
  const photo = img;
  const crop = (src) => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = Math.round(width * (v[3] - v[1]) / (v[2] - v[0]));
    c.getContext("2d").drawImage(src, v[0], v[1], v[2] - v[0], v[3] - v[1], 0, 0, c.width, c.height);
    return c;
  };
  const both = withPhoto ? crop(canvas).toDataURL("image/png") : null;
  // The same drawing over an empty sheet: the marks alone, with their alpha.
  const blank = document.createElement("canvas");
  blank.width = state.width;
  blank.height = state.height;
  img = blank;
  draw();
  const marks = crop(canvas).toDataURL("image/webp", 0.85);
  img = photo;
  draw();
  return { exit, steps: view.steps.map((s) => s.text), size: [state.width, state.height], marks, both };
}, { v: view, width: WIDTH, withPhoto: !!preview });
if (result.error) {
  console.error(`no route from ${startArg}: ${result.error}`);
  process.exit(1);
}
fs.writeFileSync(out, Buffer.from(result.marks.split(",")[1], "base64"));
if (preview) fs.writeFileSync(preview, Buffer.from(result.both.split(",")[1], "base64"));
console.log(JSON.stringify({ id, start, view, plan: result.size, exit: result.exit, steps: result.steps, errors }, null, 1));
await browser.close();
