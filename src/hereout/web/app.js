"use strict";

const $ = (id) => document.getElementById(id);
const canvas = $("plan");
const ctx = canvas.getContext("2d");
const img = new Image();
let state = null;   // the last answer from the server
let taps = null;    // [] while the user fixes the marks
let cursor = null;  // [x, y] keyboard cursor while the user fixes the marks
let saved = null;   // the marks and route before "Fix the marks", to restore on cancel or failure
let planSeq = 0;    // only the newest upload may change the page
let routeSeq = 0;   // only the newest route request may change the page
let selected = -1;  // the step shown on the plan, or -1
const canSpeak = "speechSynthesis" in window;
const STORE_KEY = "hereout:last";

function say(text) { $("status").textContent = text; }

// Error bodies from a proxy may not be JSON, and a 422 detail is a list.
async function errorText(r, fallback) {
  const body = await r.json().catch(() => ({}));
  return typeof body.detail === "string" ? body.detail : fallback;
}

function remember() {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
}

function draw() {
  if (!state) return;
  canvas.width = state.width;
  canvas.height = state.height;
  ctx.drawImage(img, 0, 0);
  const unit = Math.max(state.width, state.height) / 160;

  // Exit and "you are here" differ in shape and label, not only in colour.
  const here = state.here;
  for (const e of state.exits) exitMark(e.x, e.y, unit * 2.2);
  if (here) hereMark(here[0], here[1], unit * 2.4);

  // The route goes over the marks, so a short route stays visible.
  const pts = state.route && state.route.points;
  if (pts && pts.length > 1) {
    ctx.lineJoin = ctx.lineCap = "round";
    for (const [color, width] of [["#ffffff", unit * 2], ["#0a7d3b", unit * 1.1]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
  }

  const step = state.steps[selected];
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
    label(String(selected + 1), (step.from[0] + step.to[0]) / 2, (step.from[1] + step.to[1]) / 2 - unit * 2.5, unit * 2.4, "bottom");
  }

  // Labels last. An exit label close to YOU goes below its mark.
  for (const e of state.exits) {
    const near = here && Math.hypot(e.x - here[0], e.y - here[1]) < unit * 14;
    label("EXIT", e.x, near ? e.y + unit * 2.2 * 1.8 : e.y - unit * 2.2 * 1.8, unit * 2.2, near ? "top" : "bottom");
  }
  if (here) label("YOU", here[0], here[1] - unit * 2.4 * 1.8, unit * 2.4, "bottom");

  if (taps && cursor && document.activeElement === canvas) cross(cursor[0], cursor[1], unit * 4);
  if (!taps) canvas.setAttribute("aria-label", state.route ? "The plan with the route" : "The plan, no route yet");
}

function hereMark(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#1b5fd1";
  ctx.fill();
  ctx.lineWidth = r / 2.5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

function exitMark(x, y, r) {
  ctx.fillStyle = "#0a7d3b";
  ctx.lineWidth = r / 2.5;
  ctx.strokeStyle = "#ffffff";
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.strokeRect(x - r, y - r, r * 2, r * 2);
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
  state.steps.forEach((s, i) => {
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
  $("steps-head").hidden = state.steps.length === 0;
  $("speak").hidden = state.steps.length === 0 || !canSpeak;
  stopSpeaking();
}

// Show one step on the plan. -1 shows none.
function select(i) {
  selected = i;
  $("steps").querySelectorAll("button.step").forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
  draw();
  const step = state.steps[i];
  if (!step || step.kind !== "walk") return;
  const mid = [(step.from[0] + step.to[0]) / 2, (step.from[1] + step.to[1]) / 2];
  scrollToPoint(mid);
  // On a phone the plan is above the steps: bring the leg into the window.
  const box = canvas.getBoundingClientRect();
  const y = box.top + mid[1] / state.height * box.height;
  if (y < 0 || y > window.innerHeight) $("stage").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// One button for each other exit the model found, so the route can go to
// another exit without placing marks on the picture.
function showExits() {
  const box = $("exits");
  box.replaceChildren();
  const used = state.route ? state.route.exit_index : -1;
  const others = state.here ? state.exits.map((e, i) => [e, i]).filter(([, i]) => i !== used) : [];
  $("exits-wrap").hidden = others.length === 0 || !state.route;
  for (const [e, i] of others) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = e.label || `Exit ${i + 1}`;
    b.addEventListener("click", () => route(state.here, [[e.x, e.y]], state.exits, i));
    box.append(b);
  }
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
  const changes = [...(c.changes || []), "marks and route drawn on top"].join(", ");
  box.append(`Sample plan. Photo: “${c.title}” by ${c.author}, `,
             link(c.licence, c.licence_url), ", ", link("source", c.source_url),
             `. Changes: ${changes}.`,
             c.share_alike ? " The changed image is shared under the same licence." : "",
             " This sample uses a saved model reading.");
}

function showAll() {
  showCredit();
  draw();
  showSteps();
  showExits();
  explain();
}

function explain() {
  if (state.route) { say("Route found. Check it against the plan."); return; }
  const next = `Tap "Fix the marks" and mark it yourself, or ${state.credit ? "pick another sample" : "take the photo again"}.`;
  if (state.model_error) say(`Could not read the plan. ${next}`);
  else if (!state.here) say(`No "you are here" mark found. ${next}`);
  else if (!state.exits.length) say(`No exit found. ${next}`);
  else say('No route from that point. Tap "Fix the marks" and mark a spot in a corridor.');
}

function startFixing(byKeyboard) {
  saved = { here: state.here, exits: state.exits, route: state.route, steps: state.steps };
  taps = [];
  cursor = state.here ? [...state.here] : [state.width / 2, state.height / 2];
  $("fix").textContent = "Cancel";
  $("fix-hint").hidden = false;
  $("kbd-hint").hidden = !byKeyboard;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "Plan. Arrow keys move the marker, Enter places it, Escape cancels.");
  if (byKeyboard) canvas.focus();
  draw();
  say("Mark where you are.");
}

function stopFixing() {
  taps = null;
  cursor = null;
  canvas.removeAttribute("tabindex");
  canvas.setAttribute("role", "img");
  $("fix").textContent = "Fix the marks";
  $("fix-hint").hidden = true;
}

// Put back the marks, route and steps from before "Fix the marks".
function restore() {
  if (saved) Object.assign(state, saved);
  saved = null;
  stopFixing();
  showAll();
}

function showPlan(answer, focusResult) {
  state = answer;
  saved = null;
  stopFixing();
  img.onload = () => {
    $("result").hidden = false;
    showAll();
    if ($("stage").classList.contains("big")) centreOnHere();
    markOpenSample();
    if (focusResult) {
      $("result").scrollIntoView({ block: "start" });
      $("result-head").focus({ preventScroll: true });
    }
  };
  img.src = state.image;
}

// Load a plan from an upload or the gallery. Only the newest request wins.
async function loadPlan(request, waitText) {
  const n = ++planSeq;
  routeSeq++;
  stopSpeaking();
  if (taps) restore();
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
    if (n === planSeq) $("photo").disabled = false;
  }
  if (n !== planSeq) return;
  showPlan(answer, true);
  remember();
}

$("photo").addEventListener("change", (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";  // so the same file can be picked again
  if (!file) return;
  const body = new FormData();
  body.append("photo", file);
  loadPlan(() => fetch("/api/plan", { method: "POST", body }),
           "Reading the plan. This can take a minute or two. The button works again when it is done.");
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

function openSample(gid) {
  return loadPlan(() => fetch(`/api/gallery/${encodeURIComponent(gid)}`, { method: "POST" }), "Opening the sample plan…");
}

// The open sample is marked in the gallery and named in the address, so it can be shared.
function markOpenSample() {
  const gid = sampleId(state && state.id);
  document.querySelectorAll("#gallery button.sample").forEach((b) => {
    if (b.dataset.id === gid) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
  $("back-to-samples").hidden = !gid;
  if (!state) return;
  const url = new URL(location.href);
  if (gid) url.searchParams.set("sample", gid); else url.searchParams.delete("sample");
  history.replaceState(null, "", url);
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
      b.addEventListener("click", () => openSample(p.id));
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

$("fix").addEventListener("click", (ev) => {
  if (taps) { restore(); $("fix").focus(); return; }
  // A click from Enter or Space has detail 0.
  startFixing(ev.detail === 0);
});

async function route(here, exits, allExits, exitIndex) {
  const n = ++routeSeq;
  say("Finding the route…");
  let answer;
  try {
    const r = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: state.id, here, exits }),
    });
    if (!r.ok) {
      if (n !== routeSeq) return;
      const text = r.status === 404
        ? "This photo is no longer on the server (photos are kept for 15 minutes). Take it again."
        : await errorText(r, "Route failed. Try again.");
      restore();
      say(text);
      $("fix").focus();
      return;
    }
    answer = await r.json();
  } catch (e) {
    if (n !== routeSeq) return;
    restore();
    say("Route failed. Check the connection and try again.");
    $("fix").focus();
    return;
  }
  if (n !== routeSeq) return;
  // The server answers for the exits it was sent. Keep the full exit list
  // and point exit_index into it.
  Object.assign(state, answer, { model_error: null, here, exits: allExits });
  if (state.route) state.route.exit_index = exitIndex;
  saved = null;
  showAll();
  remember();
  $("steps").focus();
}

function place(x, y) {
  taps.push([Math.round(x), Math.round(y)]);
  if (taps.length === 1) {
    state.here = taps[0];
    state.route = null;
    state.steps = [];  // old steps no longer match the plan
    showSteps();
    $("exits-wrap").hidden = true;
    draw();
    say("Now mark the exit.");
    return;
  }
  const exit = taps[1];
  const here = state.here;
  stopFixing();
  state.exits = [{ x: exit[0], y: exit[1], label: "" }];
  draw();
  route(here, [exit], state.exits, 0);
}

canvas.addEventListener("click", (ev) => {
  if (!taps) return;
  const box = canvas.getBoundingClientRect();
  place((ev.clientX - box.left) * (canvas.width / box.width),
        (ev.clientY - box.top) * (canvas.height / box.height));
});

// Keyboard: arrow keys move a cross, Enter or Space places the mark.
canvas.addEventListener("keydown", (ev) => {
  if (!taps || !cursor) return;
  const step = Math.max(state.width, state.height) * (ev.shiftKey ? 0.05 : 0.01);
  const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
  if (move) {
    cursor = [Math.min(state.width, Math.max(0, cursor[0] + move[0])),
              Math.min(state.height, Math.max(0, cursor[1] + move[1]))];
    draw();
    scrollToPoint(cursor);
  } else if (ev.key === "Enter" || ev.key === " ") {
    place(cursor[0], cursor[1]);
  } else if (ev.key === "Escape") {
    restore();
    $("fix").focus();
  } else {
    return;
  }
  ev.preventDefault();
});
canvas.addEventListener("focus", () => { if (taps) $("kbd-hint").hidden = false; draw(); });
canvas.addEventListener("blur", draw);

// In the larger plan, put "you are here" in the middle, so the start of the route is in view.
function centreOnHere() {
  if (!state || !state.here) return;
  const st = $("stage");
  st.scrollLeft = state.here[0] / state.width * canvas.clientWidth - st.clientWidth / 2;
  st.scrollTop = state.here[1] / state.height * canvas.clientHeight - st.clientHeight / 2;
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
    centreOnHere();
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
  const lines = ["Check this route against the plan.", ...state.steps.map((s) => s.text)];
  lines.forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(text);
    if (i > 0) u.onstart = () => select(i - 1);
    if (i === lines.length - 1) u.onend = stopSpeaking;
    speechSynthesis.speak(u);
  });
  speaking = true;
  $("speak").textContent = "Stop reading";
});

// A link with ?sample=<id> opens that sample. Otherwise, after a reload, show
// the last answer again. Rerouting works while the server still keeps the photo.
const startSample = new URL(location.href).searchParams.get("sample");
if (startSample) {
  openSample(startSample);
} else {
  try {
    const last = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
    if (last && last.image) showPlan(last);
  } catch (e) { /* storage blocked */ }
}
