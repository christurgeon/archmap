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

function requireNode(model, id) {
  const n = getNode(model, id);
  if (!n) throw new Error(`no such node: ${id}`);
  return n;
}

export function addNode(model, { id, name, kind, parent = null, axis, tech, blurb }) {
  if (!id) throw new Error("addNode: id required");
  if (getNode(model, id)) throw new Error(`addNode: duplicate id: ${id}`);
  if (!KINDS.includes(kind)) throw new Error(`addNode: unknown kind: ${kind}`);
  if (parent !== null && !getNode(model, parent)) throw new Error(`addNode: missing parent: ${parent}`);
  const node = { id, name, kind, parent, axis: axis ?? kindAxis(kind) };
  if (tech !== undefined) node.tech = tech;
  if (blurb !== undefined) node.blurb = blurb;
  model.nodes.push(node);
  return node;
}

export function moveNode(model, id, newParent) {
  const node = requireNode(model, id);
  if (newParent !== null) {
    requireNode(model, newParent);
    if (newParent === id || ancestorsOf(model, newParent).includes(id)) {
      throw new Error("moveNode: would create a cycle");
    }
  }
  node.parent = newParent;
  return node;
}

export function removeNode(model, id) {
  requireNode(model, id);
  if (childrenOf(model, id).length > 0) throw new Error(`removeNode: ${id} has children`);
  model.nodes = model.nodes.filter((n) => n.id !== id);
  model.edges = model.edges.filter((e) => e.from !== id && e.to !== id);
  model.mappings = model.mappings.filter((m) => m.logical !== id && m.deploy !== id);
}

export function setBlurb(model, id, text) { requireNode(model, id).blurb = text; }
export function setTech(model, id, tech) { requireNode(model, id).tech = tech; }
export function setLinks(model, id, links) { requireNode(model, id).links = links; }

export function setGrounding(model, id, { repo, path, symbol, region, iac, dashboard }) {
  const node = requireNode(model, id);
  const g = { repo: repo ?? node.grounding?.repo, path };
  if (symbol !== undefined) g.symbol = symbol;
  if (region !== undefined) g.region = region;
  if (iac !== undefined) g.iac = iac;
  if (dashboard !== undefined) g.dashboard = dashboard;
  node.grounding = g;
  return g;
}
