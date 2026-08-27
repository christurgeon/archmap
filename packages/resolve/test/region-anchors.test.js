import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRegion } from "../resolve.js";
import { normalizeRegionAnchors } from "@archmap/schema";

function fakeIndex(records) {
  return {
    all: () => records,
    lookup: (fqn, opts = {}) => records.filter((r) => r.fqn === fqn && (!opts.path || r.path === opts.path)),
    lookupByBodyHash: (h) => records.filter((r) => r.bodyHash === h),
    bodyHashIsUnique: (h) => records.filter((r) => r.bodyHash === h).length === 1,
    lookupBySigHash: (h) => records.filter((r) => r.sigHash === h),
  };
}
const rec = (fqn, bodyHash) => ({ fqn, kind: "fn", path: "p.js", startLine: 1, endLine: 2, bodyHash, sigHash: "S" });

test("normalizeRegionAnchors accepts bare strings and passes objects through", () => {
  assert.deepEqual(normalizeRegionAnchors(["a"]), [{ fqn: "a", kind: "fn" }]);
  const obj = { fqn: "b", kind: "class", bodyHash: "H" };
  assert.deepEqual(normalizeRegionAnchors([obj]), [obj]);
  assert.deepEqual(normalizeRegionAnchors(undefined), []);
});

// This is what bootstrap emits for every undrilled container.
test("an empty region is UNANCHORED, never CLEAN", () => {
  const r = resolveRegion({ anchors: [], note: "undrilled" }, "x.js", fakeIndex([]));
  assert.equal(r.state, "UNANCHORED");
  assert.deepEqual(r.parts, []);
});

test("a region with omitted anchors does not crash", () => {
  const r = resolveRegion({ note: "malformed" }, "x.js", fakeIndex([]));
  assert.equal(r.state, "UNANCHORED");
});

// Anchors now carry their own hashes, so a rewritten body is caught rather than
// reading UNBASELINED-as-CLEAN forever.
test("anchor-carried hashes make a rewritten body CHANGED", () => {
  const idx = fakeIndex([rec("a", "REWRITTEN")]);
  const baselined = { anchors: [{ fqn: "a", kind: "fn", bodyHash: "ORIGINAL" }], note: "x" };
  assert.equal(resolveRegion(baselined, "p.js", idx).state, "CHANGED");

  // without a baseline it is honestly UNBASELINED -- not CLEAN
  const bare = { anchors: [{ fqn: "a", kind: "fn" }], note: "x" };
  assert.equal(resolveRegion(bare, "p.js", idx).state, "UNBASELINED");
});

test("string anchors still resolve (back-compat with existing models)", () => {
  const idx = fakeIndex([rec("a", "HA"), rec("b", "HB")]);
  const r = resolveRegion({ anchors: ["a", "b"], note: "x" }, "p.js", idx);
  assert.equal(r.parts.length, 2);
  assert.equal(r.state, "UNBASELINED", "no hashes to check against, and that is not CLEAN");
});

test("per-anchor path overrides the leaf path", () => {
  const idx = fakeIndex([{ ...rec("a", "HA"), path: "other.js" }]);
  const wrong = { anchors: [{ fqn: "a", kind: "fn", bodyHash: "HA" }], note: "x" };
  assert.equal(resolveRegion(wrong, "p.js", idx).state, "MOVED", "not found at the leaf path");
  const right = { anchors: [{ fqn: "a", kind: "fn", bodyHash: "HA", path: "other.js" }], note: "x" };
  assert.equal(resolveRegion(right, "p.js", idx).state, "CLEAN");
});
