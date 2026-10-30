"use strict";

// Makes the way network of a plan (route.js) off the main thread, so the
// page does not stop while it is made. The page sends the grid, the exits
// and the soft lines, and the URL of route.js with its content hash.
// After the network, the worker makes the tree to each single exit and the
// network of a wing: the first tap needs some of them, and on a phone each
// takes about a second. It makes one for each task, so a new job does not
// wait for all of them, and sends { id, done } at the end. A message
// { id, need, wing } puts the trees that a tap waits for first. The wing
// network stays before every wing tree, so the page can take each tree.
let loaded = "";
let current = 0;
let todo = [];  // [key, make] of the current job: "wing", "t<exit>", "w<exit>" (wing tree)

const treeBuffers = (t) => [t.dist.buffer, t.prev.buffer, t.inTree.buffer, t.tcost.buffer, t.tnext.buffer, t.towner.buffer];

onmessage = (ev) => {
  if (ev.data.need) {
    if (ev.data.id !== current) return;
    const keys = [...(ev.data.wing ? ["wing"] : []), ...ev.data.need.flatMap((k) => [`t${k}`, ...(ev.data.wing ? [`w${k}`] : [])])];
    const first = keys.map((key) => todo.find((t) => t[0] === key)).filter(Boolean);
    todo = [...first, ...todo.filter((t) => !first.includes(t))];
    return;
  }
  const { id, routeUrl, grid, exits } = ev.data;
  if (loaded !== routeUrl) {
    importScripts(routeUrl);
    loaded = routeUrl;
  }
  current = id;
  const R = HereOutRoute;
  const field = new R.Field(R.decodeGrid(grid), grid.w, grid.h, grid.scale, exits, [],
                            grid.soft ? R.decodeGrid({ ...grid, bits: grid.soft }) : null, grid.axes,
                            grid.wing ? { mask: R.decodeGrid({ ...grid, bits: grid.wing }), axes: grid.wing_axes } : null);
  const net = field.network();
  // The grid layers are copied, not moved: the trees below need them here.
  const data = net.toData();
  postMessage({ id, data }, treeBuffers(data.tree));
  todo = [];
  if (field.wing) {
    todo.push(["wing", () => {
      const w = field.wingNetwork().toData();
      postMessage({ id, wingData: w }, treeBuffers(w.tree));
    }]);
  }
  const sendTree = (k, wing) => [`${wing ? "w" : "t"}${k}`, () => {
    const n = wing ? field.wingNetwork() : net;
    const t = n.treeData(k);
    n.trees.delete(k);
    postMessage({ id, k, wing, tree: t }, [t.best.buffer, t.prevMove.buffer, t.nextMove.buffer]);
  }];
  for (let k = 0; k < exits.length; k++) {
    todo.push(sendTree(k, false));
    if (field.wing) todo.push(sendTree(k, true));
  }
  const step = () => {
    if (current !== id) return;
    const job = todo.shift();
    if (!job) { postMessage({ id, done: true }); return; }
    job[1]();
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
};
