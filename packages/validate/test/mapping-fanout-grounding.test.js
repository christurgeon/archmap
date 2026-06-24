import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../index.js";

const codes = (issues) => issues.map((i) => i.code);

test("mapping axis rules + dup + missing", () => {
  const nodes = [
    { id: "a", name: "A", kind: "component", parent: null, axis: "logical" },
    { id: "w", name: "W", kind: "workload", parent: null, axis: "deploy" },
  ];
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" }, nodes, edges: [],
    mappings: [
      { logical: "a", deploy: "w", label: "runs on" },
      { logical: "a", deploy: "w", label: "dup" },
      { logical: "w", deploy: "a", label: "swapped" }, // logical is deploy-kind, deploy is logical-kind
      { logical: "a", deploy: "ghost", label: "x" },
    ],
  };
  const c = codes(validate(m).errors);
  assert.ok(c.includes("MAPPING_DUP"));
  assert.ok(c.includes("MAPPING_BAD_LOGICAL"));
  assert.ok(c.includes("MAPPING_BAD_DEPLOY"));
  assert.ok(c.includes("MAPPING_ENDPOINT_MISSING"));
});

test("fan-out soft warning (>7) and hard error (>14), exact boundaries", () => {
  const mk = (count) => {
    const nodes = [{ id: "p", name: "P", kind: "system", parent: null, axis: "logical" }];
    for (let i = 0; i < count; i++) nodes.push({ id: `c${i}`, name: `C${i}`, kind: "container", parent: "p", axis: "logical", grounding: { repo: "r", path: "p", symbol: { fqn: `f${i}`, kind: "module" } } });
    return { meta: { name: "x", version: "1", snapshot: "s" }, nodes, edges: [], mappings: [] };
  };
  assert.equal(codes(validate(mk(7)).warnings).includes("FANOUT_SOFT"), false); // 7 within soft limit
  assert.ok(codes(validate(mk(8)).warnings).includes("FANOUT_SOFT"));
  assert.equal(codes(validate(mk(8)).errors).includes("FANOUT_HARD"), false);
  assert.ok(codes(validate(mk(14)).warnings).includes("FANOUT_SOFT"));        // 14 still only soft
  assert.equal(codes(validate(mk(14)).errors).includes("FANOUT_HARD"), false); // 14 == cap, not over
  assert.ok(codes(validate(mk(15)).errors).includes("FANOUT_HARD"));           // 15 exceeds cap
});

test("fan-out is enforced at the synthetic axis-root level too", () => {
  const nodes = [];
  for (let i = 0; i < 15; i++) nodes.push({ id: `r${i}`, name: `R${i}`, kind: "system", parent: null, axis: "logical" });
  const m = { meta: { name: "x", version: "1", snapshot: "s" }, nodes, edges: [], mappings: [] };
  const hard = validate(m).errors.filter((x) => x.code === "FANOUT_HARD");
  assert.ok(hard.some((x) => x.where === "__root_logical"));
});

test("groundable leaf without anchor errors; with anchor passes", () => {
  const unanchored = { meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "h", name: "H", kind: "component", parent: null, axis: "logical" }], edges: [], mappings: [] };
  assert.ok(codes(validate(unanchored).errors).includes("GROUNDABLE_UNANCHORED"));

  const anchored = { meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "h", name: "H", kind: "component", parent: null, axis: "logical",
      grounding: { repo: "r", path: "p", iac: "aws_lambda_function.foo" } }], edges: [], mappings: [] };
  assert.ok(codes(validate(anchored).errors).includes("GROUNDABLE_UNANCHORED") === false);
});

test("non-leaf groundable kind does not require an anchor", () => {
  const m = { meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "api", name: "API", kind: "container", parent: null, axis: "logical" }, // has a child -> not a leaf
      { id: "h", name: "H", kind: "component", parent: "api", axis: "logical", grounding: { repo: "r", path: "p", symbol: { fqn: "f", kind: "fn" } } },
    ], edges: [], mappings: [] };
  assert.ok(codes(validate(m).errors).includes("GROUNDABLE_UNANCHORED") === false);
});

test("a complete, realistic model yields zero errors and zero warnings", () => {
  // Proves the validator is actually satisfiable by a model exercising every axis,
  // grounding, an edge, and a mapping together — not just the per-rule fixtures.
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "user", name: "User", kind: "person", parent: null, axis: "logical" },
      { id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" },
      { id: "api", name: "API", kind: "container", parent: "sys", axis: "logical" },
      { id: "h", name: "H", kind: "component", parent: "api", axis: "logical", grounding: { repo: "r", path: "src/h.js", symbol: { fqn: "h", kind: "fn" } } },
      { id: "pod", name: "Pod", kind: "workload", parent: null, axis: "deploy", grounding: { repo: "r", path: "k8s.yaml", iac: "k8s.pod" } },
    ],
    edges: [{ from: "user", to: "h", label: "uses" }],
    mappings: [{ logical: "api", deploy: "pod", label: "runs on" }],
  };
  const r = validate(m);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});
