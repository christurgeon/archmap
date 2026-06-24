import { test } from "node:test";
import assert from "node:assert/strict";
import { createModel, addNode, moveNode, removeNode, getNode } from "../index.js";

function base() {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  addNode(m, { id: "sys", name: "Sys", kind: "system", parent: null });
  return m;
}

test("addNode sets default axis from kind and stores optional fields", () => {
  const m = base();
  const n = addNode(m, { id: "api", name: "API", kind: "container", parent: "sys", tech: "Node", blurb: "the api" });
  assert.equal(n.axis, "logical");
  assert.equal(n.tech, "Node");
  assert.equal(getNode(m, "api").blurb, "the api");
  const w = addNode(m, { id: "pod", name: "Pod", kind: "workload", parent: null });
  assert.equal(w.axis, "deploy");
});

test("addNode guards: dup id, unknown kind, missing parent, empty id", () => {
  const m = base();
  assert.throws(() => addNode(m, { id: "sys", name: "Dup", kind: "system", parent: null }), /duplicate/);
  assert.throws(() => addNode(m, { id: "z", name: "Z", kind: "widget", parent: null }), /unknown kind/);
  assert.throws(() => addNode(m, { id: "z", name: "Z", kind: "container", parent: "ghost" }), /parent/);
  assert.throws(() => addNode(m, { id: "", name: "Z", kind: "system", parent: null }), /id required/);
});

test("moveNode reparents and blocks cycles", () => {
  const m = base();
  addNode(m, { id: "api", name: "API", kind: "container", parent: "sys" });
  addNode(m, { id: "h", name: "H", kind: "component", parent: "api" });
  moveNode(m, "h", "sys");
  assert.equal(getNode(m, "h").parent, "sys");
  assert.throws(() => moveNode(m, "sys", "api"), /cycle/); // sys is ancestor of api
  assert.throws(() => moveNode(m, "api", "api"), /cycle/); // a node cannot be its own parent
  assert.throws(() => moveNode(m, "h", "ghost"), /no such node/);
});

test("removeNode blocks when it has children, else cascades edges/mappings", () => {
  const m = base();
  addNode(m, { id: "api", name: "API", kind: "container", parent: "sys" });
  assert.throws(() => removeNode(m, "sys"), /has children/);
  m.edges.push({ from: "api", to: "api2", label: "x" });
  m.mappings.push({ logical: "api", deploy: "pod", label: "runs on" });
  removeNode(m, "api");
  assert.equal(getNode(m, "api"), null);
  assert.equal(m.edges.length, 0);
  assert.equal(m.mappings.length, 0);
});
