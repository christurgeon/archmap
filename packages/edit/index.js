import * as ops from "@archmap/schema";
import { validate } from "@archmap/validate";

// The edit ops (spec §6) as data, so an agent can author a change as one JSON batch instead
// of writing a script against the schema API. Each entry names the op and its arguments in
// the order the schema function takes them.
const SIGNATURES = {
  addNode: ["node"],
  moveNode: ["id", "parent"],
  removeNode: ["id"],
  setBlurb: ["id", "blurb"],
  setTech: ["id", "tech"],
  setLinks: ["id", "links"],
  setGrounding: ["id", "grounding"],
  addEdge: ["from", "to", "label"],
  removeEdge: ["from", "to"],
  setEdgeLabel: ["from", "to", "label"],
  setEdgeEvidence: ["from", "to", "evidence"],
  addMapping: ["logical", "deploy", "label"],
  removeMapping: ["logical", "deploy"],
};
export const OPS = Object.keys(SIGNATURES);

function argsFor(op) {
  const sig = SIGNATURES[op.op];
  // addNode takes the node object itself; accept it flat ({op, id, name, …}) or nested.
  if (op.op === "addNode") {
    const { op: _, node, ...flat } = op;
    return [node ?? flat];
  }
  return sig.map((k) => {
    if (!(k in op)) {
      // `parent: null` (move to root) and `evidence: null` (clear) are meaningful; a missing
      // key is not, so it fails instead of silently becoming undefined.
      throw new Error(`${op.op}: missing "${k}"`);
    }
    return op[k];
  });
}

// All-or-nothing: ops apply to a copy, and the copy is returned only if every op succeeds
// and the result passes the gate. A half-applied batch is never observable.
export function applyOps(model, batch) {
  if (!Array.isArray(batch)) throw new Error("ops must be a JSON array");
  const next = structuredClone(model);
  batch.forEach((op, i) => {
    if (!op || !SIGNATURES[op.op]) {
      throw new Error(`op #${i}: unknown op ${JSON.stringify(op?.op)} (known: ${OPS.join(", ")})`);
    }
    try {
      ops[op.op](next, ...argsFor(op));
    } catch (e) {
      throw new Error(`op #${i} (${op.op}): ${e.message}`);
    }
  });
  const { errors, warnings } = validate(next);
  return { model: next, errors, warnings };
}
