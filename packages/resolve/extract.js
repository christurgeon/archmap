import { getParser } from "./grammar.js";
import { bodyHash, sigHash } from "./hash.js";

const FN_VALUE = new Set(["arrow_function", "function_expression"]);

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
  const root = tree.rootNode;
  const out = [];
  for (let i = 0; i < root.namedChildCount; i++) {
    let node = root.namedChild(i);
    if (node.type === "export_statement") {
      // unwrap to the inner declaration (export function/class/const ...)
      let decl = node.childForFieldName("declaration");
      if (!decl) {
        for (let j = 0; j < node.namedChildCount; j++) {
          const c = node.namedChild(j);
          if (["function_declaration", "class_declaration", "lexical_declaration", "variable_declaration"].includes(c.type)) { decl = c; break; }
        }
      }
      if (decl) node = decl; else continue;
    }
    collectDecl(node, out);
  }
  return out;
}
