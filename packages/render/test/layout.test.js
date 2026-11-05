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
  assert.ok(v.edges[0].points.length >= 2);
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

// Mirrors svg.js's label geometry: prefer the layout-provided lx/ly/lw when present.
const LABEL_H = 18;
function labelRect(e) {
  const lx = e.lx;
  const ly = e.ly;
  const w = e.lw != null ? e.lw : e.label.length * 6.8 + 12;
  return { x: lx - w / 2, y: ly - LABEL_H / 2, w, h: LABEL_H, label: e.label };
}

test("edge labels do not overlap each other or boxes", () => {
  // A hub with wide, aggregated labels — the dense fan-out that otherwise piles labels onto one line.
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

// Regression: layoutView rebuilt edge objects and dropped `cited`, so svg.js never applied
// the uncited class while the legend still claimed the distinction existed.
test("layoutView preserves the cited flag through routing", () => {
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "a", name: "A", kind: "component", parent: null, axis: "logical" },
      { id: "b", name: "B", kind: "component", parent: null, axis: "logical" },
      { id: "c", name: "C", kind: "component", parent: null, axis: "logical" },
    ],
    edges: [
      { from: "a", to: "b", label: "calls", evidence: { kind: "call", path: "p.js", anchors: [{ fqn: "f", kind: "fn" }] } },
      { from: "a", to: "c", label: "calls" },
    ],
    mappings: [],
  };
  const view = layoutView(m, null, "logical");
  const byTo = Object.fromEntries(view.edges.map((e) => [e.to, e.cited]));
  assert.equal(byTo.b, true, "cited edge");
  assert.equal(byTo.c, false, "uncited edge");
});

// ---- layout quality: the properties that make a dense view followable

// A container view with a cycle (orders -> notify -> orders), a long edge (web -> db skips
// two layers) and a hub fan-out — the shapes real systems have.
function busy() {
  const n = (id, kind = "container") => ({ id, name: id, kind, parent: "sys", axis: "logical" });
  return {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" },
      n("web"), n("api"), n("orders"), n("catalog"), n("pay"), n("notify"), n("db", "store"),
    ],
    edges: [
      ["web", "api"], ["api", "orders"], ["api", "catalog"], ["api", "pay"], ["orders", "db"],
      ["catalog", "db"], ["pay", "db"], ["orders", "notify"], ["pay", "notify"], ["notify", "orders"],
      ["web", "db"], ["notify", "api"],
    ].map(([from, to]) => ({ from, to, label: "x" })),
    mappings: [],
  };
}

function segments(points) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i], points[i + 1]]);
  return out;
}

test("cycles do not blow up the layering", () => {
  const v = layoutView(busy(), "sys", "logical");
  const rows = new Set(v.boxes.map((b) => b.y)).size;
  assert.ok(rows <= 5, `expected <= 5 rows for 7 boxes, got ${rows}`);
  assert.ok(v.height < 900, `height ${v.height}`);
});

test("routed edges are orthogonal and start/end on their own boxes", () => {
  const v = layoutView(busy(), "sys", "logical");
  const box = new Map(v.boxes.map((b) => [b.id, b]));
  const onBorder = (p, b) => p[0] >= b.x && p[0] <= b.x + b.w && (Math.abs(p[1] - b.y) < 0.2 || Math.abs(p[1] - b.y - b.h) < 0.2);
  for (const e of v.edges) {
    for (const [a, b] of segments(e.points)) assert.ok(a[0] === b[0] || a[1] === b[1], "non-orthogonal segment");
    assert.ok(onBorder(e.points[0], box.get(e.from)), `${e.from}->${e.to} does not start on ${e.from}`);
    assert.ok(onBorder(e.points.at(-1), box.get(e.to)), `${e.from}->${e.to} does not end on ${e.to}`);
  }
});

test("no edge passes through a box it does not connect", () => {
  const v = layoutView(busy(), "sys", "logical");
  for (const e of v.edges) {
    for (const b of v.boxes) {
      if (b.id === e.from || b.id === e.to) continue;
      for (const [p, q] of segments(e.points)) {
        const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]);
        const y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
        const hit = x1 > b.x && x0 < b.x + b.w && y1 > b.y && y0 < b.y + b.h;
        assert.ok(!hit, `${e.from}->${e.to} crosses box ${b.id}`);
      }
    }
  }
});

test("no two edges share a line (collinear overlap)", () => {
  const v = layoutView(busy(), "sys", "logical");
  const segs = v.edges.flatMap((e, i) => segments(e.points).map((s) => [i, s]));
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i][0] === segs[j][0]) continue;
      const [[a, b]] = [segs[i][1]], [[c, d]] = [segs[j][1]];
      if (a[1] === b[1] && c[1] === d[1] && a[1] === c[1]) {
        const o = Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]));
        assert.ok(o <= 0, `horizontal overlap at y=${a[1]}`);
      }
      if (a[0] === b[0] && c[0] === d[0] && a[0] === c[0]) {
        const o = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]));
        assert.ok(o <= 0, `vertical overlap at x=${a[0]}`);
      }
    }
  }
});

test("a reversed (cycle-closing) edge still points at its real target", () => {
  const v = layoutView(busy(), "sys", "logical");
  const box = new Map(v.boxes.map((b) => [b.id, b]));
  const e = v.edges.find((x) => x.from === "notify" && x.to === "orders");
  const end = e.points.at(-1), t = box.get("orders");
  assert.ok(end[0] >= t.x && end[0] <= t.x + t.w);
});

test("crossing reduction untangles a twisted bipartite view", () => {
  // model order a,b / c,d with a->d, b->c: one crossing unless the second row is reordered
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: ["a", "b", "c", "d"].map((id) => ({ id, name: id, kind: "component", parent: null, axis: "logical" })),
    edges: [{ from: "a", to: "d", label: "" }, { from: "b", to: "c", label: "" }],
    mappings: [],
  };
  const v = layoutView(m, null, "logical");
  const x = Object.fromEntries(v.boxes.map((b) => [b.id, b.x]));
  assert.equal(Math.sign(x.a - x.b), Math.sign(x.d - x.c));
});

test("aggregated labels collapse to one label and a count", async () => {
  const { displayLabel } = await import("../layout.js");
  assert.equal(displayLabel(["reads"]), "reads");
  assert.equal(displayLabel(["reads", "writes"]), "reads, writes");
  assert.equal(displayLabel(["SOAP", "syncs stock", "polls"]), "SOAP +2");
});
