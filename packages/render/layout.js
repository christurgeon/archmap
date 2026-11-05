import { childrenOf } from "@archmap/schema";
import { viewChildren, promoteEdges } from "./promote.js";

// A small, dependency-free layered (Sugiyama-style) layout:
//   1. break cycles (DFS back edges are drawn reversed)
//   2. longest-path layering, sources pulled down next to their targets
//   3. long edges get one dummy node per crossed layer, so they route AROUND boxes
//   4. barycenter sweeps to cut crossings (best ordering kept)
//   5. x placement by isotonic regression toward neighbour centres (straight edges)
//   6. orthogonal routing: each horizontal run gets its own track in the gap, so two
//      edges never share a line and a reader can follow any edge end to end
// Every step iterates in model order with explicit tie-breaks: output is deterministic.

const BOX_H = 64, V_GAP = 64, H_GAP = 44, MARGIN = 40;
const BOX_MIN_W = 130, BOX_MAX_W = 280;
const NAME_CHAR_W = 8.4, SUB_CHAR_W = 6.3, BOX_PAD = 48, DRILL_W = 26;
const DUMMY_W = 14, DUMMY_GAP = 16, TRACK = 12, TRACK_PAD = 18, TRACK_CLEAR = 8;
const LABEL_H = 18, LABEL_VGAP = 4, LABEL_CHAR_W = 6.8, LABEL_BASE_W = 12;
const SWEEPS = 12, PLACE_ITERS = 8;

const r1 = (v) => Math.round(v * 10) / 10;

export function boxWidth(node, opts = {}) {
  const sub = (node.kind ?? "") + (node.tech ? " · " + node.tech : "");
  const text = Math.max(String(node.name ?? "").length * NAME_CHAR_W, sub.length * SUB_CHAR_W);
  const w = Math.max(BOX_MIN_W, Math.ceil(text + BOX_PAD + (opts.drillable ? DRILL_W : 0)));
  return Math.min(BOX_MAX_W, w);
}

// Max characters of the name that fit a clamped box; the full name lives in the <title>.
export function nameFits(node, w, opts = {}) {
  return Math.floor((w - BOX_PAD - (opts.drillable ? DRILL_W : 0)) / NAME_CHAR_W);
}

function labelWidth(label) {
  return label.length * LABEL_CHAR_W + LABEL_BASE_W;
}

// Aggregated (promoted) edges can carry many labels; the box-level view keeps one and a
// count. The full list is in the edge's tooltip and in the detail panel.
export function displayLabel(labels) {
  if (!labels.length) return "";
  if (labels.length === 1) return labels[0];
  const two = labels.slice(0, 2).join(", ");
  if (labels.length === 2 && two.length <= 28) return two;
  return `${labels[0]} +${labels.length - 1}`;
}

// DFS in input order; an edge into a node still on the stack closes a cycle and is
// reversed for layering. Returns the set of reversed edge indices.
export function breakCycles(ids, edges) {
  const out = new Map(ids.map((id) => [id, []]));
  edges.forEach((e, i) => { if (out.has(e.from) && out.has(e.to)) out.get(e.from).push(i); });
  const state = new Map(); // 1 = on stack, 2 = done
  const reversed = new Set();
  for (const root of ids) {
    if (state.get(root)) continue;
    const stack = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = out.get(top[0]);
      if (top[1] >= list.length) { state.set(top[0], 2); stack.pop(); continue; }
      const ei = list[top[1]++];
      const to = edges[ei].to;
      const s = state.get(to);
      if (s === 1) reversed.add(ei);
      else if (!s) { state.set(to, 1); stack.push([to, 0]); }
    }
  }
  return reversed;
}

export function layerize(childIds, edges) {
  const ids = [...childIds];
  const idx = new Map(ids.map((id, i) => [id, i]));
  const live = edges.filter((e) => idx.has(e.from) && idx.has(e.to) && e.from !== e.to);
  const reversed = breakCycles(ids, live);
  const dag = live.map((e, i) => (reversed.has(i) ? { from: e.to, to: e.from } : e));

  const preds = new Map(ids.map((id) => [id, []]));
  const succs = new Map(ids.map((id) => [id, []]));
  for (const e of dag) { preds.get(e.to).push(e.from); succs.get(e.from).push(e.to); }

  // Kahn topological order (ties by input order) -> longest path in one pass.
  const indeg = new Map(ids.map((id) => [id, preds.get(id).length]));
  const order = [];
  const ready = ids.filter((id) => indeg.get(id) === 0);
  while (ready.length) {
    ready.sort((a, b) => idx.get(a) - idx.get(b));
    const id = ready.shift();
    order.push(id);
    for (const s of succs.get(id)) { indeg.set(s, indeg.get(s) - 1); if (indeg.get(s) === 0) ready.push(s); }
  }
  const layer = new Map(ids.map((id) => [id, 0]));
  for (const id of order) for (const s of succs.get(id)) layer.set(s, Math.max(layer.get(s), layer.get(id) + 1));

  // A pure source (a person, a cron trigger) sits directly above the first thing it uses,
  // instead of at the top with a long edge dropping through the whole diagram.
  for (const id of [...order].reverse()) {
    if (preds.get(id).length || !succs.get(id).length) continue;
    layer.set(id, Math.min(...succs.get(id).map((s) => layer.get(s))) - 1);
  }

  const maxLayer = ids.length ? Math.max(...ids.map((id) => layer.get(id))) : 0;
  const layers = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of ids) layers[layer.get(id)].push(id);
  for (const row of layers) row.sort((a, b) => idx.get(a) - idx.get(b));
  return { layers, layerOf: layer, reversed, dag: live.map((e, i) => ({ ...e, rev: reversed.has(i) })) };
}

function rectsOverlap(a, b, padX, padY) {
  return a.x < b.x + b.w + padX && b.x < a.x + a.w + padX &&
         a.y < b.y + b.h + padY && b.y < a.y + a.h + padY;
}

function countCrossings(order, links) {
  // links: [layer, upperNode, lowerNode]; crossings between adjacent layer pairs
  const pos = new Map();
  for (const row of order) row.forEach((id, i) => pos.set(id, i));
  const byLayer = new Map();
  for (const [l, u, v] of links) {
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l).push([pos.get(u), pos.get(v)]);
  }
  let c = 0;
  for (const segs of byLayer.values())
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++)
        if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) c++;
  return c;
}

// Weighted isotonic regression (pool-adjacent-violators): the positions closest to
// `desired` (least squares) that keep the row's order and minimum separations.
function placeRow(desired, minSep, weight) {
  const n = desired.length;
  const off = new Array(n).fill(0);
  for (let i = 1; i < n; i++) off[i] = off[i - 1] + minSep[i - 1];
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ sum: (desired[i] - off[i]) * weight[i], w: weight[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.w <= b.sum / b.w) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, w: a.w + b.w, n: a.n + b.n });
    }
  }
  const out = [];
  let i = 0;
  for (const b of blocks) for (let k = 0; k < b.n; k++, i++) out.push(b.sum / b.w + off[i]);
  return out;
}

// Each label starts at its anchor, then nudges vertically (0, +1, -1, +2, -2, … rows)
// until clear of every box and already-placed label. Returns the label bounds so the
// caller can grow the canvas if the stack spills past it.
function placeLabels(routed, boxes) {
  const boxRects = boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  const placed = [];
  const step = LABEL_H + LABEL_VGAP;
  const labeled = routed.filter((e) => e.label);
  labeled.sort((e1, e2) => (e1.anchor[1] - e2.anchor[1]) || (e1.anchor[0] - e2.anchor[0]));
  let minX = Infinity, maxX = -Infinity, maxBottom = 0;
  const free = (rect) => rect.y >= MARGIN / 2 &&
    !boxRects.some((r) => rectsOverlap(rect, r, 2, 2)) && !placed.some((r) => rectsOverlap(rect, r, 4, 2));
  for (const e of labeled) {
    const w = labelWidth(e.label);
    // First try spots ON the edge (longest runs first), so a label never drifts away from
    // the line it names; only if all are taken, nudge vertically off the anchor.
    const spot = e.candidates.find(([x, y]) => free({ x: x - w / 2, y: y - LABEL_H / 2, w, h: LABEL_H }));
    let [lx, anchorY] = spot ?? e.anchor;
    let cy = anchorY;
    for (let k = 0; k < 80 && !spot; k++) {
      const mult = k === 0 ? 0 : (k % 2 === 1 ? (k + 1) / 2 : -k / 2);
      const candY = anchorY + mult * step;
      if (free({ x: lx - w / 2, y: candY - LABEL_H / 2, w, h: LABEL_H })) { cy = candY; break; }
    }
    placed.push({ x: lx - w / 2, y: cy - LABEL_H / 2, w, h: LABEL_H });
    e.lx = r1(lx); e.ly = r1(cy); e.lw = r1(w);
    minX = Math.min(minX, lx - w / 2); maxX = Math.max(maxX, lx + w / 2);
    maxBottom = Math.max(maxBottom, cy + LABEL_H / 2);
  }
  return { minX, maxX, maxBottom };
}

function simplify(points) {
  const out = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 0.05 && Math.abs(q[1] - p[1]) < 0.05) continue;
    out.push(p);
  }
  // drop interior points that are collinear with their neighbours
  for (let i = out.length - 2; i >= 1; i--) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if ((Math.abs(a[0] - b[0]) < 0.05 && Math.abs(b[0] - c[0]) < 0.05) ||
        (Math.abs(a[1] - b[1]) < 0.05 && Math.abs(b[1] - c[1]) < 0.05)) out.splice(i, 1);
  }
  return out;
}

export function layoutView(model, focusId, axis) {
  const children = viewChildren(model, focusId, axis);
  const edges = promoteEdges(model, focusId, axis);
  const childIds = children.map((n) => n.id);
  const nodeById = new Map(children.map((n) => [n.id, n]));
  const { layers: realLayers, layerOf, dag } = layerize(childIds, edges);

  // ---- 3. dummy chains for edges spanning more than one layer
  const layers = realLayers.map((row) => row.slice());
  const width = new Map();
  const drillable = new Map();
  for (const n of children) {
    const d = childrenOf(model, n.id).length;
    drillable.set(n.id, d);
    width.set(n.id, boxWidth(n, { drillable: d > 0 }));
  }
  const chains = dag.map((e, ei) => {
    const top = e.rev ? e.to : e.from, bot = e.rev ? e.from : e.to;
    const chain = [top];
    for (let l = layerOf.get(top) + 1; l < layerOf.get(bot); l++) {
      const d = `\u0000d${ei}_${l}`;
      layers[l].push(d);
      width.set(d, DUMMY_W);
      chain.push(d);
    }
    chain.push(bot);
    return chain;
  });
  const isDummy = (id) => id.charCodeAt(0) === 0;
  const lyr = new Map();
  layers.forEach((row, l) => row.forEach((id) => lyr.set(id, l)));

  const up = new Map(), down = new Map(), links = [];
  for (const id of lyr.keys()) { up.set(id, []); down.set(id, []); }
  for (const chain of chains) {
    for (let i = 0; i + 1 < chain.length; i++) {
      down.get(chain[i]).push(chain[i + 1]);
      up.get(chain[i + 1]).push(chain[i]);
      links.push([lyr.get(chain[i]), chain[i], chain[i + 1]]);
    }
  }

  // ---- 4. crossing reduction
  let order = layers.map((row) => row.slice());
  let best = order.map((r) => r.slice()), bestC = countCrossings(order, links);
  for (let s = 0; s < SWEEPS && bestC > 0; s++) {
    const downward = s % 2 === 0;
    const range = downward ? [...order.keys()].slice(1) : [...order.keys()].reverse().slice(1);
    for (const l of range) {
      const ref = order[downward ? l - 1 : l + 1];
      const refPos = new Map(ref.map((id, i) => [id, i]));
      const cur = new Map(order[l].map((id, i) => [id, i]));
      const bary = (id) => {
        const nb = (downward ? up : down).get(id).filter((x) => refPos.has(x));
        if (!nb.length) return cur.get(id);
        return nb.reduce((a, x) => a + refPos.get(x), 0) / nb.length;
      };
      const keyed = order[l].map((id) => [id, bary(id), cur.get(id)]);
      keyed.sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]));
      order[l] = keyed.map((k) => k[0]);
    }
    const c = countCrossings(order, links);
    if (c < bestC) { bestC = c; best = order.map((r) => r.slice()); }
  }
  order = best;

  // ---- 5. x placement
  const sep = (a, b) => width.get(a) / 2 + width.get(b) / 2 + (isDummy(a) || isDummy(b) ? DUMMY_GAP : H_GAP);
  const cx = new Map();
  // initial: each row packed, centred on the widest row
  const rowSpan = order.map((row) => row.reduce((s, id, i) => s + (i ? sep(row[i - 1], id) : 0), 0)
    + (row.length ? width.get(row[0]) / 2 + width.get(row[row.length - 1]) / 2 : 0));
  const maxRow = Math.max(0, ...rowSpan);
  order.forEach((row, l) => {
    let x = (maxRow - rowSpan[l]) / 2 + (row.length ? width.get(row[0]) / 2 : 0);
    row.forEach((id, i) => { if (i) x += sep(row[i - 1], id); cx.set(id, x); });
  });
  for (let it = 0; it < PLACE_ITERS; it++) {
    const downward = it % 2 === 0;
    const range = downward ? [...order.keys()] : [...order.keys()].reverse();
    for (const l of range) {
      const row = order[l];
      if (!row.length) continue;
      const desired = row.map((id) => {
        const nb = [...up.get(id), ...down.get(id)];
        if (!nb.length) return cx.get(id);
        return nb.reduce((a, x) => a + cx.get(x), 0) / nb.length;
      });
      // dummies weigh more: a straight long edge reads better than a perfectly centred box
      const weight = row.map((id) => (isDummy(id) ? 2 : 1));
      const minSep = row.slice(0, -1).map((id, i) => sep(id, row[i + 1]));
      placeRow(desired, minSep, weight).forEach((x, i) => cx.set(row[i], x));
    }
  }

  // ---- ports: spread each box's edge ends along its top/bottom, ordered by the far end's x
  const outPorts = new Map(), inPorts = new Map(); // `${chainIdx}` -> x
  const portSpread = (id, list, store) => {
    if (isDummy(id)) { for (const [ci] of list) store.set(ci, cx.get(id)); return; }
    list.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    const w = width.get(id), n = list.length;
    const usable = Math.min(w - 28, Math.max(0, (n - 1) * 26));
    list.forEach(([ci], i) => store.set(ci, cx.get(id) + (n === 1 ? 0 : -usable / 2 + (usable * i) / (n - 1))));
  };
  const outsBy = new Map(), insBy = new Map();
  chains.forEach((chain, ci) => {
    const a = chain[0], b = chain[chain.length - 1];
    if (!outsBy.has(a)) outsBy.set(a, []);
    if (!insBy.has(b)) insBy.set(b, []);
    outsBy.get(a).push([ci, cx.get(chain[1])]);
    insBy.get(b).push([ci, cx.get(chain[chain.length - 2])]);
  });
  for (const [id, list] of outsBy) portSpread(id, list, outPorts);
  for (const [id, list] of insBy) portSpread(id, list, inPorts);

  // ---- 6. tracks per inter-layer gap
  const segs = order.map(() => []); // segs[l] = segments in the gap below layer l
  chains.forEach((chain, ci) => {
    for (let i = 0; i + 1 < chain.length; i++) {
      const x1 = i === 0 ? outPorts.get(ci) : cx.get(chain[i]);
      const x2 = i + 2 === chain.length ? inPorts.get(ci) : cx.get(chain[i + 1]);
      segs[lyr.get(chain[i])].push({ ci, i, x1, x2, track: -1 });
    }
  });
  const trackCount = segs.map((list) => {
    const bent = list.filter((s) => Math.abs(s.x1 - s.x2) >= 0.5);
    bent.sort((a, b) => (Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2)) || (a.ci - b.ci));
    const ends = [];
    for (const s of bent) {
      const lo = Math.min(s.x1, s.x2), hi = Math.max(s.x1, s.x2);
      let t = ends.findIndex((end) => end + TRACK_CLEAR <= lo);
      if (t < 0) { t = ends.length; ends.push(hi); } else ends[t] = hi;
      s.track = t;
    }
    return ends.length;
  });

  const gapH = trackCount.map((t, l) => (l === order.length - 1 ? 0 : Math.max(V_GAP, TRACK_PAD * 2 + Math.max(0, t - 1) * TRACK)));
  const layerY = [];
  let y = MARGIN;
  order.forEach((_, l) => { layerY.push(y); y += BOX_H + gapH[l]; });

  // ---- assemble polylines
  const pts = chains.map(() => []);
  chains.forEach((chain, ci) => {
    const a = chain[0];
    pts[ci].push([outPorts.get(ci), layerY[lyr.get(a)] + BOX_H]);
  });
  segs.forEach((list, l) => {
    const t = trackCount[l];
    const top = layerY[l] + BOX_H, bot = layerY[l + 1];
    for (const s of list) {
      const p = pts[s.ci];
      if (s.track >= 0) {
        const ty = t === 1 ? (top + bot) / 2 : top + TRACK_PAD + s.track * ((bot - top - 2 * TRACK_PAD) / Math.max(1, t - 1));
        p.push([s.x1, ty], [s.x2, ty]);
      }
      const last = s.i + 2 === chains[s.ci].length;
      if (last) p.push([s.x2, bot]);
      else p.push([s.x2, bot], [s.x2, bot + BOX_H]); // pass through the dummy's layer band
    }
  });

  const boxes = [];
  order.forEach((row, l) => {
    for (const id of row) {
      if (isDummy(id)) continue;
      const w = width.get(id);
      boxes.push({
        id, x: r1(cx.get(id) - w / 2), y: layerY[l], w, h: BOX_H, node: nodeById.get(id),
        hasChildren: drillable.get(id) > 0, childCount: drillable.get(id),
      });
    }
  });
  // Boxes come out in model order (stable SVG diffs), not in layout order.
  const modelIdx = new Map(childIds.map((id, i) => [id, i]));
  boxes.sort((a, b) => modelIdx.get(a.id) - modelIdx.get(b.id));

  const routed = dag.map((e, ci) => {
    let points = simplify(pts[ci]);
    if (e.rev) points = points.reverse();
    points = points.map(([px, py]) => [r1(px), r1(py)]);
    // label spots along the edge: each run's middle, then its thirds, longest runs first
    const runs = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const [p, q] = [points[i], points[i + 1]];
      runs.push({ p, q, len: Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + (p[1] === q[1] ? 0.5 : 0), i });
    }
    runs.sort((a, b) => (b.len - a.len) || (a.i - b.i));
    const at = ({ p, q }, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const candidates = [...runs.map((r) => at(r, 0.5)), ...runs.flatMap((r) => [at(r, 0.3), at(r, 0.7)])];
    const anchor = candidates[0] ?? points[0];
    const labels = e.labels ?? (e.label ? [e.label] : []);
    return {
      from: e.from, to: e.to, label: displayLabel(labels), labels, count: e.count ?? 1,
      // `cited` must survive routing: svg.js styles uncited edges from it, and dropping it
      // silently disabled that while the legend still advertised the distinction.
      cited: e.cited, points, anchor, candidates,
    };
  });

  const lb = placeLabels(routed, boxes);
  for (const e of routed) { delete e.anchor; delete e.candidates; }

  // Labels near the left edge may spill past the margin: shift everything right.
  const shift = Number.isFinite(lb.minX) && lb.minX < MARGIN / 2 ? Math.ceil(MARGIN / 2 - lb.minX) : 0;
  const minBox = boxes.length ? Math.min(...boxes.map((b) => b.x)) : MARGIN;
  const dx = MARGIN - minBox + shift;
  for (const b of boxes) b.x = r1(b.x + dx);
  for (const e of routed) {
    e.points = e.points.map(([px, py]) => [r1(px + dx), py]);
    if (e.lx != null) e.lx = r1(e.lx + dx);
  }
  const maxBoxR = boxes.length ? Math.max(...boxes.map((b) => b.x + b.w)) : MARGIN + BOX_MIN_W;
  const maxR = Math.max(maxBoxR, Number.isFinite(lb.maxX) ? lb.maxX + dx : 0);
  const outW = Math.ceil(maxR + MARGIN);
  const boxesBottom = layerY.length ? layerY[layerY.length - 1] + BOX_H : MARGIN;
  const height = Math.ceil(Math.max(boxesBottom + MARGIN, lb.maxBottom + MARGIN, MARGIN * 2 + BOX_H));
  return { boxes, edges: routed, width: Math.max(outW, BOX_MIN_W + MARGIN * 2), height, focusId, axis };
}
