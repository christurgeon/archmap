import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "@archmap/resolve/symbol-index";
import { groundContainer, MAX_COMPONENTS } from "../ground.js";

const container = (over = {}) => ({ id: "pkg-a", name: "a", path: "pkg/a", lang: "js", signals: ["bin"], ...over });
const idx = (files) => buildIndex(files.map(([path, source]) => ({ path, lang: "js", source })));
const names = (r) => r.components.map((c) => c.name).sort();

test("exported symbols become components; private helpers do not", async () => {
  const index = await idx([["pkg/a/index.js", "export function pub(){}\nfunction helper(){}\n"]]);
  const r = groundContainer(container(), index);
  assert.equal(r.undrilled, false);
  assert.deepEqual(names(r), ["pub"]);
});

// A class is one component; its methods are not separate components (§7.1)
test("class methods are excluded, the class itself is kept", async () => {
  const index = await idx([["pkg/a/index.js", "export class Svc { run(){} stop(){} }\n"]]);
  assert.deepEqual(names(groundContainer(container(), index)), ["Svc"]);
});

test("the >7 boundary: exactly 7 drills, 8 goes undrilled", async () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => `export function f${i}(){}`).join("\n");
  const at7 = groundContainer(container(), await idx([["pkg/a/i.js", mk(MAX_COMPONENTS)]]));
  assert.equal(at7.undrilled, false);
  assert.equal(at7.components.length, MAX_COMPONENTS);

  const at8 = groundContainer(container(), await idx([["pkg/a/i.js", mk(MAX_COMPONENTS + 1)]]));
  assert.equal(at8.undrilled, true);
  assert.match(at8.reason, />7 exports/);
});

test("zero exported symbols is undrilled, distinctly from the cap", async () => {
  const r = groundContainer(container(), await idx([["pkg/a/i.js", "function priv(){}\n"]]));
  assert.equal(r.undrilled, true);
  assert.match(r.reason, /0 exported symbols/);
});

test("a non-JS container is undrilled with its own reason", async () => {
  const r = groundContainer(container({ lang: null }), await idx([]));
  assert.equal(r.undrilled, true);
  assert.match(r.reason, /non-JS\/TS/);
});

// The case that motivates file-path id namespacing: basename-only ids would collide and
// silently drop a real exported symbol, violating "never silently omit" (§7).
test("same name in two files yields two distinct components, both grounded to their own file", async () => {
  const index = await idx([
    ["pkg/a/src/user/model.js", "export function create(){ return 1; }\n"],
    ["pkg/a/src/post/model.js", "export function create(){ return 2; }\n"],
  ]);
  const r = groundContainer(container(), index);
  assert.equal(r.components.length, 2);
  assert.equal(new Set(r.components.map((c) => c.id)).size, 2, "ids must be distinct");
  assert.deepEqual(
    r.components.map((c) => c.path).sort(),
    ["pkg/a/src/post/model.js", "pkg/a/src/user/model.js"],
    "grounded to the symbol's own file, not the package dir",
  );
});

test("component ids are namespaced by container-relative path", async () => {
  const index = await idx([["pkg/a/src/user/model.js", "export function create(){}\n"]]);
  const [c] = groundContainer(container(), index).components;
  assert.equal(c.id, "pkg-a--src-user-model--create");
});

test("only symbols inside the container are considered", async () => {
  const index = await idx([
    ["pkg/a/i.js", "export function mine(){}\n"],
    ["pkg/b/i.js", "export function theirs(){}\n"],
  ]);
  assert.deepEqual(names(groundContainer(container(), index)), ["mine"]);
});

test("the synthetic module symbol is never a component", async () => {
  const index = await idx([["pkg/a/i.js", 'import { x } from "./x.js";\nexport function f(){}\nx();\n']]);
  const r = groundContainer(container(), index);
  assert.deepEqual(names(r), ["f"], "<module> is wiring, not public surface");
});

test("components carry the hashes the resolver needs for a baseline", async () => {
  const index = await idx([["pkg/a/i.js", "export function f(a,b){ return a+b; }\n"]]);
  const [c] = groundContainer(container(), index).components;
  assert.equal(c.symbol.fqn, "f");
  assert.equal(c.symbol.kind, "fn");
  assert.ok(c.symbol.bodyHash, "bodyHash present so the leaf is not UNBASELINED");
  assert.ok(c.symbol.sigHash);
});
