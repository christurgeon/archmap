import { test } from "node:test";
import assert from "node:assert/strict";
import { createModel, addNode, addEdge, removeEdge, setEdgeLabel, addMapping, removeMapping } from "../index.js";

function base() {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  addNode(m, { id: "a", name: "A", kind: "component", parent: null });
  addNode(m, { id: "b", name: "B", kind: "component", parent: null });
  addNode(m, { id: "pod", name: "Pod", kind: "workload", parent: null });
  return m;
}

test("addEdge happy path + guards", () => {
  const m = base();
  const e = addEdge(m, "a", "b", "calls");
  assert.deepEqual(e, { from: "a", to: "b", label: "calls" });
  assert.throws(() => addEdge(m, "a", "a", "loop"), /self-edge/);
  assert.throws(() => addEdge(m, "a", "ghost", "x"), /no such node/);
  assert.throws(() => addEdge(m, "a", "b", "again"), /duplicate/);
});

test("removeEdge + setEdgeLabel", () => {
  const m = base();
  addEdge(m, "a", "b", "calls");
  setEdgeLabel(m, "a", "b", "invokes");
  assert.equal(m.edges[0].label, "invokes");
  assert.throws(() => setEdgeLabel(m, "b", "a", "x"), /no edge/);
  removeEdge(m, "a", "b");
  assert.equal(m.edges.length, 0);
});

test("mappings add/remove + guards", () => {
  const m = base();
  const mp = addMapping(m, "a", "pod", "runs on");
  assert.deepEqual(mp, { logical: "a", deploy: "pod", label: "runs on" });
  assert.throws(() => addMapping(m, "a", "pod", "again"), /duplicate/);
  assert.throws(() => addMapping(m, "a", "ghost", "x"), /no such node/);
  removeMapping(m, "a", "pod");
  assert.equal(m.mappings.length, 0);
});
