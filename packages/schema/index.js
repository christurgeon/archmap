import { readFileSync, writeFileSync } from "node:fs";

export const LOGICAL_KINDS = ["person", "system", "external", "container", "store", "tenant", "component"];
export const DEPLOY_KINDS = ["cloud", "network", "infra", "workload"];
export const KINDS = [...LOGICAL_KINDS, ...DEPLOY_KINDS];
export const AXES = ["logical", "deploy"];
export const GROUNDABLE_KINDS = ["component", "store", "infra", "workload", "container"];

export function kindAxis(kind) {
  return DEPLOY_KINDS.includes(kind) ? "deploy" : "logical";
}

export function createModel({ name, version, snapshot }) {
  return { meta: { name, version, snapshot }, nodes: [], edges: [], mappings: [] };
}

export function loadModel(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function saveModel(path, model) {
  writeFileSync(path, JSON.stringify(model, null, 2) + "\n");
}

export function getNode(model, id) {
  return model.nodes.find((n) => n.id === id) ?? null;
}

export function childrenOf(model, id) {
  return model.nodes.filter((n) => n.parent === id);
}

export function isLeaf(model, id) {
  return !model.nodes.some((n) => n.parent === id);
}

// nearest-first ancestor ids; cycle-safe (stops if it revisits a node).
export function ancestorsOf(model, id) {
  const out = [];
  const seen = new Set([id]);
  let cur = getNode(model, id);
  while (cur && cur.parent !== null) {
    const p = getNode(model, cur.parent);
    if (!p || seen.has(p.id)) break;
    seen.add(p.id);
    out.push(p.id);
    cur = p;
  }
  return out;
}
