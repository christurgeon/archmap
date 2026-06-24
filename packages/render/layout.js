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

export function boxWidth(node) {
  const sub = (node.kind ?? "") + (node.tech ? " · " + node.tech : "");
  const chars = Math.max(String(node.name ?? "").length, sub.length);
  return Math.max(BOX_MIN_W, chars * CHAR_W + BOX_PAD);
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

  const width = totalW + MARGIN * 2;
  const height = MARGIN * 2 + layers.length * BOX_H + Math.max(0, layers.length - 1) * V_GAP;
  return { boxes, edges: routed, width, height, focusId, axis };
}
