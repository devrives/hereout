"use strict";

// Makes the way network of a plan (route.js) off the main thread, so the
// page does not stop while it is made. The page sends the grid, the exits
// and the marks, and the URL of route.js with its content hash.
let loaded = "";

onmessage = (ev) => {
  const { id, routeUrl, grid, exits, clear } = ev.data;
  if (loaded !== routeUrl) {
    importScripts(routeUrl);
    loaded = routeUrl;
  }
  const R = HereOutRoute;
  const field = new R.Field(R.decodeGrid(grid), grid.w, grid.h, grid.scale, exits, clear);
  const data = field.network().toData();
  postMessage({ id, data }, [data.room.buffer, data.nodeAt.buffer, data.open.buffer, data.wd.buffer, data.cost.buffer]);
};
