import { createHash } from "node:crypto";

const LITERAL_TYPES = new Set(["string", "template_string", "number"]);

// Canonical structural serialization of a tree-sitter node:
// - skip comment nodes
// - emit each named node's `type`
// - for string/number literals, include the literal text (catches flipped flags, changed timeouts, swapped queue names)
// - identifiers contribute only their type (names stripped) -> local renames are invisible
export function canon(node) {
  if (!node || node.type === "comment") return "";
  let s = node.type;
  if (LITERAL_TYPES.has(node.type)) s += `(${node.text})`;
  const parts = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = canon(node.namedChild(i));
    if (c) parts.push(c);
  }
  return parts.length ? `${s}[${parts.join(",")}]` : s;
}

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

export function bodyHash(node) {
  return sha256(canon(node));
}

export function sigHash(paramsNode) {
  if (!paramsNode) return null;
  return sha256("sig:" + canon(paramsNode));
}
