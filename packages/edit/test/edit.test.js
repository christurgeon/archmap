import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { applyOps, OPS } from "../index.js";

const base = () => ({
  meta: { name: "x", version: "1", snapshot: "s" },
  nodes: [{ id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" }],
  edges: [], mappings: [],
});
const g = (fqn) => ({ repo: "x", path: "a.js", symbol: { fqn, kind: "fn" } });

test("every spec §6 op is exposed", () => {
  for (const op of ["addNode", "moveNode", "removeNode", "setBlurb", "setTech", "setLinks", "setGrounding",
    "addEdge", "removeEdge", "setEdgeLabel", "setEdgeEvidence", "addMapping", "removeMapping"]) {
    assert.ok(OPS.includes(op), op);
  }
});

test("a batch applies in order and passes the gate", () => {
  const { model, errors } = applyOps(base(), [
    { op: "addNode", id: "api", name: "API", kind: "component", parent: "sys" },
    { op: "addNode", node: { id: "db", name: "DB", kind: "component", parent: "sys" } },
    { op: "setGrounding", id: "api", grounding: g("api") },
    { op: "setGrounding", id: "db", grounding: g("db") },
    { op: "addEdge", from: "api", to: "db", label: "reads" },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(model.edges.length, 1);
  assert.equal(model.nodes.find((n) => n.id === "api").axis, "logical");
});

test("a failing op aborts the whole batch and leaves the input untouched", () => {
  const m = base();
  assert.throws(() => applyOps(m, [
    { op: "addNode", id: "a", name: "A", kind: "component", parent: "sys" },
    { op: "addEdge", from: "a", to: "nope", label: "x" },
  ]), /op #1 \(addEdge\): no such node: nope/);
  assert.equal(m.nodes.length, 1);
});

test("unknown ops and missing arguments fail loudly", () => {
  assert.throws(() => applyOps(base(), [{ op: "paint" }]), /unknown op "paint"/);
  assert.throws(() => applyOps(base(), [{ op: "addEdge", from: "sys" }]), /missing "to"/);
});

test("validation errors are reported, not thrown, so the CLI can refuse the write", () => {
  // an ungrounded groundable leaf is an error
  const { errors } = applyOps(base(), [{ op: "addNode", id: "c", name: "C", kind: "component", parent: "sys" }]);
  assert.ok(errors.some((e) => e.code === "GROUNDABLE_UNANCHORED"));
});

test("CLI writes on success and refuses on validation errors", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = join(here, "..", "edit.mjs");
  const dir = mkdtempSync(join(tmpdir(), "archmap-edit-"));
  const model = join(dir, "model.json");
  writeFileSync(model, JSON.stringify(base()));

  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify([{ op: "addNode", id: "c", name: "C", kind: "component", parent: "sys" }]));
  assert.throws(() => execFileSync("node", [cli, model, bad], { stdio: "pipe" }), (e) => e.status === 1);
  assert.equal(JSON.parse(readFileSync(model, "utf8")).nodes.length, 1, "nothing written");

  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify([
    { op: "addNode", id: "c", name: "C", kind: "component", parent: "sys" },
    { op: "setGrounding", id: "c", grounding: g("c") },
  ]));
  execFileSync("node", [cli, model, good, "--dry-run"], { stdio: "pipe" });
  assert.equal(JSON.parse(readFileSync(model, "utf8")).nodes.length, 1, "dry run writes nothing");
  execFileSync("node", [cli, model, good], { stdio: "pipe" });
  assert.equal(JSON.parse(readFileSync(model, "utf8")).nodes.length, 2);
});
