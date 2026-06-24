import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../symbol-index.js";

const fileA = { path: "a.js", lang: "js", source: "export function foo(){ return 1; }\nexport function bar(){ return 2; }" };
const fileB = { path: "b.js", lang: "js", source: "export function foo(){ return 3; }" }; // duplicate fqn 'foo', different body

test("lookup by fqn (all and path-scoped)", async () => {
  const idx = await buildIndex([fileA, fileB]);
  assert.equal(idx.lookup("foo").length, 2);            // foo in both files
  assert.equal(idx.lookup("foo", { path: "a.js" }).length, 1);
  assert.equal(idx.lookup("bar").length, 1);
  assert.equal(idx.lookup("nope").length, 0);
});

test("records carry their path", async () => {
  const idx = await buildIndex([fileA]);
  assert.equal(idx.lookup("foo", { path: "a.js" })[0].path, "a.js");
});

test("bodyHash lookups and uniqueness", async () => {
  const idx = await buildIndex([fileA, fileB]);
  const barHash = idx.lookup("bar")[0].bodyHash;
  assert.equal(idx.lookupByBodyHash(barHash).length, 1);
  assert.equal(idx.bodyHashIsUnique(barHash), true);
  // identical bodies collide -> not unique
  const dupSrc = { path: "c.js", lang: "js", source: "export function qux(){ return 2; }" }; // same body as bar
  const idx2 = await buildIndex([fileA, dupSrc]);
  const h = idx2.lookup("bar")[0].bodyHash;
  assert.equal(idx2.bodyHashIsUnique(h), false);
});

test("sigHash lookup", async () => {
  const idx = await buildIndex([{ path: "s.js", lang: "js", source: "export function f(a,b){return 1;}" }]);
  const sh = idx.lookup("f")[0].sigHash;
  assert.equal(idx.lookupBySigHash(sh).length, 1);
});
