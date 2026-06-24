import { test } from "node:test";
import assert from "node:assert/strict";
import { layerize } from "../layout.js";

test("longest-path layering assigns layers", () => {
  const { layerOf } = layerize(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "c" }]);
  assert.equal(layerOf.get("a"), 0);
  assert.equal(layerOf.get("b"), 1);
  assert.equal(layerOf.get("c"), 2);
});

test("diamond uses the longest path", () => {
  const { layerOf } = layerize(["a", "b", "c", "d"], [
    { from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" },
  ]);
  assert.equal(layerOf.get("d"), 2);
});

test("isolated nodes go to layer 0; within-layer order preserved", () => {
  const { layers } = layerize(["x", "y", "z"], []);
  assert.deepEqual(layers, [["x", "y", "z"]]);
});

test("cycle does not hang and terminates", () => {
  const { layerOf } = layerize(["a", "b"], [{ from: "a", to: "b" }, { from: "b", to: "a" }]);
  assert.ok(Number.isFinite(layerOf.get("a")));
  assert.ok(Number.isFinite(layerOf.get("b")));
});
