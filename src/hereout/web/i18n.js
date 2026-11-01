"use strict";

// The plan card in the user's language. EN is the source catalogue;
// scripts/translate_ui.py has Muse Spark translate it once for each language
// into web/i18n/<tag>.json. NOTES tell the translator where a text shows.
// A placeholder ({side}, {exit}, ...) always takes a whole phrase from the
// same catalogue or a name, so the grammar of each language holds.
// The start page stays English.

const HereOutI18n = (() => {
  // The languages, each by its own name.
  const LANGS = {
    en: "English", es: "Español", fr: "Français", de: "Deutsch", it: "Italiano", pt: "Português",
    ru: "Русский", uk: "Українська", ja: "日本語", ko: "한국어", "zh-Hans": "简体中文", hi: "हिन्दी", ar: "العربية",
  };
  const RTL = new Set(["ar"]);
  // The language tag for speech: a voice list names Chinese by its region.
  const SPEECH = { "zh-Hans": "zh-CN" };

  const EN = {
    // Language choice
    lang_label: "Language",
    // Steps: the parts first, then the sentences that take them.
    side_top: "toward the top of the plan",
    side_top_right: "toward the top right of the plan",
    side_right: "toward the right of the plan",
    side_bottom_right: "toward the bottom right of the plan",
    side_bottom: "toward the bottom of the plan",
    side_bottom_left: "toward the bottom left of the plan",
    side_left: "toward the left of the plan",
    side_top_left: "toward the top left of the plan",
    len_short: "a short way",
    len_medium: "a medium way",
    len_long: "a long way",
    turn_left: "left",
    turn_right: "right",
    turn_slight_left: "slightly left",
    turn_slight_right: "slightly right",
    aside_left: "left",
    aside_right: "right",
    step_start: "Start {side} and walk {length}.",
    step_start_aside: "Move over {side2}, then start {side} and walk {length}.",
    step_straight: "Keep going straight for {length}.",
    step_straight_aside: "Step {aside}, then keep going straight for {length}.",
    step_back: "Turn around and go back {length}.",
    step_back_aside: "Step {aside}, then turn around and go back {length}.",
    step_turn: "Turn {turn} and walk {length}.",
    step_turn_aside: "Turn {turn}, step {aside}, then walk {length}.",
    step_arrive: "Then you reach the exit.",
    // Exits
    exit_n: "Exit {n}",
    exit_n_label: "Exit {n}: {label}",
    kind_nearest: "Nearest exit",
    kind_chosen: "The exit you chose",
    kind_marked: "The exit you marked",
    you: "YOU",
    exit_word: "EXIT",
    // Plan view
    result_head: "Plan and route",
    view_group: "What the plan shows",
    view_map: "Escape map",
    view_photo: "Photo only",
    view_routes: "Routes only",
    enlarge: "Larger plan",
    stage: "Plan",
    stage_exits: "Exits",
    stage_ways: "Ways out",
    stage_you: "You",
    stage_route: "Route",
    tap_prompt: "Tap where you stand",
    legend_wall: "Wall, as HereOut reads it",
    legend_field: "Near an exit … far from one",
    legend_way: "Ways out, arrows to the exits",
    legend_route: "Your route",
    legend_other: "Route if your exit is blocked",
    legend_exit: "Exit, by number",
    tap_hint: "Tap any open spot on the plan to see the route from there.",
    // Answer card
    check_card: "Check the route and the exits against the plan.",
    steps_head: "Steps",
    steps_hint: "Tap a step to see it on the plan.",
    finding: "Finding the route…",
    backup: "If it is blocked, use {exit} (dashed line).",
    backup_plain: "If it is blocked, use {exit}.",
    route_to_n: "Route to Exit {n}",
    speak: "Read the steps aloud",
    speak_stop: "Stop reading",
    speak_check: "Check this route against the plan.",
    speak_backup: "If {exit} is blocked, use {backup}.",
    fix: "Mark the exit",
    fix_cancel: "Cancel",
    found_exits: "Use the exits HereOut found",
    fix_hint: "Tap the exit on the plan. HereOut then routes to that exit only.",
    fix_hint_add: "Tap the exit or the stairs of this floor on the plan. The other exits stay.",
    exits_head: "Route to another exit",
    exits_note: "Dashed: HereOut found no way from your spot to that exit.",
    exit_dead: "{exit}, no way found",
    back_samples: "Back to the samples",
    // Status messages under the plan
    msg_route_to: "Route to {exit}.",
    msg_check: "Check it against the plan.",
    msg_no_way_to: "HereOut found no way to {exit} in this photo. Try another exit.",
    msg_unread: "Could not read the plan. Tap \"{fix}\" and mark it, then tap where you are.",
    msg_no_exit: "No exit found. Tap \"{fix}\" and mark it on the plan.",
    msg_exit_marked: "Exit marked. Now tap where you are on the plan.",
    msg_exit_wall: "HereOut reads that exit as wall. Mark it in a doorway.",
    msg_tap_sample: "Tap the plan's own \"you are here\" mark, or any open spot, to see the route to the nearest exit.",
    msg_tap: "Tap where you are on the plan to see the route to the nearest exit.",
    msg_no_way_marked: "HereOut found no way to the exit you marked. Mark it at a doorway.",
    msg_no_way_marked_found: "HereOut found no way to the exit you marked. Mark it at a doorway, or use the exits HereOut found.",
    msg_no_exit_here: "No exit that HereOut found is on this part of the plan. If it is another floor, tap \"{fix}\" and mark the exit or the stairs of that floor. The other exits stay.",
    err_wall: "HereOut reads that spot as wall, or as outside the plan. Tap a spot in a corridor or a room.",
    err_no_way: "HereOut found no way from that spot to an exit in this photo. Try a spot in a corridor.",
    err_exits_wall: "HereOut reads every exit as part of a wall. Tap \"{fix}\" and mark one in a doorway.",
    err_other: "HereOut found no route from that spot.",
    msg_route_marked: "Route to the exit you marked.",
    msg_example: "Example start, picked by hand. Route to the nearest exit, {exit}.",
    msg_tap_other: "Tap the plan to start from another spot.",
    msg_route_nearest: "Route from the spot you chose to the nearest exit, {exit}.",
    photo_map_one: "This is a photo map. HereOut marks the exit ({names}), but draws no routes over a photo.",
    photo_map_many: "This is a photo map. HereOut marks {n} exits ({names}), but draws no routes over a photo.",
    photo_map_follow: "Follow the route printed on the map. \"{enlarge}\" shows it bigger.",
    msg_mark_tap: "Tap the exit on the plan.",
    msg_mark_tap_add: "Tap the exit or the stairs of this floor on the plan.",
    off_plan: "That spot is outside the floor plan. Tap a corridor or a room on the plan.",
    msg_mark_first: "Mark an exit first: tap \"{fix}\".",
    read_showing: "Showing what Muse Spark read on all of the photo.",
    read_back: "Back to the plan and the route.",
    read_tap: "Tap the plan or press Enter to go back to the route.",
    // Keyboard and screen reader texts of the plan
    kbd_map: "Arrow keys move the marker, Shift moves it faster. The marker names the closest exit.",
    kbd_mark: "Arrow keys move the marker, Shift moves it faster. Enter places the exit. Escape cancels.",
    kbd_start: "Arrow keys move the marker, Shift moves it faster. Enter starts the route there.",
    plan_label_map: "Plan, a photo map. HereOut marks the exits only. Move the marker with the arrow keys to hear the closest exit.",
    plan_label_mark: "Plan. Mark the exit: tap it, or move the marker with the arrow keys and press Enter.",
    plan_label: "Plan. Tap a spot to see the route from there, or move the marker with the arrow keys and press Enter.",
    pos_top_left: "top left of the plan",
    pos_top_middle: "top middle of the plan",
    pos_top_right: "top right of the plan",
    pos_middle_left: "middle left of the plan",
    pos_middle: "middle of the plan",
    pos_middle_right: "middle right of the plan",
    pos_bottom_left: "bottom left of the plan",
    pos_bottom_middle: "bottom middle of the plan",
    pos_bottom_right: "bottom right of the plan",
    marker: "Marker: {at}.",
    marker_near: "Marker: {at}, closest exit mark {exit}.",
    marker_off: "Marker: {at}, outside the floor plan.",
    marker_off_near: "Marker: {at}, outside the floor plan, closest exit mark {exit}.",
    // What the plan says (the words that Muse Spark read on the plan)
    words_head: "What the plan says",
    words_lang: "The plan is in {language}.",
    words_lang_unknown: "The language of the plan is not known.",
    words_legend: "Legend",
    words_instructions: "Instructions on the plan",
    words_on_plan: "On the plan:",
    words_note: "Muse Spark read these words on the photo and translated them. Check them against the plan.",
    words_wait: "Translating…",
    words_loaded: "Translation loaded.",
    words_failed: "No translation now. The words show in English.",
  };

  // For the translator: where each text shows, and what fills a placeholder.
  const NOTES = {
    lang_label: "Label of the language menu.",
    side_top: "Whole direction phrase on the printed plan (not left or right of the body), with the word for \"toward\" in it. Fills {side} or {side2}; the step sentences add no word for \"toward\" or \"side\" around it.",
    len_short: "Phrase for a distance (never a time), short compared with the plan, in the form that fits right after the verbs walk, keep going and go back. Fills {length} in: \"Start {side} and walk {length}.\", \"Keep going straight for {length}.\", \"Turn around and go back {length}.\". It must fit all of them.",
    len_medium: "As len_short, a walk of medium length.",
    len_long: "As len_short, a long walk.",
    turn_left: "The direction of a turn, as a bare word or adverb with no verb (and no particle where the language notes say so). Fills {turn} in \"Turn {turn} and walk {length}.\" and \"Turn {turn}, step {aside}, then walk {length}.\".",
    aside_left: "The direction of a small side step, as a bare word or adverb with no verb (and no particle where the language notes say so). Fills {aside} in \"Step {aside}, then ...\" and \"Turn {turn}, step {aside}, then walk {length}.\".",
    step_start: "First step. {side}: a whole direction phrase such as \"toward the top of the plan\", which already ends with its own preposition, postposition or particle: put nothing between it and the verb. {length}: a phrase such as \"a short way\".",
    step_start_aside: "First step with a side step first. {side2} and {side}: whole direction phrases on the plan, such as \"toward the left of the plan\"; add no word for \"toward\" or \"side\" around them.",
    step_straight_aside: "{aside}: a direction with no verb, such as \"left\".",
    step_back_aside: "{aside}: a direction with no verb, such as \"left\".",
    step_turn: "{turn}: a direction with no verb, such as \"left\" or \"slightly left\".",
    step_turn_aside: "{turn}: a direction with no verb, such as \"slightly left\"; {aside}: a direction with no verb, such as \"right\".",
    exit_n: "Name of an exit by its number on the plan.",
    exit_n_label: "Name of an exit: its number, then the short description that the model wrote.",
    you: "Short label drawn on the plan at the spot where the user stands. Translate it as the short \"you are here\" label of posted plans in the language, never as a bare pronoun. In capitals where the script has them.",
    exit_word: "Short label drawn on the plan beside the one exit mark. One short word in capitals where the script has them.",
    view_map: "Toggle button: shows the coloured escape map on the plan.",
    view_photo: "Toggle button: shows the photo without the escape map.",
    view_routes: "Toggle button: shows the routes on the walls only, without the photo.",
    enlarge: "Toggle button: shows the plan larger.",
    stage: "Name of the plan area, for screen readers.",
    stage_exits: "One of four short labels above the plan that show what the plan shows now: the exits that the model found.",
    stage_ways: "One of four short labels above the plan: the ways out to the exits, drawn on the plan.",
    stage_you: "One of four short labels above the plan: the place where the user stands (the user taps it). Use the same idea as the \"you are here\" label, in normal case.",
    stage_route: "One of four short labels above the plan: the route to the exit.",
    tap_prompt: "Short prompt on the plan while it waits for the user to tap the spot where they stand. An instruction to one person, polite.",
    legend_field: "Legend of a colour scale: a green glow near an exit that fades far from one.",
    route_to_n: "Button that shows the route to that exit.",
    backup: "{exit}: the name of an exit, such as \"Exit 2\".",
    speak_backup: "{exit} and {backup}: names of exits.",
    fix: "Button: the user marks the exit on the plan by hand.",
    exit_dead: "{exit}: the name of an exit.",
    msg_unread: "{fix}: the label of the \"Mark the exit\" button. Use the quotation marks of the language.",
    msg_no_exit: "{fix}: the label of the \"Mark the exit\" button. Use the quotation marks of the language.",
    msg_no_exit_here: "{fix}: the label of the \"Mark the exit\" button. Use the quotation marks of the language.",
    err_exits_wall: "{fix}: the label of the \"Mark the exit\" button. Use the quotation marks of the language.",
    msg_mark_first: "{fix}: the label of the \"Mark the exit\" button. Use the quotation marks of the language.",
    msg_tap_sample: "A posted plan often has its own \"you are here\" mark.",
    photo_map_many: "{n} is a number of 2 or more; {names}: a list of exit names. Phrase it so that it fits any number.",
    photo_map_follow: "{enlarge}: the label of the \"Larger plan\" button.",
    read_showing: "Muse Spark is the name of the AI model; keep it.",
    pos_top_left: "A position of the keyboard marker on the plan. Fills {at}.",
    marker: "Screen reader message. {at}: a position such as \"top left of the plan\".",
    marker_near: "{at}: a position; {exit}: the name of an exit.",
    marker_off_near: "{at}: a position; {exit}: the name of an exit.",
    words_head: "Heading of the section that shows the words printed on the evacuation plan, translated.",
    words_lang: "{language}: the name of a language, as the browser gives it in this language.",
    words_on_plan: "Hidden text for screen readers, before the original text as printed on the plan.",
    words_note: "Muse Spark is the name of the AI model; keep it.",
  };

  let lang = "en";
  let cat = EN;

  // A text with its placeholders filled.
  function t(key, vars) {
    const s = (cat[key] !== undefined ? cat[key] : EN[key]);
    if (s === undefined) return key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m)) : s;
  }

  // Upper case for the first letter of a sentence that starts with a phrase.
  function sentence(s) {
    return s ? s.charAt(0).toLocaleUpperCase(lang === "en" ? "en" : lang) + s.slice(1) : s;
  }

  const code = (s) => s.replace(/ /g, "_");

  // The text of a step (route.js directions, step.say) in the language.
  function stepText(say) {
    if (!say) return "";
    const vars = {};
    if (say.side) vars.side = t(`side_${code(say.side)}`);
    if (say.side2) vars.side2 = t(`side_${code(say.side2)}`);
    if (say.length) vars.length = t(`len_${say.length}`);
    if (say.turn) vars.turn = t(`turn_${code(say.turn)}`);
    if (say.aside) vars.aside = t(`aside_${say.aside}`);
    return sentence(t(`step_${say.key}`, vars));
  }

  // Sentences in a row. Chinese and Japanese put no space after a full stop.
  function join(parts) {
    return parts.filter(Boolean).reduce((out, p) => (!out ? p : /[。！？]$/.test(out) ? out + p : `${out} ${p}`), "");
  }

  // The supported language for a list of browser languages, or "en".
  function pick(tags) {
    for (const tag of tags || []) {
      const t0 = String(tag);
      if (LANGS[t0]) return t0;
      const [base, ...rest] = t0.split("-");
      const low = base.toLowerCase();
      if (low === "zh") {
        // Simplified Chinese only: a reader of Traditional Chinese gets the next language.
        const sub = rest.map((r) => r.toLowerCase());
        if (!sub.length || sub.includes("hans") || sub.includes("cn") || sub.includes("sg")) return "zh-Hans";
        continue;
      }
      if (LANGS[low]) return low;
    }
    return "en";
  }

  function use(tag, catalogue) {
    lang = LANGS[tag] ? tag : "en";
    cat = lang === "en" ? EN : { ...EN, ...(catalogue || {}) };
  }

  return {
    LANGS, RTL, SPEECH, EN, NOTES, t, stepText, sentence, join, pick, use,
    get lang() { return lang; },
    dir: (tag) => (RTL.has(tag) ? "rtl" : "ltr"),
  };
})();

if (typeof module !== "undefined") module.exports = HereOutI18n;
