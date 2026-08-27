import { test } from "node:test";
import assert from "node:assert/strict";
import { rebaseline } from "../resolve.js";

const hit = (bodyHash, sigHash = "S2") => ({ path: "a.js", startLine: 1, endLine: 2, bodyHash, sigHash });

test("rebaseline updates a CHANGED anchor in place", () => {
  const a = { fqn: "f", kind: "fn", bodyHash: "OLD", sigHash: "S1" };
  assert.equal(rebaseline(a, "CHANGED", hit("NEW")), true);
  assert.equal(a.bodyHash, "NEW");
  assert.equal(a.sigHash, "S2");
});

// §9: never auto-bump path. A MOVED/RENAMED anchor is a decision, not a confirmation --
// re-anchoring it silently is how a green check lands on the wrong symbol.
test("rebaseline refuses states that would silently re-anchor", () => {
  for (const state of ["MOVED", "RENAMED", "RENAMED?", "AMBIGUOUS", "MISSING"]) {
    const a = { fqn: "f", kind: "fn", bodyHash: "OLD" };
    assert.equal(rebaseline(a, state, hit("NEW")), false, state);
    assert.equal(a.bodyHash, "OLD", state);
  }
});

test("rebaseline is a no-op on CLEAN and without a hit", () => {
  const a = { fqn: "f", kind: "fn", bodyHash: "OLD" };
  assert.equal(rebaseline(a, "CLEAN", hit("OLD")), false);
  assert.equal(rebaseline(a, "CHANGED", null), false);
  assert.equal(a.bodyHash, "OLD");
});
