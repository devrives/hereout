// Send a set of plan photos through the page of a local HereOut server, as a
// user does: the photo button of the start page, the upload, the model reads,
// the plan that opens. Each photo goes once: no retry, and nothing changes the
// answers after the page shows them. For each photo it keeps what the page
// got and what it shows, and it writes one review page for all of them.
//
//   node scripts/site_run.mjs <server> <index.csv> <out-dir> [--workers 3] [--limit N] [--only id,id]
//
// <server> is a local server with the model key (never the live site: photos
// are not sent there for tests). The server allows 12 reads for each address
// in 10 minutes; each photo gets its own address in the cf-connecting-ip header,
// which the server reads as the address. <index.csv> is the index of
// scripts/run_set.py (rows with readable=yes and security_sensitive not yes).
//
// <out-dir> gets, for each photo id (country-file name, as the gallery):
//   <id>.json       the answer of the page (no image), the time, the status line
//   <id>.plan.jpg   the plan image that the page drew on
//   <id>.page.png   the plan as the page shows it (escape map, exits, ways out)
//   <id>.read.png   the reading view (what Muse Spark read, on the whole photo)
// and index.html, a page with every result. A photo with a saved <id>.json is
// skipped, so a stopped run goes on with the photos it did not send.
// playwright-core comes from the hub kit (kit/plugins/core) or from PLAYWRIGHT_CORE.
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

function kit() {
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const p = path.join(dir, "kit/plugins/core/package.json");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("playwright-core not found: set PLAYWRIGHT_CORE to a package.json beside it");
}
const { chromium } = createRequire(process.env.PLAYWRIGHT_CORE || kit())("playwright-core");

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const [base, indexCsv, outDir] = args;
if (!outDir) {
  console.error("usage: site_run.mjs <server> <index.csv> <out-dir> [--workers 3] [--limit N] [--only id,id]");
  process.exit(2);
}
const WORKERS = Number(opt("--workers", "3"));
const LIMIT = Number(opt("--limit", "0"));
const ONLY = opt("--only", null)?.split(",");
const OPEN_WAIT = 300_000;   // ms: the page waits up to 3 min for a read (app.js GIVE_UP_AFTER), then this run gives up
const WORDS_WAIT = 60_000;   // ms: the words of the plan come later than the plan

// The CSV of run_set.py (quoted fields, a BOM).
function readCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const csvDir = path.dirname(path.resolve(indexCsv));
let photos = readCsv(indexCsv)
  .filter((r) => r.readable === "yes" && r.security_sensitive !== "yes")
  .map((r) => ({ ...r, id: `${r.zip_name.split("/")[0]}-${path.basename(r.zip_name).replace(/\.[^.]+$/, "")}`, file: path.join(csvDir, r.zip_name) }));
if (ONLY) photos = photos.filter((p) => ONLY.includes(p.id));
if (LIMIT) photos = photos.slice(0, LIMIT);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] });

async function one(p, n) {
  const jsonPath = path.join(outDir, `${p.id}.json`);
  if (fs.existsSync(jsonPath)) return `${p.id}: saved before, skipped`;
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", locale: "en-US",
    extraHTTPHeaders: { "cf-connecting-ip": `10.90.${Math.floor(n / 250)}.${n % 250 + 1}` },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const out = { id: p.id, country: p.country, title: p.title, url: p.url, licence: p.licence, author: p.author };
  const t0 = Date.now();
  try {
    await page.goto(`${base}/?lang=en`, { waitUntil: "load" });
    await page.setInputFiles("#photo", p.file);
    // The plan opens by itself on the start page; a read that fails says so in the status line.
    await page.waitForFunction(() => (typeof state !== "undefined" && state && state.text_id && typeof view !== "undefined" && view && view.field)
      || /Could not|did not|failed|try again/i.test(document.getElementById("status").textContent), null, { timeout: OPEN_WAIT, polling: 500 });
    out.seconds = Math.round((Date.now() - t0) / 100) / 10;
    out.status = (await page.textContent("#status")).trim();
    const opened = await page.evaluate(() => typeof state !== "undefined" && !!state && !!state.text_id);
    if (opened) {
      await page.waitForFunction(() => !view.field.waitForNetwork || view.field._network, null, { timeout: 30_000 }).catch(() => {});
      await page.waitForFunction(() => state.plan_text || !state.text_pending, null, { timeout: WORDS_WAIT, polling: 1000 }).catch(() => {});
      const ans = await page.evaluate(() => {
        const { image, ...rest } = state;
        return { answer: JSON.parse(JSON.stringify(rest)), image, planStatus: document.getElementById("plan-status").textContent.trim() };
      });
      out.answer = ans.answer;
      out.plan_status = ans.planStatus;
      if (ans.image.startsWith("data:")) fs.writeFileSync(path.join(outDir, `${p.id}.plan.jpg`), Buffer.from(ans.image.split(",")[1], "base64"));
      await page.locator("#stage").screenshot({ path: path.join(outDir, `${p.id}.page.png`) });
      if (await page.locator("#show-read").isVisible()) {
        await page.click("#show-read");
        await page.waitForTimeout(400);
        await page.locator("#stage").screenshot({ path: path.join(outDir, `${p.id}.read.png`) });
      }
    }
  } catch (e) {
    out.seconds = Math.round((Date.now() - t0) / 100) / 10;
    out.failure = String(e).split("\n")[0];
  }
  out.page_errors = errors;
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 1));
  await ctx.close();
  const ex = out.answer ? out.answer.exits.length : "-";
  return `${p.id}: ${out.failure ? "FAILED " + out.failure : `${ex} exits`} (${out.seconds} s)`;
}

let next = 0;
async function worker() {
  while (next < photos.length) {
    const n = next++;
    console.log(await one(photos[n], n));
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
await browser.close();

// The review page: every photo with what the page showed.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m]);
const all = readCsv(indexCsv).filter((r) => r.readable === "yes" && r.security_sensitive !== "yes")
  .map((r) => `${r.zip_name.split("/")[0]}-${path.basename(r.zip_name).replace(/\.[^.]+$/, "")}`)
  .filter((id) => fs.existsSync(path.join(outDir, `${id}.json`)))
  .map((id) => JSON.parse(fs.readFileSync(path.join(outDir, `${id}.json`), "utf8")));
const ok = all.filter((r) => r.answer);
const secs = ok.map((r) => r.seconds).sort((a, b) => a - b);
const median = secs.length ? secs[Math.floor(secs.length / 2)] : 0;
const cards = all.map((r) => {
  const a = r.answer;
  const head = `<h2>${esc(r.id)}</h2><p>${esc(r.country)} · ${r.seconds} s · ${a ? `${a.exits.length} exits` : "no plan"}${a && a.model_error ? " · model error" : ""}${a && a.photo_map ? " · photo map" : ""}</p>`;
  const pics = a ? `<a href="${esc(r.id)}.page.png"><img loading="lazy" src="${esc(r.id)}.page.png" alt="${esc(r.id)} as the page shows it"></a>`
    + (fs.existsSync(path.join(outDir, `${r.id}.read.png`)) ? ` <a href="${esc(r.id)}.read.png">What Muse Spark read</a>` : "") : `<p>${esc(r.failure || r.status)}</p>`;
  const credit = `<p class="c">“${esc(r.title.replace(/^File:/, ""))}” by ${esc(r.author)}, ${esc(r.licence)}, <a href="${esc(r.url)}" rel="noopener">source</a></p>`;
  return `<li>${head}${pics}${credit}</li>`;
}).join("\n");
fs.writeFileSync(path.join(outDir, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>HereOut sample run</title><style>
body{margin:0;background:#07100c;color:#eaf3ee;font:16px/1.5 system-ui,sans-serif}main{max-width:1240px;margin:0 auto;padding:24px 16px}
a{color:#3dffa0}ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
li{background:#0f1a15;border:1px solid #22332b;border-radius:14px;padding:12px}h2{font-size:1rem;margin:0}p{margin:4px 0;color:#a7b8b0}
img{width:100%;height:auto;border-radius:8px;display:block;margin:6px 0}.c{font-size:.8rem}</style></head><body><main>
<h1>Sample run: ${all.length} photos through the page, once</h1>
<p>Each original photo went through the photo button of the page on a local server with the current code, once, with no retry and no change after the answer. ${ok.length} plans opened; ${all.length - ok.length} did not. Median time from the upload to the open plan: ${median} s.</p>
<ul>
${cards}
</ul></main></body></html>`);
console.log(`wrote ${path.join(outDir, "index.html")}: ${ok.length} of ${all.length} opened`);
