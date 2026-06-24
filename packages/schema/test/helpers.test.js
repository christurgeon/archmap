import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KINDS, LOGICAL_KINDS, DEPLOY_KINDS, AXES, GROUNDABLE_KINDS,
  kindAxis, createModel, getNode, childrenOf, isLeaf, ancestorsOf,
} from "../index.js";

test("kind sets & axis mapping", () => {
  assert.deepEqual(DEPLOY_KINDS, ["cloud", "network", "infra", "workload"]);
  assert.ok(KINDS.length === LOGICAL_KINDS.length + DEPLOY_KINDS.length);
  assert.deepEqual(AXES, ["logical", "deploy"]);
  assert.ok(GROUNDABLE_KINDS.includes("container"));
  assert.equal(kindAxis("component"), "logical");
  assert.equal(kindAxis("workload"), "deploy");
});

test("createModel makes an empty model with meta", () => {
  const m = createModel({ name: "x", version: "1", snapshot: "2026-06-23" });
  assert.deepEqual(m, { meta: { name: "x", version: "1", snapshot: "2026-06-23" }, nodes: [], edges: [], mappings: [] });
});

test("getNode / childrenOf / isLeaf / ancestorsOf", () => {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  m.nodes.push(
    { id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" },
    { id: "api", name: "API", kind: "container", parent: "sys", axis: "logical" },
    { id: "h", name: "Handler", kind: "component", parent: "api", axis: "logical" },
  );
  assert.equal(getNode(m, "api").name, "API");
  assert.equal(getNode(m, "nope"), null);
  assert.deepEqual(childrenOf(m, "sys").map((n) => n.id), ["api"]);
  assert.equal(isLeaf(m, "h"), true);
  assert.equal(isLeaf(m, "api"), false);
  assert.deepEqual(ancestorsOf(m, "h"), ["api", "sys"]);
  assert.deepEqual(ancestorsOf(m, "sys"), []);
});

test("ancestorsOf is cycle-safe", () => {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  m.nodes.push(
    { id: "a", name: "A", kind: "container", parent: "b", axis: "logical" },
    { id: "b", name: "B", kind: "container", parent: "a", axis: "logical" },
  );
  // must terminate, not hang
  const anc = ancestorsOf(m, "a");
  assert.ok(anc.length <= 2);
});
