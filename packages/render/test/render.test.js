import { test } from "node:test";
import assert from "node:assert/strict";
import { render, collectViews, viewId } from "../index.js";

function model() {
  return {
    meta: { name: "Demo", version: "1.0", snapshot: "2026-06-23" },
    nodes: [
      { id: "user", name: "User", kind: "person", parent: null, axis: "logical" },
      { id: "sys", name: "Demo Sys", kind: "system", parent: null, axis: "logical" },
      { id: "api", name: "API", kind: "container", parent: "sys", axis: "logical", tech: "Node" },
      { id: "h", name: "Handler", kind: "component", parent: "api", axis: "logical", blurb: "Handles requests.",
        grounding: { repo: "r", path: "src/h.js", symbol: { fqn: "h", kind: "fn" } },
        links: [{ label: "docs", url: "https://example.com" }] },
      { id: "pod", name: "Pod", kind: "workload", parent: null, axis: "deploy",
        grounding: { repo: "r", path: "k8s/pod.yaml", iac: "kubernetes_pod.api" } },
    ],
    edges: [{ from: "user", to: "h", label: "uses" }],
    mappings: [{ logical: "api", deploy: "pod", label: "runs on" }],
  };
}

test("collectViews includes both roots and every parent node", () => {
  const v = collectViews(model()).map((x) => viewId(x.focusId, x.axis)).sort();
  assert.deepEqual(v, ["__root_deploy", "__root_logical", "api", "sys"]);
});

test("render is self-contained (no external scripts/styles/img)", () => {
  const html = render(model());
  assert.match(html, /^<!doctype html>/i);
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link\s+rel=["']stylesheet/i);
  assert.doesNotMatch(html, /src=["']https?:/i);
});

test("render embeds names, the snapshot, and the user link", () => {
  const html = render(model());
  assert.match(html, /Demo Sys/);
  assert.match(html, /Handler/);
  assert.match(html, /2026-06-23/);                       // snapshot, not wall clock
  assert.match(html, /https:\/\/example\.com/);           // user-authored link allowed
});

test("render is deterministic", () => {
  assert.equal(render(model()), render(model()));
});

test("render embeds the deploy axis toggle and mapping panel data", () => {
  const html = render(model());
  assert.match(html, /"rootDeploy":"__root_deploy"/);
  assert.match(html, /data-axis="deploy"/);     // the Deploy toggle button is emitted
  assert.match(html, /"runs on"/);              // mapping label carried into the panel data
  assert.match(html, /"to":"pod"/);             // mapping target id in the panel data
});

test("render with no deploy nodes nulls rootDeploy and omits the toggle", () => {
  const m = model();
  m.nodes = m.nodes.filter((n) => (n.axis ?? "logical") !== "deploy");
  m.mappings = [];
  const html = render(m);
  assert.match(html, /"rootDeploy":null/);
  assert.doesNotMatch(html, /data-axis="deploy"/);
});
