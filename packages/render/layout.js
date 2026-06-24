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
