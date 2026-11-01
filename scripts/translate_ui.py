"""Translate the plan card catalogue (web/i18n.js EN) with Muse Spark.

Usage:
  uv run --env-file .env python scripts/translate_ui.py [--langs ko ja ...] [--keys KEY ...]

One text-only call for each language writes src/hereout/web/i18n/<tag>.json.
With --keys, only those keys are translated again, and the other texts of
the file stay. A text whose placeholders differ from the English text is
asked for once more; when it is still wrong, the file leaves it out (the page
then shows the English text) and the script names it. Every call goes through
the spend ledger (HEREOUT_LEDGER). Needs node, to read i18n.js.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

from hereout.reader import ModelClient, ModelError, parse_translation
from hereout.translate import LANGS

WEB = Path(__file__).resolve().parent.parent / "src" / "hereout" / "web"
PLACEHOLDER = re.compile(r"\{(\w+)\}")
TIMEOUT = 240.0
MAX_TOKENS = 24000

# How to address the reader, for the languages where the choice shows in each sentence.
STYLE = {
    "ko": ("Use the haeyo style (-해요, -세요) for every sentence, never -합니다, -습니다 or -십시오. Labels end on a noun. "
           "{turn} and {aside} hold a bare direction such as 왼쪽 or 약간 왼쪽, with no particle: the sentence adds 으로 after them. "
           "{side} and {side2} hold a whole phrase that already ends in 쪽으로 or 으로: the sentence adds nothing after them. "
           "After a name placeholder ({exit}, {backup}, {label}, {language}, {names}) put a noun such as 쪽 before any particle "
           "(\"{exit} 쪽으로\"), or end the sentence with the name. Never put 을/를, 이/가, 은/는, 와/과 or (으)로 right after a name placeholder. "
           "Write particles with one form (에, 의, 까지, 에서) right after other placeholders, with no space. "
           "HereOut ends in a consonant sound: HereOut이, HereOut은, HereOut을. An exit is \"출구 {n}\"."),
    "ja": ("Use the です/ます form for sentences and plain nouns for labels. "
           "{turn} and {aside} hold a bare direction such as 左 or 少し左, with no particle: the sentence adds に or へ after them. "
           "{side} and {side2} hold a whole phrase that already ends in へ: the sentence adds no particle after them. "
           "Put no spaces around placeholders. An exit is \"出口{n}\"."),
    "de": "Address the reader with Sie.",
    "fr": "Address the reader with vous.",
    "es": "Address the reader with usted.",
    "it": "Address the reader with Lei, or use the infinitive as signs do; keep one choice for all texts.",
    "pt": "Use neutral Portuguese that readers in Portugal and Brazil understand; address the reader with você.",
    "ru": "Address the reader with вы (polite plural imperative).",
    "uk": "Address the reader with ви (polite plural imperative).",
    "hi": "Use the polite आप form.",
    "ar": "Use Modern Standard Arabic.",
    "zh-Hans": "Use 您 where a pronoun is needed.",
}

PROMPT = """Translate the texts of a web page into {name} ({tag}). The page is HereOut. It shows the way out on a photo of a posted evacuation plan: a route on the plan and directions step by step. A person who must leave a building now reads it on a phone, so use short, plain and clear words.
Rules:
- Keep each placeholder in braces, such as {{exit}} or {{side}}, exactly as it is, once for each time it is in the English text. Never translate the word inside the braces.
- A placeholder takes a whole phrase from the same list, or a name; the note says which. Write each sentence so that the phrase fits in it with correct grammar.
- A phrase that fills a placeholder must fit every sentence that uses it.
- A placeholder for a name ({{exit}}, {{backup}}, {{label}}, {{language}}, {{names}}) can hold any name, in its basic form. Write the sentence so that the name needs no ending that agrees with it (the language notes below say how). In languages with cases, a noun before the name can take the case ("к выходу ..."), or the sentence can end with the name.
- A phrase that fills a placeholder is complete: the sentence must not add or repeat a particle, postposition or preposition that the phrase already has.
- Translate every English word, except HereOut, Muse Spark and the key names Enter, Shift and Escape.
- Keep "HereOut" and "Muse Spark" as they are.
- "The plan" is the evacuation plan posted on the wall, and its photo.
- Use one way to address the reader for all texts. {style}
- Use the quotation marks of the language.
Answer with JSON only: {{"<key>": "<translation>"}}, with one entry for each key.
Texts:
{items}"""

FAMILY = {"side_": "side_top", "turn_": "turn_left", "aside_": "aside_left", "pos_": "pos_top_left"}


def catalogue() -> tuple[dict, dict]:
    out = subprocess.run(["node", "-e", f"const I = require({json.dumps(str(WEB / 'i18n.js'))});"
                          "process.stdout.write(JSON.stringify({en: I.EN, notes: I.NOTES}))"],
                         check=True, capture_output=True, text=True).stdout
    data = json.loads(out)
    return data["en"], data["notes"]


def note_of(key: str, notes: dict) -> str | None:
    if key in notes:
        return notes[key]
    for prefix, k in FAMILY.items():
        if key.startswith(prefix):
            return notes.get(k)
    return None


def same_placeholders(a: str, b: str) -> bool:
    return sorted(PLACEHOLDER.findall(a)) == sorted(PLACEHOLDER.findall(b))


def ask(client: ModelClient, tag: str, keys: list[str], en: dict, notes: dict) -> tuple[dict, float]:
    lines = []
    for k in keys:
        item = {"key": k, "text": en[k]}
        if note_of(k, notes):
            item["note"] = note_of(k, notes)
        lines.append(json.dumps(item, ensure_ascii=False))
    prompt = PROMPT.format(name=LANGS[tag], tag=tag, style=STYLE.get(tag, ""), items="\n".join(lines))
    text, cost, _ = client._ask(prompt, timeout=TIMEOUT, max_tokens=MAX_TOKENS)
    return parse_translation(text, keys, limit=1000), cost


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--langs", nargs="*", default=[t for t in LANGS if t != "en"])
    ap.add_argument("--keys", nargs="*", help="translate only these keys again")
    args = ap.parse_args()
    client = ModelClient.from_env()
    if client is None:
        raise SystemExit("BASETEN is not set")
    en, notes = catalogue()
    (WEB / "i18n").mkdir(exist_ok=True)
    total = 0.0
    for tag in args.langs:
        if tag not in LANGS or tag == "en":
            raise SystemExit(f"not a translated language: {tag}")
        path = WEB / "i18n" / f"{tag}.json"
        old = json.loads(path.read_text()) if path.exists() else {}
        keys = args.keys or list(en)
        try:
            got, cost = ask(client, tag, keys, en, notes)
        except ModelError as e:
            print(f"{tag}: failed: {e}", flush=True)
            continue
        total += cost
        bad = [k for k in keys if k not in got or not same_placeholders(en[k], got[k])]
        if bad:
            try:
                again, cost = ask(client, tag, bad, en, notes)
                total += cost
                got.update({k: v for k, v in again.items() if same_placeholders(en[k], v)})
            except ModelError as e:
                print(f"{tag}: second try failed: {e}", flush=True)
        out = {**old, **{k: v for k, v in got.items() if same_placeholders(en[k], v)}}
        out = {k: out[k] for k in en if k in out}  # the order of the English catalogue
        path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
        missing = [k for k in en if k not in out]
        print(f"{tag}: {len(out)}/{len(en)} texts" + (f", missing {missing}" if missing else ""), flush=True)
    print(f"spent {total:.4f} USD", flush=True)


if __name__ == "__main__":
    main()
