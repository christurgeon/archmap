import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../index.js";

const codes = (issues) => issues.map((i) => i.code).sort();

test("clean minimal model has no errors", () => {
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" }],
    edges: [], mappings: [],
  };
  assert.deepEqual(validate(m).errors, []);
});

test("dup id, bad kind, missing parent, bad axis", () => {
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "a", name: "A", kind: "system", parent: null, axis: "logical" },
      { id: "a", name: "A2", kind: "widget", parent: "ghost", axis: "logical" },
      { id: "b", name: "B", kind: "component", parent: null, axis: "deploy" }, // wrong axis for kind
    ],
    edges: [], mappings: [],
  };
  const c = codes(validate(m).errors);
  assert.ok(c.includes("DUP_ID"));
  assert.ok(c.includes("BAD_KIND"));
  assert.ok(c.includes("MISSING_PARENT"));
  assert.ok(c.includes("BAD_AXIS"));
});

test("grounding missing repo/path is an error; authored lines is a warning", () => {
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "h", name: "H", kind: "component", parent: null, axis: "logical",
      grounding: { path: "", symbol: { fqn: "f", kind: "fn" }, lines: "10-20" } }],
    edges: [], mappings: [],
  };
  const r = validate(m);
  assert.ok(codes(r.errors).includes("GROUNDING_REPO_PATH"));
  assert.ok(codes(r.warnings).includes("LINES_AUTHORED"));
});

test("containment cycle and axis inconsistency", () => {
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "a", name: "A", kind: "container", parent: "b", axis: "logical" },
      { id: "b", name: "B", kind: "container", parent: "a", axis: "logical" },
      { id: "p", name: "P", kind: "system", parent: null, axis: "logical" },
      { id: "w", name: "W", kind: "workload", parent: "p", axis: "deploy" }, // child axis != parent axis
    ],
    edges: [], mappings: [],
  };
  const c = codes(validate(m).errors);
  assert.ok(c.includes("CONTAINMENT_CYCLE"));
  assert.ok(c.includes("AXIS_INCONSISTENT"));
});
