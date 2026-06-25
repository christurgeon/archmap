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

test("render emits the label toggle, edge data hooks, and per-node relationships", () => {
  const html = render(model());
  assert.match(html, /id="lbltoggle"/);                 // the Labels toggle button
  assert.match(html, /data-from="user" data-to="sys"/); // edge hook (user->h promotes to user->sys at root)
  assert.match(html, /"edges":\[\{"dir":"out","to":"h"/); // raw relationships carried into panel data
});

test("render ships the themed visual system", () => {
  const html = render(model());
  // semantic colour-by-kind vars (renderer-owned, spec §2)
  assert.match(html, /--k-person:/);
  assert.match(html, /--k-workload:/);
  // theme cascade: explicit light override + OS default scoped so an explicit
  // data-theme always wins (the B1 bug class)
  assert.match(html, /\[data-theme="light"\]/);
  assert.match(html, /:root:not\(\[data-theme\]\)/);
  assert.match(html, /prefers-color-scheme: ?light/);
  // pre-paint init (no FOUC) + the toggle control
  assert.match(html, /localStorage\.getItem\('archmap-theme'\)/);
  assert.match(html, /id="themetoggle"/);
  // arrowhead colour from CSS (var() can't live on the marker attr); depth via filter
  assert.match(html, /\.amview marker path\{fill:var\(--edge\)\}/);
  assert.match(html, /filter:drop-shadow\(var\(--shadow\)\)/);
});

test("render's legend lists exactly the present kinds, in canonical order", () => {
  const html = render(model());            // present: person, system, container, component, workload
  const legend = html.match(/<div id="legend">(.*?)<\/div>/s)[1];
  assert.match(legend, /class="lg kind-person"/);
  assert.match(legend, /class="lg kind-workload"/);
  assert.doesNotMatch(legend, /kind-store/);   // no store node -> absent from the legend
  assert.doesNotMatch(legend, /kind-external/);
  // canonical KINDS order: person(0) < container(3) < component(6)
  assert.ok(legend.indexOf("kind-person") < legend.indexOf("kind-container"));
  assert.ok(legend.indexOf("kind-container") < legend.indexOf("kind-component"));
});
