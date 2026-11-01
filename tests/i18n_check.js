// The catalogues of the plan card (web/i18n.js, web/i18n/<tag>.json).
// Used by test_plan_words.py. Exits with 1 and prints the faults.
const fs = require("fs");
const path = require("path");
const R = require("../src/hereout/web/route.js");
const I = require("../src/hereout/web/i18n.js");

const faults = [];
const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join(" ");
const dir = path.join(__dirname, "../src/hereout/web/i18n");
const tags = Object.keys(I.LANGS).filter((t) => t !== "en");

// Every language has every key, and the same placeholders as English.
for (const tag of tags) {
  const file = path.join(dir, `${tag}.json`);
  if (!fs.existsSync(file)) { faults.push(`${tag}: no catalogue`); continue; }
  const cat = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const k of Object.keys(I.EN)) {
    if (typeof cat[k] !== "string" || !cat[k].trim()) faults.push(`${tag}: no ${k}`);
    else if (holes(cat[k]) !== holes(I.EN[k])) faults.push(`${tag}: ${k} has "${holes(cat[k])}", English "${holes(I.EN[k])}"`);
  }
  for (const k of Object.keys(cat)) if (!(k in I.EN)) faults.push(`${tag}: extra key ${k}`);
}

// Routes on random grids: in English the step texts from the parts are the
// texts of route.js, and in each language every placeholder is filled.
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const says = [];
for (let n = 0; n < 400; n++) {
  const w = 200 + rand() * 600, h = 200 + rand() * 600;
  const pts = [[rand() * w, rand() * h]];
  const legs = 1 + Math.floor(rand() * 7);
  for (let k = 0; k < legs; k++) {
    const last = pts[pts.length - 1];
    const step = 1 + Math.floor(rand() * 12);
    const dx = (rand() - 0.5) * w * 0.6, dy = (rand() - 0.5) * h * 0.6;
    for (let s = 1; s <= step; s++) pts.push([last[0] + dx * s / step + (rand() - 0.5) * 3, last[1] + dy * s / step + (rand() - 0.5) * 3]);
  }
  for (const s of R.directions(pts, w, h)) {
    says.push(s.say);
    I.use("en");
    const t = I.stepText(s.say);
    if (t !== s.text) faults.push(`en step "${t}" is not "${s.text}"`);
  }
}
const keys = new Set(says.map((s) => s.key));
for (const k of ["start", "straight", "turn", "back", "arrive"]) if (!keys.has(k)) faults.push(`no random route gave a "${k}" step`);
for (const tag of tags) {
  const file = path.join(dir, `${tag}.json`);
  if (!fs.existsSync(file)) continue;
  I.use(tag, JSON.parse(fs.readFileSync(file, "utf8")));
  for (const say of says) {
    const t = I.stepText(say);
    if (/[{}]/.test(t) || /\b(undefined|null)\b/.test(t)) faults.push(`${tag}: step "${t}"`);
  }
}

// The browser languages pick a supported language, else English.
const pick = [[["ko-KR", "en"], "ko"], [["zh-TW", "ja"], "ja"], [["zh-CN"], "zh-Hans"], [["zh"], "zh-Hans"],
  [["pt-BR"], "pt"], [["nl", "de-AT"], "de"], [["nl"], "en"], [[], "en"]];
for (const [list, want] of pick) if (I.pick(list) !== want) faults.push(`pick ${list} gave ${I.pick(list)}, not ${want}`);

if (faults.length) {
  console.log([...new Set(faults)].slice(0, 40).join("\n"));
  process.exit(1);
}
console.log(`ok: ${tags.length} catalogues, ${says.length} steps`);
