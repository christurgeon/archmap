import { getParser } from "./grammar.js";
import { bodyHash, sigHash, canonNamed, hashString } from "./hash.js";

const FN_VALUE = new Set(["arrow_function", "function_expression"]);

// Synthetic per-file symbol for top-level wiring (CLI entry points, main(), route
// registration, DI). These are statements, not declarations, so a declaration-only
// extractor sees nothing there — and edges wired in such a file had no anchor (§9.1).
export const MODULE_FQN = "<module>";

const DECL_TYPES = new Set([
  "function_declaration", "generator_function_declaration", "class_declaration",
  "lexical_declaration", "variable_declaration",
]);

function lines(node) {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

function recordFromFunctionish(fqn, kind, declNode, fnNode, exported = false) {
  // fnNode carries parameters + body. No-paren single-param arrows (`x => ...`) expose
  // `parameter` (singular), not `parameters` — fall back so sigHash stays non-null
  // (otherwise sig-based RENAMED? recovery is silently unavailable for this shape).
  const params = fnNode.childForFieldName("parameters") ?? fnNode.childForFieldName("parameter");
  const body = fnNode.childForFieldName("body");
  return { fqn, kind, exported, ...lines(declNode), bodyHash: bodyHash(body), sigHash: sigHash(params) };
}

function collectClass(node, out, exported = false) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const className = nameNode.text;
  const body = node.childForFieldName("body"); // class_body
  out.push({ fqn: className, kind: "class", exported, ...lines(node), bodyHash: bodyHash(body), sigHash: null });
  for (let i = 0; i < body.namedChildCount; i++) {
    const m = body.namedChild(i);
    if (m.type !== "method_definition") continue;
    const mName = m.childForFieldName("name");
    if (!mName) continue;
    // methods are never independently exported; a class is one unit
    out.push(recordFromFunctionish(`${className}.${mName.text}`, "method", m, m, false));
  }
}

function collectDecl(node, out, exported = false) {
  if (node.type === "function_declaration") {
    const name = node.childForFieldName("name");
    if (name) out.push(recordFromFunctionish(name.text, "fn", node, node, exported));
  } else if (node.type === "class_declaration") {
    collectClass(node, out, exported);
  } else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const d = node.namedChild(i);
      if (d.type !== "variable_declarator") continue;
      const value = d.childForFieldName("value");
      const name = d.childForFieldName("name");
      if (name && value && FN_VALUE.has(value.type)) {
        out.push(recordFromFunctionish(name.text, "fn", d, value, exported));
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
    const clauses = []; // { local, exportedAs } from `export { a as b }` (no `from`)
    for (let i = 0; i < root.namedChildCount; i++) {
      const top = root.namedChild(i);
      let node = top;
      let exported = false;
      if (node.type === "export_statement") {
        exported = true;
        // `export { a as b }` declares nothing here; record the mapping for pass 2.
        // A re-export (`export { x } from "./y"`) has a source and is wiring, not a local decl.
        const hasSource = !!node.childForFieldName("source");
        for (let j = 0; j < node.namedChildCount; j++) {
          const c = node.namedChild(j);
          if (c.type !== "export_clause" || hasSource) continue;
          for (let k = 0; k < c.namedChildCount; k++) {
            const spec = c.namedChild(k);
            if (spec.type !== "export_specifier") continue;
            const nm = spec.childForFieldName("name");
            const alias = spec.childForFieldName("alias");
            if (nm) clauses.push({ local: nm.text, exportedAs: (alias ?? nm).text });
          }
        }
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
      if (DECL_TYPES.has(node.type)) collectDecl(node, out, exported);
      else wiring.push(top);
    }

    // Pass 2: `export { a }` marks a's declaration exported; `export { a as b }` records it
    // under the EXPORTED name, since that is the name the outside world depends on (§7.1).
    for (const { local, exportedAs } of clauses) {
      const rec = out.find((r) => r.fqn === local);
      if (!rec) continue;
      rec.exported = true;
      rec.fqn = exportedAs;
    }

    if (wiring.length) {
      // Hash only the wiring statements. Declaration bodies are excluded — they have their
      // own bodyHash, and folding them in would make every edit in the file trip every
      // module-anchored edge.
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
