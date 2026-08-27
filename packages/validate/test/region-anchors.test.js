import { test } from "node:test";
import assert from "node:assert/strict";
import { createModel, addNode } from "@archmap/schema";
import { validate } from "../index.js";

function withRegion(region) {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  addNode(m, { id: "c", name: "C", kind: "container", parent: null });
  m.nodes[0].grounding = { repo: "r", path: "src/c.js", region };
  return m;
}
const codes = (l) => l.map((x) => x.code);

test("a well-formed region passes clean", () => {
  const m = withRegion({ anchors: [{ fqn: "a", kind: "fn" }], note: "the publish path" });
  assert.deepEqual(validate(m).errors, []);
});

// note is REQUIRED — the forcing function that makes the weak case admit it's weak,
// exactly as doc evidence does for edges.
test("REGION_NEEDS_NOTE when the justification is missing", () => {
  const m = withRegion({ anchors: [{ fqn: "a", kind: "fn" }] });
  assert.equal(codes(validate(m).errors).includes("REGION_NEEDS_NOTE"), true);
});

// Previously crashed resolve.js on `.map` of undefined.
test("REGION_BAD_ANCHORS when anchors is omitted or not an array", () => {
  assert.equal(codes(validate(withRegion({ note: "x" })).errors).includes("REGION_BAD_ANCHORS"), true);
  assert.equal(codes(validate(withRegion({ anchors: "a", note: "x" })).errors).includes("REGION_BAD_ANCHORS"), true);
});

test("REGION_BAD_ANCHOR when an entry has no fqn", () => {
  const m = withRegion({ anchors: [{ kind: "fn" }], note: "x" });
  assert.equal(codes(validate(m).errors).includes("REGION_BAD_ANCHOR"), true);
});

// An empty region is legal (bootstrap emits it for undrilled containers) but it verifies
// nothing, so it warns rather than passing silently as a green check.
test("REGION_EMPTY warns, does not block", () => {
  const { errors, warnings } = validate(withRegion({ anchors: [], note: "undrilled" }));
  assert.deepEqual(errors, []);
  assert.equal(codes(warnings).includes("REGION_EMPTY"), true);
});

test("string anchors remain valid (back-compat)", () => {
  const m = withRegion({ anchors: ["a", "b"], note: "x" });
  assert.deepEqual(validate(m).errors, []);
});
