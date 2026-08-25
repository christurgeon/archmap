import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEdgeEvidence, worstState, SEVERITY } from "../resolve.js";

// Same hand-built fake index the node tests use — state transitions in isolation, no parsing.
function fakeIndex(records) {
  const byFqn = (fqn, path) => records.filter((r) => r.fqn === fqn && (!path || r.path === path));
  return {
    all: () => records,
    lookup: (fqn, opts = {}) => byFqn(fqn, opts.path),
    lookupByBodyHash: (h) => records.filter((r) => r.bodyHash === h),
    bodyHashIsUnique: (h) => records.filter((r) => r.bodyHash === h).length === 1,
    lookupBySigHash: (h) => records.filter((r) => r.sigHash === h),
  };
}
const rec = (o) => ({ fqn: "x", kind: "fn", path: "p.js", startLine: 1, endLine: 2, bodyHash: "B", sigHash: "S", ...o });
const anchor = (fqn, bodyHash, path) => ({ fqn, kind: "fn", bodyHash, ...(path ? { path } : {}) });

test("worstState picks the most severe, CLEAN when empty", () => {
  assert.equal(worstState([]), "CLEAN");
  assert.equal(worstState(["CLEAN", "CHANGED", "MOVED"]), "CHANGED");
  assert.equal(worstState(["CHANGED", "MISSING", "AMBIGUOUS"]), "MISSING");
  // the shipped severity ladder is the authority, not a second ordering
  assert.equal(SEVERITY[0], "CLEAN");
  assert.equal(SEVERITY[SEVERITY.length - 1], "MISSING");
});

test("a two-anchor call citation is CLEAN when both anchors resolve clean", () => {
  const idx = fakeIndex([
    rec({ fqn: "render", path: "html.js", bodyHash: "H1" }),
    rec({ fqn: "layoutView", path: "layout.js", bodyHash: "H2" }),
  ]);
  const r = resolveEdgeEvidence(
    {
      kind: "call", path: "html.js",
      anchors: [anchor("render", "H1"), anchor("layoutView", "H2", "layout.js")],
    },
    idx,
  );
  assert.equal(r.state, "CLEAN");
  assert.equal(r.parts.length, 2);
});

// The caller and callee of a cross-file call are never in one file, so a per-anchor
// path is load-bearing: without it the callee falls through to a repo-wide MOVED.
test("per-anchor path is required for cross-file citations", () => {
  const idx = fakeIndex([
    rec({ fqn: "render", path: "html.js", bodyHash: "H1" }),
    rec({ fqn: "layoutView", path: "layout.js", bodyHash: "H2" }),
  ]);
  const withoutPath = resolveEdgeEvidence(
    { kind: "call", path: "html.js", anchors: [anchor("layoutView", "H2")] },
    idx,
  );
  assert.equal(withoutPath.state, "MOVED");
  const withPath = resolveEdgeEvidence(
    { kind: "call", path: "html.js", anchors: [anchor("layoutView", "H2", "layout.js")] },
    idx,
  );
  assert.equal(withPath.state, "CLEAN");
});

// The point of anchoring the call site: deleting the call mutates that symbol's body.
test("call-site body change surfaces as CHANGED, not CLEAN", () => {
  const idx = fakeIndex([
    rec({ fqn: "render", path: "html.js", bodyHash: "REWRITTEN" }),
    rec({ fqn: "layoutView", path: "layout.js", bodyHash: "H2" }),
  ]);
  const r = resolveEdgeEvidence(
    {
      kind: "call", path: "html.js",
      anchors: [anchor("render", "H1"), anchor("layoutView", "H2", "layout.js")],
    },
    idx,
  );
  assert.equal(r.state, "CHANGED");
});

test("edge state is the WORST anchor state, not the first", () => {
  const idx = fakeIndex([rec({ fqn: "render", path: "html.js", bodyHash: "H1" })]);
  const r = resolveEdgeEvidence(
    { kind: "call", path: "html.js", anchors: [anchor("render", "H1"), anchor("gone", "H9")] },
    idx,
  );
  assert.equal(r.state, "MISSING");
  assert.deepEqual(r.parts.map((p) => p.state), ["CLEAN", "MISSING"]);
});

test("callee-only citation still resolves (composition-root case, spec §3.1)", () => {
  const idx = fakeIndex([rec({ fqn: "validate", path: "validate/index.js", bodyHash: "H1" })]);
  const r = resolveEdgeEvidence(
    { kind: "call", path: "validate/index.js", anchors: [anchor("validate", "H1")] },
    idx,
  );
  assert.equal(r.state, "CLEAN");
});

test("an unbaselined anchor is CLEAN_ENOUGH, not a failure", () => {
  const idx = fakeIndex([rec({ fqn: "f", path: "a.js", bodyHash: "H1" })]);
  const r = resolveEdgeEvidence({ kind: "call", path: "a.js", anchors: [anchor("f", undefined)] }, idx);
  assert.equal(r.state, "UNBASELINED");
});

test("import and test kinds resolve like call", () => {
  const idx = fakeIndex([rec({ fqn: "f", path: "a.js", bodyHash: "H1" })]);
  for (const kind of ["import", "test"]) {
    assert.equal(resolveEdgeEvidence({ kind, path: "a.js", anchors: [anchor("f", "H1")] }, idx).state, "CLEAN");
  }
});

test("doc evidence is SKIPPED — never machine-checked", () => {
  const idx = fakeIndex([]);
  const r = resolveEdgeEvidence({ kind: "doc", path: "README.md", anchors: [], note: "why" }, idx);
  assert.equal(r.state, "SKIPPED");
  assert.deepEqual(r.parts, []);
});

test("config evidence is path-checked only", () => {
  const idx = fakeIndex([]);
  const ev = { kind: "config", path: "k8s/svc.yaml", anchors: [] };
  assert.equal(resolveEdgeEvidence(ev, idx, { pathExists: () => true }).state, "CLEAN");
  assert.equal(resolveEdgeEvidence(ev, idx, { pathExists: () => false }).state, "MISSING");
  // with no predicate supplied the checker must not claim success
  assert.equal(resolveEdgeEvidence(ev, idx).state, "SKIPPED");
});

test("absent evidence is UNEVIDENCED — reported, never a failure", () => {
  const r = resolveEdgeEvidence(undefined, fakeIndex([]));
  assert.equal(r.state, "UNEVIDENCED");
  assert.deepEqual(r.parts, []);
});

test("AMBIGUOUS propagates from a colliding fqn", () => {
  const idx = fakeIndex([
    rec({ fqn: "model", path: "a.js", bodyHash: "H1" }),
    rec({ fqn: "model", path: "b.js", bodyHash: "H2" }),
  ]);
  const r = resolveEdgeEvidence({ kind: "call", path: "zz.js", anchors: [anchor("model", "H1")] }, idx);
  assert.equal(r.state, "AMBIGUOUS");
});
