import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createModel, addNode, addEdge, removeEdge, setEdgeEvidence,
  EVIDENCE_KINDS, SYMBOL_EVIDENCE_KINDS,
} from "../index.js";

function base() {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  addNode(m, { id: "a", name: "A", kind: "component", parent: null });
  addNode(m, { id: "b", name: "B", kind: "component", parent: null });
  addEdge(m, "a", "b", "calls");
  return m;
}

const anchor = (fqn) => ({ fqn, kind: "fn" });

test("kind sets are the documented ones", () => {
  assert.deepEqual(EVIDENCE_KINDS, ["call", "import", "test", "config", "doc"]);
  assert.deepEqual(SYMBOL_EVIDENCE_KINDS, ["call", "import", "test"]);
});

test("setEdgeEvidence stores a call citation with both anchors", () => {
  const m = base();
  const ev = setEdgeEvidence(m, "a", "b", {
    kind: "call",
    path: "src/a.js",
    anchors: [anchor("render"), anchor("layoutView")],
  });
  assert.equal(ev.kind, "call");
  assert.equal(ev.path, "src/a.js");
  assert.deepEqual(ev.anchors.map((x) => x.fqn), ["render", "layoutView"]);
  assert.equal(m.edges[0].evidence, ev);
});

test("callee-only citation is legal (composition-root case, spec 3.1)", () => {
  const m = base();
  const ev = setEdgeEvidence(m, "a", "b", {
    kind: "call",
    path: "src/b.js",
    anchors: [anchor("validate")],
  });
  assert.equal(ev.anchors.length, 1);
});

test("doc evidence requires a note and takes no anchors", () => {
  const m = base();
  assert.throws(
    () => setEdgeEvidence(m, "a", "b", { kind: "doc", path: "README.md" }),
    /note required/,
  );
  const ev = setEdgeEvidence(m, "a", "b", {
    kind: "doc", path: "README.md", note: "person endpoint, never call-verifiable",
  });
  assert.equal(ev.note, "person endpoint, never call-verifiable");
  assert.deepEqual(ev.anchors, []);
});

test("config evidence needs a path but no anchors", () => {
  const m = base();
  const ev = setEdgeEvidence(m, "a", "b", { kind: "config", path: "k8s/svc.yaml" });
  assert.deepEqual(ev.anchors, []);
  assert.equal(ev.path, "k8s/svc.yaml");
});

test("guards: unknown kind, missing edge, empty anchors, missing path, bad anchor", () => {
  const m = base();
  assert.throws(
    () => setEdgeEvidence(m, "a", "b", { kind: "vibes", path: "p", anchors: [anchor("x")] }),
    /unknown kind/,
  );
  assert.throws(
    () => setEdgeEvidence(m, "a", "ghost", { kind: "call", path: "p", anchors: [anchor("x")] }),
    /no edge/,
  );
  assert.throws(
    () => setEdgeEvidence(m, "a", "b", { kind: "call", path: "p", anchors: [] }),
    /anchors required/,
  );
  assert.throws(
    () => setEdgeEvidence(m, "a", "b", { kind: "call", anchors: [anchor("x")] }),
    /path required/,
  );
  assert.throws(
    () => setEdgeEvidence(m, "a", "b", { kind: "call", path: "p", anchors: [{ kind: "fn" }] }),
    /anchor needs fqn/,
  );
});

test("evidence never carries derived resolution state", () => {
  const m = base();
  const ev = setEdgeEvidence(m, "a", "b", {
    kind: "call", path: "p", anchors: [anchor("x")],
    resolved: { state: "CLEAN" }, lines: "1-2",
  });
  assert.equal("resolved" in ev, false);
  assert.equal("lines" in ev, false);
});

test("passing null clears evidence", () => {
  const m = base();
  setEdgeEvidence(m, "a", "b", { kind: "call", path: "p", anchors: [anchor("x")] });
  assert.equal(setEdgeEvidence(m, "a", "b", null), null);
  assert.equal("evidence" in m.edges[0], false);
});

test("removeEdge drops the citation with the edge", () => {
  const m = base();
  setEdgeEvidence(m, "a", "b", { kind: "call", path: "p", anchors: [anchor("x")] });
  removeEdge(m, "a", "b");
  assert.equal(m.edges.length, 0);
});
