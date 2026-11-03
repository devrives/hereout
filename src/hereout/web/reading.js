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

// While the reading shows, the other views are off; after it, they are as before.
function setReading(on) {
  const was = readShown;
  readShown = on && !!(state && state.read);
  if (readShown) clearRefusal();
  $("show-read").setAttribute("aria-pressed", String(readShown));
  $("show-read-text").textContent = readShown ? "Hide the reading" : "Show the reading on the plan";
  $("result").classList.toggle("reading", readShown);
  pressView();  // app.js: no view button is pressed while the reading shows
  showStages();  // app.js: the tap pill goes while the reading shows
  tapSaid = readShown ? () => t("read_tap") : tapText;
  $("tap-text").textContent = tapSaid();
  $("tap-text").hidden = !readShown && (!state || !state.start || marking);
  if (readShown !== was) sayPlan(readShown ? () => t("read_showing") : () => t("read_back"));
  draw();
}

// A label in another script is in the language of the plan, so a screen reader
// reads it with the right voice (the card itself is English).
function labelLang(el, text) {
  const tag = state && state.plan_text && state.plan_text.language;
  if (tag && tag !== "und" && /[^\u0000-\u024f]/.test(text)) el.lang = tag;
}

const readSide = () => Math.max(state.width, state.height);
const zoomMoved = (row) => row.zoom === "moved" &&
  Math.hypot(row.zoom_at[0] - row.at[0], row.zoom_at[1] - row.at[1]) >= READ_SAME * readSide();

// What happened to one exit point, in words.
function readFate(row) {
  if (row.zoom === "dropped") return `dropped by the second look (crop ${row.crop})`;
  if (row.drop === "label") return "dropped by HereOut: its label says closed or lift";
  if (row.drop === "legend") return "dropped by HereOut: in the legend";
  if (row.drop) return "dropped by HereOut: not on the drawing";
  const parts = [`Exit ${row.exit + 1}`];
  const crop = row.crop ? ` (crop ${row.crop})` : "";
  if (row.zoom) parts.push((zoomMoved(row) ? "moved by the second look" : "kept by the second look") + crop);
  if (row.placed_at) parts.push("moved onto the building by HereOut");
  return parts.join(", ");
}

function readZoomText(read) {
  const rows = read.exits;
  const count = (f) => rows.filter(f).length;
  switch (read.zoom) {
    case null: case undefined:
      return "This sample uses a saved reading without its second look.";
    case "none":
      return "Every point was near a green or red plan mark, so no second look ran.";
    case "skipped":
      return "The first call was slow, so the second look did not run.";
    case "failed":
      return "The second look gave no answer, so the first points stay.";
    case "done": {
      const checked = count((r) => r.zoom);
      const moved = count(zoomMoved), dropped = count((r) => r.zoom === "dropped");
      const kept = checked - moved - dropped;
      const what = [moved && `${moved} moved`, dropped && `${dropped} dropped`, kept && `${kept} kept`].filter(Boolean).join(", ");
      return `Points far from any green or red plan mark got a second Muse Spark call on numbered, zoomed crops: ${checked} checked, ${what}.`;
    }
    default:
      return "";
  }
}

// The second look: the sheets of numbered crops that the zoom call sent, and
// what came back for each crop. Crop n is on sheet (n - 1) / 4 (reader.ZOOM_PER_SHEET).
const LOOK_PER_SHEET = 4;
let lookOpener = null;

// What came back for one crop: a short word, and why.
function lookResult(row) {
  if (row.zoom === "dropped") return ["Dropped", "no exit in this crop"];
  if (row.zoom === "moved") return zoomMoved(row) ? ["Moved", "the model pointed to a new spot"] : ["Kept", "the model pointed to the same spot"];
  switch (row.why) {
    case "too far": return ["Kept", "the model pointed more than 7% of the plan away, and not at a route mark inside the floor box, so HereOut did not use that point"];
    case "off the crop": return ["Kept", "the model pointed outside this crop, so HereOut did not use that point"];
    case "last exit": return ["Kept", "the model saw no exit, but one exit must stay"];
    default: return ["No answer", "the first point stays"];
  }
}

function lookItems(rows) {
  return rows.map((row) => {
    const li = document.createElement("li");
    const n = document.createElement("span");
    n.className = "lk";
    n.setAttribute("aria-hidden", "true");
    n.textContent = String(row.crop);
    const text = document.createElement("span");
    const [word, why] = lookResult(row);
    const b = document.createElement("strong");
    b.textContent = word;
    const label = row.label.trim() ? `“${row.label.trim()}”` : "(no label)";
    const then = "exit" in row ? ` Now Exit ${row.exit + 1}.` : row.zoom === "dropped" ? "" : " Not used by HereOut.";
    const sr = document.createElement("span");
    sr.className = "sr";
    sr.textContent = `Crop ${row.crop}: `;
    const name = document.createElement("span");
    name.dir = "auto";
    name.textContent = label;
    labelLang(name, row.label);
    text.append(sr, b, ": ", name, `, ${why}.${then}`);
    li.append(n, text);
    return li;
  });
}

// The sheet image, with a ring where the model pointed in each crop. The
// image stays as the model saw it: the rings are on top, in the page.
function lookPicture(img, rows) {
  const pic = document.createElement("span");
  pic.className = "look-pic";
  pic.append(img);
  for (const row of rows) {
    if (!row.seen) continue;
    const ring = document.createElement("span");
    ring.className = "look-pt" + (row.zoom === "moved" ? "" : " unused");
    ring.setAttribute("aria-hidden", "true");
    ring.style.left = `${row.seen[0] * 100}%`;
    ring.style.top = `${row.seen[1] * 100}%`;
    pic.append(ring);
  }
  return pic;
}

function showLook(read) {
  const sheets = (read.zoom === "done" && read.sheets) || [];
  $("look-wrap").hidden = !sheets.length;
  const checked = read.exits.filter((r) => r.crop).sort((a, b) => a.crop - b.crop);
  $("look-sheets").replaceChildren(...sheets.map((url, i) => {
    const rows = checked.filter((r) => Math.floor((r.crop - 1) / LOOK_PER_SHEET) === i);
    const first = i * LOOK_PER_SHEET + 1, last = first + Math.max(0, rows.length - 1);
    const crops = rows.length > 1 ? `crops ${first} to ${last}` : `crop ${first}`;
    const head = `Sheet ${i + 1} of ${sheets.length}: ${crops}`;
    const li = document.createElement("li");
    li.className = "look-sheet";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "look-open";
    open.setAttribute("aria-haspopup", "dialog");
    const img = document.createElement("img");
    img.src = url;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = `${head}, as Muse Spark saw them. Open larger.`;
    open.append(lookPicture(img, rows));
    open.addEventListener("click", () => openLook(url, head, rows, open));
    const list = document.createElement("ol");
    list.className = "look-crops";
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", `What came back for ${crops}`);
    list.append(...lookItems(rows));
    li.append(open, list);
    return li;
  }));
}

function openLook(url, head, rows, opener) {
  const view = $("look-view");
  lookOpener = opener;
  $("look-view-head").textContent = head;
  const img = document.createElement("img");
  img.id = "look-view-img";
  img.src = url;
  img.alt = `${head}: zoomed parts of the plan photo, each with its number in a black box and a magenta cross on the first exit point.`;
  $("look-view-pic").replaceChildren(lookPicture(img, rows));
  $("look-view-crops").replaceChildren(...lookItems(rows));
  if (typeof view.showModal === "function") view.showModal();
  else view.setAttribute("open", "");
  $("look-view-close").focus();
}

function closeLook() {
  const view = $("look-view");
  if (typeof view.close === "function") view.close();
  else view.removeAttribute("open");
}

$("look-view-close").addEventListener("click", closeLook);
// A click on the backdrop (outside the box) closes the view; Escape closes a dialog by itself.
$("look-view").addEventListener("click", (ev) => { if (ev.target === $("look-view")) closeLook(); });
$("look-view").addEventListener("close", () => {
  if (lookOpener && document.contains(lookOpener)) lookOpener.focus();
  lookOpener = null;
});

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
    labelLang(label, row.label);
    const fate = document.createElement("span");
    fate.className = "rf";
    fate.textContent = readFate(row);
    text.append(label, " ", fate);
    li.append(mark, text);
    return li;
  }));
  $("read-zoom").textContent = readZoomText(read);
  showLook(read);
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
  // The plan can be above the window (a phone, or a long card).
  if (readShown && ev.detail !== 0) $("stage").scrollIntoView({ block: "nearest", behavior: smoothScroll() });
});
// Another view of the plan, a tap or Enter ends the reading view. The tap
// sets no start: the reading view shows all of the photo, and the plan view
// is framed, so the tap point would be wrong.
// A view button ends it and shows its own view (app.js setView).
function endReading(ev) {
  if (!readShown) return;
  ev.stopImmediatePropagation();
  ev.preventDefault();
  setReading(false);
}
for (const id of ["show-map", "show-photo", "show-routes"]) $(id).addEventListener("click", () => { if (readShown) setReading(false); }, true);
canvas.addEventListener("click", endReading, true);
canvas.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" || ev.key === " ") endReading(ev);
}, true);
