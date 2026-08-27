import { createHash } from "node:crypto";

const LITERAL_TYPES = new Set(["string", "template_string", "number"]);

// Structural serialization: node type only, comments skipped. String/number literals keep
// their text (catches flipped flags, changed timeouts); identifiers keep only their type,
// so local renames are invisible.
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

// Like canon() but keeps identifier text. canon() strips names because a local rename inside
// a function body isn't architectural drift — but wiring's identity IS its names, e.g.
// `validate(m)` vs `render(m)`, so name-blind hashing there would erase the relationship.
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
