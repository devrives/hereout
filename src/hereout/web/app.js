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
  for (const s of state.steps) {
    const li = document.createElement("li");
    li.textContent = s.text;
    list.append(li);
  }
  $("steps-head").hidden = state.steps.length === 0;
  $("speak").hidden = state.steps.length === 0 || !canSpeak;
  stopSpeaking();
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

function showAll() {
  draw();
  showSteps();
  showExits();
  explain();
}

function explain() {
  if (state.route) { say("Route found. Check it against the plan."); return; }
  const next = 'Tap "Fix the marks" and mark it yourself, or take the photo again.';
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

function showPlan(answer) {
  state = answer;
  saved = null;
  stopFixing();
  img.onload = () => {
    $("result").hidden = false;
    showAll();
  };
  img.src = state.image;
}

$("photo").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";  // so the same file can be picked again
  if (!file) return;
  const n = ++planSeq;
  stopSpeaking();
  if (taps) restore();
  $("photo").disabled = true;
  say("Reading the plan. This can take a minute or two. The button works again when it is done.");
  const body = new FormData();
  body.append("photo", file);
  let answer;
  try {
    const r = await fetch("/api/plan", { method: "POST", body });
    if (!r.ok) { if (n === planSeq) say(`Upload failed: ${await errorText(r, "try again")}.`); return; }
    answer = await r.json();
  } catch (e) {
    if (n === planSeq) say("Upload failed. Check the connection and try again.");
    return;
  } finally {
    if (n === planSeq) $("photo").disabled = false;
  }
  if (n !== planSeq) return;
  showPlan(answer);
  remember();
});

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
    if (i === lines.length - 1) u.onend = stopSpeaking;
    speechSynthesis.speak(u);
  });
  speaking = true;
  $("speak").textContent = "Stop reading";
});

// After a reload, show the last answer again. Rerouting works while the
// server still keeps the photo.
try {
  const last = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
  if (last && last.image) showPlan(last);
} catch (e) { /* storage blocked */ }
