import { test } from "node:test";
import assert from "node:assert/strict";
import { getParser, langForPath } from "../grammar.js";

test("langForPath maps extensions", () => {
  assert.equal(langForPath("a/b/c.js"), "js");
  assert.equal(langForPath("x.mjs"), "js");
  assert.equal(langForPath("x.ts"), "ts");
  assert.equal(langForPath("x.tsx"), "tsx");
  assert.equal(langForPath("x.py"), null);
});

test("getParser parses JS into a program node (buffer-loaded grammar)", async () => {
  const parser = await getParser("js");
  const tree = parser.parse("const x = 1;");
  assert.equal(tree.rootNode.type, "program");
});

test("getParser memoizes (same parser instance for a lang)", async () => {
  const a = await getParser("ts");
  const b = await getParser("ts");
  assert.equal(a, b);
});
