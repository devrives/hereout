"use strict";

// "What Muse Spark read": the floor box and the exit points that the model
// gave, the label it wrote for each, what the zoom check did with them, and
// what the code did after the model. The server sends it as answer.read
// (pipeline.model_reading). app.js calls readingOn() in draw() and
// showReading() when a plan opens.

const READ = "#6a1b9a";      // the model's points and box; not a colour of the other layers
const READ_DROP = "#5f6368"; // a point that was not used
const READ_CODE = "#111111"; // a move by the code
const READ_SAME = 0.005;     // share of the long side: a smaller zoom move keeps the point
let readShown = false;

function readingOn() {
  return readShown && !!(state && state.read);
}

function setReading(on) {
  readShown = on && !!(state && state.read);
  $("show-read").setAttribute("aria-pressed", String(readShown));
  $("result").classList.toggle("reading", readShown);
  draw();
}

const readSide = () => Math.max(state.width, state.height);
const zoomMoved = (row) => row.zoom === "moved" &&
  Math.hypot(row.zoom_at[0] - row.at[0], row.zoom_at[1] - row.at[1]) >= READ_SAME * readSide();

// What happened to one exit point, in words.
function readFate(row) {
  if (row.zoom === "dropped") return "dropped by the zoom check";
  if (row.drop === "legend") return "dropped by HereOut: in the legend";
  if (row.drop) return "dropped by HereOut: not on the drawing";
  const parts = [`Exit ${row.exit + 1}`];
  if (row.zoom) parts.push(zoomMoved(row) ? "moved by the zoom check" : "kept by the zoom check");
  if (row.placed_at) parts.push("moved onto the building by HereOut");
  return parts.join(", ");
}

function readZoomText(read) {
  const rows = read.exits;
  const count = (f) => rows.filter(f).length;
  switch (read.zoom) {
    case null: case undefined:
      return "This sample uses a saved reading. Its zoom check, if any, was not saved.";
    case "none":
      return "Every point was near a green or red plan mark, so no zoom check ran.";
    case "skipped":
      return "The first call was slow, so the zoom check did not run.";
    case "failed":
      return "The zoom check gave no answer, so the first points stay.";
    case "done": {
      const checked = count((r) => r.zoom);
      const moved = count(zoomMoved), dropped = count((r) => r.zoom === "dropped");
      const kept = checked - moved - dropped;
      const what = [moved && `${moved} moved`, dropped && `${dropped} dropped`, kept && `${kept} kept`].filter(Boolean).join(", ");
      return `Points far from any green or red plan mark got a second Muse Spark call on zoomed crops: ${checked} checked, ${what}.`;
    }
    default:
      return "";
  }
}

function showReading() {
  const read = state && state.read;
  $("read-wrap").hidden = !read;
  readShown = false;
  $("show-read").setAttribute("aria-pressed", "false");
  $("result").classList.remove("reading");
  if (!read) return;
  const n = read.exits.length;
  $("read-sum").textContent = (read.box ? "The box of the floor drawing and " : "") +
    `${n} exit point${n === 1 ? "" : "s"}, each with the label the model wrote:`;
  $("read-exits").replaceChildren(...read.exits.map((row) => {
    const li = document.createElement("li");
    const mark = document.createElement("span");
    mark.className = "rk" + ("exit" in row ? "" : " out");
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "exit" in row ? String(row.exit + 1) : "×";
    const text = document.createElement("span");
    const label = document.createElement("span");
    label.className = "rl";
    label.dir = "auto";
    label.textContent = row.label.trim() ? `“${row.label.trim()}”` : "(no label)";
    const fate = document.createElement("span");
    fate.className = "rf";
    fate.textContent = readFate(row);
    text.append(label, " ", fate);
    li.append(mark, text);
    return li;
  }));
  $("read-zoom").textContent = readZoomText(read);
  const has = (f) => read.exits.some(f);
  $("rl-box").hidden = !read.box;
  $("rl-zoom").hidden = !has(zoomMoved);
  $("rl-code").hidden = !has((r) => r.placed_at);
  $("rl-drop").hidden = !has((r) => !("exit" in r));
}

function readArrow(a, b, color, width, dash) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d < 1) return;
  const ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d, head = Math.min(d / 2, width * 3.2);
  for (const [c, w] of [["#ffffff", width * 2.2], [color, width]]) {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.setLineDash(c === color ? dash : []);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0] - ux * head * 0.8, b[1] - uy * head * 0.8);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]);
  ctx.lineTo(b[0] - ux * head - uy * head * 0.6, b[1] - uy * head + ux * head * 0.6);
  ctx.lineTo(b[0] - ux * head + uy * head * 0.6, b[1] - uy * head - ux * head * 0.6);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = width / 1.5;
  ctx.stroke();
  ctx.fill();
}

function readRing(p, r, n) {
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = r / 2.6;
  ctx.strokeStyle = n === null ? READ_DROP : READ;
  ctx.stroke();
  if (n === null) {
    const k = r * 0.5;
    ctx.lineWidth = r / 3.5;
    ctx.beginPath();
    ctx.moveTo(p[0] - k, p[1] - k); ctx.lineTo(p[0] + k, p[1] + k);
    ctx.moveTo(p[0] + k, p[1] - k); ctx.lineTo(p[0] - k, p[1] + k);
    ctx.stroke();
    return;
  }
  ctx.font = `bold ${Math.round(r * (n > 9 ? 1 : 1.25))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = READ;
  ctx.fillText(String(n), p[0], p[1] + r * 0.08);
}

// The plan photo with the reading on top, and nothing that the code made.
function drawReading() {
  const read = state.read;
  const unit = readSide() / 160;
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";  // the marks read on a busy photo
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (read.box) {
    const [x0, y0, x1, y1] = read.box;
    for (const [c, w, dash] of [["#ffffff", unit * 1.1, []], [READ, unit * 0.5, [unit * 2, unit * 1.2]]]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.setLineDash(dash);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.setLineDash([]);
  }
  const r = unit * 2;
  ctx.lineCap = ctx.lineJoin = "round";
  for (const row of read.exits) {
    const last = row.zoom_at || row.at;
    if (zoomMoved(row)) readArrow(row.at, row.zoom_at, READ, unit * 0.45, []);
    if (row.placed_at) readArrow(last, row.placed_at, READ_CODE, unit * 0.4, [unit * 1.2, unit * 0.9]);
  }
  for (const row of read.exits) {
    if (zoomMoved(row)) {
      ctx.beginPath();
      ctx.arc(row.at[0], row.at[1], r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = r / 4;
      ctx.strokeStyle = READ;
      ctx.stroke();
    }
    readRing(row.zoom_at || row.at, r, "exit" in row ? row.exit + 1 : null);
  }
  if (cursor && keyboard && document.activeElement === canvas) cross(cursor[0], cursor[1], unit * 4);
}

$("show-read").addEventListener("click", (ev) => {
  setReading(!readShown);
  // On a phone the plan is above this card.
  if (readShown && narrow() && ev.detail !== 0) $("stage").scrollIntoView({ block: "nearest", behavior: smoothScroll() });
});
// Another view of the plan, a tap or Enter ends the reading view. The tap
// sets no start: the reading view shows all of the photo, and the plan view
// is framed, so the tap point would be wrong.
for (const id of ["show-map", "show-photo", "show-routes"]) {
  $(id).addEventListener("click", () => { if (readShown) setReading(false); });
}
canvas.addEventListener("click", (ev) => {
  if (!readShown) return;
  ev.stopImmediatePropagation();
  setReading(false);
}, true);
canvas.addEventListener("keydown", (ev) => {
  if (readShown && (ev.key === "Enter" || ev.key === " ")) setReading(false);
}, true);
