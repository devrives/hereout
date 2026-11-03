"use strict";

const $ = (id) => document.getElementById(id);
const R = HereOutRoute;
const I = HereOutI18n;
const t = I.t;
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
// What the plan shows: one view of three (DESIGN.md "view control").
// "map": the dimmed photo with the escape map and the marks; "photo": the
// photo only; "routes": the walls HereOut read with the escape map and the
// marks, with no photo. showMap stays true: the map shows in "map" and "routes".
let viewMode = "map";
let marksMode = "map";  // the view with marks to go back to after "photo"
const showMap = true;
let photoOnly = false;
let routesOnly = false;
let addExit = false;    // the next exit the user marks joins the others (explain, NO_EXIT_HERE)
const canSpeak = "speechSynthesis" in window;
$("shoot").hidden = $("new-photo").hidden = false;  // without JS the photo buttons would do nothing
// Two photo buttons: the big one on the start page, and one in the header while a plan is open.
const PHOTOS = [$("photo"), $("photo-2")];
// Below this width the answer is under the plan, so an answer can scroll the plan away.
const narrow = () => matchMedia("(max-width: 959px)").matches;
// "?set=review" opens the review set: plans read with code under test. Only a
// local server with HEREOUT_REVIEW=1 has it; elsewhere the gallery stays empty.
const SET = new URLSearchParams(location.search).get("set") === "review" ? "?set=review" : "";
const STORE_KEY = `hereout:last${SET}`;  // the review set keeps its own last plan
const PHOTO_KEY = "hereout:photo";  // the plan of the last photo, so Back after a sample finds it

// The marks glow over the dimmed photo (DESIGN.md, Afterglow). Each colour
// is the custom property of the same name in style.css.
// Map colours: the floor glows green near an exit and fades far from one.
const NEAR = [61, 255, 160];
const MAP_ALPHA = 54;
const ROUTE = "#5aa2ff";
const ROUTE_GLOW = "rgba(90, 162, 255, 0.32)";
const ROUTE_CORE = "#d6e7ff";  // a thin light line in the middle of the route
const HERE = "#2f7dff";  // the start dot: the route blue, a little deeper on its white rim
const HERE_HALO = "rgba(90, 162, 255, 0.22)";
const EXIT = "#3dffa0";
const EXIT_INK = "#03140b";
const EXIT_GLOW = "rgba(61, 255, 160, 0.75)";
const DONE = "#aebdcc";  // the legs before the lit step: walked, so grey, but light on the dimmed photo
const DARK = "#07100c";  // the ground of the page: the edge of every mark
const VEIL = "rgba(7, 16, 12, 0.6)";  // over the photo in the escape map, so the marks stand out
const ARROW_GAP = 24;   // plan units between two arrows on a way out
const ARROW_SIZE = 1.1; // plan units: half the width of an arrow head
const OTHER_TRIES = 3;  // exits tried for the second way out
const FLOOR_SHARE = 0.05; // an open area with this share of the open cells is a floor, not a pocket of paper
const ARROW_CLEAR = 2;  // plan units: no arrow this close to a route
const ARROW_APART = 4;  // arrow sizes: no head this close to another head (two heads meet at a split or join)
const ARROW_KEEP = 5;   // plan units: a line this long keeps one head, also near other heads
const ARROW_START = 8;  // plan units: no arrow this close to the start, where it can point away from the route
const WALL = "#7d9188";  // darker than the ways out, so a way and a wall differ in more than hue
const BLOCK = "#18251f";  // a filled area of the plan, in Routes only
const WAY = "#3dffa0";  // the ways out
const WAY_GLOW = "rgba(61, 255, 160, 0.22)";
// The ways out show as a few main lines (owner, 2026-11-02: lines too busy),
// and every line shown joins an exit (owner, 2026-11-02: no gaps). So no
// line of the network is cut out of its middle: only spurs go. A spur is a
// piece with a free end (not at an exit), up to the next fork. A short spur
// (a line into a room, a tick) does not show; a long one (a far wing) does.
// The pass repeats, because a fork can go with its spurs. A piece that
// joins no exit does not show.
const WAY_SPUR = 16;  // plan units: a shorter spur does not show
const FIELD_UNDER_ROUTE = 0.5;  // with a route: the soft field near the exits at this share, and no way lines
function shownLegs(net) {
  const fr = shownFrame();
  const unit = Math.max(fr[2] - fr[0], fr[3] - fr[1]) / 160;
  if (net._shown && net._shownUnit === unit) return net._shown;
  const { lines = [] } = state.walls || {};
  const onBuilding = lines.length ? R.buildingOutline(view.field, lines, state.width, state.height) : () => true;
  const key = (p) => `${Math.round(p[0])},${Math.round(p[1])}`;
  const len = (l) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
  const exits = exitPoints();
  const atExit = (p) => exits.some(([x, y]) => Math.hypot(p[0] - x, p[1] - y) < unit);
  const anchor = new Set();
  const at = new Map();  // the legs at each end
  const point = new Map();
  const live = new Set(net.legs.filter((l) => len(l) > 0));
  for (const l of live) {
    for (const p of [l.a, l.b]) {
      const k = key(p);
      point.set(k, p);
      if (!at.has(k)) at.set(k, new Set());
      at.get(k).add(l);
      if (atExit(p)) anchor.add(k);
    }
  }
  const other = (l, k) => (key(l.a) === k ? key(l.b) : key(l.a));
  for (let cut = true; cut;) {
    cut = false;
    for (const [k0, ls] of at) {
      if (ls.size !== 1 || anchor.has(k0)) continue;
      // Walk from the free end to a fork, an exit or the other free end.
      const spur = [];
      let k = k0, l = [...ls][0], d = 0;
      for (;;) {
        spur.push(l);
        d += len(l);
        k = other(l, k);
        const next = [...at.get(k)].filter((m) => m !== l);
        if (next.length !== 1 || anchor.has(k)) break;
        l = next[0];
      }
      if (d >= unit * WAY_SPUR && onBuilding(point.get(k0), unit)) continue;
      for (const m of spur) {
        live.delete(m);
        at.get(key(m.a)).delete(m);
        at.get(key(m.b)).delete(m);
      }
      cut = true;
    }
  }
  // Only the pieces that reach an exit.
  const reach = new Set([...anchor]);
  for (let grow = true; grow;) {
    grow = false;
    for (const l of live) {
      const ka = key(l.a), kb = key(l.b);
      if (reach.has(ka) !== reach.has(kb)) { reach.add(ka); reach.add(kb); grow = true; }
    }
  }
  const shown = [...live].filter((l) => reach.has(key(l.a)));
  net._shown = shown;
  net._shownUnit = unit;
  return shown;
}

// The language of the plan card (i18n.js), from the address (lang=) or the
// browser. The start page stays English. Muse Spark translated the catalogue
// once (scripts/translate_ui.py); the words of each plan are translated when
// the plan opens in another language (loadWords).
let lang = "en";
const catalogues = { en: I.EN };
let langSeq = 0;

// A step in the language: English is the text of route.js itself.
function stepText(s) {
  return lang === "en" || !s.say ? s.text : I.stepText(s.say);
}

async function catalogue(tag) {
  if (catalogues[tag]) return catalogues[tag];
  try {
    const r = await fetch(`/static/i18n/${tag}.json?v=${document.documentElement.dataset.i18n || ""}`);
    if (r.ok) return (catalogues[tag] = await r.json());
  } catch (e) { /* offline: the English texts */ }
  return null;
}

// chosen: the user picked it, so the address keeps it.
async function setLang(tag, chosen) {
  const n = ++langSeq;
  const cat = await catalogue(tag);
  if (n !== langSeq) return;
  lang = tag;
  I.use(tag, cat || {});
  $("words-status").textContent = "";
  $("lang").value = tag;
  // The texts of the card are in the language once its catalogue is there.
  $("result").lang = cat ? tag : "en";
  $("result").dir = cat ? I.dir(tag) : "ltr";
  if (chosen) {
    const url = new URL(location.href);
    url.searchParams.set("lang", tag);
    history.replaceState(history.state, "", url);
  }
  retext();
  // Arrow keys on the select change the language at each press: the words call waits for the last one.
  clearTimeout(wordsTimer);
  wordsTimer = setTimeout(loadWords, chosen ? 500 : 0);
}

function setUpLang() {
  const sel = $("lang");
  for (const [tag, name] of Object.entries(I.LANGS)) {
    const o = document.createElement("option");
    o.value = tag;
    o.lang = tag;
    o.dir = I.dir(tag);
    o.textContent = name;
    sel.append(o);
  }
  sel.addEventListener("change", () => setLang(sel.value, true));
  const asked = new URL(location.href).searchParams.get("lang");
  const browser = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  setLang(asked && I.LANGS[asked] ? asked : I.pick(browser), false);
}

// Every text of the plan card again, in the language now.
function retext() {
  document.querySelectorAll("#result [data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll("#result [data-t-label]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.tLabel)));
  $("fix-text").textContent = t(marking ? "fix_cancel" : "fix");
  $("fix-hint").textContent = t(addExit ? "fix_hint_add" : "fix_hint");
  $("tap-text").textContent = tapSaid();
  hints();
  if (!state || !view) { $("speak-text").textContent = t("speak"); return; }
  const keep = selected;
  showSteps();  // stops the speech: it was in the old language
  if (keep >= 0 && view.steps[keep]) {
    selected = keep;
    $("steps").querySelectorAll("button.step").forEach((b, j) => b.setAttribute("aria-pressed", String(j === keep)));
  }
  draw();
  showBackup();
  showExits();
  showAnswer();
  showNow();
  sayPlanSoon();
  showWords();
}

// After a change of language the route sentence is said once: after the last
// change, and with the exit names in the language when they still have to come.
const SAY_AFTER = 600;
const SAY_WAIT = 2500;
let sayTimer = 0;
let wordsTimer = 0;
function needsLabels() {
  if (!state) return false;
  const have = (wordsIn(lang) || {}).labels || {};
  return state.exits.some((e) => {
    const l = (e.label || "").trim();
    return l && !PLAIN_LABEL.test(l) && (lang !== "en" || FOREIGN.test(l)) && !have[l];
  });
}
function sayPlanSoon() {
  clearTimeout(sayTimer);
  const s = state;
  sayTimer = setTimeout(() => {
    if (state === s) $("plan-status").textContent = planSaid();
  }, needsLabels() ? SAY_WAIT : SAY_AFTER);
}

// The exit names after their labels came in the language.
function renameExits() {
  if (!state || !view) return;
  showAnswer();
  [...$("exits").children].forEach((b, i) => nameExitButton(b, i));
  showBackup();
  clearTimeout(sayTimer);
  const said = planSaid();
  if ($("plan-status").textContent !== said) $("plan-status").textContent = said;
}

// The words of the plan in a language, once the server sent them: {plan_text, labels}.
function wordsIn(tag) {
  if (!state) return null;
  if (tag === "en") {
    const labels = (state.tr && state.tr.en && state.tr.en.labels) || {};
    return state.plan_text || Object.keys(labels).length ? { plan_text: state.plan_text, labels } : null;
  }
  return (state.tr && state.tr[tag]) || null;
}

// An exit label that only says "exit", or only a number, needs no words (translate.py PLAIN_LABEL).
const PLAIN_LABEL = /^\s*(exit|[\d.]*)\s*$/i;
// A label in another script ("ВЫХОД") gets an English name too (translate.py FOREIGN).
const FOREIGN = /[^\u0000-\u024f]/;
const WORDS_TRIES = 30;  // asks every ASK_EVERY ms while the server still reads the words of a photo
let wordsSeq = 0;
let wordsState = "";     // "wait" while a translation comes, "failed" when none came

function languageName(tag) {
  if (!tag) return "";
  try {
    return new Intl.DisplayNames([lang], { type: "language" }).of(tag) || tag;
  } catch (e) { return tag; }
}

// The words of the plan and the exit labels in the language. The page shows
// the English words first and puts the translation in place when it comes.
async function loadWords() {
  const s = state;
  const n = ++wordsSeq;
  const tag = lang;
  wordsState = "";
  const english = (!s || !s.text_id || s.plan_text || !s.text_pending) &&
    !(s && s.exits.some((e) => FOREIGN.test(e.label || "")) && !(s.tr && s.tr.en));
  const nothing = s && !s.plan_text && !s.text_pending && !s.exits.some((e) => !PLAIN_LABEL.test(e.label || ""));
  if (!s || !s.text_id || (tag === "en" ? english : wordsIn(tag) || nothing)) { showWords(); return; }
  if (tag !== "en") wordsState = "wait";
  showWords();
  const q = new URLSearchParams({ lang: tag });
  if (SET) q.set("set", "review");
  for (let k = 0; k < WORDS_TRIES; k++) {
    let r = null;
    try {
      r = await fetch(`/api/text/${encodeURIComponent(s.text_id)}?${q}`, { cache: "no-store" });
    } catch (e) { /* no connection */ }
    if (n !== wordsSeq || state !== s) return;
    if (r && r.status === 202) {
      await sleep(ASK_EVERY);
      if (n !== wordsSeq || state !== s) return;
      continue;
    }
    const data = r && r.ok ? await r.json().catch(() => null) : null;
    if (n !== wordsSeq || state !== s) return;
    if (!data) break;
    s.text_pending = false;
    if (data.plan_text && !s.plan_text) s.plan_text = data.plan_text;
    (s.tr = s.tr || {})[tag] = { plan_text: data.plan_text, labels: data.labels || {} };
    wordsState = "";
    remember();
    showWords();
    renameExits();
    if (tag !== "en") $("words-status").textContent = t("words_loaded");
    return;
  }
  if (tag === "en") s.text_pending = false;
  wordsState = tag === "en" ? "" : "failed";
  showWords();
  if (tag !== "en") $("words-status").textContent = t("words_failed");
}

// "What the plan says": the title, the instructions and the legend, each in
// the language with its original under it, so the user can find it on the plan.
function showWords() {
  const box = $("words-wrap");
  const own = wordsIn(lang);
  const en = wordsIn("en");
  const pt = (own && own.plan_text) || (en && en.plan_text);
  box.hidden = !pt || (!pt.title && !pt.legend.length && !pt.instructions.length);
  if (box.hidden) return;
  // Until the translation comes, the texts are English.
  const textLang = lang !== "en" && !(own && own.plan_text) ? "en" : null;
  // An English plan in English: the text as printed is enough.
  const asPrinted = lang === "en" && /^en\b/i.test(pt.language || "");
  const name = languageName(pt.language);
  const note = wordsState ? t(wordsState === "wait" ? "words_wait" : "words_failed") : "";
  $("words-lang").textContent = I.join([name ? t("words_lang", { language: name }) : t("words_lang_unknown"), note]);
  const item = (e, el) => {
    const main = document.createElement("span");
    main.className = "w-text";
    main.textContent = asPrinted ? e.original : (e.text || e.english);
    if (textLang) { main.lang = textLang; main.dir = "ltr"; }
    el.append(main);
    if (e.original && e.original !== main.textContent) {
      const o = document.createElement("span");
      o.className = "w-orig";
      const sr = document.createElement("span");
      sr.className = "sr";
      sr.textContent = `${t("words_on_plan")} `;
      const txt = document.createElement("span");
      txt.lang = pt.language || "";
      txt.dir = "auto";
      txt.textContent = e.original;
      o.append(sr, txt);
      el.append(o);
    }
  };
  const title = $("words-title");
  title.replaceChildren();
  title.hidden = !pt.title;
  if (pt.title) item(pt.title, title);
  for (const [key, list, head] of [["instructions", "words-instr", "words-instr-head"], ["legend", "words-legend", "words-legend-head"]]) {
    const ul = $(list);
    ul.replaceChildren();
    for (const e of pt[key] || []) {
      const li = document.createElement("li");
      item(e, li);
      ul.append(li);
    }
    ul.hidden = $(head).hidden = !(pt[key] || []).length;
  }
}

// Two status lines: one by the photo button for loading, one under the plan
// for what happens on the plan, so the answer to a tap is in view.
function say(text) { $("status").textContent = text; }
// The same text again is no change, and a screen reader stays silent: an
// Enter with no answer sounds like a dead key. Empty the line first, and set
// the text in a later task.
// The line keeps how it made its text, so a change of language says it again in the new one.
let sayAgain = 0;
let planSaid = () => "";
function sayPlan(say) {
  planSaid = typeof say === "function" ? say : () => say;
  const text = planSaid();
  const el = $("plan-status");
  if (text === finding() && el.textContent === text) return;  // one open, one message
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
  if ((how === "tap" || how === "exit" || how === "exit-button") && view.route) { startRouteDraw(); if (how === "tap") showNowInView(); }  // the route of a tap that waited for the worker
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

const finding = () => t("finding");

// While the worker makes the ways out, the page shows no route: a grid route
// first and a different route a second later would confuse. A spot with no
// way out gets its message at once.
function findRoute() {
  view.route = null;
  view.backup = null;
  view.steps = [];
  view.error = null;
  view.pending = false;
  view.near = null;
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
  // A second way out, in case the first exit is blocked: the nearest other
  // exit whose way does not pass the door of the first one. With no such
  // exit there is no second way: "if it is blocked" must not lead past that door.
  const door = f.doorRadius() / 2;
  const passes = (pts, i) => pts.slice(1, -1).some(([x, y]) => Math.hypot(x - state.exits[i].x, y - state.exits[i].y) < door);
  // A route on the ways out gives the length of its way before it moved
  // onto the drawn lines (route.js).
  const len = (r) => r.length ?? r.points.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - r.points[i][0], q[1] - r.points[i][1]), 0);
  // The route and the second way to exit k, or to the nearest exit (k = -1).
  // null while the worker makes the ways out. A start with no way throws NoRoute.
  const ways = (k) => {
    const r = k >= 0 ? to(k) : f.wayRoute(start);
    if (f.waitForNetwork && !f._network) return null;
    let main = { points: r.points, exitIndex: k >= 0 ? k : r.exitIndex, length: r.length };
    // "Nearest" is by the cost of the way, as for the second exit below; the
    // map lines can lead a spot to an exit a little farther away.
    const near = k >= 0 ? -1 : f.nearestExit(start);
    if (near >= 0 && near !== main.exitIndex) { const r = to(near); main = { points: r.points, exitIndex: near, length: r.length }; }
    let backup = null;
    for (const j of f.otherExits(start, main.exitIndex).slice(0, OTHER_TRIES)) {
      let r;
      try { r = to(j); } catch (e) { if (!(e instanceof R.NoRoute)) throw e; continue; }
      if (!passes(r.points, main.exitIndex)) { backup = { points: r.points, exitIndex: j, length: r.length }; break; }
    }
    // The solid route is the shorter one, so "nearest" stays true on the plan.
    // After a swap, the second way must keep clear of the door of the new first exit too.
    if (backup && k < 0 && len(backup) < len(main)) {
      [main, backup] = [backup, main];
      if (passes(backup.points, main.exitIndex)) backup = null;
    }
    return { main, backup };
  };
  let w;
  try {
    w = ways(state.exitChoice);
  } catch (e) {
    if (!(e instanceof R.NoRoute)) throw e;
    view.error = e.message;
    return;
  }
  if (!w) { view.pending = true; return; }
  view.route = w.main;
  view.backup = w.backup;
  view.steps = R.directions(w.main.points, state.width, state.height);
  // The exit buttons name the nearest exit and the exit of the second way
  // from this start. A chosen exit does not change them, so the buttons stay.
  let first = state.exitChoice < 0 ? w : null;
  if (!first) {
    try { first = ways(-1); } catch (e) { if (!(e instanceof R.NoRoute)) throw e; }
  }
  view.near = first ? { main: first.main.exitIndex, backup: first.backup ? first.backup.exitIndex : -1 } : null;
}

// The escape map: colour by the cost to the nearest exit, and the ways out
// as lines. Made once for each field.
function tintLayer() {
  if (view.tint) return view.tint;
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
    for (let k = 0; k < 3; k++) data.data[i * 4 + k] = NEAR[k];
    data.data[i * 4 + 3] = MAP_ALPHA * (1 - t);
  }
  tctx.putImageData(data, 0, 0);

  const l = frameLayer();
  l.imageSmoothingEnabled = true;
  l.drawImage(tint, 0, 0, f.gw / f.scale, f.gh / f.scale);
  view.tint = l.canvas;
  return view.tint;
}

// The ways out, or null while the worker makes them.
function network() {
  const f = view.field;
  return f._network || (f.waitForNetwork ? null : f.network());
}

// The ways out: straight lines from door to door to the exits, wider where
// more doors and rooms drain through them, with a soft glow. With share < 1
// (the reveal), each line grows out from its exit side: a line shows from
// its end near the exit when the front is past it.
function drawWays(l, share = 1) {
  const net = network();
  if (!net) return;
  const unit = frameUnit();
  const legs = shownLegs(net);
  const front = share < 1 ? share * wayDepth(net).max : Infinity;
  l.lineCap = l.lineJoin = "round";
  for (const [color, width] of [[WAY_GLOW, 1.6], [WAY, 0.55]]) {
    l.strokeStyle = color;
    l.lineWidth = unit * width;
    l.beginPath();
    for (const leg of legs) {
      const { a, b: z } = leg;
      if (front === Infinity) { l.moveTo(a[0], a[1]); l.lineTo(z[0], z[1]); continue; }
      const d = wayDepth(net).of.get(leg);
      if (front <= d.near) continue;
      const k = Math.min(1, (front - d.near) / Math.max(1e-6, d.far - d.near));
      l.moveTo(z[0], z[1]);
      l.lineTo(z[0] + (a[0] - z[0]) * k, z[1] + (a[1] - z[1]) * k);
    }
    l.stroke();
  }
}

// How far each end of a way-out line is from its exit, along the floor (the
// distance of the field), for the reveal. The end b is the end toward the exit.
function wayDepth(net) {
  if (net._depth) return net._depth;
  const f = view.field;
  const exits = exitPoints();
  const at = ([x, y]) => {
    const c = Math.floor(x * f.scale), r = Math.floor(y * f.scale);
    const d = c >= 0 && r >= 0 && c < f.gw && r < f.gh ? f.dist[r * f.gw + c] : Infinity;
    if (Number.isFinite(d)) return d / f.scale;
    return Math.min(...exits.map(([ex, ey]) => Math.hypot(x - ex, y - ey)));
  };
  const of = new Map();
  let max = 0;
  for (const leg of net.legs) {
    const near = at(leg.b), far = Math.max(near, at(leg.a));
    of.set(leg, { near, far });
    max = Math.max(max, far);
  }
  net._depth = { of, max: max || 1 };
  return net._depth;
}

function mapLayer() {
  if (view.layer) return view.layer;
  const l = frameLayer();
  l.drawImage(tintLayer(), 0, 0, l.canvas.width, l.canvas.height, ...shownFrame().slice(0, 2), ...frameSize());
  drawWays(l);
  view.layer = l.canvas;
  return view.layer;
}

// The width and height of the frame in photo pixels.
function frameSize() {
  const fr = shownFrame();
  return [fr[2] - fr[0], fr[3] - fr[1]];
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
  // Only the lines on the building: a line on a legend or a text panel
  // floats off the plan (route.js buildingLines).
  const onBuilding = R.buildingLines(view.field, lines, state.width, state.height);
  for (const [x0, y0, x1, y1, width] of lines.filter((_, i) => onBuilding[i])) {
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
// the same on a zoomed plan as on all of the photo. On a small screen the
// unit has a floor in CSS pixels, so the exits stay big enough to read
// (owner, 2026-11-02: the marks were too small on a phone).
const UNIT_MIN_CSS = 4;
function frameUnit() {
  const fr = shownFrame();
  const long = Math.max(fr[2] - fr[0], fr[3] - fr[1]);
  const css = canvas.clientWidth ? (fr[2] - fr[0]) / canvas.clientWidth : 0;
  return Math.max(long / 160, UNIT_MIN_CSS * css);
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
  const unit = frameUnit();
  // The layers are drawn at one unit: a new size of the plan on the screen makes them again.
  if (view.unit !== unit) { view.unit = unit; view.layer = view.walls = null; }
  if (routesOnly) {
    ctx.fillStyle = DARK;
    ctx.fillRect(0, 0, state.width, state.height);
    drawLayer(wallLayer());
  } else {
    ctx.drawImage(img, 0, 0);
    if (!photoOnly) {
      ctx.fillStyle = VEIL;
      ctx.fillRect(0, 0, state.width, state.height);
    }
  }
  if (!photoOnly) {
    const rv = revealNow();
    if (showMap && view.reachable) {
      if (rv) {
        // The reveal: the floor tint and the ways out grow in after the exits.
        ctx.save();
        ctx.globalAlpha = rv.ways;
        drawLayer(tintLayer());
        ctx.restore();
        if (rv.ways > 0) drawWays(ctx, rv.ways);
      } else {
        // With a route, the route is the one line on the plan (owner,
        // 2026-11-02: a way line beside the route looked like a second line
        // stuck to it). The ways out fade out while the dot comes in, and the
        // soft field near the exits stays.
        // At a new tap the ways stay out: they do not flash back (ux review).
        const k = view.route && state.start ? (hereAnim && hereAnim.from ? 1 : hereShare()) : 0;
        ctx.save();
        if (k > 0) {
          ctx.globalAlpha = FIELD_UNDER_ROUTE;
          drawLayer(tintLayer());
          ctx.globalAlpha = 1 - k;
        }
        if (k < 1) {
          drawLayer(mapLayer());
          drawArrows(unit);
        }
        ctx.restore();
      }
    }
    drawMarks(unit, rv);
  }
  if (cursor && keyboard && document.activeElement === canvas) cross(cursor[0], cursor[1], unit * 4);
  showStages();
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
  ctx.strokeStyle = DARK;
  ctx.lineWidth = unit * 0.3;
  ctx.lineJoin = "miter";
  ctx.beginPath();
  for (const leg of shownLegs(net)) {
    if (leg.join || leg.bridge) continue;
    const dx = leg.b[0] - leg.a[0], dy = leg.b[1] - leg.a[1];
    const len = Math.hypot(dx, dy);
    if (len < unit * ARROW_KEEP) continue;
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

// The reveal (owner, 2026-11-01): a plan opens in the order of the work.
// First the exits that Muse Spark found, one by one; then every way out,
// which grows out from the exits; then the plan asks for the tap. After a
// tap the route draws in from YOU, and the second way out follows it. A tap
// during the reveal ends it. With reduced motion, everything shows at once.
const REVEAL_EXIT = 160;  // ms between two exits
const REVEAL_GROW = 280;  // ms: one exit grows in
const REVEAL_WAYS = 1000; // ms: the ways out grow from the exits to the far rooms
const ROUTE_SPEED = 0.45; // shares of the frame for each second: the route draws in
const ROUTE_MIN = 700, ROUTE_MAX = 1200;  // ms
let reveal = null;     // { t0, waysAt } while the plan opens
let routeAnim = null;  // { t0, ms, start, exit } while the route draws in
// The start dot comes in after a tap: it grows in at the first tap and
// glides from the old start at a new tap; then the route draws in from it
// (owner, 2026-11-02: the start pick must be smooth).
const HERE_MS = 220;
let hereAnim = null;  // { t0, from, to } while the dot comes in
const hereShare = () => (hereAnim && hereAnim.t0 !== null ? easeOut((performance.now() - hereAnim.t0) / HERE_MS) : hereAnim ? 0 : 1);
let frameAsked = false;
const stillMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
const easeInOut = (k) => { k = Math.min(1, Math.max(0, k)); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };

function startReveal() {
  reveal = null;
  // The example opens with its start: it plays the reveal, then draws its route.
  if (stillMotion() || (state.start && !exampleStart()) || state.photo_map || !state.exits.length) return;
  reveal = { t0: performance.now(), waysAt: null };
  animate();
}

function startRouteDraw() {
  routeAnim = null;
  const r = view.route;
  if (stillMotion() || !r || r.points.length < 2) return;
  const len = r.points.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - r.points[i][0], q[1] - r.points[i][1]), 0);
  const [w, h] = frameSize();
  const ms = Math.min(ROUTE_MAX, Math.max(ROUTE_MIN, len / Math.max(w, h) / ROUTE_SPEED * 1000));
  const wait = hereAnim ? HERE_MS * 0.6 : 0;  // the line leaves the dot as it lands
  routeAnim = { t0: null, wait, ms, start: state.start, exit: r.exitIndex };
  afterRoute = null;
  animate();
}

// One frame of the motion, then the next while any motion runs.
function animate() {
  if (frameAsked) return;
  frameAsked = true;
  requestAnimationFrame(() => {
    frameAsked = false;
    if (!state || !view || (!reveal && !routeAnim && !hereAnim && !afterRoute && !tapRing)) return;
    draw();
    showStages();
    if (reveal || routeAnim || hereAnim || afterRoute || tapRing) animate();
  });
}

// What the reveal shows now: a share (0 to 1) for each exit and for the ways
// out, or null when the plan shows everything.
function revealNow() {
  if (!reveal) return null;
  const now = performance.now() - reveal.t0;
  const exits = state.exits.map((_, i) => easeOut((now - i * REVEAL_EXIT) / REVEAL_GROW));
  const exitsDone = (state.exits.length - 1) * REVEAL_EXIT + REVEAL_GROW;
  // The ways out wait for the worker.
  if (reveal.waysAt === null && now >= exitsDone && (!view.reachable || network())) reveal.waysAt = now;
  const ways = reveal.waysAt === null ? 0 : easeOut((now - reveal.waysAt) / REVEAL_WAYS);
  if (ways >= 1 || (reveal.waysAt !== null && !view.reachable)) {
    reveal = null;
    if (state.start) startRouteDraw();  // the example: its route draws in now
    return null;
  }
  return { exits, ways, stage: reveal.waysAt === null ? "exits" : "ways" };
}

// The share of the route that shows: 1 when no route draws in.
function routeDrawn() {
  if (!routeAnim) return 1;
  // update() finds the route again (a new object): the draw goes on while the start and the exit stay.
  if (routeAnim.start !== state.start || !view.route || routeAnim.exit !== view.route.exitIndex) { routeAnim = null; return 1; }
  // The clock starts at the first frame, after the route was found (ux review).
  if (routeAnim.t0 === null) routeAnim.t0 = performance.now() + routeAnim.wait;
  // Ease out: the line leaves the dot at once and slows into the exit.
  const k = easeOut((performance.now() - routeAnim.t0) / routeAnim.ms);
  if (k >= 1) { routeAnim = null; afterRoute = { t0: performance.now() }; return 1; }
  return k;
}

// The second way and the ring round the exit fade in after the route is in,
// so nothing pops in at its end (ux review). 1 when no fade runs.
const AFTER_MS = 200;
let afterRoute = null;  // { t0 } while they fade in
function afterShare() {
  if (!afterRoute) return 1;
  const k = (performance.now() - afterRoute.t0) / AFTER_MS;
  if (k >= 1) { afterRoute = null; return 1; }
  return Math.max(0, k);
}

// The first share of a line of points, by length.
function partOfLine(pts, share) {
  if (share >= 1) return pts;
  const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
  let left = lens.reduce((a, b) => a + b, 0) * share;
  const out = [pts[0]];
  for (let i = 0; i < lens.length; i++) {
    if (left >= lens[i]) { out.push(pts[i + 1]); left -= lens[i]; continue; }
    const k = lens[i] ? left / lens[i] : 0;
    out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]);
    break;
  }
  return out;
}

// The four parts above the plan: what the plan shows now is lit.
const STAGES = ["exits", "ways", "you", "route"];
function showStages() {
  const el = $("stages");
  el.hidden = !state || !!state.photo_map || !state.exits.length;
  if (el.hidden) { $("tap-prompt").hidden = true; return; }
  const rv = reveal && revealNow();
  const now = rv ? rv.stage : !state.start ? "you" : view.route ? "route" : "you";
  const at = STAGES.indexOf(now);
  [...el.children].forEach((li, i) => {
    li.classList.toggle("done", i < at);
    li.classList.toggle("now", i === at);
  });
  // The plan waits for a tap: it says so on the plan, where the eyes are (ux
  // review). One pill for each wait: the start, the exit to mark, and for a
  // while the words of a refused tap.
  const prompt = $("tap-prompt");
  const was = prompt.hidden;
  const note = pillNote && performance.now() < pillNote.until ? pillNote : null;
  // While the reading shows, a tap does not set a start: no pill.
  const words = photoOnly || (typeof readingOn === "function" && readingOn()) ? "" : note ? note.text()
    : marking ? t(addExit ? "msg_mark_tap_add" : "msg_mark_tap")
    : now === "you" && !state.start && view.reachable ? t("tap_prompt") : "";
  prompt.hidden = !words;
  prompt.classList.toggle("note", !!note);
  const span = prompt.querySelector("span");
  const changed = span.textContent !== words;
  if (changed) span.textContent = words;
  if (!prompt.hidden && (was || changed || prompt.dataset.for !== promptKey())) placePrompt();
}

// The place of the tap prompt: the edge of the plan where it covers the
// fewest ways out and no exit (judge review: at the foot of RU-commons_000164
// it hid the ways to Exit 4). The tries go from the foot to the top, the middle first.
const promptKey = () => `${canvas.clientWidth}x${canvas.clientHeight}:${$("stage").scrollLeft},${$("stage").scrollTop}:${!!(view && network())}`;
function placePrompt() {
  const el = $("tap-prompt"), st = $("stage");
  el.dataset.for = promptKey();
  const w = el.offsetWidth, h = el.offsetHeight, m = 16;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch || w + 2 * m > st.clientWidth) { el.style.left = el.style.top = ""; el.classList.remove("placed"); return; }
  // The part of the canvas in view, in the CSS pixels of the stage.
  const vx0 = Math.max(canvas.offsetLeft, st.scrollLeft), vx1 = Math.min(canvas.offsetLeft + cw, st.scrollLeft + st.clientWidth);
  const vy0 = Math.max(canvas.offsetTop, st.scrollTop), vy1 = Math.min(canvas.offsetTop + ch, st.scrollTop + st.clientHeight);
  const xs = [(vx0 + vx1 - w) / 2, vx0 + m, vx1 - w - m], ys = [vy1 - h - m, vy0 + m];
  const tries = ys.flatMap((y) => xs.map((x) => [x, y]));
  // What the prompt would cover: points along the ways out, and the exits.
  const [x0, y0, x1, y1] = shownFrame();
  const toPlan = (x, y) => [x0 + (x - canvas.offsetLeft) / cw * (x1 - x0), y0 + (y - canvas.offsetTop) / ch * (y1 - y0)];
  const net = network();
  const step = frameUnit();
  const pts = [];
  for (const leg of net ? net.legs : []) {
    const n = Math.max(1, Math.ceil(Math.hypot(leg.b[0] - leg.a[0], leg.b[1] - leg.a[1]) / step));
    for (let k = 0; k <= n; k++) pts.push([leg.a[0] + (leg.b[0] - leg.a[0]) * k / n, leg.a[1] + (leg.b[1] - leg.a[1]) * k / n, 1]);
  }
  for (const e of state.exits) pts.push([e.x, e.y, 50]);
  // The pill does not cover the route or the dot.
  if (state.start) pts.push([state.start[0], state.start[1], 80]);
  for (const r of [view.route, view.backup]) {
    const line = r && r.points;
    for (let k = 1; line && k < line.length; k++) {
      const n = Math.max(1, Math.ceil(Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]) / step));
      for (let j = 0; j <= n; j++) pts.push([line[k - 1][0] + (line[k][0] - line[k - 1][0]) * j / n, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * j / n, 5]);
    }
  }
  const cost = ([x, y]) => {
    const [px0, py0] = toPlan(x - 6, y - 6), [px1, py1] = toPlan(x + w + 6, y + h + 6);
    return pts.reduce((a, [px, py, k]) => a + (px >= px0 && px <= px1 && py >= py0 && py <= py1 ? k : 0), 0);
  };
  let best = tries[0], bestCost = Infinity;
  for (const p of tries) {
    const c = cost(p);
    if (c < bestCost) { best = p; bestCost = c; }
    if (!c) break;
  }
  el.classList.add("placed");
  el.style.left = `${Math.round(best[0])}px`;
  el.style.top = `${Math.round(best[1])}px`;
}

function drawMarks(unit, rv = null) {
  // Exit and the start differ in shape (a numbered square, a dot), not only in colour.
  const here = state.start;
  const used = view.route ? view.route.exitIndex : -1;
  // In the reveal each exit grows in after the one before.
  state.exits.forEach((e, i) => {
    const k = rv ? rv.exits[i] : 1;
    if (k > 0) exitMark(e.x, e.y, unit * 2.2 * k, i + 1, i === used, k);
  });
  // With two or more exits the numbers and the legend name them, and a row
  // of "EXIT" words would hide the plan.
  if (state.exits.length === 1) {
    const e = state.exits[0];
    const near = here && Math.hypot(e.x - here[0], e.y - here[1]) < unit * 14;
    label(t("exit_word"), e.x, near ? e.y + unit * 2.2 * 1.8 : e.y - unit * 2.2 * 1.8, unit * 2.2, near ? "top" : "bottom");
  }

  // In the reveal the route and the start wait (the example has a start).
  const draw = rv ? 0 : routeDrawn();
  // The second way out has no line on the plan: the route is the one line
  // (owner, 2026-11-02: "one line moves and reaches the exit"; a dashed
  // line that came out by itself looked like a second line). The card names
  // it, and its button draws it in as the route.

  // The route and the start go over the exits, so a short route stays
  // visible. The route draws in from the start after a tap (routeDrawn).
  // The route is one line of one width and one colour (owner, 2026-11-02:
  // one line moves from the dot and reaches the exit). It draws in from the
  // start with one moving end. From step 2 on, the legs before the current
  // step are walked, so grey (Mappedin, research brief 2); the rest is the
  // same blue line as before.
  const pts = !rv && view.route && view.route.points && partOfLine(view.route.points, draw);
  if (pts && pts.length > 1) {
    const parts = draw === 1 && selected > 0 ? routeParts() : null;
    if (parts && parts.done.length > 1) {
      strokeLine(parts.done, [[DARK, unit * 1.9], [DONE, unit * 1.15]]);
      strokeLine(parts.now.concat(parts.after.slice(1)), ROUTE_LINE(unit));
    } else {
      strokeLine(pts, ROUTE_LINE(unit));
    }
  }

  // The exit in use goes over the route again, so its number shows.
  // Also while the route draws in, so the line never goes over its box (ux review).
  if (used >= 0) exitMark(state.exits[used].x, state.exits[used].y, unit * 2.2, used + 1, true);

  if (rv) return;
  const step = draw === 1 ? view.steps[selected] : null;
  // The last walk ends at the exit: a ring in the route colour round it.
  if (step && step.kind === "walk" && selected === walkCount() - 1 && used >= 0) {
    const e = state.exits[used], r = unit * 2.2 * 1.75;
    ctx.save();
    ctx.globalAlpha = afterShare();
    for (const [color, width] of [[DARK, unit * 1.3], [ROUTE, unit * 0.7]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.roundRect(e.x - r, e.y - r, r * 2, r * 2, r * 0.35);
      ctx.stroke();
    }
    ctx.restore();
  }
  // The start is a location dot, as on a map app, with no text (owner,
  // 2026-11-02: the mark must look natural). The route line and step 1 give
  // the first move: a beam muddied the route (ux review). An exit near the
  // start goes over the dot again, so its number shows.
  if (here) {
    // The dot comes in (hereAnim): it glides from the old start, or grows in.
    let k = 1;
    if (hereAnim && hereAnim.to !== here) hereAnim = null;
    if (hereAnim) {
      if (hereAnim.t0 === null) hereAnim.t0 = performance.now();  // the clock starts at the first frame (ux review)
      k = easeOut((performance.now() - hereAnim.t0) / HERE_MS);
      if (k >= 1) hereAnim = null;
    }
    const from = k < 1 && hereAnim.from;
    const at = from ? [from[0] + (here[0] - from[0]) * k, from[1] + (here[1] - from[1]) * k] : here;
    hereMark(at[0], at[1], unit * 2.4 * (from || k >= 1 ? 1 : 0.5 + 0.5 * k));
    state.exits.forEach((e, i) => {
      if (Math.hypot(e.x - here[0], e.y - here[1]) < unit * 9) exitMark(e.x, e.y, unit * 2.2, i + 1, i === used);
    });
  }
  tapRingMark(unit);
}

// The layers of the route line: glow, dark edge, blue, light core.
const ROUTE_LINE = (unit) => [[ROUTE_GLOW, unit * 3.4], [DARK, unit * 1.9], [ROUTE, unit * 1.25], [ROUTE_CORE, unit * 0.3]];

function strokeLine(pts, layers) {
  if (!pts || pts.length < 2) return;
  ctx.lineJoin = ctx.lineCap = "round";
  for (const [color, width] of layers) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }
}

// The route in three parts at the current step, from the paths of the steps
// (route.js directions): the walks before it, the step, the walks after it.
// null with no walk.
function routeParts() {
  const steps = view.steps, k = Math.max(0, selected);
  if (!steps[k] || steps[k].kind !== "walk") return null;
  const join = (paths) => paths.reduce((a, p) => a.concat(a.length ? p.slice(1) : p), []);
  const walks = steps.map((s, j) => [s, j]).filter(([s]) => s.kind === "walk");
  return { done: join(walks.filter(([, j]) => j < k).map(([s]) => s.path)),
           now: steps[k].path,
           after: join(walks.filter(([, j]) => j > k).map(([s]) => s.path)) };
}

// The ring at a refused tap: it grows and fades out.
function tapRingMark(unit) {
  if (!tapRing) return;
  const k = (performance.now() - tapRing.t0) / RING_MS;
  if (k >= 1) { tapRing = null; return; }
  ctx.save();
  ctx.globalAlpha = 1 - k;
  for (const [color, width] of [[DARK, unit * 0.9], ["#ffffff", unit * 0.45]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(tapRing.at[0], tapRing.at[1], unit * (1.5 + 2.5 * easeOut(k)), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// The start: a blue dot with a white rim in a soft halo, as on a map app.
function hereMark(x, y, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
  ctx.fillStyle = HERE_HALO;
  ctx.fill();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = r * ctx.getTransform().a * 0.6;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.15, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
  ctx.fillStyle = HERE;
  ctx.fill();
}

// The number matches the exit buttons below the plan. The exit the route
// goes to has a frame in the route colour. A mark glows; k (the reveal)
// makes the glow stronger while the mark grows in.
function exitMark(x, y, r, n, used, k = 1) {
  const px = ctx.getTransform().a;  // canvas pixels for each photo pixel: the blur is in canvas pixels
  const corner = r * 0.3;
  const box = () => { ctx.beginPath(); ctx.roundRect(x - r, y - r, r * 2, r * 2, corner); };
  ctx.save();
  ctx.shadowColor = EXIT_GLOW;
  ctx.shadowBlur = r * px * (k < 1 ? 2.4 - k : 1.1);
  ctx.fillStyle = EXIT;
  box();
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = used ? r / 1.6 : r / 4;
  ctx.strokeStyle = used ? ROUTE : DARK;
  box();
  ctx.stroke();
  if (state.exits.length < 2) return;
  ctx.font = `600 ${Math.round(r * (n > 9 ? 1.1 : 1.35))}px "Geist Mono", ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = EXIT_INK;
  ctx.fillText(String(n), x, y + r * 0.08);
}

function label(text, x, y, r, baseline, align = "center") {
  ctx.font = `600 ${Math.round(r * 1.6)}px Geist, system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineWidth = r / 1.5;
  ctx.lineJoin = "round";
  ctx.strokeStyle = DARK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#ffffff";
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

// Turn icons (DESIGN.md): one outline glyph for each kind of step, left of
// its text in the step list and in the card of the current step.
const SVG_NS = "http://www.w3.org/2000/svg";
const TURN_PATHS = {
  straight: ["M12 20V5", "m6 11 6-6 6 6"],
  left: ["M17 20v-7a3 3 0 0 0-3-3H6", "m10 6-4 4 4 4"],
  right: ["M7 20v-7a3 3 0 0 1 3-3h8", "m14 6 4 4-4 4"],
  "slight left": ["M16 21v-7.5L8 6", "M8 12V6h6"],
  "slight right": ["M8 21v-7.5L16 6", "M10 6h6v6"],
  back: ["M16 20V10a4 4 0 0 0-8 0v6", "m5 13 3 3 3-3"],
  arrive: ["M3 21h18", "M5 21V5a2 2 0 0 1 2-2h7.5", "M17 13.5V21", "M14 7h7m-3-3 3 3-3 3"],
  // A side step, then straight on: the line jogs to that side (judge review).
  "aside left": ["M16 21v-5l-8-5V4", "m4 8 4-4 4 4"],
  "aside right": ["M8 21v-5l8-5V4", "m12 8 4-4 4 4"],
};
// The first step names a side of the plan, not a turn: its arrow points to that side.
const SIDE_ANGLE = { top: 0, "top right": 45, right: 90, "bottom right": 135, bottom: 180, "bottom left": 225, left: 270, "top left": 315 };

// The glyph of a step. A turn keeps its turn glyph when it has a side step
// too: the turn is the larger move. A step that only steps aside and goes on
// (the first step too) gets the jog to its side.
function turnKind(step, i) {
  if (step.kind === "arrive") return "arrive";
  const key = step.say && step.say.key;
  if ((key === "straight_aside" || key === "start_aside") && (step.aside === "left" || step.aside === "right")) return `aside ${step.aside}`;
  return i === 0 ? "straight" : step.turn;
}

function turnIcon(step, i) {
  const kind = turnKind(step, i);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", kind === "arrive" ? "turn door" : "turn");
  const g = document.createElementNS(SVG_NS, "g");
  const side = i === 0 && step.say ? SIDE_ANGLE[step.say.side] : undefined;
  if (side) g.setAttribute("transform", `rotate(${side} 12 12)`);
  for (const d of TURN_PATHS[kind] || TURN_PATHS.straight) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    g.append(path);
  }
  svg.append(g);
  return svg;
}

function stepRow(s, i, text = stepText(s)) {
  const span = document.createElement("span");
  span.textContent = text;
  return [turnIcon(s, i), span];
}

// The steps are the walks of the route (judge review). The last item of
// route.js, "Then you reach the exit.", is no step of its own: the list shows
// it with no number after the walks, and the card adds it to the last walk.
const walkCount = () => (view ? view.steps.filter((s) => s.kind === "walk").length : 0);
function walkText(i) {
  const s = view.steps[i];
  const end = i === walkCount() - 1 && view.steps.find((x) => x.kind === "arrive");
  return end ? I.join([stepText(s), stepText(end)]) : stepText(s);
}

// With a route, step 1 is the current step: the card under the plan shows
// it, and the plan lights its leg once the route has drawn in.
function showSteps() {
  const list = $("steps");
  list.replaceChildren();
  selected = view.route && walkCount() ? 0 : -1;
  view.steps.forEach((s, i) => {
    const li = document.createElement("li");
    if (s.kind === "walk") {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "step";
      b.append(...stepRow(s, i));
      b.setAttribute("aria-pressed", String(i === selected));
      b.addEventListener("click", () => select(i));
      li.append(b);
    } else {
      li.className = "arrive";
      li.append(...stepRow(s, i));
    }
    list.append(li);
  });
  if (view.pending) {
    const li = document.createElement("li");
    li.textContent = finding();
    list.append(li);
  }
  const none = view.steps.length === 0;
  $("steps-head").hidden = $("steps-hint").hidden = none && !view.pending;
  // The hint keeps its space while the route is found, so the list does not move.
  $("steps-hint").style.visibility = view.pending ? "hidden" : "";
  $("speak").hidden = none || !canSpeak;
  stopSpeaking();
}

// The card of the current step under the plan (DESIGN.md "Current step"):
// the exit, "step 2 of 5", the turn and the words of the step, with buttons
// for the step before and after it. The plan lights the same step.
function showNow() {
  const card = $("now-card");
  const n = walkCount();
  const on = !!(state && view && view.route && state.start && n && !state.photo_map && !marking);
  card.hidden = !on;
  if (!on) return;
  const i = Math.min(n - 1, Math.max(0, selected)), s = view.steps[i];
  const exit = view.route.exitIndex + 1;
  $("now-num").textContent = String(exit);
  $("now-head").textContent = `${t("exit_n", { n: exit })} · ${t("step_of", { i: i + 1, count: n })}`;
  const text = $("now-text");
  text.replaceChildren(...stepRow(s, i, walkText(i)));
  // At either end the button keeps its place, so the card does not move.
  // At the last walk the exit door takes the place of "Next".
  $("step-prev").classList.toggle("gone", i === 0);
  $("step-next").hidden = i === n - 1;
  $("now-end").hidden = i !== n - 1;
  for (const id of ["step-prev", "step-next", "now-speak"]) $(id).title = $(id).getAttribute("aria-label");
  $("now-speak").hidden = !canSpeak;
  stickNow();
}

// The step before or after the current one. The new step goes to the live
// line of the plan once. The focus stays on the button. At either end it goes
// to the words of the step (a11y review): a held Enter then stops there, and
// does not move on with the other button.
function stepBy(d) {
  const n = walkCount();
  if (!n) return;
  const i = Math.min(n - 1, Math.max(0, Math.max(0, selected) + d));
  const mine = $(d < 0 ? "step-prev" : "step-next");
  const had = document.activeElement === mine;
  select(i);
  $("marker-status").textContent = t("step_said", { i: i + 1, count: n, text: walkText(i) });
  if (had && (i === 0 || i === n - 1)) $("now-text").focus();
}
$("step-prev").addEventListener("click", () => stepBy(-1));
$("step-next").addEventListener("click", () => stepBy(1));

// The card sticks to the foot of the screen only while it takes at most 40 %
// of the screen (a11y review: at 200 % zoom it covered the plan), and not
// while the plan has the keyboard focus: then the cross can be under it.
function stickNow() {
  const card = $("now-card");
  if (card.hidden) return;
  const keys = document.activeElement === canvas && canvas.matches(":focus-visible");
  card.classList.toggle("loose", card.offsetHeight > window.innerHeight * 0.4 || keys);
}
window.addEventListener("resize", stickNow);

// After a tap the plan and the current step come into view together. The
// page scrolls only as far as it must, and it stops at an edge: the header,
// the strip of stages and the view buttons show whole or not at all, and the
// top of the plan stays in view. On a wide screen the steps are beside the
// plan, so only the plan must be in view.
function showNowInView() {
  const card = $("now-card");
  const stage = $("stage").getBoundingClientRect();
  const bar = $("upload-bar");
  const room = window.innerHeight - (bar.classList.contains("float") ? bar.offsetHeight : 0);
  const withCard = !card.hidden && getComputedStyle(card).display !== "none";
  // The card can stick to the foot of the screen: measure its own place under the plan.
  const bottom = withCard ? stage.bottom + parseFloat(getComputedStyle(card).marginTop) + card.offsetHeight : stage.bottom;
  const need = bottom + 8 - room;
  if (need <= 4) return;
  // The gaps between the parts above the plan, where the edge of the screen can stop.
  const box = (el) => (el && !el.hidden && el.offsetHeight ? el.getBoundingClientRect() : null);
  const parts = [box(document.querySelector("header.top")), box($("stages")), box(document.querySelector(".view"))].filter(Boolean);
  const gaps = [];
  let from = -Infinity;
  for (const r of parts) { gaps.push([from, r.top]); from = r.bottom; }
  gaps.push([from, stage.top]);
  const fit = gaps.map(([a, b]) => (need <= b ? Math.max(a, need) : null)).find((v) => v !== null);
  const by = Math.min(fit ?? stage.top, stage.top);
  if (by > 4) window.scrollBy({ top: by, behavior: smoothScroll() });
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

// Show one step on the plan. -1 shows none.
function select(i) {
  routeAnim = afterRoute = null;  // a step chosen during the draw-in: the route shows whole (ux review)
  clearRefusal();
  selected = Math.min(i, walkCount() - 1);
  i = selected;
  $("steps").querySelectorAll("button.step").forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
  if (photoOnly) setPhotoOnly(false);
  draw();
  showNow();
  const step = view.steps[i];
  if (!step || step.kind !== "walk") return;
  const mid = pathMiddle(step.path);
  scrollToPoint(mid);
  // On a phone the plan is above the steps: bring the leg into the window.
  const y = canvas.getBoundingClientRect().top + toCanvasCss(mid)[1];
  if (y < 0 || y > window.innerHeight) $("stage").scrollIntoView({ block: "nearest", behavior: smoothScroll() });
}

// Model labels are often all "Exit", so the number tells the exits apart.
// In another language the label is its translation, once it has come (loadWords).
function exitName(i) {
  const label = exitLabel(i);
  if (label) return t("exit_n_label", { n: i + 1, label });
  const l = (state.exits[i].label || "").trim();
  const words = wordsIn(lang);
  // A label that already has the number ("Exit 4") needs it only once.
  return l && new RegExp(`\\bexit\\s*${i + 1}\\b`, "i").test(l) ? (words && words.labels && words.labels[l]) || l : t("exit_n", { n: i + 1 });
}

// A number at the start of a label is the plan's own exit number ("4" in
// "4 To street level"). Beside the number of the page it reads as a second
// number ("Exit 1: 4 To street level"), so the name leaves it out. When two
// names would then be the same, the plan's number stays, set apart: "4 · To
// street level" (ux review: in a station the signs carry that number).
const LEAD_NUMBER = /^\s*(?:№|no\.?|#)?\s*(\p{Nd}+)[.):]?\s+(?=\p{L})/iu;
function shownLabel(i) {
  const l = (state.exits[i].label || "").trim();
  const words = wordsIn(lang);
  return (words && words.labels && words.labels[l]) || l;
}
function withoutNumber(i) {
  const shown = shownLabel(i);
  const m = shown.match(LEAD_NUMBER);
  if (!m) return shown;
  const rest = shown.slice(m[0].length);
  const same = state.exits.some((e, j) => j !== i && shownLabel(j).replace(LEAD_NUMBER, "") === rest);
  return same && Number(m[1]) !== i + 1 ? `${m[1]} · ${rest}` : rest;
}

// The label of exit i that its name shows after the number ("ВЫХОД" in
// "Exit 4: ВЫХОД"), in the language when it has come; "" when the name is
// only the number, or the label already has the number.
function exitLabel(i) {
  const l = (state.exits[i].label || "").trim();
  if (!l || /^exit$/i.test(l)) return "";
  const shown = withoutNumber(i);
  // A label that only says "exit" in the language ("ВЫХОД" in Korean) is the plain name too.
  const bare = (s) => s.trim().toLocaleLowerCase();
  if (shown !== l && [t("exit_word"), t("exit_n", { n: "" })].some((w) => bare(w) === bare(shown))) return "";
  return new RegExp(`\\bexit\\s*${i + 1}\\b`, "i").test(l) ? "" : shown;
}

// One button for each exit, in number order, so the route can go to another
// exit without placing marks on the picture. The list does not move when the
// route changes. The nearest exit and the exit of the second way say so.
function showExits() {
  const box = $("exits");
  box.replaceChildren();
  const current = view.route ? view.route.exitIndex : state.exitChoice;
  // A start that reaches no exit gets the message, not a list of dead buttons.
  const open = state.start ? state.exits.map((e, i) => view.field.reaches(state.start, i)) : [];
  $("exits-wrap").hidden = state.exits.length < 2 || !open.some(Boolean);
  $("exits-note").hidden = !open.some((o) => !o);
  if ($("exits-wrap").hidden) return;
  const near = view.near;
  state.exits.forEach((e, i) => {
    const b = document.createElement("button");
    b.type = "button";
    // The number, as on the plan. The name is in the label and the tooltip.
    const num = document.createElement("span");
    num.textContent = String(i + 1);
    b.append(num);
    const tag = !near || !open[i] ? "" : i === near.main ? "near" : i === near.backup ? "second" : "";
    if (tag) {
      b.dataset.tag = tag;
      b.classList.add("tagged");
      const word = document.createElement("span");
      word.className = "tag";
      word.textContent = t(`exit_tag_${tag}`);
      b.append(word);
    }
    b.classList.toggle("dead", !open[i]);
    nameExitButton(b, i);
    b.setAttribute("aria-pressed", String(i === current));
    b.addEventListener("click", () => chooseExit(i, "button"));
    box.append(b);
  });
}

// The name of an exit button. A button with a word ("4 Nearest") has the
// visible words first and together, then the label: "Exit 4, Nearest: ВЫХОД"
// (a11y review, WCAG 2.5.3).
function nameExitButton(b, i) {
  const name = b.classList.contains("dead") ? t("exit_dead", { exit: exitName(i) }) : exitName(i);
  const tag = b.dataset.tag && t(`exit_tag_${b.dataset.tag}`);
  const label = tag ? exitLabel(i) : "";
  b.title = !tag ? name : label ? t("exit_n_tag_label", { n: i + 1, tag, label }) : t("exit_tagged", { exit: name, tag });
  b.setAttribute("aria-label", b.title);
}

// The route to exit i, from its exit button ("button") or from a tap on its
// mark ("plan").
function chooseExit(i, from) {
  // The nearest exit is no choice: the answer keeps "Nearest exit" (ux review).
  state.exitChoice = view.near && view.near.main === i ? -1 : i;
  update();
  remember();
  if (view.pending) {
    view.pendingHow = "exit-button";
    sayPlan(finding);
    if (from === "button") $("exits").children[i].focus();
    return;
  }
  sayPlan(view.route ? () => I.join([t("msg_route_to", { exit: exitName(i) }), otherWay(), t("msg_check")])
                     : () => t("msg_no_way_to", { exit: exitName(i) }));
  // A tap on the plan keeps the focus there; the card shows the new first step.
  if (from === "plan") { if (view.route) { startRouteDraw(); showNowInView(); } return; }
  if (!view.route) { $("exits").children[i].focus(); return; }
  startRouteDraw();
  // On a narrow screen the plan with the new route and the card of the step
  // come into view, and "Next" in the card takes the focus: the step list is
  // far below (a11y review). On a wide screen the steps are beside the plan.
  if (narrow() && !$("now-card").hidden) {
    ($("stages").hidden ? document.querySelector(".view") : $("stages")).scrollIntoView({ block: "start" });
    showNowInView();
    const next = $("step-next");
    (next.hidden ? $("now-text") : next).focus({ preventScroll: true });
    return;
  }
  $("steps").focus({ preventScroll: narrow() });
}

// A tap on an exit mark while a route shows: the route goes to that exit, as
// its exit button does. A tap anywhere else is a start, as before.
// perCss: photo pixels for each CSS pixel of the canvas.
function pickedExit(x, y, perCss) {
  if (!state || !state.start || !view || !view.route || view.pending || marking || state.photo_map || photoOnly) return -1;
  if (state.exits.length < 2 || (typeof readingOn === "function" && readingOn())) return -1;
  const unit = frameUnit(), used = view.route.exitIndex;
  const reach = Math.max(unit * 2.2 * 1.25, 16 * perCss);
  let best = -1, bestD = reach;
  state.exits.forEach((e, i) => {
    const d = Math.hypot(e.x - x, e.y - y);
    if (i !== used && d < bestD) { best = i; bestD = d; }
  });
  return best;
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
  const changes = [...(c.changes || []), ...(state.photo_map ? ["exit marks drawn on top"] : ["dimmed", "marks, ways out and route drawn on top"])].join(", ");
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
  $("answer-kind").textContent = t(state.exits[i].marked ? "kind_marked"
    : state.exitChoice >= 0 ? "kind_chosen" : "kind_nearest");
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
  // With no start, the status line gives the same instruction. A photo map
  // takes no start, so it never shows the tap hint.
  $("tap-text").hidden = !state.start || marking || !!state.photo_map;
  showLegend();
  showStages();
  showNow();
}

function showLegend() {
  const map = showMap && view.reachable;
  // In Photo only the legend keeps its space, so the text under the plan does not move.
  $("legend").hidden = false;
  $("legend").style.visibility = photoOnly ? "hidden" : "";
  // With a route the way lines go (the legend no longer names them, a11y
  // review, 2026-11-02) and the field is faint (FIELD_UNDER_ROUTE).
  $("legend-way").hidden = !map || !!(view.route && state.start);
  $("legend-field").hidden = !map;  // the soft field stays under a route (a11y review)
  // The ways out show once the worker has made them. The item keeps its
  // space, so the text under the plan does not move when they come.
  $("legend-way").style.visibility = view.field.waitForNetwork && !view.field._network ? "hidden" : "";
  $("legend-wall").hidden = !routesOnly;
  // The start dot has no text on the plan: the legend names it (a11y review).
  $("legend-you").hidden = !state.start;
  // The item keeps its space while two exits can give a second way, so the
  // text under the plan does not move after a tap.
}

// The walls come from the photo, so the messages say what HereOut read,
// not what the building is.
const ROUTE_ERRORS = {
  "start is inside a wall": () => t("err_wall"),
  "no open way to an exit": () => t("err_no_way"),
  "every exit is inside a wall": () => t("err_exits_wall", { fix: t("fix") }),
};
// A sheet can show several floors, and the model can miss the exits of one.
// The exit marked after this message is added to the others.
const NO_EXIT_HERE = () => t("msg_no_exit_here", { fix: t("fix") });
// Walls found in an aerial photo are roofs and trees (photo_map.py). The
// exits are only marks on the photo, so the text names them.
function photoMapText() {
  const n = state.exits.length;
  const names = state.exits.map((e, i) => exitName(i)).join(", ");
  return I.join([t(n === 1 ? "photo_map_one" : "photo_map_many", { n, names }), t("photo_map_follow", { enlarge: t("enlarge") })]);
}

// how: "tap" (a start the user chose) or "exit" (an exit the user marked).
function explain(how = "tap") {
  addExit = false;
  // Each message is a function: a change of language says it again (sayPlan).
  if (!state.exits.length) {
    const key = state.model_error ? "msg_unread" : "msg_no_exit";
    sayPlan(() => t(key, { fix: t("fix") }));
  } else if (state.photo_map) {
    sayPlan(photoMapText);
  } else if (!state.start && how === "exit") {
    const key = view.reachable ? "msg_exit_marked" : "msg_exit_wall";
    sayPlan(() => t(key));
  } else if (!state.start) {
    // A sample is not where the user stands: its own mark is the natural start.
    const key = state.credit ? "msg_tap_sample" : "msg_tap";
    sayPlan(() => t(key));
  } else if (view.pending) {
    view.pendingHow = how;
    sayPlan(finding);
  } else if (view.error && state.exitChoice >= 0) {
    const i = state.exitChoice;
    sayPlan(() => t("msg_no_way_to", { exit: exitName(i) }));
  } else if (view.error && how === "exit") {
    const key = state.foundExits.length ? "msg_no_way_marked_found" : "msg_no_way_marked";
    sayPlan(() => t(key));
  } else if (view.error === "no open way to an exit" && view.field.areaShare(state.start) >= FLOOR_SHARE) {
    sayPlan(NO_EXIT_HERE);
    addExit = true;
    return;
  } else if (view.error) {
    sayPlan(ROUTE_ERRORS[view.error] || (() => t("err_other")));
  } else if (state.exits[view.route.exitIndex].marked) {
    sayPlan(() => I.join([t("msg_route_marked"), t("msg_check")]));
  } else if (state.exitChoice >= 0) {
    const i = state.exitChoice;
    sayPlan(() => I.join([t("msg_route_to", { exit: exitName(i) }), otherWay(), t("msg_check")]));
  } else if (exampleStart()) {
    const i = view.route.exitIndex;
    sayPlan(() => I.join([t("msg_example", { exit: exitName(i) }), otherWay(), t("msg_tap_other")]));
  } else {
    const i = view.route.exitIndex;
    sayPlan(() => I.join([t("msg_route_nearest", { exit: exitName(i) }), otherWay(), t("msg_check")]));
  }
}

// The second way out, as words for the status line.
function otherWay() {
  if (!view || !view.backup) return "";
  return backupText();
}

// The words of the second way out (it has no line on the plan). After the
// user chose an exit, the second way can lead to the nearest exit: then it
// says so, as its exit button does ("Nearest"), and not "if it is blocked"
// (judge review).
function backupText() {
  const i = view.backup.exitIndex;
  const nearest = state.exitChoice >= 0 && view.near && view.near.main === i;
  const key = nearest ? "backup_nearest_plain" : "backup_plain";
  return t(key, { exit: exitName(i) });
}

// The second way out under the steps too, where the eyes are after a tap
// or after an exit button, with a button that shows its route.
function showBackup() {
  const b = view.backup;
  $("backup").hidden = !b || !view.route;
  if ($("backup").hidden) return;
  $("backup-text").textContent = backupText();
  $("backup-go").textContent = t("route_to_n", { n: b.exitIndex + 1 });
}

// The three views are one choice (ux review): exactly one button is pressed.
// The reading view (reading.js) is a fourth view: then none is pressed.
const VIEW_BUTTONS = { map: "show-map", photo: "show-photo", routes: "show-routes" };
function pressView() {
  const off = typeof readingOn === "function" && readingOn();
  for (const [mode, id] of Object.entries(VIEW_BUTTONS)) $(id).setAttribute("aria-pressed", String(!off && mode === viewMode));
}

function setView(mode) {
  clearRefusal();
  viewMode = mode;
  if (mode !== "photo") marksMode = mode;
  photoOnly = mode === "photo";
  routesOnly = mode === "routes";
  pressView();
  showLegend();
  draw();
  showStages();
  if (view && view.backup) showBackup();
}

// A step, a tap or a mark needs the marks: Photo only goes back to the view before it.
function setPhotoOnly(on) {
  setView(on ? "photo" : marksMode);
}

for (const [mode, id] of Object.entries(VIEW_BUTTONS)) $(id).addEventListener("click", () => setView(mode));

function startMarking() {
  clearRefusal();
  marking = true;
  $("fix-text").textContent = t("fix_cancel");
  $("fix-hint").textContent = t(addExit ? "fix_hint_add" : "fix_hint");
  $("fix-hint").hidden = false;
  $("tap-text").hidden = true;
  hints();
  if (photoOnly) setPhotoOnly(false);
  const key = addExit ? "msg_mark_tap_add" : "msg_mark_tap";
  sayPlan(() => t(key));
  // The pill on the plan asks for the exit; the line says it to a screen
  // reader only, so the words show once (ux review).
  $("plan-status").classList.add("sr");
  showNow();
  showStages();
}

function stopMarking() {
  marking = false;
  $("fix-text").textContent = t("fix");
  $("fix-hint").hidden = true;
  if (state) $("tap-text").hidden = !state.start;
  hints();
  if (state && view) { showAnswer(); showNow(); showStages(); }
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
  if (view.route && state.start) startRouteDraw();
  remember();
  explain("exit");
}

function setStart(x, y) {
  const cardWas = !$("now-card").hidden;
  const from = state.start;
  state.start = [Math.round(x), Math.round(y)];
  hereAnim = stillMotion() ? null : { t0: null, from, to: state.start };
  state.exitChoice = -1;
  if (photoOnly) setPhotoOnly(false);
  reveal = null;  // a tap ends the reveal
  update();
  startRouteDraw();
  if (hereAnim) animate();
  remember();
  explain("tap");
  // The plan stays under the finger at a new tap: only a card that comes new
  // brings itself into view (ux review).
  if (!cardWas) showNowInView();
}

// A tap off the floor drawing gives no route. The tap says "I am here", so
// the old start and its route go too: a route from the old spot left on the
// plan looked as if the tap did nothing (judge review, 2026-11-02). A tap
// on a wall or on ink next to open floor starts on that floor (route.js
// Field.tapStart). The keyboard marker follows the same rules.
const tapText = () => t("tap_hint");
let tapSaid = tapText;  // the text under the plan, as a function (sayPlan)
// A tap reaches floor a fingertip away on the screen (ux review, 2026-11-02:
// a tap 19 CSS px from a corridor gave no route).
const TAP_FINGER_CSS = 24;
function fingerReach() {
  const fr = shownFrame();
  return canvas.clientWidth ? TAP_FINGER_CSS * (fr[2] - fr[0]) / canvas.clientWidth : 0;
}
function startFromTap(x, y) {
  const t = view.field.tapStart([x, y], fingerReach());
  // Off the plan and on a wall give the same words (ux review): the edge
  // between the two does not show on the plan.
  if (t.at === "outside" || t.at === "wall") { refuseTap(ROUTE_ERRORS["start is inside a wall"], [x, y], dropStart()); return; }
  // A large floor with no exit is another floor of the sheet: the start
  // stays there, and the plan asks for the exit of that floor (explain,
  // NO_EXIT_HERE). A small closed area gives no start (ux review).
  if (t.at === "noway" && view.field.areaShare(view.field.toPx(t.cell)) < FLOOR_SHARE) { refuseTap(ROUTE_ERRORS["no open way to an exit"], [x, y], dropStart()); return; }
  if (t.at === "moved" || t.at === "noway") [x, y] = view.field.toPx(t.cell);
  setStart(x, y);
}

// True when a start and its route went.
function dropStart() {
  if (!state.start) return false;
  state.start = null;
  state.exitChoice = -1;
  hereAnim = routeAnim = null;
  reveal = null;
  update();
  remember();
  return true;
}

// The message goes under the plan, where the eyes are after a tap, and to
// the live status line (in the answer card) for a screen reader. The card
// line stays hidden then, so the message shows once.
// The plan also shows the words for a while in the pill on the plan, and a
// ring fades out at the tap: on a phone the line under the plan can be below
// the screen (ux review, 2026-11-02).
const NOTE_MS = 3500, RING_MS = 600;
let pillNote = null;  // { text, until } while the pill shows a refusal
let tapRing = null;   // { at, t0 } while the ring at a refused tap fades
// dropped: the tap removed a start and its route. The live line says so too,
// for a screen reader (a11y review); the plan shows the route go.
function refuseTap(text, at = null, dropped = false) {
  pillNote = { text, until: performance.now() + NOTE_MS };
  tapRing = at && !stillMotion() ? { at, t0: performance.now() } : null;
  clearTimeout(refuseTap.timer);
  // With no start left, the page then asks for a tap again, in the card too
  // (ux review: on a wide screen the card kept only "Mark the exit").
  refuseTap.timer = setTimeout(() => {
    if (!state) return;
    if (!state.start && !marking) clearRefusal();
    showStages();
  }, NOTE_MS + 50);
  showStages();
  if (tapRing) animate();
  tapSaid = text;
  $("tap-text").textContent = text();
  $("tap-text").hidden = false;
  $("tap-hint").classList.add("refused");
  $("plan-status").classList.add("sr");
  sayPlan(dropped ? () => I.join([text(), t("route_cleared")]) : text);
}

function clearRefusal() {
  pillNote = tapRing = null;
  if (!$("tap-hint").classList.contains("refused")) return;
  $("tap-hint").classList.remove("refused");
  tapSaid = tapText;
  $("tap-text").textContent = tapText();
  $("tap-text").hidden = !state || !state.start || marking || !!state.photo_map;
  if (view) showAnswer();
  // The refusal leaves the live line; with no start it asks for a tap again (a11y review).
  if (state && view && !state.start) explain();
}

function place(x, y) {
  if (marking) setExit(x, y);
  else if (state.photo_map && state.exits.length) sayPlan(photoMapText);
  else if (state.exits.length) startFromTap(x, y);
  else sayPlan(() => t("msg_mark_first", { fix: t("fix") }));
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
    $("kbd-hint").textContent = t("kbd_map");
    canvas.setAttribute("aria-label", t("plan_label_map"));
    return;
  }
  $("kbd-hint").textContent = t(marking ? "kbd_mark" : "kbd_start");
  canvas.setAttribute("aria-label", t(marking ? "plan_label_mark" : "plan_label"));
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
    // Its views are the photo with the exit marks ("Escape map") and Photo only.
    const map = !!state.photo_map;
    if (map && viewMode === "routes") { viewMode = marksMode = "map"; routesOnly = false; }
    pressView();
    $("show-routes").hidden = $("fix").hidden = $("legend-route").hidden = map;
    hints();
    $("result").hidden = false;
    layout();
    buildField();
    showCredit();
    if (typeof showReading === "function") showReading();  // reading.js
    startReveal();
    update();
    explain();
    showWords();
    loadWords();
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
  // The videos of the start page must not play on, hidden, under a plan.
  if (!$("result").hidden) for (const v of document.querySelectorAll("#demo video, #hero-loop")) v.pause();
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
// The focus frame of the plan shows after Tab, Enter or Space (a11y review:
// also Enter alone), not after an arrow key that scrolls (ux review).
addEventListener("keydown", (ev) => { if (ev.key === "Tab" || ev.key === "Enter" || ev.key === " ") document.documentElement.classList.add("kbd"); }, true);
addEventListener("pointerdown", () => document.documentElement.classList.remove("kbd"), true);

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
const GALLERY_FIRST = matchMedia("(min-width: 960px)").matches ? 12 : 8;
const GALLERY_BATCH = 24;  // each chevron opens this many more
const GALLERY_PEEK = matchMedia("(min-width: 960px)").matches ? 6 : 2;  // the faded row under them (house rule: more is a peek)
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

// The phone of the hero plays only while it is on the screen. With reduced
// motion it shows its first frame (the poster) until the user plays it. The
// button beside it pauses and plays it (WCAG 2.2.2: motion of more than 5 s).
function setUpLoop() {
  const v = $("hero-loop"), btn = $("loop-toggle");
  if (!v || !btn) return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  let seen = false, wanted = !calm.matches;
  const run = () => {
    if (seen && wanted && !document.documentElement.classList.contains("has-plan")) v.play().catch(() => {});
    else v.pause();
    btn.dataset.playing = String(wanted);
    btn.setAttribute("aria-label", wanted ? "Pause the animation" : "Play the animation");
  };
  new IntersectionObserver((es) => { seen = es[es.length - 1].isIntersecting; run(); }, { threshold: 0.2 }).observe(v);
  calm.addEventListener("change", () => { wanted = !calm.matches; run(); });
  btn.addEventListener("click", () => { wanted = !wanted; run(); });
  run();
}
setUpLoop();

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

// Under the photo button: a few sample plans whose exits are right, for a
// visitor with no plan at hand. Each one opens in one tap, like a gallery tile.
// The row is in the page (index.html), so nothing moves when the gallery comes
// (a11y review: layout shift). A plan that the gallery does not have goes.
for (const b of $("try-list").querySelectorAll("button.sample")) b.addEventListener("click", () => openSample(b.dataset.id, true));
function showTry(plans) {
  for (const b of $("try-list").querySelectorAll("button.sample")) if (!plans.some((p) => p.id === b.dataset.id)) b.parentElement.remove();
  if (!$("try-list").children.length || SET) $("try").hidden = true;
}

async function showGallery() {
  let plans = [];
  try {
    const r = await fetch(`/api/gallery${SET}`);
    if (r.ok) plans = (await r.json()).plans;
  } catch (e) { /* no gallery: the parts that show it go */ }
  if (!plans.length) { $("try").hidden = $("nav-samples").hidden = true; return; }
  const grid = $("gallery");
  let shown = GALLERY_FIRST;
  const render = () => {
    grid.replaceChildren();
    const all = shown >= plans.length;
    const peek = all ? 0 : Math.min(GALLERY_PEEK, plans.length - shown);
    plans.slice(0, shown + peek).forEach((p, i) => {
      const li = document.createElement("li");
      // The faded row only shows that more plans follow: the chevron opens them.
      if (i >= shown) { li.className = "peek"; li.inert = true; li.setAttribute("aria-hidden", "true"); }
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
    $("gallery-more").hidden = all;
    $("gallery-more").setAttribute("aria-label", `Show ${Math.min(GALLERY_BATCH, plans.length - shown)} more plans`);
    markOpenSample();
  };
  // "XX" marks photos whose country is not known.
  const countries = String(new Set(plans.map((p) => p.country).filter((c) => c !== "XX")).size);
  $("gallery-count").textContent = $("proof-plans").textContent = String(plans.length);
  $("gallery-countries").textContent = $("proof-countries").textContent = countries;
  $("proof").hidden = false;
  showTry(plans);
  $("gallery-more").addEventListener("click", () => {
    const first = shown;
    shown = Math.min(plans.length, shown + GALLERY_BATCH);
    render();
    grid.children[first]?.querySelector("button").focus();
  });
  render();
  $("gallery-wrap").hidden = $("nav-samples").hidden = false;
}
showGallery();

canvas.addEventListener("click", (ev) => {
  if (!state) return;
  const box = canvas.getBoundingClientRect();
  const [x0, y0, x1, y1] = shownFrame();
  const x = x0 + (ev.clientX - box.left) * ((x1 - x0) / box.width);
  const y = y0 + (ev.clientY - box.top) * ((y1 - y0) / box.height);
  const k = pickedExit(x, y, (x1 - x0) / box.width);
  if (k >= 0) { clearRefusal(); chooseExit(k, "plan"); return; }
  place(x, y);
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
    // The cross stays in the window: on a short screen the plan is taller than it.
    const cy = canvas.getBoundingClientRect().top + toCanvasCss(cursor)[1];
    const pad = 40;
    if (cy < pad || cy > window.innerHeight - pad) window.scrollBy({ top: cy < pad ? cy - pad : cy - window.innerHeight + pad });
    sayMarker();
  } else if (ev.key === "Enter" || ev.key === " ") {
    keyboard = true;
    place(cursor[0], cursor[1]);
    if (state.start && !marking) cursor = [...state.start];  // a snapped start: the cross goes with it (ux review)
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
  stickNow();
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
    const at = t(row === col ? "pos_middle" : `pos_${row}_${col}`);
    let near = -1, best = Infinity;
    state.exits.forEach((e, i) => { const d = Math.hypot(e.x - x, e.y - y); if (d < best) { best = d; near = i; } });
    // Enter there gives no route: say so before the user presses it.
    // A wall or a closed room: the words of the refusal that Enter gives (a11y review).
    const got = !marking && !state.photo_map && view ? view.field.tapStart([x, y], fingerReach()) : { at: "open" };
    const tap = got.at;
    const key = "marker" + (near >= 0 ? "_near" : "");
    const small = tap === "noway" && view.field.areaShare(view.field.toPx(got.cell)) < FLOOR_SHARE;
    const why = tap === "wall" || tap === "outside" ? ROUTE_ERRORS["start is inside a wall"] : small ? ROUTE_ERRORS["no open way to an exit"] : null;
    const said = t(key, { at, exit: near >= 0 ? exitName(near) : "" });
    $("marker-status").textContent = why ? I.join([said, why()]) : said;
  }, 400);
}
canvas.addEventListener("blur", () => { $("kbd-hint").hidden = true; stickNow(); draw(); });

// In the larger plan, put the start in the middle, so the start of the route is in view.
function centreOnStart() {
  if (state && state.start) centreOn(state.start);
}

function centreOn(p) {
  const st = $("stage");
  const [x, y] = toCanvasCss(p);
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

// The larger plan is at most 2.2 times as wide as the frame. With a route,
// it is only as large as keeps the route, YOU and its exit in the view, and
// the view is centred on them (ux review: on a phone the exit was cut off).
const BIG_MAX = 2.2, BIG_MIN = 1.4;
function bigZoom() {
  const st = $("stage");
  const r = state && state.start && view && view.route;
  if (!r) return { zoom: BIG_MAX, box: null };
  const e = state.exits[r.exitIndex];
  const pts = [...r.points, state.start, [e.x, e.y]];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = frameUnit() * 8;  // room for the exit mark and the start dot
  const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  const [x0, y0, x1, y1] = shownFrame();
  const w = st.clientWidth, h = Math.min(window.innerHeight * 0.8, window.innerHeight - 60);
  // At zoom k the canvas is k * w wide, so a plan unit is k * w / (x1 - x0) CSS pixels.
  const perUnit = w / (x1 - x0);
  const fit = Math.min(w / ((box[2] - box[0]) * perUnit), h / ((box[3] - box[1]) * perUnit));
  return { zoom: Math.max(BIG_MIN, Math.min(BIG_MAX, fit)), box };
}

$("enlarge").addEventListener("click", () => {
  const st = $("stage");
  const z = st.classList.contains("big") ? null : bigZoom();
  st.style.setProperty("--zoom", z ? `${Math.round(z.zoom * 100)}%` : "");
  const big = st.classList.toggle("big");
  $("enlarge").setAttribute("aria-pressed", String(big));
  if (big) {
    st.tabIndex = 0;
    if (z.box) centreOn([(z.box[0] + z.box[2]) / 2, (z.box[1] + z.box[3]) / 2]);
    else centreOnStart();
    st.scrollIntoView({ block: "nearest" });
  } else {
    st.removeAttribute("tabindex");
  }
});

let speaking = false;

function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
  speaking = false;
  $("speak-text").textContent = t("speak");
}

// A voice for the language, when the browser has one: else the browser picks.
function voiceFor(tag) {
  const norm = (s) => s.replace(/_/g, "-").toLowerCase();
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => norm(v.lang) === norm(tag)) ||
         voices.find((v) => norm(v.lang).split("-")[0] === norm(tag).split("-")[0]) || null;
}

$("speak").addEventListener("click", () => {
  if (!canSpeak || !state) return;
  if (speaking) { stopSpeaking(); return; }
  speechSynthesis.cancel();
  const lines = [t("speak_check"), ...view.steps.map(stepText)];
  if (view.backup) lines.push(t("speak_backup", { exit: exitName(view.route.exitIndex), backup: exitName(view.backup.exitIndex) }));
  const tag = I.SPEECH[lang] || lang;
  const voice = voiceFor(tag);
  lines.forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = tag;
    if (voice) u.voice = voice;
    if (i > 0 && i <= walkCount()) u.onstart = () => select(i - 1);
    if (i === lines.length - 1) u.onend = stopSpeaking;
    speechSynthesis.speak(u);
  });
  speaking = true;
  $("speak-text").textContent = t("speak_stop");
});

// The speaker in the card reads the current step only.
$("now-speak").addEventListener("click", () => {
  if (!canSpeak || !view || !walkCount()) return;
  stopSpeaking();
  const tag = I.SPEECH[lang] || lang;
  const voice = voiceFor(tag);
  const u = new SpeechSynthesisUtterance(walkText(Math.min(walkCount() - 1, Math.max(0, selected))));
  u.lang = tag;
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
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
setUpLang();
openFromAddress();
// early.js hid the start page for a plan that is not there: show it again.
if (!state && !opening && !loading) layout();
try {
  const job = JSON.parse(sessionStorage.getItem(JOB_KEY) || "null");
  sessionStorage.removeItem(JOB_KEY);
  if (job && job.job && Date.now() - job.start < GIVE_UP_AFTER) readPhoto(null, job);
  else if (job && !job.job) say("The reload stopped the upload of your photo. Send the photo again.");
} catch (e) { /* storage blocked */ }
