import { KINDS, AXES, kindAxis, getNode } from "@archmap/schema";

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

  return { errors, warnings };
}
