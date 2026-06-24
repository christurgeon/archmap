import { test } from "node:test";
import assert from "node:assert/strict";
import { createModel, addNode, setBlurb, setTech, setLinks, setGrounding, getNode } from "../index.js";

function base() {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  addNode(m, { id: "h", name: "H", kind: "component", parent: null });
  return m;
}

test("setBlurb/setTech/setLinks mutate the node", () => {
  const m = base();
  setBlurb(m, "h", "does a thing");
  setTech(m, "h", "Rust");
  setLinks(m, "h", [{ label: "docs", url: "https://x" }]);
  const n = getNode(m, "h");
  assert.equal(n.blurb, "does a thing");
  assert.equal(n.tech, "Rust");
  assert.deepEqual(n.links, [{ label: "docs", url: "https://x" }]);
});

test("setGrounding stores anchor + repo/path, keeps repo on re-set", () => {
  const m = base();
  const g = setGrounding(m, "h", { repo: "r", path: "src/h.rs", symbol: { fqn: "crate::h", kind: "fn", bodyHash: "abc" } });
  assert.equal(g.repo, "r");
  assert.equal(g.path, "src/h.rs");
  assert.equal(g.symbol.fqn, "crate::h");
  // re-set without repo keeps the prior repo
  setGrounding(m, "h", { path: "src/h2.rs", symbol: { fqn: "crate::h", kind: "fn" } });
  assert.equal(getNode(m, "h").grounding.repo, "r");
  assert.equal(getNode(m, "h").grounding.path, "src/h2.rs");
});

test("setGrounding never writes lines or resolved", () => {
  const m = base();
  const g = setGrounding(m, "h", { repo: "r", path: "p", region: { anchors: ["a", "b"], note: "spread out" } });
  assert.equal("lines" in g, false);
  assert.equal("resolved" in g, false);
  assert.deepEqual(g.region.anchors, ["a", "b"]);
});

test("attribute ops throw on missing node", () => {
  const m = base();
  assert.throws(() => setBlurb(m, "ghost", "x"), /no such node/);
});
