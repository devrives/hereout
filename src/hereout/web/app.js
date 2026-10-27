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
const canSpeak = "speechSynthesis" in window;
$("shoot").hidden = false;  // without JS the photo button would do nothing
const STORE_KEY = "hereout:last";

// Map colours: green near an exit, yellow far from one.
const NEAR = [10, 125, 59], FAR_C = [245, 190, 20];
const MAP_ALPHA = 110;
const ROUTE = "#1b5fd1";

// Two status lines: one by the photo button for loading, one under the plan
// for what happens on the plan, so the answer to a tap is in view.
function say(text) { $("status").textContent = text; }
function sayPlan(text) { $("plan-status").textContent = text; }

// Error bodies from a proxy may not be JSON, and a 422 detail is a list.
async function errorText(r, fallback) {
  const body = await r.json().catch(() => ({}));
  return typeof body.detail === "string" ? body.detail : fallback;
}

function remember() {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
}

const exitPoints = () => state.exits.map((e) => [e.x, e.y]);

// The escape field for the current exits. The ink of the plan's own marks
// is not a wall.
function buildField() {
  const g = state.grid;
  const blocked = R.decodeGrid(g);
  const clear = state.here ? [state.here] : [];
  const make = (exits) => new R.Field(blocked, g.w, g.h, g.scale, exits, [...clear, ...exitPoints()]);
  const field = make(exitPoints());
  const single = new Map();  // a field to one exit, made when the user picks that exit
  view = { field, layer: null, route: null, steps: [], error: null,
           toExit: (i) => { if (!single.has(i)) single.set(i, make([exitPoints()[i]])); return single.get(i); } };
  view.reachable = field.owner.some((o) => o >= 0);
}

function findRoute() {
  view.route = null;
  view.steps = [];
  view.error = null;
  if (!state.start || !state.exits.length) return;
  const field = state.exitChoice >= 0 ? view.toExit(state.exitChoice) : view.field;
  try {
    const r = field.route(state.start);
    const exitIndex = state.exitChoice >= 0 ? state.exitChoice : r.exitIndex;
    view.route = { points: r.points, exitIndex };
    view.steps = R.directions(r.points, state.width, state.height);
  } catch (e) {
    if (!(e instanceof R.NoRoute)) throw e;
    view.error = e.message;
  }
}

// The escape map: colour by the cost to the nearest exit, and lines along
// the ways that many routes share. Made once for each field.
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

  const { acc, order } = f.flow();
  const min = Math.max(20, order.length * 0.004);
  const unit = Math.max(state.width, state.height) / 160;
  const widths = [[], [], [], [], [], []];
  for (const i of order) {
    if (acc[i] < min || f.next[i] < 0) continue;
    widths[Math.min(5, Math.floor(Math.log2(acc[i] / min)))].push(i);
  }
  l.lineCap = l.lineJoin = "round";
  l.strokeStyle = "rgba(6, 64, 34, 0.75)";
  widths.forEach((cells, b) => {
    l.lineWidth = unit * (0.22 + 0.16 * b);
    l.beginPath();
    for (const i of cells) {
      const a = f.toPx(i), z = f.toPx(f.next[i]);
      l.moveTo(a[0], a[1]);
      l.lineTo(z[0], z[1]);
    }
    l.stroke();
  });

  // Arrow heads on the main ways, at even steps of cost, pointing to the exit.
  const spacing = 0.09 * Math.max(f.gw, f.gh);
  l.fillStyle = "rgba(6, 64, 34, 0.9)";
  for (const i of order) {
    const j = f.next[i];
    if (acc[i] < min * 4 || j < 0 || Math.floor(f.dist[i] / spacing) === Math.floor(f.dist[j] / spacing)) continue;
    let k = j;
    for (let s = 0; s < 3 && f.next[k] >= 0; s++) k = f.next[k];
    const a = f.toPx(i), z = f.toPx(k);
    const ang = Math.atan2(z[1] - a[1], z[0] - a[0]);
    const r = unit * 1.3;
    l.beginPath();
    l.moveTo(a[0] + Math.cos(ang) * r, a[1] + Math.sin(ang) * r);
    l.lineTo(a[0] + Math.cos(ang + 2.5) * r, a[1] + Math.sin(ang + 2.5) * r);
    l.lineTo(a[0] + Math.cos(ang - 2.5) * r, a[1] + Math.sin(ang - 2.5) * r);
    l.closePath();
    l.fill();
  }
  view.layer = layer;
  return layer;
}

function draw() {
  if (!state) return;
  canvas.width = state.width;
  canvas.height = state.height;
  ctx.drawImage(img, 0, 0);
  const unit = Math.max(state.width, state.height) / 160;
  if (!photoOnly) {
    if (showMap && view.reachable) ctx.drawImage(mapLayer(), 0, 0);
    drawMarks(unit);
  }
  if (cursor && keyboard && document.activeElement === canvas) cross(cursor[0], cursor[1], unit * 4);
}

function drawMarks(unit) {
  // Exit and "you are here" differ in shape and label, not only in colour.
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
    // Near the top edge the label goes below the mark, so it is not cut off.
    const above = here[1] - r * 1.8 - r * 1.6 > 0;
    label("YOU", here[0], above ? here[1] - r * 1.8 : here[1] + r * 1.8, r, above ? "bottom" : "top");
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

function label(text, x, y, r, baseline) {
  ctx.font = `bold ${Math.round(r * 1.6)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
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
  const none = view.steps.length === 0;
  $("steps-head").hidden = $("steps-hint").hidden = none;
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
  return !l || /^exit$/i.test(l) ? `Exit ${i + 1}` : `${l} (${i + 1})`;
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
      sayPlan(view.route ? `Route to ${exitName(i)}. Check it against the plan.`
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
  const changes = [...(c.changes || []), "marks, escape map and route drawn on top"].join(", ");
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
  showExits();
  $("to-mark").hidden = !state.here || !state.start || startKind() === "mark";
  $("found-exits").hidden = !state.exitsMarked || !state.foundExits.length;
  showLegend();
}

const showLegend = () => { $("legend").hidden = !showMap || photoOnly || !view.reachable; };

// The walls come from the photo, so the messages say what HereOut read,
// not what the building is.
const ROUTE_ERRORS = {
  "start is inside a wall": "HereOut reads that spot as wall. Tap a spot in a corridor or a room.",
  "no open way to an exit": "HereOut found no way from that spot to an exit in this photo. Try a spot in a corridor.",
  "every exit is inside a wall": 'HereOut reads every exit as part of a wall. Tap "Mark the exit" and mark one in a doorway.',
};
const MARK_ERRORS = {
  "start is inside a wall": 'HereOut reads "you are here" as wall. Tap where you are.',
  "no open way to an exit": 'HereOut found no way from "you are here" to an exit in this photo. Tap a spot in a corridor near it.',
};

// Is the start the plan's own "you are here" mark, or a spot the user chose?
const startKind = () => (state.here && state.start && state.start[0] === state.here[0] &&
  state.start[1] === state.here[1] ? "mark" : "tap");

// how: "mark" (the plan's "you are here"), "tap" (a start the user chose) or "exit" (an exit the user marked).
function explain(how) {
  if (!state.exits.length) {
    sayPlan(state.model_error
      ? 'Could not read the plan. Tap "Mark the exit" and mark it, then tap where you are.'
      : 'No exit found. Tap "Mark the exit" and mark it on the plan.');
  } else if (!state.start) {
    sayPlan('No "you are here" mark found. Tap where you are on the plan.');
  } else if (view.error && how === "exit") {
    sayPlan(`HereOut found no way to the exit you marked. Mark it at a doorway${
      state.foundExits.length ? ", or use the exits HereOut found" : ""}.`);
  } else if (view.error) {
    sayPlan((how === "mark" && MARK_ERRORS[view.error]) || ROUTE_ERRORS[view.error] || "HereOut found no route from that spot.");
  } else if (how === "exit") {
    sayPlan("Route to the exit you marked. Check it against the plan.");
  } else if (how === "tap") {
    sayPlan("Route from the spot you chose to the nearest exit. Check it against the plan.");
  } else {
    sayPlan('Route from "you are here" to the nearest exit. Check it against the plan.');
  }
}

function setPhotoOnly(on) {
  photoOnly = on;
  $("show-photo").setAttribute("aria-pressed", String(on));
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

function startMarking() {
  marking = true;
  $("fix").textContent = "Cancel";
  $("fix-hint").hidden = false;
  hints();
  if (photoOnly) setPhotoOnly(false);
  sayPlan("Tap the exit on the plan.");
}

function stopMarking() {
  marking = false;
  $("fix").textContent = "Mark the exit";
  $("fix-hint").hidden = true;
  hints();
}

$("fix").addEventListener("click", (ev) => {
  if (marking) { stopMarking(); explain(startKind()); return; }
  startMarking();
  // A click from Enter or Space has detail 0: go on with the keyboard.
  if (ev.detail === 0) canvas.focus();
});

// The user's exit takes the place of the exits the model found.
function setExit(x, y) {
  stopMarking();
  state.exits = [{ x: Math.round(x), y: Math.round(y), label: "" }];
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
  else if (state.exits.length) setStart(x, y);
  else sayPlan('Mark an exit first: tap "Mark the exit".');
}

// Undo "Mark the exit": the exits from the reading come back.
$("found-exits").addEventListener("click", () => {
  state.exits = state.foundExits.map((e) => ({ ...e }));
  state.exitsMarked = false;
  state.exitChoice = -1;
  buildField();
  update();
  remember();
  explain(startKind());
  $("fix").focus();  // this button is hidden now
});

$("to-mark").addEventListener("click", () => {
  state.start = [...state.here];
  state.exitChoice = -1;
  update();
  remember();
  explain("mark");
  $("steps").focus();  // this button is hidden now
});

function hints() {
  $("kbd-hint").textContent = marking
    ? "Arrow keys move the marker, Shift moves it faster. Enter places the exit. Escape cancels."
    : "Arrow keys move the marker, Shift moves it faster. Enter starts the route there.";
  canvas.setAttribute("aria-label", marking
    ? "Plan. Mark the exit: tap it, or move the marker with the arrow keys and press Enter."
    : "Plan. Tap a spot to see the route from there, or move the marker with the arrow keys and press Enter.");
}

function showPlan(answer, focusResult, push) {
  state = answer;
  if (state.start === undefined) state.start = state.here;
  if (state.exitChoice === undefined) state.exitChoice = -1;
  if (state.foundExits === undefined) state.foundExits = state.exits.map((e) => ({ ...e }));
  say("");
  stopMarking();
  cursor = null;
  keyboard = false;
  img.onload = () => {
    $("result").hidden = false;
    buildField();
    showCredit();
    update();
    explain(startKind());
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

// push: add a history entry, so Back returns to the plan before.
function openSample(gid, push) {
  return loadPlan(() => fetch(`/api/gallery/${encodeURIComponent(gid)}`, { method: "POST" }), "Opening the sample plan…", push);
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
    const r = await fetch("/api/gallery");
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
  } else if (ev.key === "Enter" || ev.key === " ") {
    keyboard = true;
    place(cursor[0], cursor[1]);
  } else if (ev.key === "Escape" && marking) {
    stopMarking();
    explain(startKind());
  } else {
    return;
  }
  ev.preventDefault();
});
// The keyboard hint only for keyboard focus, not after a tap.
canvas.addEventListener("focus", () => { $("kbd-hint").hidden = !canvas.matches(":focus-visible"); draw(); });
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
