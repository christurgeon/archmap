import { getParser } from "./grammar.js";
import { bodyHash, sigHash, canonNamed, hashString } from "./hash.js";

const FN_VALUE = new Set(["arrow_function", "function_expression"]);

// The synthetic per-file symbol for wiring code. Composition roots — CLI entry points,
// main(), route registration, DI wiring — are top-level STATEMENTS, and a declaration-only
// extractor sees nothing there. That is exactly where architectural relationships are
// realized, so edges wired in such a file previously had no anchor (spec §9.1).
export const MODULE_FQN = "<module>";

const DECL_TYPES = new Set([
  "function_declaration", "generator_function_declaration", "class_declaration",
  "lexical_declaration", "variable_declaration",
]);

function lines(node) {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

function recordFromFunctionish(fqn, kind, declNode, fnNode) {
  // fnNode carries parameters + body (the function_declaration itself, or the arrow/function-expression value).
  // No-paren single-param arrows (`x => ...`) expose `parameter` (singular), not `parameters` — fall back so
  // such symbols still get a non-null sigHash (otherwise sig-based RENAMED? recovery is silently unavailable).
  const params = fnNode.childForFieldName("parameters") ?? fnNode.childForFieldName("parameter");
  const body = fnNode.childForFieldName("body");
  return { fqn, kind, ...lines(declNode), bodyHash: bodyHash(body), sigHash: sigHash(params) };
}

function collectClass(node, out) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const className = nameNode.text;
  const body = node.childForFieldName("body"); // class_body
  out.push({ fqn: className, kind: "class", ...lines(node), bodyHash: bodyHash(body), sigHash: null });
  for (let i = 0; i < body.namedChildCount; i++) {
    const m = body.namedChild(i);
    if (m.type !== "method_definition") continue;
    const mName = m.childForFieldName("name");
    if (!mName) continue;
    out.push(recordFromFunctionish(`${className}.${mName.text}`, "method", m, m));
  }
}

function collectDecl(node, out) {
  if (node.type === "function_declaration") {
    const name = node.childForFieldName("name");
    if (name) out.push(recordFromFunctionish(name.text, "fn", node, node));
  } else if (node.type === "class_declaration") {
    collectClass(node, out);
  } else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const d = node.namedChild(i);
      if (d.type !== "variable_declarator") continue;
      const value = d.childForFieldName("value");
      const name = d.childForFieldName("name");
      if (name && value && FN_VALUE.has(value.type)) {
        out.push(recordFromFunctionish(name.text, "fn", d, value));
      }
    }
  }
}

export async function extractSymbols(source, lang) {
  const parser = await getParser(lang);
  const tree = parser.parse(source);
  try {
    const root = tree.rootNode;
    const out = [];
    const wiring = []; // top-level statements that are not declarations
    for (let i = 0; i < root.namedChildCount; i++) {
      const top = root.namedChild(i);
      let node = top;
      if (node.type === "export_statement") {
        // unwrap to the inner declaration (export function/class/const ...)
        let decl = node.childForFieldName("declaration");
        if (!decl) {
          for (let j = 0; j < node.namedChildCount; j++) {
            const c = node.namedChild(j);
            if (DECL_TYPES.has(c.type)) { decl = c; break; }
          }
        }
        // A bare `export { x } from "./y.js"` declares nothing but IS wiring — it is how a
        // barrel file re-exports, and a binder that ignores it loses the dependency entirely.
        if (decl) node = decl; else { wiring.push(top); continue; }
      }
      if (DECL_TYPES.has(node.type)) collectDecl(node, out);
      else wiring.push(top);
    }

    if (wiring.length) {
      // Hash the wiring statements only. Declaration bodies are deliberately excluded:
      // those already have their own bodyHash, and folding them in would make every edit
      // anywhere in the file trip every edge anchored to the module.
      const hash = hashString("module[" + wiring.map((n) => canonNamed(n)).join(",") + "]");
      out.push({
        fqn: MODULE_FQN, kind: "module",
        startLine: wiring[0].startPosition.row + 1,
        endLine: wiring[wiring.length - 1].endPosition.row + 1,
        bodyHash: hash, sigHash: null,
      });
    }
    return out;
  } finally {
    // web-tree-sitter Trees hold WASM linear memory that JS GC cannot reclaim. Without this
    // the heap grows monotonically across a repo walk and a large monorepo aborts at the
    // wasm32 ceiling rather than merely slowing down.
    tree.delete?.();
  }
}
