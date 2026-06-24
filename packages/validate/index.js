import { KINDS, AXES, kindAxis, getNode, ancestorsOf, isLeaf, childrenOf, GROUNDABLE_KINDS } from "@archmap/schema";

const EDGE_LABEL_MAX_WORDS = 3;
const FANOUT_SOFT = 7;
const FANOUT_HARD = 14;
function wordCount(s) { return String(s ?? "").trim().split(/\s+/).filter(Boolean).length; }

function detectCycle(model, id) {
  const seen = new Set();
  let cur = getNode(model, id);
  while (cur && cur.parent !== null) {
    if (seen.has(cur.id)) return true;
    seen.add(cur.id);
    const p = getNode(model, cur.parent);
    if (p && p.id === id) return true;
    cur = p;
  }
  return false;
}

export function validate(model) {
  const errors = [];
  const warnings = [];
  const err = (code, message, where) => errors.push({ code, message, where });
  const warn = (code, message, where) => warnings.push({ code, message, where });

  const seenIds = new Set();
  for (const n of model.nodes) {
    if (seenIds.has(n.id)) err("DUP_ID", "duplicate node id", n.id);
    else seenIds.add(n.id);

    if (!KINDS.includes(n.kind)) err("BAD_KIND", `unknown kind ${n.kind}`, n.id);

    if (n.parent !== null && !getNode(model, n.parent)) {
      err("MISSING_PARENT", `missing parent ${n.parent}`, n.id);
    }

    const axis = n.axis ?? "logical";
    if (!AXES.includes(axis)) {
      err("BAD_AXIS", `invalid axis ${axis}`, n.id);
    } else if (KINDS.includes(n.kind) && axis !== kindAxis(n.kind)) {
      err("BAD_AXIS", `kind ${n.kind} belongs to axis ${kindAxis(n.kind)}, not ${axis}`, n.id);
    }

    if (n.grounding) {
      if (!n.grounding.repo || !n.grounding.path) {
        err("GROUNDING_REPO_PATH", "grounding requires repo and path", n.id);
      }
      if (n.grounding.lines) {
        warn("LINES_AUTHORED", "lines is derived output, not input", n.id);
      }
    }
  }

  for (const n of model.nodes) {
    if (n.parent === null) continue;
    if (detectCycle(model, n.id)) err("CONTAINMENT_CYCLE", "containment cycle", n.id);
    const p = getNode(model, n.parent);
    if (p) {
      const pAxis = p.axis ?? "logical";
      const nAxis = n.axis ?? "logical";
      if (pAxis !== nAxis) err("AXIS_INCONSISTENT", `child axis ${nAxis} != parent axis ${pAxis}`, n.id);
    }
  }

  const edgeKeys = new Set();
  for (const e of model.edges) {
    const f = getNode(model, e.from);
    const t = getNode(model, e.to);
    if (!f || !t) { err("EDGE_ENDPOINT_MISSING", "edge endpoint missing", `${e.from}->${e.to}`); continue; }
    if (e.from === e.to) err("EDGE_SELF", "self edge", e.from);
    const fAxis = f.axis ?? "logical";
    const tAxis = t.axis ?? "logical";
    if (fAxis !== tAxis) err("EDGE_CROSS_AXIS", "edge crosses axes", `${e.from}->${e.to}`);
    if (!isLeaf(model, e.from) || !isLeaf(model, e.to)) {
      err("EDGE_NOT_LEAF", "edges must connect leaves", `${e.from}->${e.to}`);
    }
    if (ancestorsOf(model, e.from).includes(e.to) || ancestorsOf(model, e.to).includes(e.from)) {
      err("EDGE_SPANS_HIERARCHY", "edge spans containment hierarchy", `${e.from}->${e.to}`);
    }
    const key = `${e.from}->${e.to}`;
    if (edgeKeys.has(key)) err("EDGE_DUP", "duplicate edge", key);
    else edgeKeys.add(key);
    if (wordCount(e.label) > EDGE_LABEL_MAX_WORDS) {
      err("EDGE_LABEL_BUDGET", `edge label exceeds ${EDGE_LABEL_MAX_WORDS} words`, key);
    }
  }

  const mapKeys = new Set();
  for (const mp of model.mappings) {
    const l = getNode(model, mp.logical);
    const d = getNode(model, mp.deploy);
    if (!l || !d) { err("MAPPING_ENDPOINT_MISSING", "mapping endpoint missing", `${mp.logical}~${mp.deploy}`); continue; }
    if ((l.axis ?? "logical") !== "logical") err("MAPPING_BAD_LOGICAL", "mapping.logical must be on the logical axis", mp.logical);
    if ((d.axis ?? "logical") !== "deploy") err("MAPPING_BAD_DEPLOY", "mapping.deploy must be on the deploy axis", mp.deploy);
    const key = `${mp.logical}~${mp.deploy}`;
    if (mapKeys.has(key)) err("MAPPING_DUP", "duplicate mapping", key);
    else mapKeys.add(key);
  }

  for (const n of model.nodes) {
    const kids = childrenOf(model, n.id).length;
    if (kids > FANOUT_HARD) err("FANOUT_HARD", `fan-out ${kids} exceeds hard cap ${FANOUT_HARD}`, n.id);
    else if (kids > FANOUT_SOFT) warn("FANOUT_SOFT", `fan-out ${kids} exceeds soft limit ${FANOUT_SOFT}`, n.id);

    if (GROUNDABLE_KINDS.includes(n.kind) && isLeaf(model, n.id)) {
      const g = n.grounding;
      const anchored = g && (g.symbol || g.region || g.iac);
      if (!anchored) err("GROUNDABLE_UNANCHORED", "groundable leaf needs a symbol, region, or iac anchor", n.id);
    }
  }

  // The axis roots form a rendered level too (the __root_<axis> view), so cap them as well.
  for (const axis of AXES) {
    const roots = model.nodes.filter((n) => n.parent === null && (n.axis ?? "logical") === axis).length;
    if (roots > FANOUT_HARD) err("FANOUT_HARD", `axis ${axis} root level has ${roots} nodes, exceeds hard cap ${FANOUT_HARD}`, `__root_${axis}`);
    else if (roots > FANOUT_SOFT) warn("FANOUT_SOFT", `axis ${axis} root level has ${roots} nodes, exceeds soft limit ${FANOUT_SOFT}`, `__root_${axis}`);
  }

  return { errors, warnings };
}
