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

import { boxWidth, layoutView } from "../layout.js";

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const m = {
  meta: { name: "x", version: "1", snapshot: "s" },
  nodes: [
    { id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" },
    { id: "api", name: "API", kind: "container", parent: "sys", axis: "logical" },
    { id: "db", name: "DB", kind: "store", parent: "sys", axis: "logical" },
    { id: "h1", name: "H1", kind: "component", parent: "api", axis: "logical" },
  ],
  edges: [{ from: "h1", to: "db", label: "reads" }],
  mappings: [],
};

test("boxWidth grows with the longer label and respects the minimum", () => {
  assert.equal(boxWidth({ name: "x", kind: "component" }), 130);
  assert.ok(boxWidth({ name: "a-very-long-component-name-here", kind: "component", tech: "Rust" }) > 130);
});

test("layoutView produces non-overlapping boxes and routed edges", () => {
  const v = layoutView(m, "sys", "logical");
  assert.deepEqual(v.boxes.map((b) => b.id).sort(), ["api", "db"]);
  assert.equal(v.boxes.find((b) => b.id === "api").hasChildren, true);
  assert.equal(v.boxes.find((b) => b.id === "db").hasChildren, false);
  assert.equal(v.edges.length, 1);
  assert.equal(v.edges[0].points.length, 4);
  for (let i = 0; i < v.boxes.length; i++)
    for (let j = i + 1; j < v.boxes.length; j++)
      assert.equal(rectsOverlap(v.boxes[i], v.boxes[j]), false);
  assert.ok(v.width > 0 && v.height > 0);
});

test("layoutView is deterministic (serialized geometry)", () => {
  const a = layoutView(m, "sys", "logical");
  const b = layoutView(m, "sys", "logical");
  assert.equal(
    JSON.stringify(a.boxes.map((x) => [x.id, x.x, x.y, x.w, x.h])),
    JSON.stringify(b.boxes.map((x) => [x.id, x.x, x.y, x.w, x.h])),
  );
  assert.equal(JSON.stringify(a.edges), JSON.stringify(b.edges));
});

test("layoutView of a childless focus is empty but well-formed", () => {
  const v = layoutView(m, "h1", "logical"); // h1 is a leaf in this fixture
  assert.deepEqual(v.boxes, []);
  assert.deepEqual(v.edges, []);
  assert.ok(v.width > 0 && v.height > 0); // no Math.max(...[]) / -Infinity crash
});

// Non-overlapping labels are the renderer's guarantee, not a model-author
// concern. Mirror svg.js's label geometry, preferring the layout-provided
// lx/ly/lw when present.
const LABEL_H = 18;
function labelRect(e) {
  const lx = e.lx != null ? e.lx : (e.points[1][0] + e.points[2][0]) / 2;
  const ly = e.ly != null ? e.ly : e.points[1][1];
  const w = e.lw != null ? e.lw : e.label.length * 6.8 + 12;
  return { x: lx - w / 2, y: ly - LABEL_H / 2, w, h: LABEL_H, label: e.label };
}

test("edge labels do not overlap each other or boxes", () => {
  // A hub fanning out to a row of nodes, each edge carrying a wide, aggregated
  // label — the dense fan-out that otherwise piles labels onto one line.
  const hub = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "hub", name: "Hub", kind: "system", parent: null, axis: "logical" },
      { id: "a", name: "Target A", kind: "external", parent: null, axis: "logical" },
      { id: "b", name: "Target B", kind: "external", parent: null, axis: "logical" },
      { id: "c", name: "Target C", kind: "external", parent: null, axis: "logical" },
    ],
    edges: [
      { from: "hub", to: "a", label: "writes workflow, REST API, writes values.yaml" },
      { from: "hub", to: "b", label: "verifies JWT, OIDC login" },
      { from: "hub", to: "c", label: "submits create request" },
    ],
    mappings: [],
  };
  const v = layoutView(hub, null, "logical");
  const labels = v.edges.filter((e) => e.label).map(labelRect);
  assert.equal(labels.length, 3);
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      assert.equal(rectsOverlap(labels[i], labels[j]), false,
        `labels overlap: "${labels[i].label}" / "${labels[j].label}"`);
  for (const L of labels)
    for (const box of v.boxes)
      assert.equal(rectsOverlap(L, box), false,
        `label "${L.label}" overlaps box ${box.id}`);
});
