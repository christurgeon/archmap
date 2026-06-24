import { test } from "node:test";
import assert from "node:assert/strict";
import { viewChildren, promoteEdges } from "../promote.js";

// sys > {api > {h1,h2}, db}; w is a deploy root
function model() {
  return {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" },
      { id: "api", name: "API", kind: "container", parent: "sys", axis: "logical" },
      { id: "db", name: "DB", kind: "store", parent: "sys", axis: "logical" },
      { id: "h1", name: "H1", kind: "component", parent: "api", axis: "logical" },
      { id: "h2", name: "H2", kind: "component", parent: "api", axis: "logical" },
      { id: "w", name: "W", kind: "workload", parent: null, axis: "deploy" },
    ],
    edges: [
      { from: "h1", to: "db", label: "reads" },   // promotes to api->db at the sys view
      { from: "h1", to: "h2", label: "calls" },    // internal to api at the sys view (dropped), shown inside api view
      { from: "h2", to: "db", label: "writes" },   // also promotes to api->db at sys view (aggregates)
    ],
    mappings: [],
  };
}

test("viewChildren: roots by axis, then direct children", () => {
  const m = model();
  assert.deepEqual(viewChildren(m, null, "logical").map((n) => n.id), ["sys"]);
  assert.deepEqual(viewChildren(m, null, "deploy").map((n) => n.id), ["w"]);
  assert.deepEqual(viewChildren(m, "sys", "logical").map((n) => n.id), ["api", "db"]);
  assert.deepEqual(viewChildren(m, "api", "logical").map((n) => n.id), ["h1", "h2"]);
});

test("promoteEdges at the sys view aggregates api->db and drops api-internal", () => {
  const e = promoteEdges(model(), "sys", "logical");
  assert.equal(e.length, 1);
  assert.equal(e[0].from, "api");
  assert.equal(e[0].to, "db");
  assert.deepEqual(e[0].label.split(", ").sort(), ["reads", "writes"]);
});

test("promoteEdges inside api shows the internal call", () => {
  const e = promoteEdges(model(), "api", "logical");
  assert.deepEqual(e, [{ from: "h1", to: "h2", label: "calls" }]);
});

test("promoteEdges at the logical root surfaces cross-system edges", () => {
  // Each leaf lifts to its DISTINCT root system, so the edge surfaces at the context view
  // (it is not dropped — dropping only happens when both endpoints lift to the same child).
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "s1", name: "S1", kind: "system", parent: null, axis: "logical" },
      { id: "s2", name: "S2", kind: "system", parent: null, axis: "logical" },
      { id: "l1", name: "L1", kind: "component", parent: "s1", axis: "logical" },
      { id: "l2", name: "L2", kind: "component", parent: "s2", axis: "logical" },
    ],
    edges: [{ from: "l1", to: "l2", label: "calls" }],
    mappings: [],
  };
  assert.deepEqual(promoteEdges(m, null, "logical"), [{ from: "s1", to: "s2", label: "calls" }]);
});
