import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIgnore } from "../ignore.js";

const m = (text) => parseIgnore(text);

test("blank lines and comments are ignored", () => {
  const ig = m("\n# a comment\n\n  \ndist/\n");
  assert.equal(ig.ignores("dist/x.js"), true);
  assert.equal(ig.ignores("src/x.js"), false);
});

test("directory patterns match at any depth", () => {
  const ig = m("dist/\nnode_modules/");
  assert.equal(ig.ignores("dist/a.js"), true);
  assert.equal(ig.ignores("packages/x/dist/a.js"), true);
  assert.equal(ig.ignores("packages/x/node_modules/y/z.js"), true);
  assert.equal(ig.ignores("src/distance.js"), false, "prefix must not partial-match a segment");
});

test("a leading slash anchors to the repo root", () => {
  const ig = m("/build/");
  assert.equal(ig.ignores("build/a.js"), true);
  assert.equal(ig.ignores("packages/x/build/a.js"), false);
});

test("glob patterns match within one segment", () => {
  const ig = m("*.log\n*.gen.ts");
  assert.equal(ig.ignores("a.log"), true);
  assert.equal(ig.ignores("deep/nested/a.log"), true);
  assert.equal(ig.ignores("api.gen.ts"), true);
  assert.equal(ig.ignores("api.ts"), false);
});

test("a bare name matches a file or a directory at any depth", () => {
  const ig = m("coverage");
  assert.equal(ig.ignores("coverage"), true);
  assert.equal(ig.ignores("coverage/lcov.js"), true);
  assert.equal(ig.ignores("packages/a/coverage/x.js"), true);
  assert.equal(ig.ignores("src/coverage-report.js"), false);
});

test("negation re-includes, last match wins", () => {
  const ig = m("dist/\n!dist/keep.js");
  assert.equal(ig.ignores("dist/a.js"), true);
  assert.equal(ig.ignores("dist/keep.js"), false);
});

test("** spans directories", () => {
  const ig = m("packages/**/generated/");
  assert.equal(ig.ignores("packages/a/generated/x.js"), true);
  assert.equal(ig.ignores("packages/a/b/generated/x.js"), true);
  assert.equal(ig.ignores("packages/a/src/x.js"), false);
});

test("an empty ignore file ignores nothing", () => {
  const ig = m("");
  assert.equal(ig.ignores("anything.js"), false);
});

test("archmap's own .gitignore excludes its build artifact", () => {
  const ig = m("node_modules/\n*.log\narchmap.html\ndocs/superpowers/\n.superpowers/\n");
  assert.equal(ig.ignores("archmap.html"), true);
  assert.equal(ig.ignores("node_modules/x/y.js"), true);
  assert.equal(ig.ignores("packages/render/html.js"), false);
});
