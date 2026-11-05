import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../index.js";

function model(edgePairs, n = 5) {
  const g = (id) => ({ repo: "r", path: "a.js", symbol: { fqn: id, kind: "fn" } });
  const nodes = [{ id: "sys", name: "S", kind: "system", parent: null, axis: "logical" }];
  for (let i = 0; i < n; i++) nodes.push({ id: "c" + i, name: "C" + i, kind: "component", parent: "sys", axis: "logical", grounding: g("c" + i) });
  return {
    meta: { name: "x", version: "1", snapshot: "s" }, nodes, mappings: [],
    edges: edgePairs.map(([a, b]) => ({ from: "c" + a, to: "c" + b, label: "x" })),
  };
}
const all = (n) => { const out = []; for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) out.push([a, b]); return out; };
const dense = (m) => validate(m).warnings.filter((w) => w.code === "VIEW_DENSE");

test("a view with more than 2 relationships per box warns", () => {
  const w = dense(model(all(5))); // 20 relationships among 5 boxes
  assert.equal(w.length, 1);
  assert.equal(w[0].where, "sys");
});

test("a view at or under the budget does not warn", () => {
  assert.deepEqual(dense(model(all(5).slice(0, 10))), []);
});

test("small views get a floor: 8 edges among 3 boxes is never flagged", () => {
  assert.deepEqual(dense(model(all(3), 3)), []);
});
