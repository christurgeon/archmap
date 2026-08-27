import { test } from "node:test";
import assert from "node:assert/strict";
import { createModel, addNode, addEdge } from "@archmap/schema";
import { validate } from "../index.js";

function base() {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  addNode(m, { id: "a", name: "A", kind: "component", parent: null });
  addNode(m, { id: "b", name: "B", kind: "component", parent: null });
  // components are groundable leaves — anchor them so GROUNDABLE_UNANCHORED stays quiet
  m.nodes[0].grounding = { repo: "r", path: "src/a.js", symbol: { fqn: "a", kind: "fn" } };
  m.nodes[1].grounding = { repo: "r", path: "src/b.js", symbol: { fqn: "b", kind: "fn" } };
  addEdge(m, "a", "b", "calls");
  return m;
}

const codes = (list) => list.map((x) => x.code);

// Evidence is optional by design (spec §5): requiring it would push authors toward
// fabricated citations, which is the self-certification failure the design exists to avoid.
test("an unevidenced edge is not an error", () => {
  const { errors, warnings } = validate(base());
  assert.deepEqual(errors, []);
  assert.equal(codes(warnings).includes("EDGE_UNEVIDENCED"), false);
});

test("a well-formed call citation passes clean", () => {
  const m = base();
  m.edges[0].evidence = {
    kind: "call", path: "src/a.js",
    anchors: [{ fqn: "a", kind: "fn" }, { fqn: "b", kind: "fn" }],
  };
  const { errors, warnings } = validate(m);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("EDGE_EVIDENCE_BAD_KIND on an unknown kind", () => {
  const m = base();
  m.edges[0].evidence = { kind: "vibes", path: "p", anchors: [{ fqn: "a", kind: "fn" }] };
  assert.equal(codes(validate(m).errors).includes("EDGE_EVIDENCE_BAD_KIND"), true);
});

test("EDGE_EVIDENCE_NO_PATH when path is absent or empty", () => {
  const m = base();
  m.edges[0].evidence = { kind: "call", anchors: [{ fqn: "a", kind: "fn" }] };
  assert.equal(codes(validate(m).errors).includes("EDGE_EVIDENCE_NO_PATH"), true);
  m.edges[0].evidence = { kind: "call", path: "", anchors: [{ fqn: "a", kind: "fn" }] };
  assert.equal(codes(validate(m).errors).includes("EDGE_EVIDENCE_NO_PATH"), true);
});

test("EDGE_EVIDENCE_NO_ANCHORS only for symbol kinds", () => {
  const m = base();
  for (const kind of ["call", "import", "test"]) {
    m.edges[0].evidence = { kind, path: "p", anchors: [] };
    assert.equal(codes(validate(m).errors).includes("EDGE_EVIDENCE_NO_ANCHORS"), true, kind);
  }
  // config and doc legitimately carry none
  m.edges[0].evidence = { kind: "config", path: "k8s/svc.yaml", anchors: [] };
  assert.equal(codes(validate(m).errors).includes("EDGE_EVIDENCE_NO_ANCHORS"), false);
  m.edges[0].evidence = { kind: "doc", path: "README.md", anchors: [], note: "why" };
  assert.equal(codes(validate(m).errors).includes("EDGE_EVIDENCE_NO_ANCHORS"), false);
});

test("EDGE_EVIDENCE_DOC_NEEDS_NOTE — the honesty forcing function", () => {
  const m = base();
  m.edges[0].evidence = { kind: "doc", path: "README.md", anchors: [] };
  assert.equal(codes(validate(m).errors).includes("EDGE_EVIDENCE_DOC_NEEDS_NOTE"), true);
  m.edges[0].evidence = { kind: "doc", path: "README.md", anchors: [], note: "person endpoint" };
  assert.equal(codes(validate(m).errors).includes("EDGE_EVIDENCE_DOC_NEEDS_NOTE"), false);
});

test("EDGE_EVIDENCE_BAD_ANCHOR when an anchor lacks fqn or kind", () => {
  const m = base();
  m.edges[0].evidence = { kind: "call", path: "p", anchors: [{ kind: "fn" }] };
  assert.equal(codes(validate(m).errors).includes("EDGE_EVIDENCE_BAD_ANCHOR"), true);
  m.edges[0].evidence = { kind: "call", path: "p", anchors: [{ fqn: "a" }] };
  assert.equal(codes(validate(m).errors).includes("EDGE_EVIDENCE_BAD_ANCHOR"), true);
});

// Mirrors LINES_AUTHORED: resolution state is derived output, computed at check time
// and never stored in the model (spec §3.2).
test("EDGE_EVIDENCE_RESOLVED_AUTHORED warns on hand-written resolution state", () => {
  const m = base();
  m.edges[0].evidence = {
    kind: "call", path: "p", anchors: [{ fqn: "a", kind: "fn" }],
    resolved: { state: "CLEAN" },
  };
  const { errors, warnings } = validate(m);
  assert.deepEqual(errors, []);
  assert.equal(codes(warnings).includes("EDGE_EVIDENCE_RESOLVED_AUTHORED"), true);
});

test("evidence on a missing-endpoint edge does not crash the pass", () => {
  const m = base();
  m.edges.push({ from: "a", to: "ghost", label: "x", evidence: { kind: "doc", path: "p" } });
  const { errors } = validate(m);
  assert.equal(codes(errors).includes("EDGE_ENDPOINT_MISSING"), true);
});
