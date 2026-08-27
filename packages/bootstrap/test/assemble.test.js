import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@archmap/validate";
import { resolveRegion } from "@archmap/resolve";
import { assemble, MAX_CONTAINERS } from "../assemble.js";

const meta = { name: "t", version: "1", snapshot: "2026-08-27" };
const system = { id: "sys", name: "sys" };
const drilled = (id, comps) => ({
  id, name: id, path: `pkg/${id}`, lang: "js", undrilled: false,
  components: comps.map((fqn) => ({
    id: `${id}--i--${fqn}`, name: fqn, path: `pkg/${id}/i.js`,
    symbol: { fqn, kind: "fn", bodyHash: "H", sigHash: "S" },
  })),
});
const undrilledC = (id, reason = "why") => ({
  id, name: id, path: `pkg/${id}`, lang: "js", undrilled: true, reason, components: [],
});

// THE central promise of the package: valid by construction (§13.1). validate is a cheap
// pure call, so this guards every future heuristic change.
test("every fixture assembles to a model validate accepts with zero errors", () => {
  const fixtures = [
    [],
    [drilled("a", ["f"])],
    [undrilledC("b")],
    [drilled("a", ["f", "g"]), undrilledC("b"), drilled("c", ["h"])],
    Array.from({ length: 12 }, (_, i) => undrilledC(`c${String(i).padStart(2, "0")}`)),
  ];
  for (const containers of fixtures) {
    const { errors } = validate(assemble({ meta, system, containers }));
    assert.deepEqual(errors, [], `fixture with ${containers.length} containers`);
  }
});

// probe D: an omitted `anchors` key crashed resolveRegion on `.map` of undefined
test("every undrilled leaf carries region.anchors as an ARRAY, and resolveRegion survives it", () => {
  const model = assemble({ meta, system, containers: [undrilledC("b"), drilled("a", ["f"])] });
  const regions = model.nodes.map((n) => n.grounding?.region).filter(Boolean);
  assert.equal(regions.length, 1);
  for (const r of regions) {
    assert.ok(Array.isArray(r.anchors), "anchors present and an array");
    assert.ok(r.note, "note explains why this is not one symbol");
    const idx = { all: () => [], lookup: () => [], lookupByBodyHash: () => [], bodyHashIsUnique: () => false, lookupBySigHash: () => [] };
    assert.doesNotThrow(() => resolveRegion(r, "pkg/b", idx));
    // and it must not read as a passing grounding
    assert.equal(resolveRegion(r, "pkg/b", idx).state, "UNANCHORED");
  }
});

test("containers are capped, the tail is logged, and no grouping node is invented", () => {
  const containers = Array.from({ length: 10 }, (_, i) => undrilledC(`c${String(i).padStart(2, "0")}`));
  const logged = [];
  const model = assemble({ meta, system, containers, log: (m) => logged.push(m) });
  const kinds = model.nodes.map((n) => n.kind);
  assert.equal(kinds.filter((k) => k === "container").length, MAX_CONTAINERS);
  assert.equal(kinds.filter((k) => k === "system").length, 1);
  assert.equal(logged.filter((m) => m.startsWith("deferred:")).length, 3, "tail logged, never silent");
  assert.equal(validate(model).errors.length, 0, "the cap is what keeps fan-out legal");
});

test("emission order is parents before children", () => {
  const model = assemble({ meta, system, containers: [drilled("a", ["f"])] });
  const order = model.nodes.map((n) => n.id);
  assert.ok(order.indexOf("sys") < order.indexOf("a"));
  assert.ok(order.indexOf("a") < order.indexOf("a--i--f"));
});

test("every grounding carries repo, and components ground to their symbol's file", () => {
  const model = assemble({ meta, system, containers: [drilled("a", ["f"]), undrilledC("b")] });
  for (const n of model.nodes.filter((x) => x.grounding)) {
    assert.equal(n.grounding.repo, meta.name);
    assert.ok(n.grounding.path);
  }
  assert.equal(model.nodes.find((n) => n.id === "a--i--f").grounding.path, "pkg/a/i.js");
});

test("a drilled container is a non-leaf and carries no anchor of its own", () => {
  const model = assemble({ meta, system, containers: [drilled("a", ["f"])] });
  assert.equal(model.nodes.find((n) => n.id === "a").grounding, undefined);
});

test("v1 emits no edges and no mappings", () => {
  const model = assemble({ meta, system, containers: [drilled("a", ["f"])] });
  assert.deepEqual(model.edges, []);
  assert.deepEqual(model.mappings, []);
});

// A single-package repo's container is the repo root, whose repo-relative path is "".
// validate treats an empty path as missing, so the assembler must normalize it.
test("a root container grounds to '.', not the empty string", () => {
  const rootC = { id: "pkg-solo", name: "solo", path: "", lang: "js", undrilled: true, reason: "why", components: [] };
  const model = assemble({ meta, system, containers: [rootC] });
  assert.equal(model.nodes.find((n) => n.id === "pkg-solo").grounding.path, ".");
  assert.deepEqual(validate(model).errors, [], "an empty path would trip GROUNDING_REPO_PATH");
});
