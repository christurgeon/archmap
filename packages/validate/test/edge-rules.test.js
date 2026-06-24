import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../index.js";

const codes = (issues) => issues.map((i) => i.code);

function model(nodes, edges) {
  return { meta: { name: "x", version: "1", snapshot: "s" }, nodes, edges, mappings: [] };
}

// Anchored so these groundable leaves stay clean once Task 8 adds the
// GROUNDABLE_UNANCHORED rule (the whole validate suite is re-run from Task 8 on).
// Tests below use .includes() so they tolerate extra errors; the "clean" test's
// deepEqual([]) is the one that would break without these anchors.
const leaves = [
  { id: "a", name: "A", kind: "component", parent: null, axis: "logical", grounding: { repo: "r", path: "a", symbol: { fqn: "a", kind: "fn" } } },
  { id: "b", name: "B", kind: "component", parent: null, axis: "logical", grounding: { repo: "r", path: "b", symbol: { fqn: "b", kind: "fn" } } },
  { id: "w", name: "W", kind: "workload", parent: null, axis: "deploy", grounding: { repo: "r", path: "w", iac: "x.y" } },
];

test("clean leaf-to-leaf same-axis edge passes", () => {
  const r = validate(model(leaves, [{ from: "a", to: "b", label: "calls" }]));
  assert.deepEqual(r.errors, []);
});

test("missing endpoint, self edge, cross axis", () => {
  const r = validate(model(leaves, [
    { from: "a", to: "ghost", label: "x" },
    { from: "a", to: "a", label: "loop" },
    { from: "a", to: "w", label: "cross" },
  ]));
  const c = codes(r.errors);
  assert.ok(c.includes("EDGE_ENDPOINT_MISSING"));
  assert.ok(c.includes("EDGE_SELF"));
  assert.ok(c.includes("EDGE_CROSS_AXIS"));
});

test("non-leaf endpoint and spanning hierarchy", () => {
  const nodes = [
    { id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" },
    { id: "api", name: "API", kind: "container", parent: "sys", axis: "logical" },
    { id: "h", name: "H", kind: "component", parent: "api", axis: "logical" },
  ];
  // sys has children (not a leaf); sys->h also spans the hierarchy (ancestor->descendant)
  const r = validate(model(nodes, [{ from: "sys", to: "h", label: "x" }]));
  const c = codes(r.errors);
  assert.ok(c.includes("EDGE_NOT_LEAF"));
  assert.ok(c.includes("EDGE_SPANS_HIERARCHY"));
});

test("duplicate edge and label budget (>3 words)", () => {
  const r = validate(model(leaves, [
    { from: "a", to: "b", label: "calls" },
    { from: "a", to: "b", label: "calls" },
    { from: "b", to: "a", label: "one two three four" },
  ]));
  const c = codes(r.errors);
  assert.ok(c.includes("EDGE_DUP"));
  assert.ok(c.includes("EDGE_LABEL_BUDGET"));
});
