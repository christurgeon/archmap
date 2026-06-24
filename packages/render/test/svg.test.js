import { test } from "node:test";
import assert from "node:assert/strict";
import { renderViewSvg, esc } from "../svg.js";

const view = {
  width: 400, height: 300, focusId: "sys", axis: "logical",
  boxes: [
    { id: "api", x: 40, y: 40, w: 130, h: 64, node: { id: "api", name: "API & <Co>", kind: "container", tech: "Node" }, hasChildren: true },
    { id: "ext", x: 200, y: 40, w: 130, h: 64, node: { id: "ext", name: "GitHub", kind: "external" }, hasChildren: false },
  ],
  edges: [{ from: "api", to: "ext", label: "calls", points: [[105, 104], [105, 150], [265, 150], [265, 40]] }],
};

test("esc escapes XML metacharacters", () => {
  assert.equal(esc('a & b < c > "d"'), "a &amp; b &lt; c &gt; &quot;d&quot;");
});

test("renderViewSvg emits boxes, edges, labels and escapes text", () => {
  const svg = renderViewSvg(view);
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 400 300"/);
  assert.match(svg, /class="amedge"/);
  assert.match(svg, /data-id="api"/);
  assert.match(svg, /API &amp; &lt;Co&gt;/);          // escaped name
  assert.match(svg, /container · Node/);               // sub label
  assert.match(svg, /kind-external/);                  // external styling hook
  assert.match(svg, /class="amlabel"/);
  assert.match(svg, />calls</);
  assert.doesNotMatch(svg, /<Co>/);                    // unescaped angle brackets must not appear
});
