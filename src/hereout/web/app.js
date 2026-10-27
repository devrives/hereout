"use strict";

const $ = (id) => document.getElementById(id);
const canvas = $("plan");
const ctx = canvas.getContext("2d");
const img = new Image();
let state = null;   // the last answer from the server
let taps = null;    // [] while the user fixes the marks

function say(text) { $("status").textContent = text; }

function draw() {
  if (!state) return;
  canvas.width = state.width;
  canvas.height = state.height;
  ctx.drawImage(img, 0, 0);
  const unit = Math.max(state.width, state.height) / 160;

  const pts = state.route && state.route.points;
  if (pts && pts.length > 1) {
    ctx.lineJoin = ctx.lineCap = "round";
    for (const [color, width] of [["#ffffff", unit * 2.4], ["#0a7d3b", unit * 1.4]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
  }
  for (const e of state.exits) dot(e.x, e.y, "#0a7d3b", unit * 2);
  if (state.here) dot(state.here[0], state.here[1], "#1b5fd1", unit * 2.2);
}

function dot(x, y, color, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = r / 2.5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

function showSteps() {
  const list = $("steps");
  list.replaceChildren();
  for (const s of state.steps) {
    const li = document.createElement("li");
    li.textContent = s.text;
    list.append(li);
  }
  $("speak").hidden = state.steps.length === 0;
}

function explain() {
  if (state.route) { say("Route found. Check it against the plan."); return; }
  if (state.model_error) say(`Could not read the plan (${state.model_error}). Tap "Fix the marks".`);
  else if (!state.here) say('No "you are here" mark found. Tap "Fix the marks".');
  else if (!state.exits.length) say('No exit found. Tap "Fix the marks".');
  else say(`No route (${state.route_error}). Tap "Fix the marks".`);
}

$("photo").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  say("Reading the plan…");
  $("result").hidden = true;
  const body = new FormData();
  body.append("photo", file);
  try {
    const r = await fetch("/api/plan", { method: "POST", body });
    if (!r.ok) throw new Error((await r.json()).detail || r.status);
    state = await r.json();
  } catch (e) {
    say(`Upload failed: ${e.message}`);
    return;
  }
  img.onload = () => {
    $("result").hidden = false;
    draw();
    showSteps();
    explain();
  };
  img.src = state.image;
});

$("fix").addEventListener("click", () => {
  taps = [];
  $("fix-hint").hidden = false;
  say("Tap where you are.");
});

canvas.addEventListener("click", async (ev) => {
  if (!taps) return;
  const box = canvas.getBoundingClientRect();
  const x = (ev.clientX - box.left) * (canvas.width / box.width);
  const y = (ev.clientY - box.top) * (canvas.height / box.height);
  taps.push([Math.round(x), Math.round(y)]);
  if (taps.length === 1) {
    state.here = taps[0];
    state.route = null;
    draw();
    say("Now tap the exit.");
    return;
  }
  state.exits = [{ x: taps[1][0], y: taps[1][1], label: "" }];
  const exit = taps[1];
  taps = null;
  $("fix-hint").hidden = true;
  say("Finding the route…");
  const r = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: state.id, here: state.here, exits: [exit] }),
  });
  if (!r.ok) { say((await r.json()).detail || "Route failed."); return; }
  Object.assign(state, await r.json(), { model_error: null });
  draw();
  showSteps();
  explain();
});

$("speak").addEventListener("click", () => {
  if (!("speechSynthesis" in window) || !state) return;
  speechSynthesis.cancel();
  for (const s of state.steps) speechSynthesis.speak(new SpeechSynthesisUtterance(s.text));
});
