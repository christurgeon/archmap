import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRegion } from "../resolve.js";

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

test("region is CLEAN only when all anchors are clean", () => {
  const idx = fakeIndex([rec("a", "HA"), rec("b", "HB")]);
  const region = { anchors: ["a", "b"], note: "the publish path" };
  const r = resolveRegion(region, null, idx, { hashes: { a: "HA", b: "HB" } });
  assert.equal(r.state, "CLEAN");
  assert.equal(r.parts.length, 2);
});

test("region takes the worst state when one anchor drifts", () => {
  const idx = fakeIndex([rec("a", "HA")]); // 'b' is gone -> MISSING
  const region = { anchors: ["a", "b"], note: "x" };
  const r = resolveRegion(region, null, idx, { hashes: { a: "HA", b: "HB" } });
  assert.equal(r.state, "MISSING");
});

test("region worst-state picks AMBIGUOUS over CHANGED (pins ordering beyond MISSING)", () => {
  // a -> CHANGED (one hit, baseline mismatch); b -> AMBIGUOUS (fqn appears twice)
  const idx = fakeIndex([rec("a", "HX"), rec("b", "H1"), rec("b", "H2")]);
  const r = resolveRegion({ anchors: ["a", "b"], note: "x" }, null, idx, { hashes: { a: "HA" } });
  assert.equal(r.state, "AMBIGUOUS");
});
