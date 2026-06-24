import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, classify } from "../resolve.js";

// A hand-built fake index so state transitions are tested in isolation (no parsing).
function fakeIndex(records) {
  const byFqn = (fqn, path) => records.filter((r) => r.fqn === fqn && (!path || r.path === path));
  return {
    all: () => records,
    lookup: (fqn, opts = {}) => byFqn(fqn, opts.path),
    lookupByBodyHash: (h) => records.filter((r) => r.bodyHash === h),
    bodyHashIsUnique: (h) => records.filter((r) => r.bodyHash === h).length === 1,
    lookupBySigHash: (h) => records.filter((r) => r.sigHash === h),
  };
}
const rec = (o) => ({ fqn: "x", kind: "fn", path: "p.js", startLine: 1, endLine: 2, bodyHash: "B", sigHash: "S", ...o });

test("CLEAN when found at path and bodyHash matches", () => {
  const idx = fakeIndex([rec({ fqn: "f", path: "a.js", bodyHash: "H1" })]);
  const r = resolve({ fqn: "f", kind: "fn", bodyHash: "H1" }, "a.js", idx);
  assert.equal(r.state, "CLEAN");
});

test("CHANGED when found at path but bodyHash differs", () => {
  const idx = fakeIndex([rec({ fqn: "f", path: "a.js", bodyHash: "H2" })]);
  const r = resolve({ fqn: "f", kind: "fn", bodyHash: "H1" }, "a.js", idx);
  assert.equal(r.state, "CHANGED");
});

test("UNBASELINED when anchor has no bodyHash", () => {
  const idx = fakeIndex([rec({ fqn: "f", path: "a.js", bodyHash: "H2" })]);
  const r = resolve({ fqn: "f", kind: "fn" }, "a.js", idx);
  assert.equal(r.state, "UNBASELINED");
});

test("MOVED when not at path but unique repo-wide", () => {
  const idx = fakeIndex([rec({ fqn: "f", path: "moved.js", bodyHash: "H1" })]);
  const r = resolve({ fqn: "f", kind: "fn", bodyHash: "H1" }, "a.js", idx);
  assert.equal(r.state, "MOVED");
  assert.equal(r.hit.path, "moved.js");
});

test("MOVED carries bodyState=CHANGED when the relocated body also differs", () => {
  const idx = fakeIndex([rec({ fqn: "f", path: "moved.js", bodyHash: "NEW" })]);
  const r = resolve({ fqn: "f", kind: "fn", bodyHash: "OLD" }, "a.js", idx);
  assert.equal(r.state, "MOVED");
  assert.equal(r.bodyState, "CHANGED");
});

test("AMBIGUOUS when fqn matches >1 repo-wide", () => {
  const idx = fakeIndex([rec({ fqn: "f", path: "a.js" }), rec({ fqn: "f", path: "b.js" })]);
  const r = resolve({ fqn: "f", kind: "fn", bodyHash: "Z" }, "c.js", idx);
  assert.equal(r.state, "AMBIGUOUS");
  assert.equal(r.candidates.length, 2);
});

test("RENAMED via globally-unique bodyHash", () => {
  const idx = fakeIndex([rec({ fqn: "newName", path: "a.js", bodyHash: "UNIQ" })]);
  const r = resolve({ fqn: "oldName", kind: "fn", bodyHash: "UNIQ" }, "a.js", idx);
  assert.equal(r.state, "RENAMED");
  assert.equal(r.to.fqn, "newName");
});

test("no RENAMED when bodyHash collides (not unique)", () => {
  const idx = fakeIndex([rec({ fqn: "n1", path: "a.js", bodyHash: "DUP" }), rec({ fqn: "n2", path: "b.js", bodyHash: "DUP" })]);
  const r = resolve({ fqn: "old", kind: "fn", bodyHash: "DUP", sigHash: "NOPE" }, "a.js", idx);
  assert.equal(r.state, "MISSING"); // body not unique, sig no match
});

test("RENAMED? via unique sigHash when body recovery fails", () => {
  const idx = fakeIndex([rec({ fqn: "renamed", path: "a.js", bodyHash: "OTHER", sigHash: "SIG1" })]);
  const r = resolve({ fqn: "old", kind: "fn", bodyHash: "GONE", sigHash: "SIG1" }, "a.js", idx);
  assert.equal(r.state, "RENAMED?");
  assert.equal(r.to.fqn, "renamed");
});

test("MISSING when nothing matches", () => {
  const idx = fakeIndex([rec({ fqn: "other", path: "a.js", bodyHash: "X", sigHash: "Y" })]);
  const r = resolve({ fqn: "gone", kind: "fn", bodyHash: "Q", sigHash: "Z" }, "a.js", idx);
  assert.equal(r.state, "MISSING");
});

test("classify directly", () => {
  assert.equal(classify({ bodyHash: "A" }, { bodyHash: "A" }).state, "CLEAN");
  assert.equal(classify({ bodyHash: "A" }, { bodyHash: "B" }).state, "CHANGED");
  assert.equal(classify({}, { bodyHash: "B" }).state, "UNBASELINED");
});
