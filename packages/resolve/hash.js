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

// Like canon, but keeps the text of LEAF named nodes — identifiers included.
//
// canon() strips names on purpose: for a function body, a local rename is not architectural
// drift. For module WIRING the opposite holds — `validate(m)` vs `render(m)` is precisely the
// relationship, and name-blind hashing would make those two identical. The cost is that
// renaming a local in wiring code trips the hash; wiring is short, and the names are the point.
export function canonNamed(node) {
  if (!node || node.type === "comment") return "";
  if (node.namedChildCount === 0) return `${node.type}(${node.text})`;
  const parts = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = canonNamed(node.namedChild(i));
    if (c) parts.push(c);
  }
  return parts.length ? `${node.type}[${parts.join(",")}]` : node.type;
}

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

export function bodyHash(node) {
  return sha256(canon(node));
}

// For hashing a SET of nodes (the module symbol's wiring statements) rather than one subtree.
export function hashString(s) {
  return sha256(s);
}

export function sigHash(paramsNode) {
  if (!paramsNode) return null;
  return sha256("sig:" + canon(paramsNode));
}
