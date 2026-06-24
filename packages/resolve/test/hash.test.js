import { test } from "node:test";
import assert from "node:assert/strict";
import { getParser } from "../grammar.js";
import { bodyHash, sigHash, canon } from "../hash.js";

async function fnBody(src) {
  const parser = await getParser("js");
  const tree = parser.parse(src);
  const fn = tree.rootNode.namedChild(0); // function_declaration
  return { body: fn.childForFieldName("body"), params: fn.childForFieldName("parameters") };
}

test("bodyHash ignores comments and whitespace", async () => {
  const a = await fnBody("function f(){ return 1 + 2; }");
  const b = await fnBody("function f(){\n  // a comment\n  return 1   +   2;\n}");
  assert.equal(bodyHash(a.body), bodyHash(b.body));
});

test("bodyHash ignores local identifier renames", async () => {
  const a = await fnBody("function f(){ const x = 1; return x; }");
  const b = await fnBody("function f(){ const renamed = 1; return renamed; }");
  assert.equal(bodyHash(a.body), bodyHash(b.body));
});

test("bodyHash is sensitive to literal changes", async () => {
  const a = await fnBody("function f(){ return 1; }");
  const b = await fnBody("function f(){ return 2; }");
  assert.notEqual(bodyHash(a.body), bodyHash(b.body));
  const c = await fnBody('function f(){ return "queue-a"; }');
  const d = await fnBody('function f(){ return "queue-b"; }');
  assert.notEqual(bodyHash(c.body), bodyHash(d.body));
});

test("bodyHash distinguishes boolean literals (true/false are distinct node types)", async () => {
  const a = await fnBody("function f(){ return true; }");
  const b = await fnBody("function f(){ return false; }");
  assert.notEqual(bodyHash(a.body), bodyHash(b.body));
});

test("bodyHash is sensitive to structural changes", async () => {
  const a = await fnBody("function f(){ return 1; }");
  const b = await fnBody("function f(){ if (x) return 1; return 0; }");
  assert.notEqual(bodyHash(a.body), bodyHash(b.body));
});

test("sigHash: same arity survives body edits; null params -> null", async () => {
  const a = await fnBody("function f(a, b){ return 1; }");
  const b = await fnBody("function f(a, b){ return 999; }");
  assert.equal(sigHash(a.params), sigHash(b.params));
  const c = await fnBody("function f(a){ return 1; }");
  assert.notEqual(sigHash(a.params), sigHash(c.params));
  assert.equal(sigHash(null), null);
});

test("canon returns a string and is stable", async () => {
  const a = await fnBody("function f(){ return 1; }");
  assert.equal(typeof canon(a.body), "string");
  assert.equal(canon(a.body), canon(a.body));
});
