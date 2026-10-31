"use strict";

const $ = (id) => document.getElementById(id);
const R = HereOutRoute;
const canvas = $("plan");
const ctx = canvas.getContext("2d");
let img = new Image();  // the image of state; a new plan loads into its own image first
// The plan: the server answer, plus the start, the exits and the chosen exit
// as the user set them. Everything else is found again from it in the browser.
let state = null;
let view = null;      // the escape field, the map layer, the route and the steps for state
let opening = null;   // the answer whose image loads, before it becomes state
let openingImg = null;  // its image
let marking = false;  // true while the user marks the exit
let cursor = null;    // [x, y] keyboard marker on the plan
let keyboard = false; // show the marker only after an arrow key
let planSeq = 0;      // only the newest upload may change the page
let selected = -1;    // the step shown on the plan, or -1
let showMap = true;
let photoOnly = false;
let routesOnly = false; // the routes on the walls HereOut read, with no photo
let addExit = false;    // the next exit the user marks joins the others (explain, NO_EXIT_HERE)
const canSpeak = "speechSynthesis" in window;
$("shoot").hidden = $("new-photo").hidden = false;  // without JS the photo buttons would do nothing
// Two photo buttons: the big one on the start page, and one in the header while a plan is open.
const PHOTOS = [$("photo"), $("photo-2")];
// Below this width the answer is under the plan, so an answer can scroll the plan away.
const narrow = () => matchMedia("(max-width: 959px)").matches;
// "?set=review" opens the review set: plans read with code under test.
const SET = new URLSearchParams(location.search).get("set") === "review" ? "?set=review" : "";
const STORE_KEY = `hereout:last${SET}`;  // the review set keeps its own last plan
const PHOTO_KEY = "hereout:photo";  // the plan of the last photo, so Back after a sample finds it

// Map colours: green near an exit, yellow far from one.
const NEAR = [10, 125, 59], FAR_C = [245, 190, 20];
const MAP_ALPHA = 110;
const ROUTE = "#1b5fd1";
const ARROW_GAP = 12;   // plan units between two arrows on a way out
const ARROW_SIZE = 1.1; // plan units: half the width of an arrow head
const OTHER_TRIES = 3;  // exits tried for the second way out
const FLOOR_SHARE = 0.05; // an open area with this share of the open cells is a floor, not a pocket of paper
const ARROW_CLEAR = 2;  // plan units: no arrow this close to a route
const ARROW_APART = 4;  // arrow sizes: no head this close to another head (two heads meet at a split or join)
const ARROW_KEEP = 5;   // plan units: a line this long keeps one head, also near other heads
const ARROW_START = 8;  // plan units: no arrow this close to the start, where it can point away from the route
const WALL = "#7a818b";  // lighter than the ways out, so a way and a wall differ in more than hue
const BLOCK = "#d3d6db";  // a filled area of the plan, in Routes only
const WAY = "rgb(6, 64, 34)";  // the ways out, opaque so they keep their contrast over a photo

// Two status lines: one by the photo button for loading, one under the plan
// for what happens on the plan, so the answer to a tap is in view.
function say(text) { $("status").textContent = text; }
// The same text again is no change, and a screen reader stays silent: an
// Enter with no answer sounds like a dead key. Empty the line first, and set
// the text in a later task.
let sayAgain = 0;
function sayPlan(text) {
  const el = $("plan-status");
  if (text === FINDING && el.textContent === FINDING) return;  // one open, one message
  clearTimeout(sayAgain);
  if (text && el.textContent === text) {
    el.textContent = "";
    sayAgain = setTimeout(() => { el.textContent = text; }, 100);
  } else {
    el.textContent = text;
  }
}

// Error bodies from a proxy may not be JSON, and a 422 detail is a list.
async function errorText(r, fallback) {
  const body = await r.json().catch(() => ({}));
  return typeof body.detail === "string" ? body.detail : fallback;
}

function remember() {
  try {
    const json = JSON.stringify(state);
    sessionStorage.setItem(STORE_KEY, json);
    if (!sampleId(state.id)) sessionStorage.setItem(PHOTO_KEY, json);
  } catch (e) { /* storage full or blocked */ }
}

const exitPoints = () => state.exits.map((e) => [e.x, e.y]);

// The escape field for the current exits.
function buildField() {
  const g = state.grid;
  const blocked = R.decodeGrid(g);
  const soft = g.soft ? R.decodeGrid({ ...g, bits: g.soft }) : null;
  const wing = g.wing ? { mask: R.decodeGrid({ ...g, bits: g.wing }), axes: g.wing_axes } : null;
  const make = (exits) => new R.Field(blocked, g.w, g.h, g.scale, exits, [], soft, g.axes, wing);
  const field = make(exitPoints());
  const single = new Map();  // a field to one exit, made when the user picks that exit
  view = { field, layer: null, walls: null, route: null, steps: [], error: null,
           toExit: (i) => { if (!single.has(i)) single.set(i, make([exitPoints()[i]])); return single.get(i); } };
  view.reachable = field.owner.some((o) => o >= 0);
  view.frame = floorFrame();
  if (view.reachable) makeNetwork(field);
  else stopWorker();  // no ways out to make: the trees of the plan before are not wanted
}

// The ways out take about a second to make on a phone, so a worker makes
// them. Until they come, routes follow the grid field and the map has no
// lines. Without a worker, the page makes them itself. After the ways out,
// the worker makes the trees to single exits that a tap needs (route.js
// treeData); a tap before they come makes the trees it needs itself.
let worker = null;
let workerBusy = false;   // the worker still makes trees for a job
let networkJob = 0;
let networkReady = null;  // the callback of the newest job
let networkField = null;  // the field of the newest job
let networkTimer = 0;
const NETWORK_WAIT = 15000;  // ms: a worker with no answer by then is stopped (a phone can kill it for memory)
const scriptUrl = (sel) => { const el = document.querySelector(sel); return el && (el.src || el.href); };

// The page waited for the worker: show the route now.
function updateAfterWait() {
  const exitAt = [...$("exits").children].indexOf(document.activeElement);
  // The status said "Finding the route…": now it names the route. A route
  // that still waits (the trees after the network) keeps it for later.
  // Any other status is already right: do not read it again.
  const how = view.pendingHow;
  view.pendingHow = null;
  update();
  if (exitAt >= 0) $("exits").children[exitAt]?.focus();
  if (state.start && how) explain(how);
}

// The trees to single exits that a route from start needs and the worker
// has not sent yet, as { ks, wing }, or null. Only while the worker makes
// them: then the page waits for them, and does not stop to make them too.
function treesToWait(f, start) {
  if (!workerBusy || networkField !== f || !f._network) return null;
  const k = state.exitChoice;
  const m = k >= 0 ? k : f.nearestExit(start);
  if (m < 0) return null;
  const ks = [m, ...f.otherExits(start, m).slice(0, OTHER_TRIES)];
  const has = (net, i) => net && net.trees.has(i);
  const missing = ks.filter((i) => !has(f._network, i) || (f.wing && !has(f._wingNet, i)));
  if (f.wing && !f._wingNet) return { ks, wing: true };
  return missing.length ? { ks: missing, wing: !!f.wing } : null;
}

// A tree came, or the worker is done: a route that waits for trees can go on.
function treeCame() {
  if (!state || !view || view.field !== networkField || !view.pending || !state.start) return;
  if (!treesToWait(view.field, state.start)) updateAfterWait();
}

function stopWorker() {
  if (worker && workerBusy) { worker.terminate(); worker = null; workerBusy = false; }
}

function makeNetwork(field) {
  const job = ++networkJob;
  field.waitForNetwork = true;
  const ready = (data) => {
    if (job !== networkJob || !state || view.field !== field) return;
    clearTimeout(networkTimer);
    if (data) field.adoptNetwork(data);
    else field.waitForNetwork = false;
    view.layer = null;
    updateAfterWait();
  };
  networkReady = ready;
  networkField = field;
  try {
    stopWorker();  // a worker busy with the trees of an old plan: the new plan must not wait
    if (!worker) {
      const w = worker = new Worker(scriptUrl("#network-worker"));
      worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.id !== networkJob) return;
        if (m.done) workerBusy = false;
        else if (m.data) { if (networkReady) networkReady(m.data); return; }
        else if (m.wingData) networkField.adoptWingNetwork(m.wingData);
        else if (m.tree) networkField.adoptTree(m.k, m.tree, m.wing);
        treeCame();
      };
      worker.onerror = (ev) => {
        ev.preventDefault();
        if (worker !== w) return;  // an error of a worker that a new job stopped
        worker = null;
        workerBusy = false;
        if (networkReady) networkReady(null);
      };
    }
    clearTimeout(networkTimer);
    networkTimer = setTimeout(() => {
      if (job !== networkJob) return;
      worker?.terminate();
      worker = null;
      workerBusy = false;
      ready(null);
    }, NETWORK_WAIT);
    const g = state.grid;
    workerBusy = true;
    worker.postMessage({ id: job, routeUrl: scriptUrl('script[src*="/static/route.js"]'),
                         grid: { w: g.w, h: g.h, scale: g.scale, bits: g.bits, soft: g.soft, axes: g.axes,
                                 wing: g.wing, wing_axes: g.wing_axes }, exits: exitPoints() });
  } catch (e) {
    worker = null;
    setTimeout(() => ready(null), 0);
  }
}

const FINDING = "Finding the route…";

// While the worker makes the ways out, the page shows no route: a grid route
// first and a different route a second later would confuse. A spot with no
// way out gets its message at once.
function findRoute() {
  view.route = null;
  view.backup = null;
  view.steps = [];
  view.error = null;
  view.pending = false;
  if (!state.start || !state.exits.length) return;
  const f = view.field, start = state.start;
  // While the worker makes the trees this start needs, wait for them.
  const need = treesToWait(f, start);
  if (need) {
    view.pending = true;
    worker.postMessage({ id: networkJob, need: need.ks, wing: need.wing });
    return;
  }
  // The ways out lead to a chosen exit too. Where they do not, the grid
  // route of a field to that exit is the answer.
  const to = (k) => f.wayRoute(start, k) || view.toExit(k).route(start);
  let main;
  try {
    const k = state.exitChoice;
    const r = k >= 0 ? to(k) : f.wayRoute(start);
    if (f.waitForNetwork && !f._network) { view.pending = true; return; }
    main = { points: r.points, exitIndex: k >= 0 ? k : r.exitIndex, length: r.length };
    // "Nearest" is by the cost of the way, as for the second exit below; the
    // map lines can lead a spot to an exit a little farther away.
    const near = k >= 0 ? -1 : f.nearestExit(start);
    if (near >= 0 && near !== main.exitIndex) { const r = to(near); main = { points: r.points, exitIndex: near, length: r.length }; }
  } catch (e) {
    if (!(e instanceof R.NoRoute)) throw e;
    view.error = e.message;
    return;
  }
  // A second way out, in case the first exit is blocked: the nearest other
  // exit whose way does not pass the door of the first one. With no such
  // exit there is no second way: "if it is blocked" must not lead past that door.
  const door = f.doorRadius() / 2;
  const passes = (pts, i) => pts.slice(1, -1).some(([x, y]) => Math.hypot(x - state.exits[i].x, y - state.exits[i].y) < door);
  let backup = null;
  for (const k of f.otherExits(start, main.exitIndex).slice(0, OTHER_TRIES)) {
    let r;
    try { r = to(k); } catch (e) { if (!(e instanceof R.NoRoute)) throw e; continue; }
    if (!passes(r.points, main.exitIndex)) { backup = { points: r.points, exitIndex: k, length: r.length }; break; }
  }
  // The solid route is the shorter one, so "nearest" stays true on the plan.
  // After a swap, the second way must keep clear of the door of the new first exit too.
  // A route on the ways out gives the length of its way before it moved
  // onto the drawn lines (route.js).
  const len = (r) => r.length ?? r.points.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - r.points[i][0], q[1] - r.points[i][1]), 0);
  if (backup && state.exitChoice < 0 && len(backup) < len(main)) {
    [main, backup] = [backup, main];
    if (passes(backup.points, main.exitIndex)) backup = null;
  }
  view.route = main;
  view.backup = backup;
  view.steps = R.directions(main.points, state.width, state.height);
}

// The escape map: colour by the cost to the nearest exit, and the ways out
// as lines. Made once for each field.
function mapLayer() {
  if (view.layer) return view.layer;
  const f = view.field;
  const n = f.gw * f.gh;
  const tint = document.createElement("canvas");
  tint.width = f.gw;
  tint.height = f.gh;
  const tctx = tint.getContext("2d");
  const data = tctx.createImageData(f.gw, f.gh);
  let max = 0;
  for (let i = 0; i < n; i++) if (f.owner[i] >= 0 && f.dist[i] > max) max = f.dist[i];
  for (let i = 0; i < n; i++) {
    if (f.owner[i] < 0) continue;
    const t = max ? Math.sqrt(f.dist[i] / max) : 0;
    for (let k = 0; k < 3; k++) data.data[i * 4 + k] = NEAR[k] + (FAR_C[k] - NEAR[k]) * t;
    data.data[i * 4 + 3] = MAP_ALPHA;
  }
  tctx.putImageData(data, 0, 0);

  const l = frameLayer();
  const layer = l.canvas;
  l.imageSmoothingEnabled = true;
  l.drawImage(tint, 0, 0, f.gw / f.scale, f.gh / f.scale);

  // The ways out: straight lines from door to door to the exits, wider where
  // more doors and rooms drain through them.
  // No lines while the worker makes them.
  const net = f._network || (f.waitForNetwork ? null : f.network());
  const legs = net ? net.legs : [];
  const unit = frameUnit();
  const widths = [[], [], [], [], [], []];
  for (const leg of legs) widths[Math.min(5, Math.floor(Math.log2(leg.flow)))].push(leg);
  l.lineCap = l.lineJoin = "round";
  l.strokeStyle = WAY;
  widths.forEach((group, b) => {
    l.lineWidth = unit * (0.7 + 0.16 * b);
    l.beginPath();
    for (const { a, b: z } of group) {
      l.moveTo(a[0], a[1]);
      l.lineTo(z[0], z[1]);
    }
    l.stroke();
  });

  view.layer = layer;
  return layer;
}

// The walls as HereOut reads them: the straight wall lines and the filled
// areas that the server found. The routes keep inside these walls.
function wallLayer() {
  if (view.walls) return view.walls;
  const l = frameLayer();
  const layer = l.canvas;
  const unit = frameUnit();
  const { lines = [], blocks = [] } = state.walls || {};
  // Filled areas (hatching, solid ink) in light grey with a wall edge.
  l.fillStyle = BLOCK;
  l.strokeStyle = WALL;
  l.lineWidth = unit * 0.45;
  for (const b of blocks) {
    l.beginPath();
    b.forEach(([x, y], i) => (i ? l.lineTo(x, y) : l.moveTo(x, y)));
    l.closePath();
    l.fill();
    l.stroke();
  }
  l.lineCap = "round";
  for (const [x0, y0, x1, y1, width] of lines) {
    l.lineWidth = Math.max(width, unit * 0.45);
    l.beginPath();
    l.moveTo(x0, y0);
    l.lineTo(x1, y1);
    l.stroke();
  }
  view.walls = layer;
  return layer;
}

// The plan view shows the floor drawing, not all of the photo: a photo
// often has a frame, text panels and a legend round the sheet, and the plan
// was small on a phone. The frame is the box of the open cells of the wall
// grid (route.js openBox: every cell outside the model's floor box is wall)
// and every exit, start and their marks, with a margin. "Photo only" keeps the
// frame, so the photo and the route compare at one place; the reading view
// (reading.js) shows all of the photo. All drawing is in photo pixels;
// setFrame maps them.
const FRAME_MARGIN = 0.05;  // share of the long side of the box: room for the exit marks and their labels
const FRAME_TALL = 1.25;    // a frame is at most this tall for its width, or as tall as the photo
const FRAME_ALL = 0.9;      // a box with this share of the photo on both sides shows all of it
const FRAME_ZOOM = 3;       // the canvas has at most this many pixels for each photo pixel

function floorFrame() {
  const W = state.width, H = state.height, all = [0, 0, W, H];
  const box = state.photo_map ? null : view.field.openBox();
  if (!box) return all;
  let [x0, y0, x1, y1] = box;
  for (const [x, y] of [...exitPoints(), ...(state.start ? [state.start] : [])]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const m = FRAME_MARGIN * Math.max(x1 - x0, y1 - y0);
  x0 -= m; y0 -= m; x1 += m; y1 += m;
  // A tall narrow box becomes wider, so the plan does not run far down the page.
  const tall = Math.max(H / W, FRAME_TALL);
  if (y1 - y0 > tall * (x1 - x0)) {
    const grow = ((y1 - y0) / tall - (x1 - x0)) / 2;
    x0 -= grow; x1 += grow;
  }
  // Keep the box on the photo; a side that runs off moves the other side in.
  const fit = (a, b, size) => (b - a >= size ? [0, size] : a < 0 ? [0, b - a] : b > size ? [size - (b - a), size] : [a, b]);
  [x0, x1] = fit(x0, x1, W);
  [y0, y1] = fit(y0, y1, H);
  if (x1 - x0 >= FRAME_ALL * W && y1 - y0 >= FRAME_ALL * H) return all;
  return [x0, y0, x1, y1].map(Math.round);
}

// The part of the photo in view now: all of it in Photo only.
// The reading view (reading.js) shows all of the photo, as the model saw it.
function shownFrame() {
  const reading = typeof readingOn === "function" && readingOn();
  return reading || !view || !view.frame ? [0, 0, state.width, state.height] : view.frame;
}

// Canvas pixels for each photo pixel: a frame gets as many canvas pixels as
// all of the photo, so the zoomed plan stays sharp.
function frameScale(fr) {
  return Math.min(FRAME_ZOOM, Math.max(state.width, state.height) / Math.max(fr[2] - fr[0], fr[3] - fr[1]));
}

// The size unit of the marks and lines: a share of the frame, so they look
// the same on a zoomed plan as on all of the photo.
function frameUnit() {
  const fr = shownFrame();
  return Math.max(fr[2] - fr[0], fr[3] - fr[1]) / 160;
}

// Size the canvas to the frame and map photo pixels onto it.
function setFrame() {
  const fr = shownFrame(), k = frameScale(fr);
  canvas.width = Math.round((fr[2] - fr[0]) * k);
  canvas.height = Math.round((fr[3] - fr[1]) * k);
  ctx.setTransform(k, 0, 0, k, -fr[0] * k, -fr[1] * k);
}

// A layer canvas as big as the plan canvas, in photo pixels.
function frameLayer() {
  const fr = shownFrame(), k = frameScale(fr);
  const layer = document.createElement("canvas");
  layer.width = Math.round((fr[2] - fr[0]) * k);
  layer.height = Math.round((fr[3] - fr[1]) * k);
  const l = layer.getContext("2d");
  l.setTransform(k, 0, 0, k, -fr[0] * k, -fr[1] * k);
  return l;
}

// A layer from frameLayer goes on the canvas pixel for pixel.
function drawLayer(layer) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

// A photo point in CSS pixels from the top left of the canvas.
function toCanvasCss(p) {
  const [x0, y0, x1, y1] = shownFrame();
  return [(p[0] - x0) / (x1 - x0) * canvas.clientWidth, (p[1] - y0) / (y1 - y0) * canvas.clientHeight];
}

// The keyboard marker starts at the start, else in the middle of the view.
function startCursor() {
  const [x0, y0, x1, y1] = shownFrame();
  return state.start ? [...state.start] : [(x0 + x1) / 2, (y0 + y1) / 2];
}

function draw() {
  if (!state) return;
  setFrame();
  if (typeof readingOn === "function" && readingOn()) return drawReading();  // reading.js
  if (routesOnly) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, state.width, state.height);
    drawLayer(wallLayer());
  } else {
    ctx.drawImage(img, 0, 0);
  }
  const unit = frameUnit();
  if (!photoOnly) {
    if (showMap && view.reachable) {
      drawLayer(mapLayer());
      drawArrows(unit);
    }
    drawMarks(unit);
  }
  if (cursor && keyboard && document.activeElement === canvas) cross(cursor[0], cursor[1], unit * 4);
}

// Arrows toward the exits, as on a printed plan. Each line of the tree runs
// toward its exit; a bridge between two exits and a join at the edge of a
// wing go both ways, so they get none. Near the routes there are none: a
// route to a chosen or a second exit can run against them.
function drawArrows(unit) {
  const f = view.field;
  const net = f._network || (f.waitForNetwork ? null : f.network());
  if (!net) return;
  const routes = [view.route, view.backup].filter(Boolean).map((r) => r.points);
  const here = state.start;
  const clear = (x, y) => routes.every((pts) => pts.slice(1).every((q, i) =>
    segmentGap([x, y], pts[i], q) > unit * ARROW_CLEAR)) &&
    !(here && Math.hypot(x - here[0], y - here[1]) < unit * ARROW_START);
  const heads = [];
  // The heads are wider than the line and filled in its colour with a white
  // edge, so their shape shows on a phone and over a photo.
  const gap = unit * ARROW_GAP;
  const s = unit * ARROW_SIZE;
  ctx.fillStyle = WAY;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = unit * 0.3;
  ctx.lineJoin = "miter";
  ctx.beginPath();
  for (const leg of net.legs) {
    if (leg.bridge || leg.join) continue;
    const dx = leg.b[0] - leg.a[0], dy = leg.b[1] - leg.a[1];
    const len = Math.hypot(dx, dy);
    if (len < gap * 0.6) continue;
    const ux = dx / len, uy = dy / len;
    const head = (x, y) => {
      heads.push([x, y]);
      ctx.moveTo(x, y);
      ctx.lineTo(x - ux * s * 1.4 - uy * s, y - uy * s * 1.4 + ux * s);
      ctx.lineTo(x - ux * s * 1.4 + uy * s, y - uy * s * 1.4 - ux * s);
      ctx.closePath();
    };
    const near = (x, y) => Math.min(Infinity, ...heads.map(([hx, hy]) => Math.hypot(x - hx, y - hy)));
    let placed = 0, best = null;
    for (let t0 = len % gap / 2 || gap / 2; t0 < len; t0 += gap) {
      // A head too near another head slides on along its line (ux review):
      // a line beside another line keeps its heads.
      for (const t of [0, 1, -1, 2, -2, 3].map((k) => t0 + (k * gap) / 4).filter((t) => t >= 0 && t < len)) {
        const x = leg.a[0] + ux * (t + s / 2), y = leg.a[1] + uy * (t + s / 2);
        if (!clear(x, y)) break;
        if (!best || near(x, y) > near(best[0], best[1])) best = [x, y];
        if (near(x, y) < s * ARROW_APART) continue;
        head(x, y);
        placed++;
        break;
      }
    }
    // A long line keeps one head, at its place farthest from the others.
    if (!placed && best && len >= unit * ARROW_KEEP) head(best[0], best[1]);
  }
  ctx.stroke();
  ctx.fill();
}

// Smooth scrolling, unless the user asks for less motion.
const smoothScroll = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

// The distance from point p to segment a-b.
function segmentGap(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const n = dx * dx + dy * dy;
  const t = n ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / n)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function drawMarks(unit) {
  // Exit and the start (YOU) differ in shape and label, not only in colour.
  const here = state.start;
  const used = view.route ? view.route.exitIndex : -1;
  state.exits.forEach((e, i) => exitMark(e.x, e.y, unit * 2.2, i + 1, i === used));
  // With two or more exits the numbers and the legend name them, and a row
  // of "EXIT" words would hide the plan.
  if (state.exits.length === 1) {
    const e = state.exits[0];
    const near = here && Math.hypot(e.x - here[0], e.y - here[1]) < unit * 14;
    label("EXIT", e.x, near ? e.y + unit * 2.2 * 1.8 : e.y - unit * 2.2 * 1.8, unit * 2.2, near ? "top" : "bottom");
  }

  // The second way out: dashed, under the route, so the route stays on top
  // where the two share a corridor.
  const alt = view.backup && view.backup.points;
  if (alt && alt.length > 1) {
    ctx.lineJoin = ctx.lineCap = "round";
    for (const [color, width, dash] of [["#ffffff", unit * 1.5, []], [ROUTE, unit * 0.8, [unit * 1.6, unit * 1.2]]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(alt[0][0], alt[0][1]);
      for (const p of alt.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Its exit goes over the dashed line again, so its number shows.
    const b = state.exits[view.backup.exitIndex];
    exitMark(b.x, b.y, unit * 2.2, view.backup.exitIndex + 1, false);
  }

  // The route and YOU go over the exits, so a short route stays visible.
  const pts = view.route && view.route.points;
  if (pts && pts.length > 1) {
    ctx.lineJoin = ctx.lineCap = "round";
    for (const [color, width] of [["#ffffff", unit * 2], [ROUTE, unit * 1.1]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
  }

  // The exit in use goes over the route again, so its number shows.
  if (used >= 0) exitMark(state.exits[used].x, state.exits[used].y, unit * 2.2, used + 1, true);

  const step = view.steps[selected];
  if (step && step.kind === "walk") {
    ctx.lineCap = "round";
    for (const [color, width] of [["#ffffff", unit * 3.2], ["#d9480f", unit * 2]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(step.path[0][0], step.path[0][1]);
      for (const p of step.path.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
  }
  let you = null;
  if (here) {
    const r = unit * 2.4;
    hereMark(here[0], here[1], r);
    const at = youLabelAt(here, r, unit * 2.2);
    label("YOU", at.x, at.y, r, at.baseline, at.align);
    you = [Math.min(at.box[0], here[0] - r), Math.min(at.box[1], here[1] - r), Math.max(at.box[2], here[0] + r), Math.max(at.box[3], here[1] + r)];
  }
  if (step && step.kind === "walk") {
    // The number goes above the middle of the longest leg, else below, right
    // or left of it, where it covers neither YOU (a11y review) nor an exit
    // mark (ux review). With no such place, step 1 has no number: YOU marks
    // where it starts.
    const [x, y] = longestMiddle(step.path), r = unit * 2.4, gap = unit * 2.5;
    ctx.font = `bold ${Math.round(r * 1.6)}px system-ui, sans-serif`;
    const w = ctx.measureText(String(selected + 1)).width, h = r * 1.6, pad = r / 3;
    const marks = state.exits.map((e) => [e.x - unit * 2.2, e.y - unit * 2.2, e.x + unit * 2.2, e.y + unit * 2.2]);
    const covers = ([x0, y0, x1, y1]) => [you, ...marks].some((m) => m && x0 - pad < m[2] && x1 + pad > m[0] && y0 - pad < m[3] && y1 + pad > m[1]);
    const places = [
      { x, y: y - gap, baseline: "bottom", align: "center", box: [x - w / 2, y - gap - h, x + w / 2, y - gap] },
      { x, y: y + gap, baseline: "top", align: "center", box: [x - w / 2, y + gap, x + w / 2, y + gap + h] },
      { x: x + gap, y, baseline: "middle", align: "left", box: [x + gap, y - h / 2, x + gap + w, y + h / 2] },
      { x: x - gap, y, baseline: "middle", align: "right", box: [x - gap - w, y - h / 2, x - gap, y + h / 2] },
    ];
    const at = places.find((p) => !covers(p.box)) || (selected > 0 ? places[0] : null);
    if (at) label(String(selected + 1), at.x, at.y, r, at.baseline, at.align);
  }
}

function hereMark(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = ROUTE;
  ctx.fill();
  ctx.lineWidth = r / 2.5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

// The number matches the exit buttons below the plan. The exit the route
// goes to has a frame in the route colour.
function exitMark(x, y, r, n, used) {
  ctx.fillStyle = "#0a7d3b";
  ctx.lineWidth = used ? r / 1.6 : r / 2.5;
  ctx.strokeStyle = used ? ROUTE : "#ffffff";
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.strokeRect(x - r, y - r, r * 2, r * 2);
  if (state.exits.length < 2) return;
  ctx.font = `bold ${Math.round(r * (n > 9 ? 1.1 : 1.4))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(n), x, y + r * 0.08);
}

// The place of the YOU label: above the mark, else below, right or left,
// whichever first stays on the plan and covers no exit mark (its number).
function youLabelAt(here, r, exitR) {
  ctx.font = `bold ${Math.round(r * 1.6)}px system-ui, sans-serif`;
  const w = ctx.measureText("YOU").width, h = r * 1.6, gap = r * 1.8;
  const [x, y] = here;
  const places = [
    { x, y: y - gap, baseline: "bottom", align: "center", box: [x - w / 2, y - gap - h, x + w / 2, y - gap] },
    { x, y: y + gap, baseline: "top", align: "center", box: [x - w / 2, y + gap, x + w / 2, y + gap + h] },
    { x: x + gap, y, baseline: "middle", align: "left", box: [x + gap, y - h / 2, x + gap + w, y + h / 2] },
    { x: x - gap, y, baseline: "middle", align: "right", box: [x - gap - w, y - h / 2, x - gap, y + h / 2] },
  ];
  // The white halo of the text and the frame of an exit take some room too.
  const pad = r / 3 + exitR * 4 / 3;
  const fr = shownFrame();
  const onPlan = ([x0, y0, x1, y1]) => x0 >= fr[0] && y0 >= fr[1] && x1 <= fr[2] && y1 <= fr[3];
  const free = ([x0, y0, x1, y1]) => state.exits.every((e) =>
    e.x + pad < x0 || e.x - pad > x1 || e.y + pad < y0 || e.y - pad > y1);
  return places.find((p) => onPlan(p.box) && free(p.box)) || places.find((p) => onPlan(p.box)) || places[0];
}

function label(text, x, y, r, baseline, align = "center") {
  ctx.font = `bold ${Math.round(r * 1.6)}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineWidth = r / 1.5;
  ctx.strokeStyle = "#ffffff";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#111111";
  ctx.fillText(text, x, y);
}

function cross(x, y, r) {
  for (const [color, width] of [["#ffffff", r / 3], ["#111111", r / 7]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
    ctx.stroke();
  }
}

function showSteps() {
  const list = $("steps");
  list.replaceChildren();
  selected = -1;
  view.steps.forEach((s, i) => {
    const li = document.createElement("li");
    if (s.kind === "walk") {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "step";
      b.textContent = s.text;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => select(selected === i && !speaking ? -1 : i));
      li.append(b);
    } else {
      li.textContent = s.text;
    }
    list.append(li);
  });
  if (view.pending) {
    const li = document.createElement("li");
    li.textContent = FINDING;
    list.append(li);
  }
  const none = view.steps.length === 0;
  $("steps-head").hidden = $("steps-hint").hidden = none && !view.pending;
  // The hint keeps its space while the route is found, so the list does not move.
  $("steps-hint").style.visibility = view.pending ? "hidden" : "";
  $("speak").hidden = none || !canSpeak;
  stopSpeaking();
}

// The point halfway along the path of a step: the step follows the route
// with its side steps, not the straight line from its start to its end.
function pathMiddle(path) {
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  let half = path.slice(1).reduce((t, p, k) => t + len(path[k], p), 0) / 2;
  for (let k = 1; k < path.length; k++) {
    const d = len(path[k - 1], path[k]);
    if (d >= half && d > 0) return [path[k - 1][0] + (path[k][0] - path[k - 1][0]) * half / d, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * half / d];
    half -= d;
  }
  return path[path.length - 1];
}

// The middle of the longest leg of the path of a step: its number goes
// there, off the short side steps that its words name.
function longestMiddle(path) {
  let k = 1;
  for (let j = 2; j < path.length; j++) {
    if (Math.hypot(path[j][0] - path[j - 1][0], path[j][1] - path[j - 1][1]) >
        Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1])) k = j;
  }
  return [(path[k - 1][0] + path[k][0]) / 2, (path[k - 1][1] + path[k][1]) / 2];
}

// Show one step on the plan. -1 shows none.
function select(i) {
  selected = i;
  $("steps").querySelectorAll("button.step").forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
  if (photoOnly) setPhotoOnly(false);
  draw();
  const step = view.steps[i];
  if (!step || step.kind !== "walk") return;
  const mid = pathMiddle(step.path);
  scrollToPoint(mid);
  // On a phone the plan is above the steps: bring the leg into the window.
  const y = canvas.getBoundingClientRect().top + toCanvasCss(mid)[1];
  if (y < 0 || y > window.innerHeight) $("stage").scrollIntoView({ block: "nearest", behavior: smoothScroll() });
}

// Model labels are often all "Exit", so the number tells the exits apart.
function exitName(i) {
  const l = (state.exits[i].label || "").trim();
  if (!l || /^exit$/i.test(l)) return `Exit ${i + 1}`;
  // A label that already has the number ("Exit 4") needs it only once. Else the
  // number comes first, so it matches the mark on the plan.
  return new RegExp(`\\bexit\\s*${i + 1}\\b`, "i").test(l) ? l : `Exit ${i + 1}: ${l}`;
}

// One button for each exit, in number order, so the route can go to another
// exit without placing marks on the picture. The list does not move when the
// route changes.
function showExits() {
  const box = $("exits");
  box.replaceChildren();
  const current = view.route ? view.route.exitIndex : state.exitChoice;
  // A start that reaches no exit gets the message, not a list of dead buttons.
  const open = state.start ? state.exits.map((e, i) => view.field.reaches(state.start, i)) : [];
  $("exits-wrap").hidden = state.exits.length < 2 || !open.some(Boolean);
  $("exits-note").hidden = !open.some((o) => !o);
  if ($("exits-wrap").hidden) return;
  state.exits.forEach((e, i) => {
    const b = document.createElement("button");
    b.type = "button";
    // The number, as on the plan. The name is in the label and the tooltip.
    b.textContent = String(i + 1);
    b.title = open[i] ? exitName(i) : `${exitName(i)}, no way found`;
    b.setAttribute("aria-label", b.title);
    b.classList.toggle("dead", !open[i]);
    b.setAttribute("aria-pressed", String(i === current));
    b.addEventListener("click", () => {
      state.exitChoice = i;
      update();
      remember();
      if (view.pending) {
        view.pendingHow = "exit-button";
        sayPlan(FINDING);
        $("exits").children[i].focus();
        return;
      }
      sayPlan(view.route ? `Route to ${exitName(i)}.${otherWay()} Check it against the plan.`
                         : `HereOut found no way to ${exitName(i)} in this photo. Try another exit.`);
      if (!view.route) { $("exits").children[i].focus(); return; }
      // On a phone, the plan with the new route comes into view; the steps take the focus.
      if (narrow()) $("stage").scrollIntoView({ block: "start" });
      $("steps").focus({ preventScroll: narrow() });
    });
    box.append(b);
  });
}

function showCredit() {
  const box = $("credit");
  box.replaceChildren();
  const c = state.credit;
  box.hidden = !c;
  if (!c) return;
  const link = (text, href) => {
    if (!href) return document.createTextNode(text);
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    a.rel = "noopener";
    return a;
  };
  const changes = [...(c.changes || []), state.photo_map ? "exit marks drawn on top" : "marks, escape map and route drawn on top"].join(", ");
  box.append(`Sample plan. Photo: “${quoted(c.title)}” by ${c.author}, `,
             link(c.licence, c.licence_url), ", ", link("source", c.source_url),
             `. Changes: ${changes}.`,
             c.share_alike ? " The changed image is shared under the same licence." : "",
             " This sample uses a saved model reading.");
}

// The head of the answer card: the exit of the route, by its number on the plan.
// The live status line says the same in a sentence, for a screen reader.
function showAnswer() {
  const r = view.route;
  const on = !!(r && state.start);
  $("answer-head").hidden = $("answer-check").hidden = !on;
  $("plan-status").classList.toggle("sr", on);
  if (!on) return;
  const i = r.exitIndex;
  $("answer-num").textContent = String(i + 1);
  $("answer-kind").textContent = state.exits[i].marked ? "The exit you marked"
    : state.exitChoice >= 0 ? "The exit you chose" : "Nearest exit";
  $("answer-name").textContent = exitName(i);
}

// Find the route again and show everything that depends on it.
function update() {
  clearRefusal();
  findRoute();
  // The steps first: they clear the step selection that draw() shows (a11y review).
  showSteps();
  draw();
  showBackup();
  showExits();
  showAnswer();
  $("found-exits").hidden = !state.exitsMarked || !state.foundExits.length;
  // With no start, the status line gives the same instruction.
  $("tap-text").hidden = !state.start || marking;
  showLegend();
}

function showLegend() {
  const map = showMap && view.reachable;
  // In Photo only the legend keeps its space, so the text under the plan does not move.
  $("legend").hidden = false;
  $("legend").style.visibility = photoOnly ? "hidden" : "";
  $("legend-field").hidden = $("legend-way").hidden = !map;
  // The ways out show once the worker has made them. The item keeps its
  // space, so the text under the plan does not move when they come.
  $("legend-way").style.visibility = view.field.waitForNetwork && !view.field._network ? "hidden" : "";
  $("legend-wall").hidden = !routesOnly;
  // The item keeps its space while two exits can give a second way, so the
  // text under the plan does not move after a tap.
  $("legend-other").hidden = state.exits.length < 2;
  $("legend-other").style.visibility = view.backup ? "" : "hidden";
}

// The walls come from the photo, so the messages say what HereOut read,
// not what the building is.
const ROUTE_ERRORS = {
  "start is inside a wall": "HereOut reads that spot as wall, or as outside the plan. Tap a spot in a corridor or a room.",
  "no open way to an exit": "HereOut found no way from that spot to an exit in this photo. Try a spot in a corridor.",
  "every exit is inside a wall": 'HereOut reads every exit as part of a wall. Tap "Mark the exit" and mark one in a doorway.',
};
// A sheet can show several floors, and the model can miss the exits of one.
// The exit marked after this message is added to the others.
const NO_EXIT_HERE = 'No exit that HereOut found is on this part of the plan. If it is another floor, tap "Mark the exit" and mark the exit or the stairs of that floor. The other exits stay.';
// Walls found in an aerial photo are roofs and trees (photo_map.py). The
// exits are only marks on the photo, so the text names them.
function photoMapText() {
  const n = state.exits.length;
  const names = state.exits.map((e, i) => exitName(i)).join(", ");
  return `This is a photo map. HereOut marks ${n === 1 ? "the exit" : `${n} exits`} (${names}), but draws no routes over a photo. ` +
         'Follow the route printed on the map. "Larger plan" shows it bigger.';
}

// how: "tap" (a start the user chose) or "exit" (an exit the user marked).
function explain(how = "tap") {
  addExit = false;
  if (!state.exits.length) {
    sayPlan(state.model_error
      ? 'Could not read the plan. Tap "Mark the exit" and mark it, then tap where you are.'
      : 'No exit found. Tap "Mark the exit" and mark it on the plan.');
  } else if (state.photo_map) {
    sayPlan(photoMapText());
  } else if (!state.start && how === "exit") {
    sayPlan(view.reachable ? "Exit marked. Now tap where you are on the plan."
                           : "HereOut reads that exit as wall. Mark it in a doorway.");
  } else if (!state.start) {
    // A sample is not where the user stands: its own mark is the natural start.
    sayPlan(state.credit
      ? 'Tap the plan\'s own "you are here" mark, or any open spot, to see the route to the nearest exit.'
      : "Tap where you are on the plan to see the route to the nearest exit.");
  } else if (view.pending) {
    view.pendingHow = how;
    sayPlan(FINDING);
  } else if (view.error && state.exitChoice >= 0) {
    sayPlan(`HereOut found no way to ${exitName(state.exitChoice)} in this photo. Try another exit.`);
  } else if (view.error && how === "exit") {
    sayPlan(`HereOut found no way to the exit you marked. Mark it at a doorway${
      state.foundExits.length ? ", or use the exits HereOut found" : ""}.`);
  } else if (view.error === "no open way to an exit" && view.field.areaShare(state.start) >= FLOOR_SHARE) {
    sayPlan(NO_EXIT_HERE);
    addExit = true;
    return;
  } else if (view.error) {
    sayPlan(ROUTE_ERRORS[view.error] || "HereOut found no route from that spot.");
  } else if (state.exits[view.route.exitIndex].marked) {
    sayPlan("Route to the exit you marked. Check it against the plan.");
  } else if (state.exitChoice >= 0) {
    sayPlan(`Route to ${exitName(state.exitChoice)}.${otherWay()} Check it against the plan.`);
  } else if (exampleStart()) {
    sayPlan(`Example start, picked by hand. Route to the nearest exit, ${exitName(view.route.exitIndex)}.${otherWay()} Tap the plan to start from another spot.`);
  } else {
    sayPlan(`Route from the spot you chose to the nearest exit, ${exitName(view.route.exitIndex)}.${otherWay()} Check it against the plan.`);
  }
}

// The second way out, as words for the status line.
function otherWay() {
  if (!view.backup) return "";
  return ` If it is blocked, use ${exitName(view.backup.exitIndex)}${photoOnly ? "" : " (dashed line)"}.`;
}

// The second way out under the steps too, where the eyes are after a tap
// or after an exit button, with a button that shows its route.
function showBackup() {
  const b = view.backup;
  $("backup").hidden = !b || !view.route;
  if ($("backup").hidden) return;
  $("backup-text").textContent = `If it is blocked, use ${exitName(b.exitIndex)}${photoOnly ? "" : " (dashed line)"}.`;
  $("backup-go").textContent = `Route to Exit ${b.exitIndex + 1}`;
}

// Photo only and Routes only change what is under the marks, so at most one is on.
function setPhotoOnly(on) {
  clearRefusal();
  photoOnly = on;
  if (on) routesOnly = false;
  $("show-photo").setAttribute("aria-pressed", String(on));
  $("show-routes").setAttribute("aria-pressed", String(routesOnly));
  $("show-map").disabled = on;
  $("show-map").setAttribute("aria-pressed", String(showMap && !on));
  showLegend();
  draw();
}

$("show-map").addEventListener("click", () => {
  clearRefusal();
  showMap = !showMap;
  $("show-map").setAttribute("aria-pressed", String(showMap));
  showLegend();
  draw();
});
$("show-photo").addEventListener("click", () => setPhotoOnly(!photoOnly));
$("show-routes").addEventListener("click", () => {
  routesOnly = !routesOnly;
  setPhotoOnly(false);
});

function startMarking() {
  clearRefusal();
  marking = true;
  $("fix-text").textContent = "Cancel";
  $("fix-hint").textContent = addExit
    ? "Tap the exit or the stairs of this floor on the plan. The other exits stay."
    : "Tap the exit on the plan. HereOut then routes to that exit only.";
  $("fix-hint").hidden = false;
  $("tap-text").hidden = true;
  hints();
  if (photoOnly) setPhotoOnly(false);
  sayPlan(addExit ? "Tap the exit or the stairs of this floor on the plan." : "Tap the exit on the plan.");
}

function stopMarking() {
  marking = false;
  $("fix-text").textContent = "Mark the exit";
  $("fix-hint").hidden = true;
  if (state) $("tap-text").hidden = !state.start;
  hints();
}

$("fix").addEventListener("click", (ev) => {
  if (marking) { stopMarking(); explain(); return; }
  startMarking();
  // A click from Enter or Space has detail 0: go on with the keyboard.
  if (ev.detail === 0) canvas.focus();
  // The exit is marked on the plan: on a phone it is above this button.
  else if (narrow()) $("stage").scrollIntoView({ block: "nearest", behavior: smoothScroll() });
});

// The user's exit takes the place of the exits the model found. After a tap
// on a floor with no exit (addExit), it is added: the exits of the other floors stay.
function setExit(x, y) {
  stopMarking();
  const mark = { x: Math.round(x), y: Math.round(y), label: "", marked: true };
  state.exits = addExit ? [...state.exits, mark] : [mark];
  state.exitsMarked = true;
  state.exitChoice = -1;
  buildField();
  update();
  remember();
  explain("exit");
}

function setStart(x, y) {
  state.start = [Math.round(x), Math.round(y)];
  state.exitChoice = -1;
  if (photoOnly) setPhotoOnly(false);
  update();
  remember();
  explain("tap");
}

// A tap off the floor drawing gives no route, and the old route stays. A tap
// on a wall or on ink next to open floor starts on that floor (route.js
// Field.tapStart). The keyboard marker follows the same rules.
const OFF_PLAN = "That spot is outside the floor plan. Tap a corridor or a room on the plan.";
const TAP_TEXT = $("tap-text").textContent;
function startFromTap(x, y) {
  const t = view.field.tapStart([x, y]);
  if (t.at === "outside") { refuseTap(OFF_PLAN); return; }
  if (t.at === "wall") { refuseTap(ROUTE_ERRORS["start is inside a wall"]); return; }
  if (t.at === "moved") [x, y] = view.field.toPx(t.cell);
  setStart(x, y);
}

// The message goes under the plan, where the eyes are after a tap, and to
// the live status line (in the answer card) for a screen reader. The card
// line stays hidden then, so the message shows once.
function refuseTap(text) {
  $("tap-text").textContent = text;
  $("tap-text").hidden = false;
  $("tap-hint").classList.add("refused");
  $("plan-status").classList.add("sr");
  sayPlan(text);
}

function clearRefusal() {
  if (!$("tap-hint").classList.contains("refused")) return;
  $("tap-hint").classList.remove("refused");
  $("tap-text").textContent = TAP_TEXT;
  $("tap-text").hidden = !state || !state.start || marking;
  if (view) showAnswer();
}

function place(x, y) {
  if (marking) setExit(x, y);
  else if (state.photo_map && state.exits.length) sayPlan(photoMapText());
  else if (state.exits.length) startFromTap(x, y);
  else sayPlan('Mark an exit first: tap "Mark the exit".');
}

// The button of the second way out does what its exit button does.
$("backup-go").addEventListener("click", () => {
  if (view.backup) $("exits").children[view.backup.exitIndex]?.click();
});

// Undo "Mark the exit": the exits from the reading come back.
$("found-exits").addEventListener("click", () => {
  state.exits = state.foundExits.map((e) => ({ ...e }));
  state.exitsMarked = false;
  state.exitChoice = -1;
  buildField();
  update();
  remember();
  explain();
  $("fix").focus();  // this button is hidden now
});

function hints() {
  if (state && state.photo_map) {
    $("kbd-hint").textContent = "Arrow keys move the marker, Shift moves it faster. The marker names the closest exit.";
    canvas.setAttribute("aria-label", "Plan, a photo map. HereOut marks the exits only. Move the marker with the arrow keys to hear the closest exit.");
    return;
  }
  $("kbd-hint").textContent = marking
    ? "Arrow keys move the marker, Shift moves it faster. Enter places the exit. Escape cancels."
    : "Arrow keys move the marker, Shift moves it faster. Enter starts the route there.";
  canvas.setAttribute("aria-label", marking
    ? "Plan. Mark the exit: tap it, or move the marker with the arrow keys and press Enter."
    : "Plan. Tap a spot to see the route from there, or move the marker with the arrow keys and press Enter.");
}

// The old plan stays in state, with its map, until the image of the new plan
// is there: a tap or a late worker answer in that time never mixes the two.
const askedAgain = new Set();  // samples whose image did not load, asked for again
function showPlan(answer, focusResult, push) {
  // Take the focus before the controls of the old plan hide, so it never falls to the page body.
  if (focusResult && !$("result").hidden) $("result-head").focus({ preventScroll: true });
  if (answer.start === undefined) answer.start = null;
  if (answer.exitChoice === undefined) answer.exitChoice = -1;
  if (answer.foundExits === undefined) answer.foundExits = answer.exits.map((e) => ({ ...e }));
  // The status lines change when the plan opens: a wait text stays while
  // the image loads, and an image that does not load says so on one line only.
  const wasMarking = marking;
  stopSpeaking();
  stopMarking();
  cursor = null;
  keyboard = false;
  dropOpening();
  opening = answer;
  const next = openingImg = new Image();
  next.onerror = () => {
    dropOpening();
    forget(answer);
    // A sample kept in the tab from before a deploy can name an image that
    // the server no longer has: ask the server for the sample once.
    const gid = sampleId(answer.id);
    if (gid && !answer.image.startsWith("data:") && !askedAgain.has(gid)) {
      askedAgain.add(gid);
      openSample(gid, push);
      return;
    }
    // A new answer that does not open leaves the old plan open. Back or Forward
    // to a plan that does not open shows the start page, as the address says.
    if (state && push) {
      if (wasMarking) explain();  // the line asked for a tap on the exit; the old plan is open again
      if (focusResult) $("result").scrollIntoView({ block: "start" });
    } else {
      closePlan();
      window.scrollTo(0, 0);
      if (focusResult) $("photo").focus();
    }
    say(sampleId(answer.id) ? "Could not show this sample plan. Try another one." : "Could not show the plan of your photo. Send the photo again.");
  };
  next.onload = () => {
    dropOpening();
    // A plan that opens while the server reads a photo says that the photo comes later.
    say(upload ? STILL_TEXT : "");
    $("status").style.removeProperty("min-height");
    img = next;
    state = answer;
    // A photo map has no routes, so the controls for routes and walls go.
    const map = !!state.photo_map;
    if (map) routesOnly = false;
    $("show-map").hidden = $("show-routes").hidden = $("fix").hidden = $("legend-route").hidden = map;
    hints();
    $("result").hidden = false;
    layout();
    buildField();
    showCredit();
    if (typeof showReading === "function") showReading();  // reading.js
    update();
    explain();
    if ($("stage").classList.contains("big")) centreOnStart();
    markOpenSample(push);
    remember();
    showBusy();  // the upload bar floats over a plan
    if (focusResult) {
      $("result").scrollIntoView({ block: "start" });
      $("result-head").focus({ preventScroll: true });
    }
  };
  next.src = answer.image;
}

function dropOpening() {
  if (openingImg) openingImg.onload = openingImg.onerror = null;
  openingImg = opening = null;
}

// Back to the start page: nothing of the old plan may change the page after this.
function closePlan() {
  dropOpening();
  ++networkJob;
  networkReady = null;
  clearTimeout(networkTimer);
  stopWorker();
  stopSpeaking();
  stopMarking();
  state = null;
  view = null;
  $("result").hidden = true;
  layout();
  markOpenSample();
}

// A plan whose image does not open is not kept for a reload.
function forget(answer) {
  try {
    // A photo plan has no id: the image tells the plans apart.
    if (lastPlan()?.image === answer.image) sessionStorage.removeItem(STORE_KEY);
    if (lastPlan(PHOTO_KEY)?.image === answer.image) sessionStorage.removeItem(PHOTO_KEY);
  } catch (e) { /* storage blocked */ }
}

// The photo button waits while a sample plan loads or the server reads a photo.
// aria-disabled, not disabled, so that the button keeps the keyboard focus.
let loading = 0;       // the number of the sample plan that loads, or 0
let upload = null;     // {start, job} of the photo that the server reads
let readyPlan = null;  // the answer for that photo, when the user did not wait for it
function showBusy() {
  const bar = $("upload-bar");
  const inFlow = bar.offsetHeight;  // the room the bar takes in the page now
  for (const p of PHOTOS) p.setAttribute("aria-disabled", String(!!loading || !!upload));
  $("reading").hidden = !upload;
  $("ready").hidden = !readyPlan;
  // With a plan open, the bar stays at the foot of the screen, where it is in view.
  // The live status line says the same as the note, so the note is only seen.
  const float = !!readyPlan || (!!upload && !!state);
  // The bar keeps its place in the page when it starts to float, so nothing under it jumps.
  if (float && !bar.classList.contains("float")) $("upload-slot").style.setProperty("min-height", `${inFlow}px`);
  if (!float) $("upload-slot").style.removeProperty("min-height");
  bar.classList.toggle("float", float);
  $("reading-note").hidden = !(float && upload && !readyPlan);
  barRoom();
  // A control in focus near the foot of the screen moves up out from under the bar.
  const a = document.activeElement;
  if (float && a && a !== document.body && a.getBoundingClientRect().bottom > bar.getBoundingClientRect().top) {
    a.scrollIntoView({ block: "nearest" });
  }
}
// The page keeps room at its foot for the floating bar, as high as the bar is.
function barRoom() {
  const bar = $("upload-bar");
  document.documentElement.style.setProperty("--bar-room", `${bar.classList.contains("float") ? bar.offsetHeight : 0}px`);
}
new ResizeObserver(barRoom).observe($("upload-bar"));
for (const p of PHOTOS) p.addEventListener("click", (ev) => {
  if (p.getAttribute("aria-disabled") === "true") ev.preventDefault();
});

// With a plan open, the start page text goes and the header has the photo button.
function layout() {
  document.documentElement.classList.toggle("has-plan", !$("result").hidden);
  // The demo video (start page only) must not play on, hidden, under a plan.
  if (!$("result").hidden) document.querySelector("#demo video")?.pause();
}

// Load a sample plan. Only the newest request wins.
async function loadPlan(request, waitText, push) {
  const n = ++planSeq;
  stopSpeaking();
  if (marking) stopMarking();
  loading = n;
  showBusy();
  say(waitText);
  let answer;
  try {
    const r = await request();
    if (!r.ok) { if (n === planSeq) { say(`Could not open the plan: ${await errorText(r, "try again")}.`); layout(); } return; }
    answer = await r.json();
  } catch (e) {
    if (n === planSeq) { say("Could not open the plan. Check the connection and try again."); layout(); }
    return;
  } finally {
    if (loading === n) { loading = 0; showBusy(); }
  }
  if (n !== planSeq) return;
  showPlan(answer, true, push);
  showBusy();
}

// A phone photo has up to 50 megapixels. The server works on 1600 pixels at
// most, so a smaller copy uploads faster on mobile data and stays under the
// size limit. A file that the browser cannot decode goes as it is.
const UPLOAD_SIDE = 3200;
const UPLOAD_BYTES = 3 * 1024 * 1024;

async function smallPhoto(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (e) {
    return file;
  }
  try {
    const f = Math.min(1, UPLOAD_SIDE / Math.max(bmp.width, bmp.height));
    if (f === 1 && file.size <= UPLOAD_BYTES) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * f);
    c.height = Math.round(bmp.height * f);
    // A high-quality resize keeps 1-pixel wall lines; the default one can drop them.
    // createImageBitmap resizes off the main thread, so the page does not freeze.
    let small = bmp;
    try {
      small = await createImageBitmap(bmp, { resizeWidth: c.width, resizeHeight: c.height, resizeQuality: "high" });
    } catch (e) { /* the canvas resizes instead */ }
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(small, 0, 0, c.width, c.height);
    if (small !== bmp) small.close();
    const blob = await new Promise((done) => c.toBlob(done, "image/jpeg", 0.9));
    return blob && blob.size < file.size ? blob : file;
  } catch (e) {
    return file;
  } finally {
    bmp.close();
  }
}

// The upload starts a job on the server, and the page asks for its answer.
// A slow model answer can take longer than a proxy keeps one request open.
// The job is kept for the tab, so a reload asks again for the same answer.
const JOB_KEY = "hereout:job";
const ASK_EVERY = 2000;
const GIVE_UP_AFTER = 3 * 60 * 1000;  // the server tries a slow model call twice, 45 s each (and 10 s to connect), then the wall pass
const WAIT_TEXT = "Reading your photo. This takes 15 seconds to a minute, sometimes more. The photo button works again when it is done.";
const STILL_TEXT = 'HereOut still reads your photo. When it is ready, choose "Show the plan of your photo".';
const LOST_TEXT = "The connection is lost. HereOut asks again when it is back.";
const OFFLINE_TEXT = "Could not reach HereOut. Check the connection and send the photo again.";
// What the status line says after a long wait: [after ms, text].
const WAIT_NEWS = [
  [60 * 1000, "Still reading your photo. A slow answer can take 2 minutes. The photo button works again when it is done."],
  [2 * 60 * 1000, "This takes longer than usual. HereOut stops at 3 minutes, then the photo button works again."],
];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function keepJob(job) {
  try {
    if (job) sessionStorage.setItem(JOB_KEY, JSON.stringify(job));
    else sessionStorage.removeItem(JOB_KEY);
  } catch (e) { /* storage blocked: a reload loses the wait */ }
}

// Ask for the answer of one job until it is done. A lost connection, a rate
// limit or a proxy error is not the answer: ask again.
async function askForAnswer(job) {
  const age = () => Date.now() - job.start;
  let told = WAIT_NEWS.filter(([after]) => age() > after).length;
  let lost = false;
  while (age() < GIVE_UP_AFTER) {
    await sleep(ASK_EVERY);
    let a = null;
    try {
      a = await fetch(`/api/plan/${encodeURIComponent(job.job)}`, { cache: "no-store" });
    } catch (e) { /* no connection */ }
    const failed = !a || a.status === 429 || a.status >= 502;
    if (a && a.status !== 202 && !failed) return a;
    if (failed && !lost) say(LOST_TEXT);
    else if (!failed && lost) say(told ? WAIT_NEWS[told - 1][1] : WAIT_TEXT);
    lost = failed;
    while (told < WAIT_NEWS.length && age() > WAIT_NEWS[told][0]) {
      if (!lost) say(WAIT_NEWS[told][1]);
      told++;
    }
  }
  if (lost) return null;
  return new Response(JSON.stringify({ detail: "the plan took too long to read; try again" }), { status: 504 });
}

// file: a new photo; job: a job of this tab from before a reload.
async function readPhoto(file, job) {
  stopSpeaking();
  if (marking) stopMarking();
  // After a reload, a plan that is already open stays: the answer gets the button.
  const n = file ? ++planSeq : (state || opening || loading ? -1 : planSeq);
  const mine = job || { start: Date.now(), job: null };
  // The plan that this photo replaces, if the user only waits in it: a photo plan, not a sample.
  const replaces = state && !sampleId(state.id) ? state : null;
  upload = mine;
  readyPlan = null;
  showBusy();
  // After a reload, the last news that is due comes again: it can say when HereOut stops (ux and a11y reviews).
  const due = job ? WAIT_NEWS.filter(([after]) => Date.now() - job.start > after).pop() : null;
  say(due ? due[1] : job ? "Reading your photo again after the reload. The photo button works again when it is done." : WAIT_TEXT);
  let r = null;
  try {
    if (file) {
      keepJob(mine);  // a reload before the job id comes knows that the photo did not get there
      const body = new FormData();
      body.append("photo", await smallPhoto(file), "photo.jpg");
      r = await fetch("/api/plan", { method: "POST", body });
      if (r.status === 202) mine.job = (await r.json()).job;
    }
    if (mine.job) {
      keepJob(mine);
      r = await askForAnswer(mine);
    }
  } catch (e) {
    r = null;
  }
  keepJob(null);
  // One change of the bar for each answer, so the page under it moves once at most.
  const done = () => { if (upload === mine) upload = null; };
  if (!r || !r.ok) {
    done();
    showBusy();
    say(r ? `Could not read the photo: ${await errorText(r, "try again")}.` : OFFLINE_TEXT);
    return;
  }
  let answer;
  try {
    answer = await r.json();
  } catch (e) {
    done();
    showBusy();
    say(OFFLINE_TEXT);
    return;
  }
  // Show the plan at once only when the user still waits for it: at the photo
  // button, or in the photo plan it replaces, untouched since the upload.
  const a = document.activeElement;
  const waiting = a === document.body || PHOTOS.includes(a) ||
    ($("result").contains(a) && state === replaces && !!replaces && touched < mine.start);
  if (n === planSeq && !loading && waiting) {
    done();
    showBusy();
    showPlan(answer, true, true);
  } else {
    readyPlan = answer;
    done();
    // The ready text is shorter than the wait text: keep the height of the line, so the page under it stays.
    $("status").style.setProperty("min-height", `${$("status").offsetHeight}px`);
    showBusy();
    say('The plan of your photo is ready. Choose "Show the plan of your photo" to open it.');
  }
}

// The last tap or key in the plan: a user who works in the plan does not wait for the photo.
let touched = 0;
for (const type of ["pointerdown", "keydown"]) $("result").addEventListener(type, () => { touched = Date.now(); });

$("ready").addEventListener("click", () => {
  if (!readyPlan) return;
  ++planSeq;
  // The focus leaves the button before it hides; the plan heading takes it on load.
  if ($("result").hidden) $("photo").focus();
  showPlan(readyPlan, true, true);
  readyPlan = null;
  // The bar goes a moment later, so the second tap of a double tap does not hit
  // what was under it. Its room in the page goes now, before the plan shows.
  $("upload-slot").style.removeProperty("min-height");
  setTimeout(showBusy, 500);
});

for (const p of PHOTOS) p.addEventListener("change", (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";  // so the same file can be picked again
  if (file) readPhoto(file);
});

// Gallery of open-licensed plan photos with saved readings.
// On a wide screen the tiles are in rows of 3 beside the start text.
const GALLERY_FIRST = matchMedia("(min-width: 960px)").matches ? 9 : 8;
const countryName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (code) => {
      try { const n = names.of(code); return n && n !== code ? n : "Unknown country"; } catch (e) { return "Unknown country"; }
    };
  } catch (e) { return (code) => code; }
})();

const sampleId = (id) => (id && id.startsWith("g-") ? id.slice(2) : null);
// push: add a history entry, so Back returns to the plan before.
function openSample(gid, push) {
  return loadPlan(() => fetch(`/api/gallery/${encodeURIComponent(gid)}${SET}`, { method: "POST" }), "Opening the sample plan…", push);
}

// The example on the start page opens its sample plan with the start of its
// picture. The start is not in the address: a sample from the gallery or from
// a link opens with no start, and the user taps it (start-from-tap).
function openExample(gid, start) {
  return loadPlan(async () => {
    const r = await fetch(`/api/gallery/${encodeURIComponent(gid)}`, { method: "POST" });
    if (!r.ok) return r;
    const answer = await r.json();
    answer.start = start;
    return { ok: true, json: async () => answer };
  }, "Opening the example…", true);
}

// The start is the one of the example picture (not one the user chose).
function exampleStart() {
  const fig = $("example");
  if (!fig || !state.start || sampleId(state.id) !== fig.dataset.sample) return false;
  const [x, y] = fig.dataset.start.split(",").map(Number);
  return state.start[0] === x && state.start[1] === y;
}

function setUpExample() {
  const fig = $("example");
  if (!fig) return;  // the server has no saved image of the example plan
  if (SET) { fig.remove(); return; }  // the review set has its own plans
  $("example-open").addEventListener("click", (ev) => {
    if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    openExample(fig.dataset.sample, fig.dataset.start.split(",").map(Number));
  });
}
setUpExample();

// The open sample is marked in the gallery and named in the address, so it can be shared.
function markOpenSample(push) {
  const gid = sampleId(state && state.id);
  document.querySelectorAll("#gallery button.sample").forEach((b) => {
    if (b.dataset.id === gid) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
  $("back-to-samples").hidden = !gid;
  if (!state) return;
  const url = new URL(location.href);
  if (gid) url.searchParams.set("sample", gid); else url.searchParams.delete("sample");
  // The entry of a photo plan says so: Back, Forward and a reload open the photo
  // again, but the logo link and a new visit of the page show the start page.
  const entry = gid ? null : { photo: true };
  if (push && url.href !== location.href) history.pushState(entry, "", url);
  else history.replaceState(entry, "", url);
}

$("back-to-samples").addEventListener("click", () => {
  const gid = sampleId(state && state.id);
  const tile = document.querySelector(`#gallery button.sample[data-id="${CSS.escape(gid || "")}"]`) || document.querySelector("#gallery button.sample");
  if (tile) { tile.scrollIntoView({ block: "center" }); tile.focus({ preventScroll: true }); }
});

// A title in quotes keeps its own quotes as single marks: “‘Parade formation’ exhibition”.
function quoted(title) {
  return title.replace(/"([^"]*)"/g, "‘$1’");
}

function creditLine(c) {
  const li = document.createElement("li");
  const a = (text, href) => { const e = document.createElement("a"); e.href = href; e.textContent = text; e.rel = "noopener"; return e; };
  li.append(`“${quoted(c.title)}” by ${c.author}, `);
  li.append(c.licence_url ? a(c.licence, c.licence_url) : c.licence, ", ", a("source", c.source_url));
  return li;
}

async function showGallery() {
  let plans = [];
  try {
    const r = await fetch(`/api/gallery${SET}`);
    if (r.ok) plans = (await r.json()).plans;
  } catch (e) { return; }
  if (!plans.length) return;
  const grid = $("gallery");
  const render = (all) => {
    grid.replaceChildren();
    (all ? plans : plans.slice(0, GALLERY_FIRST)).forEach((p, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sample";
      b.dataset.id = p.id;
      const im = document.createElement("img");
      im.src = p.thumb;
      im.alt = "";
      im.loading = "lazy";
      const cap = document.createElement("span");
      const country = countryName(p.country);
      cap.textContent = p.route_found ? country : `${country} · no route`;
      b.append(im, cap);
      // The name starts with the visible text, and the number tells equal names apart.
      b.setAttribute("aria-label", `${cap.textContent}, sample plan ${i + 1} of ${plans.length}`);
      b.addEventListener("click", () => openSample(p.id, true));
      li.append(b);
      grid.append(li);
    });
    $("gallery-more").hidden = all || plans.length <= GALLERY_FIRST;
    markOpenSample();
  };
  $("credits").replaceChildren(...plans.map((p) => creditLine(p.credit)));
  $("gallery-count").textContent = String(plans.length);
  // "XX" marks photos whose country is not known.
  $("gallery-countries").textContent = String(new Set(plans.map((p) => p.country).filter((c) => c !== "XX")).size);
  $("gallery-more").textContent = `Show all ${plans.length} plans`;
  $("gallery-more").addEventListener("click", () => {
    render(true);
    grid.children[GALLERY_FIRST]?.querySelector("button").focus();
  });
  render(false);
  $("gallery-wrap").hidden = false;
}
showGallery();

canvas.addEventListener("click", (ev) => {
  if (!state) return;
  const box = canvas.getBoundingClientRect();
  const [x0, y0, x1, y1] = shownFrame();
  place(x0 + (ev.clientX - box.left) * ((x1 - x0) / box.width),
        y0 + (ev.clientY - box.top) * ((y1 - y0) / box.height));
});

// Keyboard: arrow keys move a cross, Enter or Space places the start or the exit.
canvas.addEventListener("keydown", (ev) => {
  if (!state) return;
  const fr = shownFrame();
  const step = Math.max(fr[2] - fr[0], fr[3] - fr[1]) * (ev.shiftKey ? 0.05 : 0.01);
  const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
  if (!cursor) cursor = startCursor();
  if (move) {
    keyboard = true;
    $("kbd-hint").hidden = false;
    const inset = frameUnit() * 4;  // the cross stays whole on the plan
    cursor = [Math.min(fr[2] - inset, Math.max(fr[0] + inset, cursor[0] + move[0])),
              Math.min(fr[3] - inset, Math.max(fr[1] + inset, cursor[1] + move[1]))];
    draw();
    scrollToPoint(cursor);
    sayMarker();
  } else if (ev.key === "Enter" || ev.key === " ") {
    keyboard = true;
    place(cursor[0], cursor[1]);
  } else if (ev.key === "Escape" && marking) {
    stopMarking();
    explain();
  } else {
    return;
  }
  ev.preventDefault();
});
// The keyboard hint only for keyboard focus, not after a tap.
// A keyboard user sees the marker at once, so Enter places a start they saw.
canvas.addEventListener("focus", () => {
  const kbd = canvas.matches(":focus-visible");
  $("kbd-hint").hidden = !kbd;
  if (kbd && state) {
    if (!cursor) cursor = startCursor();
    keyboard = true;
  }
  draw();
});

// Where the marker is, in words, for a user who cannot see it. It waits for
// the arrow keys to stop, so a screen reader reads one place, not every step.
let markerTimer = null;
function sayMarker() {
  clearTimeout(markerTimer);
  markerTimer = setTimeout(() => {
    if (!cursor || !state) return;
    const [x, y] = cursor;
    const [x0, y0, x1, y1] = shownFrame();
    const col = ["left", "middle", "right"][Math.max(0, Math.min(2, Math.floor(3 * (x - x0) / (x1 - x0))))];
    const row = ["top", "middle", "bottom"][Math.max(0, Math.min(2, Math.floor(3 * (y - y0) / (y1 - y0))))];
    const at = row === col ? "middle" : `${row} ${col}`;
    let near = -1, best = Infinity;
    state.exits.forEach((e, i) => { const d = Math.hypot(e.x - x, e.y - y); if (d < best) { best = d; near = i; } });
    // Enter there gives no route: say so before the user presses it.
    const off = !marking && !state.photo_map && view && view.field.tapStart([x, y]).at === "outside" ? ", outside the floor plan" : "";
    $("marker-status").textContent = `Marker: ${at} of the plan${off}` + (near >= 0 ? `, closest exit mark ${exitName(near)}.` : ".");
  }, 400);
}
canvas.addEventListener("blur", () => { $("kbd-hint").hidden = true; draw(); });

// In the larger plan, put the start in the middle, so the start of the route is in view.
function centreOnStart() {
  if (!state || !state.start) return;
  const st = $("stage");
  const [x, y] = toCanvasCss(state.start);
  st.scrollLeft = x - st.clientWidth / 2;
  st.scrollTop = y - st.clientHeight / 2;
}

// In the larger plan, scroll so that a plan point is in the middle of the view.
function scrollToPoint(p) {
  const st = $("stage");
  if (!st.classList.contains("big") || !p) return;
  const [x, y] = toCanvasCss(p);
  if (x < st.scrollLeft + 40 || x > st.scrollLeft + st.clientWidth - 40) st.scrollLeft = x - st.clientWidth / 2;
  if (y < st.scrollTop + 40 || y > st.scrollTop + st.clientHeight - 40) st.scrollTop = y - st.clientHeight / 2;
}

$("enlarge").addEventListener("click", () => {
  const big = $("stage").classList.toggle("big");
  $("enlarge").setAttribute("aria-pressed", String(big));
  if (big) {
    $("stage").tabIndex = 0;
    centreOnStart();
    $("stage").scrollIntoView({ block: "nearest" });
  } else {
    $("stage").removeAttribute("tabindex");
  }
});

let speaking = false;

function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
  speaking = false;
  $("speak-text").textContent = "Read the steps aloud";
}

$("speak").addEventListener("click", () => {
  if (!canSpeak || !state) return;
  if (speaking) { stopSpeaking(); return; }
  speechSynthesis.cancel();
  const lines = ["Check this route against the plan.", ...view.steps.map((s) => s.text)];
  if (view.backup) lines.push(`If ${exitName(view.route.exitIndex)} is blocked, use ${exitName(view.backup.exitIndex)}.`);
  lines.forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(text);
    if (i > 0) u.onstart = () => select(i - 1);
    if (i === lines.length - 1) u.onend = stopSpeaking;
    speechSynthesis.speak(u);
  });
  speaking = true;
  $("speak-text").textContent = "Stop reading";
});

function lastPlan(key = STORE_KEY) {
  try {
    const last = JSON.parse(sessionStorage.getItem(key) || "null");
    return last && last.image && last.grid ? last : null;
  } catch (e) { return null; /* storage blocked */ }
}

// A link with ?sample=<id> opens that sample. After a reload of the same
// sample, the start and the exits the user set come back.
function openFromAddress(ev) {
  const gid = new URL(location.href).searchParams.get("sample");
  const last = lastPlan();
  const photo = history.state?.photo ? lastPlan(PHOTO_KEY) : null;
  // A sample that still loads for the entry before is not wanted now.
  // A photo that the server reads still opens when its answer comes.
  if (loading) { ++planSeq; loading = 0; }
  // Back or Forward: the focus goes to the plan that comes in.
  const focus = !!ev;
  // A plan from the address is newer than a photo that the server still reads.
  if (gid && last && last.id === `g-${gid}`) showPlan(last, focus);
  else if (gid) openSample(gid);
  else if (photo) showPlan(photo, focus);
  else {
    if (!upload) say("");  // a wait text of a sample from the entry before goes
    if (state || opening) {
      closePlan();
      if (ev) $("photo").focus();
    }
  }
  showBusy();
}
window.addEventListener("popstate", openFromAddress);
// The logo goes to the start page in a new entry, so Back opens the plan again.
// A plain link to the same address is a reload, and a reload keeps the plan.
document.querySelector(".brand").addEventListener("click", (ev) => {
  if (!(state || opening) || ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
  ev.preventDefault();
  const url = new URL(location.href);
  url.searchParams.delete("sample");
  history.pushState(null, "", url);
  openFromAddress(ev);
  window.scrollTo(0, 0);
});
openFromAddress();
// early.js hid the start page for a plan that is not there: show it again.
if (!state && !opening && !loading) layout();
try {
  const job = JSON.parse(sessionStorage.getItem(JOB_KEY) || "null");
  sessionStorage.removeItem(JOB_KEY);
  if (job && job.job && Date.now() - job.start < GIVE_UP_AFTER) readPhoto(null, job);
  else if (job && !job.job) say("The reload stopped the upload of your photo. Send the photo again.");
} catch (e) { /* storage blocked */ }
