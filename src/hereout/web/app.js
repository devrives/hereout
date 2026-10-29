"use strict";

const $ = (id) => document.getElementById(id);
const R = HereOutRoute;
const canvas = $("plan");
const ctx = canvas.getContext("2d");
const img = new Image();
// The plan: the server answer, plus the start, the exits and the chosen exit
// as the user set them. Everything else is found again from it in the browser.
let state = null;
let view = null;      // the escape field, the map layer, the route and the steps for state
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
$("shoot").hidden = false;  // without JS the photo button would do nothing
const STORE_KEY = "hereout:last";

// Map colours: green near an exit, yellow far from one.
const NEAR = [10, 125, 59], FAR_C = [245, 190, 20];
const MAP_ALPHA = 110;
const ROUTE = "#1b5fd1";
const ARROW_GAP = 12;   // plan units between two arrows on a way out
const ARROW_SIZE = 1.1; // plan units: half the width of an arrow head
const OTHER_TRIES = 3;  // exits tried for the second way out
const FLOOR_SHARE = 0.05; // an open area with this share of the open cells is a floor, not a pocket of paper
const ARROW_CLEAR = 2;  // plan units: no arrow this close to a route
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
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
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
  if (view.reachable) makeNetwork(field);
}

// The ways out take about a second to make on a phone, so a worker makes
// them. Until they come, routes follow the grid field and the map has no
// lines. Without a worker, the page makes them itself.
let worker = null;
let networkJob = 0;
let networkReady = null;  // the callback of the newest job
const scriptUrl = (sel) => { const el = document.querySelector(sel); return el && (el.src || el.href); };

function makeNetwork(field) {
  const job = ++networkJob;
  field.waitForNetwork = true;
  const ready = (data) => {
    if (job !== networkJob || view.field !== field) return;
    if (data) field.adoptNetwork(data);
    else field.waitForNetwork = false;
    view.layer = null;
    const exitAt = [...$("exits").children].indexOf(document.activeElement);
    update();
    if (exitAt >= 0) $("exits").children[exitAt]?.focus();
    // The status said "Finding the route…": now it names the route.
    // Any other status is already right: do not read it again.
    if (state.start && view.pendingHow) explain(view.pendingHow);
    view.pendingHow = null;
  };
  networkReady = ready;
  try {
    if (!worker) {
      worker = new Worker(scriptUrl("#network-worker"));
      worker.onmessage = (ev) => { if (ev.data.id === networkJob && networkReady) networkReady(ev.data.data); };
      worker.onerror = (ev) => { ev.preventDefault(); worker = null; if (networkReady) networkReady(null); };
    }
    const g = state.grid;
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
  // The ways out lead to a chosen exit too. Where they do not, the grid
  // route of a field to that exit is the answer.
  const to = (k) => f.wayRoute(start, k) || view.toExit(k).route(start);
  let main;
  try {
    const k = state.exitChoice;
    const r = k >= 0 ? to(k) : f.wayRoute(start);
    if (f.waitForNetwork && !f._network) { view.pending = true; return; }
    main = { points: r.points, exitIndex: k >= 0 ? k : r.exitIndex };
    // "Nearest" is by the cost of the way, as for the second exit below; the
    // map lines can lead a spot to an exit a little farther away.
    const near = k >= 0 ? -1 : f.nearestExit(start);
    if (near >= 0 && near !== main.exitIndex) main = { points: to(near).points, exitIndex: near };
  } catch (e) {
    if (!(e instanceof R.NoRoute)) throw e;
    view.error = e.message;
    return;
  }
  // A second way out, in case the first exit is blocked: the nearest other
  // exit whose way does not pass the door of the first one.
  const door = f.doorRadius() / 2, { x: mx, y: my } = state.exits[main.exitIndex];
  const passes = (pts) => pts.slice(1, -1).some(([x, y]) => Math.hypot(x - mx, y - my) < door);
  let backup = null;
  for (const k of f.otherExits(start, main.exitIndex).slice(0, OTHER_TRIES)) {
    let r;
    try { r = to(k); } catch (e) { if (!(e instanceof R.NoRoute)) throw e; continue; }
    const b = { points: r.points, exitIndex: k };
    if (!backup) backup = b;
    if (!passes(r.points)) { backup = b; break; }
  }
  // The solid route is the shorter one, so "nearest" stays true on the plan.
  const len = (pts) => pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
  if (backup && state.exitChoice < 0 && len(backup.points) < len(main.points)) [main, backup] = [backup, main];
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

  const layer = document.createElement("canvas");
  layer.width = state.width;
  layer.height = state.height;
  const l = layer.getContext("2d");
  l.imageSmoothingEnabled = true;
  l.drawImage(tint, 0, 0, f.gw / f.scale, f.gh / f.scale);

  // The ways out: straight lines from door to door to the exits, wider where
  // more doors and rooms drain through them.
  // No lines while the worker makes them.
  const net = f._network || (f.waitForNetwork ? null : f.network());
  const legs = net ? net.legs : [];
  const unit = Math.max(state.width, state.height) / 160;
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
  const layer = document.createElement("canvas");
  layer.width = state.width;
  layer.height = state.height;
  const l = layer.getContext("2d");
  const unit = Math.max(state.width, state.height) / 160;
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

function draw() {
  if (!state) return;
  canvas.width = state.width;
  canvas.height = state.height;
  if (routesOnly) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(wallLayer(), 0, 0);
  } else {
    ctx.drawImage(img, 0, 0);
  }
  const unit = Math.max(state.width, state.height) / 160;
  if (!photoOnly) {
    if (showMap && view.reachable) {
      ctx.drawImage(mapLayer(), 0, 0);
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
  const clearOfRoutes = (x, y) => routes.every((pts) => pts.slice(1).every((q, i) =>
    segmentGap([x, y], pts[i], q) > unit * ARROW_CLEAR));
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
    for (let t = len % gap / 2 || gap / 2; t < len; t += gap) {
      const x = leg.a[0] + ux * (t + s / 2), y = leg.a[1] + uy * (t + s / 2);
      if (!clearOfRoutes(x, y)) continue;
      ctx.moveTo(x, y);
      ctx.lineTo(x - ux * s * 1.4 - uy * s, y - uy * s * 1.4 + ux * s);
      ctx.lineTo(x - ux * s * 1.4 + uy * s, y - uy * s * 1.4 - ux * s);
      ctx.closePath();
    }
  }
  ctx.stroke();
  ctx.fill();
}

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
      ctx.moveTo(step.from[0], step.from[1]);
      ctx.lineTo(step.to[0], step.to[1]);
      ctx.stroke();
    }
  }
  if (here) {
    const r = unit * 2.4;
    hereMark(here[0], here[1], r);
    const at = youLabelAt(here, r, unit * 2.2);
    label("YOU", at.x, at.y, r, at.baseline, at.align);
  }
  if (step && step.kind === "walk") {
    label(String(selected + 1), (step.from[0] + step.to[0]) / 2, (step.from[1] + step.to[1]) / 2 - unit * 2.5, unit * 2.4, "bottom");
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
  const onPlan = ([x0, y0, x1, y1]) => x0 >= 0 && y0 >= 0 && x1 <= state.width && y1 <= state.height;
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

// Show one step on the plan. -1 shows none.
function select(i) {
  selected = i;
  $("steps").querySelectorAll("button.step").forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
  if (photoOnly) setPhotoOnly(false);
  draw();
  const step = view.steps[i];
  if (!step || step.kind !== "walk") return;
  const mid = [(step.from[0] + step.to[0]) / 2, (step.from[1] + step.to[1]) / 2];
  scrollToPoint(mid);
  // On a phone the plan is above the steps: bring the leg into the window.
  const box = canvas.getBoundingClientRect();
  const y = box.top + mid[1] / state.height * box.height;
  if (y < 0 || y > window.innerHeight) $("stage").scrollIntoView({ block: "nearest", behavior: "smooth" });
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
  if ($("exits-wrap").hidden) return;
  state.exits.forEach((e, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = open[i] ? exitName(i) : `${exitName(i)} · no way found`;
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
      (view.route ? $("steps") : $("exits").children[i]).focus();
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
  box.append(`Sample plan. Photo: “${c.title}” by ${c.author}, `,
             link(c.licence, c.licence_url), ", ", link("source", c.source_url),
             `. Changes: ${changes}.`,
             c.share_alike ? " The changed image is shared under the same licence." : "",
             " This sample uses a saved model reading.");
}

// Find the route again and show everything that depends on it.
function update() {
  findRoute();
  draw();
  showSteps();
  showBackup();
  showExits();
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
  } else {
    sayPlan(`Route from the spot you chose to the nearest exit, ${exitName(view.route.exitIndex)}.${otherWay()} Check it against the plan.`);
  }
}

// The second way out, as words for the status line.
function otherWay() {
  if (!view.backup) return "";
  return ` If it is blocked, use ${exitName(view.backup.exitIndex)}${photoOnly ? "" : ": the dashed line"}.`;
}

// The second way out under the steps too, where the eyes are after a tap
// or after an exit button, with a button that shows its route.
function showBackup() {
  const b = view.backup;
  $("backup").hidden = !b || !view.route;
  if ($("backup").hidden) return;
  $("backup-text").textContent = `If ${exitName(view.route.exitIndex)} is blocked, use ${exitName(b.exitIndex)}${photoOnly ? "" : ": the dashed line"}.`;
  $("backup-go").textContent = `Route to ${exitName(b.exitIndex)}`;
}

// Photo only and Routes only change what is under the marks, so at most one is on.
function setPhotoOnly(on) {
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
  marking = true;
  $("fix").textContent = "Cancel";
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
  $("fix").textContent = "Mark the exit";
  $("fix-hint").hidden = true;
  if (state) $("tap-text").hidden = !state.start;
  hints();
}

$("fix").addEventListener("click", (ev) => {
  if (marking) { stopMarking(); explain(); return; }
  startMarking();
  // A click from Enter or Space has detail 0: go on with the keyboard.
  if (ev.detail === 0) canvas.focus();
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

function place(x, y) {
  if (marking) setExit(x, y);
  else if (state.photo_map && state.exits.length) sayPlan(photoMapText());
  else if (state.exits.length) setStart(x, y);
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

function showPlan(answer, focusResult, push) {
  state = answer;
  // A photo map has no routes, so the controls for routes and walls go.
  const map = !!state.photo_map;
  if (map) routesOnly = false;
  $("show-map").hidden = $("show-routes").hidden = $("fix").hidden = $("legend-route").hidden = map;
  if (state.start === undefined) state.start = null;
  if (state.exitChoice === undefined) state.exitChoice = -1;
  if (state.foundExits === undefined) state.foundExits = state.exits.map((e) => ({ ...e }));
  say("");
  sayPlan("");  // the same instruction for the next plan is then a change, and is read
  stopMarking();
  cursor = null;
  keyboard = false;
  img.onload = () => {
    $("result").hidden = false;
    buildField();
    showCredit();
    update();
    explain();
    if ($("stage").classList.contains("big")) centreOnStart();
    markOpenSample(push);
    if (focusResult) {
      $("result").scrollIntoView({ block: "start" });
      $("result-head").focus({ preventScroll: true });
    }
  };
  img.src = state.image;
}

// Load a plan from an upload or the gallery. Only the newest request wins.
async function loadPlan(request, waitText, push) {
  const n = ++planSeq;
  stopSpeaking();
  if (marking) stopMarking();
  $("photo").disabled = true;
  say(waitText);
  let answer;
  try {
    const r = await request();
    if (!r.ok) { if (n === planSeq) say(`Could not open the plan: ${await errorText(r, "try again")}.`); return; }
    answer = await r.json();
  } catch (e) {
    if (n === planSeq) say("Could not open the plan. Check the connection and try again.");
    return;
  } finally {
    if (n === planSeq) {
      $("photo").disabled = false;
      // Disabling the input took its focus away.
      if (document.activeElement === document.body) $("photo").focus();
    }
  }
  if (n !== planSeq) return;
  showPlan(answer, true, push);
  remember();
}

$("photo").addEventListener("change", (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";  // so the same file can be picked again
  if (!file) return;
  const body = new FormData();
  body.append("photo", file);
  loadPlan(() => fetch("/api/plan", { method: "POST", body }),
           "Reading the plan. This takes about 15 seconds. The button works again when it is done.");
});

// Gallery of open-licensed plan photos with saved readings.
const GALLERY_FIRST = 8;
const countryName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (code) => {
      try { const n = names.of(code); return n && n !== code ? n : "Unknown country"; } catch (e) { return "Unknown country"; }
    };
  } catch (e) { return (code) => code; }
})();

const sampleId = (id) => (id && id.startsWith("g-") ? id.slice(2) : null);
// "?set=review" opens the review set: plans read with code under test.
const SET = new URLSearchParams(location.search).get("set") === "review" ? "?set=review" : "";

// push: add a history entry, so Back returns to the plan before.
function openSample(gid, push) {
  return loadPlan(() => fetch(`/api/gallery/${encodeURIComponent(gid)}${SET}`, { method: "POST" }), "Opening the sample plan…", push);
}

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
  if (push && url.href !== location.href) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

$("back-to-samples").addEventListener("click", () => {
  const gid = sampleId(state && state.id);
  const tile = document.querySelector(`#gallery button.sample[data-id="${CSS.escape(gid || "")}"]`) || document.querySelector("#gallery button.sample");
  if (tile) { tile.scrollIntoView({ block: "center" }); tile.focus({ preventScroll: true }); }
});

function creditLine(c) {
  const li = document.createElement("li");
  const a = (text, href) => { const e = document.createElement("a"); e.href = href; e.textContent = text; e.rel = "noopener"; return e; };
  li.append(`“${c.title}” by ${c.author}, `);
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
  place((ev.clientX - box.left) * (canvas.width / box.width),
        (ev.clientY - box.top) * (canvas.height / box.height));
});

// Keyboard: arrow keys move a cross, Enter or Space places the start or the exit.
canvas.addEventListener("keydown", (ev) => {
  if (!state) return;
  const step = Math.max(state.width, state.height) * (ev.shiftKey ? 0.05 : 0.01);
  const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
  if (!cursor) cursor = state.start ? [...state.start] : [state.width / 2, state.height / 2];
  if (move) {
    keyboard = true;
    $("kbd-hint").hidden = false;
    cursor = [Math.min(state.width, Math.max(0, cursor[0] + move[0])),
              Math.min(state.height, Math.max(0, cursor[1] + move[1]))];
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
    if (!cursor) cursor = state.start ? [...state.start] : [state.width / 2, state.height / 2];
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
    const col = ["left", "middle", "right"][Math.min(2, Math.floor(3 * x / state.width))];
    const row = ["top", "middle", "bottom"][Math.min(2, Math.floor(3 * y / state.height))];
    const at = row === col ? "middle" : `${row} ${col}`;
    let near = -1, best = Infinity;
    state.exits.forEach((e, i) => { const d = Math.hypot(e.x - x, e.y - y); if (d < best) { best = d; near = i; } });
    $("marker-status").textContent = `Marker: ${at} of the plan` + (near >= 0 ? `, closest exit mark ${exitName(near)}.` : ".");
  }, 400);
}
canvas.addEventListener("blur", () => { $("kbd-hint").hidden = true; draw(); });

// In the larger plan, put the start in the middle, so the start of the route is in view.
function centreOnStart() {
  if (!state || !state.start) return;
  const st = $("stage");
  st.scrollLeft = state.start[0] / state.width * canvas.clientWidth - st.clientWidth / 2;
  st.scrollTop = state.start[1] / state.height * canvas.clientHeight - st.clientHeight / 2;
}

// In the larger plan, scroll so that a plan point is in the middle of the view.
function scrollToPoint(p) {
  const st = $("stage");
  if (!st.classList.contains("big") || !p) return;
  const x = p[0] / state.width * canvas.clientWidth, y = p[1] / state.height * canvas.clientHeight;
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
  $("speak").textContent = "Read the steps aloud";
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
  $("speak").textContent = "Stop reading";
});

function lastPlan() {
  try {
    const last = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
    return last && last.image && last.grid ? last : null;
  } catch (e) { return null; /* storage blocked */ }
}

// A link with ?sample=<id> opens that sample. After a reload of the same
// sample, the start and the exits the user set come back.
function openFromAddress() {
  const gid = new URL(location.href).searchParams.get("sample");
  const last = lastPlan();
  if (gid && last && last.id === `g-${gid}`) showPlan(last);
  else if (gid) openSample(gid);
  else if (last && !sampleId(last.id)) showPlan(last);
  else if (state) { state = null; $("result").hidden = true; markOpenSample(); }
}
window.addEventListener("popstate", openFromAddress);
openFromAddress();
