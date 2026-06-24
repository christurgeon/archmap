import { getNode, childrenOf } from "@archmap/schema";

export function viewChildren(model, focusId, axis) {
  if (focusId === null) {
    return model.nodes.filter((n) => n.parent === null && (n.axis ?? "logical") === axis);
  }
  return childrenOf(model, focusId);
}

// Lift a leaf id up to the ancestor whose parent === focusId (i.e. a direct child of the view).
// Returns null if the leaf is not contained under the view. Cycle-safe: render(model) is
// exported and may be called without the validator gate, so it must not hang on a bad model.
function promoteToView(model, leafId, focusId) {
  const seen = new Set();
  let cur = getNode(model, leafId);
  while (cur && cur.parent !== focusId) {
    if (cur.parent === null || seen.has(cur.id)) return null;
    seen.add(cur.id);
    cur = getNode(model, cur.parent);
  }
  return cur ? cur.id : null;
}

export function promoteEdges(model, focusId, axis) {
  const childIds = new Set(viewChildren(model, focusId, axis).map((n) => n.id));
  const agg = new Map();
  for (const e of model.edges) {
    const f = promoteToView(model, e.from, focusId);
    const t = promoteToView(model, e.to, focusId);
    if (!f || !t || f === t) continue;
    if (!childIds.has(f) || !childIds.has(t)) continue;
    const key = `${f}->${t}`;
    if (!agg.has(key)) agg.set(key, { from: f, to: t, labels: [] });
    if (e.label && !agg.get(key).labels.includes(e.label)) agg.get(key).labels.push(e.label);
  }
  return [...agg.values()].map((x) => ({ from: x.from, to: x.to, label: x.labels.join(", ") }));
}
