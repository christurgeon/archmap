import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSymbols } from "../extract.js";

const SRC = `
export function addNode(model, opts) { return 1; }
const helper = (x) => x + 1;
export class Foo {
  bar(y) { return y; }
  baz() { const localArrow = () => 1; return localArrow(); }
}
function validate(m) {
  const err = (c) => c;   // nested local — must NOT be extracted
  return err(1);
}
`;

test("extracts top-level fns, consts, classes, and methods with fqns", async () => {
  const syms = await extractSymbols(SRC, "js");
  const byFqn = Object.fromEntries(syms.map((s) => [s.fqn, s]));
  assert.ok(byFqn["addNode"] && byFqn["addNode"].kind === "fn");
  assert.ok(byFqn["helper"] && byFqn["helper"].kind === "fn");
  assert.ok(byFqn["Foo"] && byFqn["Foo"].kind === "class");
  assert.ok(byFqn["Foo.bar"] && byFqn["Foo.bar"].kind === "method");
  assert.ok(byFqn["Foo.baz"] && byFqn["Foo.baz"].kind === "method");
  assert.ok(byFqn["validate"] && byFqn["validate"].kind === "fn");
});

test("does NOT extract declarations nested inside function bodies", async () => {
  const syms = await extractSymbols(SRC, "js");
  const fqns = syms.map((s) => s.fqn);
  assert.ok(!fqns.includes("err"), "nested local arrow must be skipped");
  assert.ok(!fqns.includes("Foo.baz.localArrow"), "method-body local must be skipped");
});

test("records carry hashes and 1-based line ranges", async () => {
  const syms = await extractSymbols(SRC, "js");
  const addNode = syms.find((s) => s.fqn === "addNode");
  assert.equal(typeof addNode.bodyHash, "string");
  assert.equal(typeof addNode.sigHash, "string");
  assert.ok(addNode.startLine >= 1 && addNode.endLine >= addNode.startLine);
  const foo = syms.find((s) => s.fqn === "Foo");
  assert.equal(foo.sigHash, null); // classes have no param signature
});

test("extracts an exported arrow const (export_statement unwrap + arrow params)", async () => {
  const syms = await extractSymbols("export const build = (a, b) => a + b;\n", "js");
  const s = syms.find((x) => x.fqn === "build");
  assert.ok(s && s.kind === "fn");
  assert.equal(typeof s.sigHash, "string"); // arrow has a parameter signature
});

test("extracts a no-paren single-param arrow with a sigHash (parameter field)", async () => {
  const syms = await extractSymbols("export const g = x => x + 1;\n", "js");
  const s = syms.find((x) => x.fqn === "g");
  assert.ok(s && s.kind === "fn");
  assert.equal(typeof s.sigHash, "string"); // must NOT be null despite the no-paren form
});

test("extracts from TypeScript source (ts grammar end-to-end)", async () => {
  const syms = await extractSymbols(
    "export function greet(name: string): string { return name; }\nexport class S { m(x: number) { return x; } }\n",
    "ts",
  );
  const byFqn = Object.fromEntries(syms.map((s) => [s.fqn, s]));
  assert.ok(byFqn["greet"] && byFqn["greet"].kind === "fn");
  assert.ok(byFqn["S.m"] && byFqn["S.m"].kind === "method");
});
