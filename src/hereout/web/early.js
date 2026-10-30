"use strict";
// Before the first paint: a plan from the address or the tab shows in place
// of the start page, so the page does not jump when it opens (app.js layout()).
try {
  if (new URL(location.href).searchParams.has("sample") || sessionStorage.getItem("hereout:photo")) {
    document.documentElement.classList.add("has-plan");
  }
} catch (e) { /* storage blocked */ }
