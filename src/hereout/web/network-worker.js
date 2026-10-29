"use strict";

// Makes the way network of a plan (route.js) off the main thread, so the
// page does not stop while it is made. The page sends the grid, the exits
// and the soft lines, and the URL of route.js with its content hash.
let loaded = "";

onmessage = (ev) => {
  const { id, routeUrl, grid, exits } = ev.data;
  if (loaded !== routeUrl) {
    importScripts(routeUrl);
    loaded = routeUrl;
  }
  const R = HereOutRoute;
  const field = new R.Field(R.decodeGrid(grid), grid.w, grid.h, grid.scale, exits, [],
                            grid.soft ? R.decodeGrid({ ...grid, bits: grid.soft }) : null, grid.axes,
                            grid.wing ? { mask: R.decodeGrid({ ...grid, bits: grid.wing }), axes: grid.wing_axes } : null);
  const data = field.network().toData();
  const t = data.tree;
  postMessage({ id, data }, [data.room.buffer, data.open.buffer, data.pass.buffer, data.wd.buffer, data.cost.buffer, data.src.buffer,
                             t.dist.buffer, t.prev.buffer, t.inTree.buffer, t.tcost.buffer, t.tnext.buffer, t.towner.buffer]);
};
