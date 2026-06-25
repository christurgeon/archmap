import { childrenOf } from "@archmap/schema";
import { viewChildren, promoteEdges } from "./promote.js";

export function layerize(childIds, edges) {
  const ids = [...childIds];
  const idx = new Map(ids.map((id, i) => [id, i]));
  const preds = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (idx.has(e.from) && idx.has(e.to)) preds.get(e.to).push(e.from);
  }
  const layer = new Map(ids.map((id) => [id, 0]));
  for (let iter = 0; iter < ids.length; iter++) {
    let changed = false;
    for (const id of ids) {
      for (const p of preds.get(id)) {
        const cand = layer.get(p) + 1;
        if (cand > layer.get(id)) { layer.set(id, cand); changed = true; }
      }
    }
    if (!changed) break;
  }
  const maxLayer = ids.length ? Math.max(...ids.map((id) => layer.get(id))) : 0;
  const layers = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of ids) layers[layer.get(id)].push(id);
  for (const row of layers) row.sort((a, b) => idx.get(a) - idx.get(b));
  return { layers, layerOf: layer };
}

const BOX_H = 64, V_GAP = 70, H_GAP = 40, CHAR_W = 8, BOX_PAD = 24, BOX_MIN_W = 130, MARGIN = 40;
const LABEL_H = 18, LABEL_VGAP = 4, LABEL_CHAR_W = 6.8, LABEL_BASE_W = 12;

export function boxWidth(node) {
  const sub = (node.kind ?? "") + (node.tech ? " · " + node.tech : "");
  const chars = Math.max(String(node.name ?? "").length, sub.length);
  return Math.max(BOX_MIN_W, chars * CHAR_W + BOX_PAD);
}

function labelWidth(label) {
  return label.length * LABEL_CHAR_W + LABEL_BASE_W;
}

function rectsOverlap(a, b, padX, padY) {
  return a.x < b.x + b.w + padX && b.x < a.x + a.w + padX &&
         a.y < b.y + b.h + padY && b.y < a.y + a.h + padY;
}

// Keeping labels legible and non-overlapping is the renderer's job, not
// something a model author hand-tunes. Each label starts at the midpoint of
// its edge's horizontal segment, then nudges vertically (0, +1, -1, +2, -2, …
// rows) until it clears every box and every already-placed label. Returns the
// lowest label bottom so the caller can grow the canvas if the stack spills past it.
function placeLabels(routed, boxes) {
  const boxRects = boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  const placed = [];
  const step = LABEL_H + LABEL_VGAP;
  const labeled = routed.filter((e) => e.label);
  // Top-to-bottom, then left-to-right: predictable, stable stacking.
  labeled.sort((e1, e2) => {
    const dy = e1.points[1][1] - e2.points[1][1];
    if (dy !== 0) return dy;
    return (e1.points[1][0] + e1.points[2][0]) - (e2.points[1][0] + e2.points[2][0]);
  });
  let maxBottom = 0;
  for (const e of labeled) {
    const lx = (e.points[1][0] + e.points[2][0]) / 2;
    const w = labelWidth(e.label);
    const anchorY = e.points[1][1];
    let cy = anchorY;
    for (let k = 0; k < 80; k++) {
      const mult = k === 0 ? 0 : (k % 2 === 1 ? (k + 1) / 2 : -k / 2);
      const candY = anchorY + mult * step;
      const rect = { x: lx - w / 2, y: candY - LABEL_H / 2, w, h: LABEL_H };
      if (rect.y < MARGIN / 2) continue; // don't drift above the top margin
      const hitsBox = boxRects.some((r) => rectsOverlap(rect, r, 2, 2));
      const hitsLabel = placed.some((r) => rectsOverlap(rect, r, 4, 2));
      if (!hitsBox && !hitsLabel) { cy = candY; break; }
    }
    placed.push({ x: lx - w / 2, y: cy - LABEL_H / 2, w, h: LABEL_H });
    e.lx = lx; e.ly = cy; e.lw = w;
    maxBottom = Math.max(maxBottom, cy + LABEL_H / 2);
  }
  return maxBottom;
}

export function layoutView(model, focusId, axis) {
  const children = viewChildren(model, focusId, axis);
  const edges = promoteEdges(model, focusId, axis);
  const childIds = children.map((n) => n.id);
  const { layers } = layerize(childIds, edges);
  const nodeById = new Map(children.map((n) => [n.id, n]));

  const rowWidths = layers.map((row) =>
    row.reduce((w, id) => w + boxWidth(nodeById.get(id)), 0) + Math.max(0, row.length - 1) * H_GAP
  );
  const totalW = Math.max(BOX_MIN_W, ...(rowWidths.length ? rowWidths : [0]));

  const boxes = [];
  layers.forEach((row, li) => {
    let x = MARGIN + (totalW - rowWidths[li]) / 2;
    const y = MARGIN + li * (BOX_H + V_GAP);
    for (const id of row) {
      const n = nodeById.get(id);
      const w = boxWidth(n);
      boxes.push({ id, x, y, w, h: BOX_H, node: n, hasChildren: childrenOf(model, id).length > 0 });
      x += w + H_GAP;
    }
  });

  const boxIndex = new Map(boxes.map((b) => [b.id, b]));
  const routed = edges.map((e) => {
    const a = boxIndex.get(e.from);
    const b = boxIndex.get(e.to);
    const x1 = a.x + a.w / 2, y1 = a.y + a.h;
    const x2 = b.x + b.w / 2, y2 = b.y;
    const ymid = (y1 + y2) / 2;
    return { from: e.from, to: e.to, label: e.label, points: [[x1, y1], [x1, ymid], [x2, ymid], [x2, y2]] };
  });

  const labelBottom = placeLabels(routed, boxes);

  const width = totalW + MARGIN * 2;
  const boxesHeight = MARGIN * 2 + layers.length * BOX_H + Math.max(0, layers.length - 1) * V_GAP;
  const height = Math.max(boxesHeight, labelBottom + MARGIN);
  return { boxes, edges: routed, width, height, focusId, axis };
}
