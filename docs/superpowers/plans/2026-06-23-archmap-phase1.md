# archmap Phase 1 (Artifact Chain) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the archmap artifact chain — a structured model (`model.json`) edited through a small operation API, gated by a deterministic validator, and rendered by a pure function into a single self-contained `archmap.html`.

**Architecture:** An npm-workspaces monorepo with three packages. `@archmap/schema` owns the model shape, helpers, and the edit-operation API (the agent's only surface). `@archmap/validate` is the gate: a pure `validate(model)` returning `{errors, warnings}` plus a CLI that exits non-zero on errors. `@archmap/render` is a pure `render(model) -> htmlString`: it owns all geometry (a zero-dependency deterministic layered layout) and emits one self-contained HTML file with inline CSS/SVG/JS. The agent edits only the model; render is a pure rebuild.

**Tech Stack:** Node 24 LTS, ES modules (`"type": "module"`), `node:test` built-in test runner, **zero runtime dependencies**. CLIs are plain `.mjs` entry points matching the spec's naming (`validate.mjs`, `render.mjs`).

## Global Constraints

- **Node** `>=22` (dev machine runs v24.18 via nvm; `.nvmrc` = `lts/*`). Copy verbatim into each `package.json`: `"engines": { "node": ">=22" }`.
- **Zero runtime dependencies** across all packages. Tests use only `node:test` + `node:assert/strict`. The only allowed `devDependencies` are none — `node --test` is built in.
- **ESM only.** Every `package.json` has `"type": "module"`. Internal modules are `.js`; CLI entry points are `.mjs`.
- **Pure render.** `render(model)` must be deterministic: identical `model` → byte-identical HTML. No `Date.now()`, no `Math.random()`, no wall-clock. Any displayed timestamp comes from `model.meta.snapshot`.
- **Self-contained output.** `archmap.html` must contain no external resource references: no `<script src=...>`, no `<link rel="stylesheet">`, no `src="http..."`. User-authored `links[].url` are the *only* external hrefs and are allowed (they are content, opened in a new tab).
- **Workspace package names:** `@archmap/schema`, `@archmap/validate`, `@archmap/render`. Cross-package imports use these names (workspaces symlink them under `node_modules` after `npm install`).
- **The agent edits only `model.json`.** It never edits HTML and never hand-authors `grounding.lines` or `grounding.resolved` (validator warns on authored `lines`).
- **Edit-op signatures thread the model explicitly.** The spec (§6) lists ops conceptually as `addNode({...})`; the implementation threads the target model as the first argument: `addNode(model, {...})`. This is an intentional deviation from the spec's listing — recorded here so it is not "fixed" back.
- **Rendering uses drill-down, not nested boundary boxes.** Each view shows one containment level; clicking a parent navigates into its children's view (with a breadcrumb), rather than drawing nested rectangles within a single view. This satisfies §8 "boundary boxes render from containment" via navigation (containment drives which boxes appear in which view). Intentional Phase-1 interpretation — recorded so it is not mistaken for a missing feature. Swapping to nested boxes later is a render-only change; the model is unaffected.
- **Spec is source of truth.** Section references (§N) point at `/home/chris/archmap/spec.md`.

### Canonical type shapes (verbatim from spec §3, for reference in every task)

```ts
type Axis = "logical" | "deploy";
type Kind =
  | "person" | "system" | "external"            // logical · L1
  | "container" | "store" | "tenant"            // logical · L2
  | "component"                                 // logical · L3
  | "cloud" | "network" | "infra" | "workload"; // deploy axis

interface Node {
  id: string; name: string; kind: Kind; parent: string | null;
  axis?: Axis; tech?: string; blurb?: string;
  links?: { label: string; url: string }[];
  grounding?: Grounding;
}
interface Edge { from: string; to: string; label: string; }       // leaf-to-leaf, SAME axis
interface Mapping { logical: string; deploy: string; label: string; } // ONLY cross-axis link
interface Model { meta: { name: string; version: string; snapshot: string };
  nodes: Node[]; edges: Edge[]; mappings: Mapping[]; }

interface Grounding {
  repo: string; path: string;
  symbol?: SymbolAnchor; region?: RegionAnchor;
  iac?: string; dashboard?: string;
  lines?: string;        // DERIVED — authoring it = warning
  resolved?: Resolved;   // written by resolver (Phase 2); never authored
}
interface SymbolAnchor { fqn: string; kind: "fn"|"method"|"class"|"type"|"module"|"iac_resource"; bodyHash?: string; sigHash?: string; }
interface RegionAnchor { anchors: string[]; note: string; }
```

### Kind → axis & groundable sets (single source, defined in Task 2, used everywhere)

- `LOGICAL_KINDS = ["person","system","external","container","store","tenant","component"]`
- `DEPLOY_KINDS  = ["cloud","network","infra","workload"]`
- `KINDS = [...LOGICAL_KINDS, ...DEPLOY_KINDS]`
- `AXES = ["logical","deploy"]`
- `GROUNDABLE_KINDS = ["component","store","infra","workload","container"]` (spec §3 grounding comment)
- `kindAxis(kind)` → `"deploy"` if `kind ∈ DEPLOY_KINDS` else `"logical"`.

---

## File Structure

```
archmap/
  .nvmrc                          # lts/*
  .gitignore
  package.json                    # root: workspaces, scripts
  model.json                      # the dogfood model (Task 14)
  packages/
    schema/
      package.json                # @archmap/schema
      index.js                    # constants, helpers, edit ops
      test/helpers.test.js        # constants + getNode/childrenOf/isLeaf/ancestorsOf
      test/node-ops.test.js       # addNode/moveNode/removeNode
      test/attr-ops.test.js       # setBlurb/setTech/setLinks/setGrounding
      test/edge-ops.test.js       # addEdge/removeEdge/setEdgeLabel/add+removeMapping
    validate/
      package.json                # @archmap/validate
      index.js                    # validate(model) -> {errors, warnings}
      validate.mjs                # CLI
      test/schema-rules.test.js
      test/edge-rules.test.js
      test/mapping-fanout-grounding.test.js
      test/cli.test.js
    render/
      package.json                # @archmap/render
      index.js                    # render(model) -> html ; collectViews
      promote.js                  # viewChildren, promoteEdges
      layout.js                   # layerize, boxWidth, layoutView
      svg.js                      # renderViewSvg
      html.js                     # assemble self-contained HTML
      render.mjs                  # CLI (validates first, then writes html)
      test/promote.test.js
      test/layout.test.js
      test/svg.test.js
      test/render.test.js
  .github/workflows/validate.yml  # CI: test + validate on PR
  docs/superpowers/plans/2026-06-23-archmap-phase1.md  # this file
```

---

## Task 1: Repo scaffold + toolchain

**Files:**
- Create: `.nvmrc`, `.gitignore`, `package.json` (root)
- Create: `packages/schema/package.json`, `packages/validate/package.json`, `packages/render/package.json`
- Create: `packages/schema/index.js` (stub), `packages/schema/test/smoke.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: a working workspace where `npm test` runs `node --test` across all packages; `@archmap/schema` resolvable from other packages after `npm install`.

- [ ] **Step 1: Write the failing smoke test**

Create `packages/schema/test/smoke.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS } from "../index.js";

test("schema exports KINDS", () => {
  assert.ok(Array.isArray(KINDS));
  assert.ok(KINDS.includes("component"));
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run (load nvm first in every shell): `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test`
Expected: FAIL — `Cannot find module '../index.js'` (or `KINDS` undefined).

- [ ] **Step 3: Create scaffold files**

`.nvmrc`:
```
lts/*
```

`.gitignore`:
```
node_modules/
*.log
archmap.html
```

Root `package.json`:
```json
{
  "name": "archmap",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "node --test",
    "validate": "node packages/validate/validate.mjs",
    "render": "node packages/render/render.mjs"
  }
}
```

`packages/schema/package.json`:
```json
{
  "name": "@archmap/schema",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "engines": { "node": ">=22" }
}
```

`packages/validate/package.json`:
```json
{
  "name": "@archmap/validate",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "bin": { "archmap-validate": "validate.mjs" },
  "engines": { "node": ">=22" },
  "dependencies": { "@archmap/schema": "*" }
}
```

`packages/render/package.json`:
```json
{
  "name": "@archmap/render",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "bin": { "archmap-render": "render.mjs" },
  "engines": { "node": ">=22" },
  "dependencies": { "@archmap/schema": "*", "@archmap/validate": "*" }
}
```

`packages/schema/index.js` (stub — replaced in Task 2):
```js
export const KINDS = ["person", "system", "external", "container", "store", "tenant", "component", "cloud", "network", "infra", "workload"];
```

- [ ] **Step 4: Install workspaces and run the test**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && npm install && node --test`
Expected: `npm install` links the three workspace packages; `node --test` reports the smoke test PASS (1 pass, 0 fail).

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add .nvmrc .gitignore package.json package-lock.json packages/
git commit -m "chore: scaffold archmap workspace (schema/validate/render)"
```

---

## Task 2: schema — constants & helpers

**Files:**
- Modify: `packages/schema/index.js`
- Test: `packages/schema/test/helpers.test.js`

**Interfaces:**
- Produces:
  - `LOGICAL_KINDS, DEPLOY_KINDS, KINDS, AXES, GROUNDABLE_KINDS` (arrays of strings)
  - `kindAxis(kind: string) -> "logical"|"deploy"`
  - `createModel({name, version, snapshot}) -> Model`
  - `loadModel(path: string) -> Model`, `saveModel(path: string, model: Model) -> void`
  - `getNode(model, id) -> Node|null`
  - `childrenOf(model, id) -> Node[]` (direct children only)
  - `isLeaf(model, id) -> boolean` (no children)
  - `ancestorsOf(model, id) -> string[]` (nearest-first; cycle-safe — stops on revisit)

- [ ] **Step 1: Write the failing test**

Create `packages/schema/test/helpers.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KINDS, LOGICAL_KINDS, DEPLOY_KINDS, AXES, GROUNDABLE_KINDS,
  kindAxis, createModel, getNode, childrenOf, isLeaf, ancestorsOf,
} from "../index.js";

test("kind sets & axis mapping", () => {
  assert.deepEqual(DEPLOY_KINDS, ["cloud", "network", "infra", "workload"]);
  assert.ok(KINDS.length === LOGICAL_KINDS.length + DEPLOY_KINDS.length);
  assert.deepEqual(AXES, ["logical", "deploy"]);
  assert.ok(GROUNDABLE_KINDS.includes("container"));
  assert.equal(kindAxis("component"), "logical");
  assert.equal(kindAxis("workload"), "deploy");
});

test("createModel makes an empty model with meta", () => {
  const m = createModel({ name: "x", version: "1", snapshot: "2026-06-23" });
  assert.deepEqual(m, { meta: { name: "x", version: "1", snapshot: "2026-06-23" }, nodes: [], edges: [], mappings: [] });
});

test("getNode / childrenOf / isLeaf / ancestorsOf", () => {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  m.nodes.push(
    { id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" },
    { id: "api", name: "API", kind: "container", parent: "sys", axis: "logical" },
    { id: "h", name: "Handler", kind: "component", parent: "api", axis: "logical" },
  );
  assert.equal(getNode(m, "api").name, "API");
  assert.equal(getNode(m, "nope"), null);
  assert.deepEqual(childrenOf(m, "sys").map((n) => n.id), ["api"]);
  assert.equal(isLeaf(m, "h"), true);
  assert.equal(isLeaf(m, "api"), false);
  assert.deepEqual(ancestorsOf(m, "h"), ["api", "sys"]);
  assert.deepEqual(ancestorsOf(m, "sys"), []);
});

test("ancestorsOf is cycle-safe", () => {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  m.nodes.push(
    { id: "a", name: "A", kind: "container", parent: "b", axis: "logical" },
    { id: "b", name: "B", kind: "container", parent: "a", axis: "logical" },
  );
  // must terminate, not hang
  const anc = ancestorsOf(m, "a");
  assert.ok(anc.length <= 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/schema/test/helpers.test.js`
Expected: FAIL — `LOGICAL_KINDS` / `kindAxis` not exported.

- [ ] **Step 3: Replace `packages/schema/index.js` with constants + helpers**

```js
import { readFileSync, writeFileSync } from "node:fs";

export const LOGICAL_KINDS = ["person", "system", "external", "container", "store", "tenant", "component"];
export const DEPLOY_KINDS = ["cloud", "network", "infra", "workload"];
export const KINDS = [...LOGICAL_KINDS, ...DEPLOY_KINDS];
export const AXES = ["logical", "deploy"];
export const GROUNDABLE_KINDS = ["component", "store", "infra", "workload", "container"];

export function kindAxis(kind) {
  return DEPLOY_KINDS.includes(kind) ? "deploy" : "logical";
}

export function createModel({ name, version, snapshot }) {
  return { meta: { name, version, snapshot }, nodes: [], edges: [], mappings: [] };
}

export function loadModel(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function saveModel(path, model) {
  writeFileSync(path, JSON.stringify(model, null, 2) + "\n");
}

export function getNode(model, id) {
  return model.nodes.find((n) => n.id === id) ?? null;
}

export function childrenOf(model, id) {
  return model.nodes.filter((n) => n.parent === id);
}

export function isLeaf(model, id) {
  return !model.nodes.some((n) => n.parent === id);
}

// nearest-first ancestor ids; cycle-safe (stops if it revisits a node).
export function ancestorsOf(model, id) {
  const out = [];
  const seen = new Set([id]);
  let cur = getNode(model, id);
  while (cur && cur.parent !== null) {
    const p = getNode(model, cur.parent);
    if (!p || seen.has(p.id)) break;
    seen.add(p.id);
    out.push(p.id);
    cur = p;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/schema/test/helpers.test.js`
Expected: PASS (4 tests). Then delete the now-redundant smoke test: `git rm packages/schema/test/smoke.test.js`.

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git rm packages/schema/test/smoke.test.js
git add packages/schema/index.js packages/schema/test/helpers.test.js
git commit -m "feat(schema): constants, kindAxis, model helpers"
```

---

## Task 3: schema — node ops (addNode / moveNode / removeNode)

**Files:**
- Modify: `packages/schema/index.js` (append)
- Test: `packages/schema/test/node-ops.test.js`

**Interfaces:**
- Consumes: `getNode, childrenOf, ancestorsOf, kindAxis, KINDS` from Task 2.
- Produces:
  - `addNode(model, {id, name, kind, parent=null, axis?, tech?, blurb?}) -> Node` — throws on empty/duplicate id, unknown kind, missing parent. Sets `axis = axis ?? kindAxis(kind)`.
  - `moveNode(model, id, newParent) -> Node` — throws if node/newParent missing or move would create a cycle.
  - `removeNode(model, id) -> void` — throws if it has children; cascades removal of edges & mappings touching `id`.

Ops do **minimal structural guards** (existence, uniqueness, cycle, child-on-remove). The full rubric (axis consistency, leaf-only edges, fan-out, anchors) is the validator's job, not the ops'.

- [ ] **Step 1: Write the failing test**

Create `packages/schema/test/node-ops.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createModel, addNode, moveNode, removeNode, getNode } from "../index.js";

function base() {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  addNode(m, { id: "sys", name: "Sys", kind: "system", parent: null });
  return m;
}

test("addNode sets default axis from kind and stores optional fields", () => {
  const m = base();
  const n = addNode(m, { id: "api", name: "API", kind: "container", parent: "sys", tech: "Node", blurb: "the api" });
  assert.equal(n.axis, "logical");
  assert.equal(n.tech, "Node");
  assert.equal(getNode(m, "api").blurb, "the api");
  const w = addNode(m, { id: "pod", name: "Pod", kind: "workload", parent: null });
  assert.equal(w.axis, "deploy");
});

test("addNode guards: dup id, unknown kind, missing parent, empty id", () => {
  const m = base();
  assert.throws(() => addNode(m, { id: "sys", name: "Dup", kind: "system", parent: null }), /duplicate/);
  assert.throws(() => addNode(m, { id: "z", name: "Z", kind: "widget", parent: null }), /unknown kind/);
  assert.throws(() => addNode(m, { id: "z", name: "Z", kind: "container", parent: "ghost" }), /parent/);
  assert.throws(() => addNode(m, { id: "", name: "Z", kind: "system", parent: null }), /id required/);
});

test("moveNode reparents and blocks cycles", () => {
  const m = base();
  addNode(m, { id: "api", name: "API", kind: "container", parent: "sys" });
  addNode(m, { id: "h", name: "H", kind: "component", parent: "api" });
  moveNode(m, "h", "sys");
  assert.equal(getNode(m, "h").parent, "sys");
  assert.throws(() => moveNode(m, "sys", "api"), /cycle/); // sys is ancestor of api
  assert.throws(() => moveNode(m, "api", "api"), /cycle/); // a node cannot be its own parent
  assert.throws(() => moveNode(m, "h", "ghost"), /no such node/);
});

test("removeNode blocks when it has children, else cascades edges/mappings", () => {
  const m = base();
  addNode(m, { id: "api", name: "API", kind: "container", parent: "sys" });
  assert.throws(() => removeNode(m, "sys"), /has children/);
  m.edges.push({ from: "api", to: "api2", label: "x" });
  m.mappings.push({ logical: "api", deploy: "pod", label: "runs on" });
  removeNode(m, "api");
  assert.equal(getNode(m, "api"), null);
  assert.equal(m.edges.length, 0);
  assert.equal(m.mappings.length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/schema/test/node-ops.test.js`
Expected: FAIL — `addNode` not a function.

- [ ] **Step 3: Append node ops to `packages/schema/index.js`**

```js
function requireNode(model, id) {
  const n = getNode(model, id);
  if (!n) throw new Error(`no such node: ${id}`);
  return n;
}

export function addNode(model, { id, name, kind, parent = null, axis, tech, blurb }) {
  if (!id) throw new Error("addNode: id required");
  if (getNode(model, id)) throw new Error(`addNode: duplicate id: ${id}`);
  if (!KINDS.includes(kind)) throw new Error(`addNode: unknown kind: ${kind}`);
  if (parent !== null && !getNode(model, parent)) throw new Error(`addNode: missing parent: ${parent}`);
  const node = { id, name, kind, parent, axis: axis ?? kindAxis(kind) };
  if (tech !== undefined) node.tech = tech;
  if (blurb !== undefined) node.blurb = blurb;
  model.nodes.push(node);
  return node;
}

export function moveNode(model, id, newParent) {
  const node = requireNode(model, id);
  if (newParent !== null) {
    requireNode(model, newParent);
    if (newParent === id || ancestorsOf(model, newParent).includes(id)) {
      throw new Error("moveNode: would create a cycle");
    }
  }
  node.parent = newParent;
  return node;
}

export function removeNode(model, id) {
  requireNode(model, id);
  if (childrenOf(model, id).length > 0) throw new Error(`removeNode: ${id} has children`);
  model.nodes = model.nodes.filter((n) => n.id !== id);
  model.edges = model.edges.filter((e) => e.from !== id && e.to !== id);
  model.mappings = model.mappings.filter((m) => m.logical !== id && m.deploy !== id);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/schema/test/node-ops.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add packages/schema/index.js packages/schema/test/node-ops.test.js
git commit -m "feat(schema): addNode/moveNode/removeNode with structural guards"
```

---

## Task 4: schema — attribute & grounding ops

**Files:**
- Modify: `packages/schema/index.js` (append)
- Test: `packages/schema/test/attr-ops.test.js`

**Interfaces:**
- Consumes: `requireNode` (module-internal from Task 3).
- Produces:
  - `setBlurb(model, id, text) -> void`
  - `setTech(model, id, tech) -> void`
  - `setLinks(model, id, links) -> void` (`links` = `{label, url}[]`)
  - `setGrounding(model, id, {repo?, path, symbol?, region?, iac?, dashboard?}) -> Grounding` — sets `node.grounding = {repo, path, ...}`. `repo` falls back to the node's existing grounding repo if omitted. Never writes `lines`/`resolved`. (`repo` is added to the spec §6 signature because the schema requires it.)

- [ ] **Step 1: Write the failing test**

Create `packages/schema/test/attr-ops.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/schema/test/attr-ops.test.js`
Expected: FAIL — `setBlurb` not a function.

- [ ] **Step 3: Append attribute/grounding ops to `packages/schema/index.js`**

```js
export function setBlurb(model, id, text) { requireNode(model, id).blurb = text; }
export function setTech(model, id, tech) { requireNode(model, id).tech = tech; }
export function setLinks(model, id, links) { requireNode(model, id).links = links; }

export function setGrounding(model, id, { repo, path, symbol, region, iac, dashboard }) {
  const node = requireNode(model, id);
  const g = { repo: repo ?? node.grounding?.repo, path };
  if (symbol !== undefined) g.symbol = symbol;
  if (region !== undefined) g.region = region;
  if (iac !== undefined) g.iac = iac;
  if (dashboard !== undefined) g.dashboard = dashboard;
  node.grounding = g;
  return g;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/schema/test/attr-ops.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add packages/schema/index.js packages/schema/test/attr-ops.test.js
git commit -m "feat(schema): setBlurb/setTech/setLinks/setGrounding"
```

---

## Task 5: schema — edge & mapping ops

**Files:**
- Modify: `packages/schema/index.js` (append)
- Test: `packages/schema/test/edge-ops.test.js`

**Interfaces:**
- Produces:
  - `addEdge(model, from, to, label) -> Edge` — throws on missing endpoint, self-edge, exact duplicate `(from,to)`.
  - `removeEdge(model, from, to) -> void`
  - `setEdgeLabel(model, from, to, label) -> void` — throws if no such edge.
  - `addMapping(model, logical, deploy, label) -> Mapping` — throws on missing endpoint or duplicate `(logical,deploy)`.
  - `removeMapping(model, logical, deploy) -> void`

- [ ] **Step 1: Write the failing test**

Create `packages/schema/test/edge-ops.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createModel, addNode, addEdge, removeEdge, setEdgeLabel, addMapping, removeMapping } from "../index.js";

function base() {
  const m = createModel({ name: "x", version: "1", snapshot: "s" });
  addNode(m, { id: "a", name: "A", kind: "component", parent: null });
  addNode(m, { id: "b", name: "B", kind: "component", parent: null });
  addNode(m, { id: "pod", name: "Pod", kind: "workload", parent: null });
  return m;
}

test("addEdge happy path + guards", () => {
  const m = base();
  const e = addEdge(m, "a", "b", "calls");
  assert.deepEqual(e, { from: "a", to: "b", label: "calls" });
  assert.throws(() => addEdge(m, "a", "a", "loop"), /self-edge/);
  assert.throws(() => addEdge(m, "a", "ghost", "x"), /no such node/);
  assert.throws(() => addEdge(m, "a", "b", "again"), /duplicate/);
});

test("removeEdge + setEdgeLabel", () => {
  const m = base();
  addEdge(m, "a", "b", "calls");
  setEdgeLabel(m, "a", "b", "invokes");
  assert.equal(m.edges[0].label, "invokes");
  assert.throws(() => setEdgeLabel(m, "b", "a", "x"), /no edge/);
  removeEdge(m, "a", "b");
  assert.equal(m.edges.length, 0);
});

test("mappings add/remove + guards", () => {
  const m = base();
  const mp = addMapping(m, "a", "pod", "runs on");
  assert.deepEqual(mp, { logical: "a", deploy: "pod", label: "runs on" });
  assert.throws(() => addMapping(m, "a", "pod", "again"), /duplicate/);
  assert.throws(() => addMapping(m, "a", "ghost", "x"), /no such node/);
  removeMapping(m, "a", "pod");
  assert.equal(m.mappings.length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/schema/test/edge-ops.test.js`
Expected: FAIL — `addEdge` not a function.

- [ ] **Step 3: Append edge/mapping ops to `packages/schema/index.js`**

```js
export function addEdge(model, from, to, label) {
  requireNode(model, from);
  requireNode(model, to);
  if (from === to) throw new Error("addEdge: self-edge");
  if (model.edges.some((e) => e.from === from && e.to === to)) {
    throw new Error(`addEdge: duplicate ${from}->${to}`);
  }
  const edge = { from, to, label };
  model.edges.push(edge);
  return edge;
}

export function removeEdge(model, from, to) {
  model.edges = model.edges.filter((e) => !(e.from === from && e.to === to));
}

export function setEdgeLabel(model, from, to, label) {
  const e = model.edges.find((x) => x.from === from && x.to === to);
  if (!e) throw new Error(`setEdgeLabel: no edge ${from}->${to}`);
  e.label = label;
}

export function addMapping(model, logical, deploy, label) {
  requireNode(model, logical);
  requireNode(model, deploy);
  if (model.mappings.some((m) => m.logical === logical && m.deploy === deploy)) {
    throw new Error(`addMapping: duplicate ${logical}~${deploy}`);
  }
  const mp = { logical, deploy, label };
  model.mappings.push(mp);
  return mp;
}

export function removeMapping(model, logical, deploy) {
  model.mappings = model.mappings.filter((m) => !(m.logical === logical && m.deploy === deploy));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test`
Expected: PASS — all schema tests green. **Use bare `node --test` (it recurses); `node --test <dir>` does NOT discover files on Node 24 — it treats the dir as one file and silently runs nothing.**

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add packages/schema/index.js packages/schema/test/edge-ops.test.js
git commit -m "feat(schema): edge & mapping ops complete the edit API"
```

---

## Task 6: validate — schema & containment rules

**Files:**
- Create: `packages/validate/index.js`
- Test: `packages/validate/test/schema-rules.test.js`

**Interfaces:**
- Consumes: `KINDS, AXES, kindAxis, getNode, ancestorsOf` from `@archmap/schema`.
- Produces: `validate(model) -> { errors: Issue[], warnings: Issue[] }`, where `Issue = { code: string, message: string, where: string }`. This task implements the node/containment subset; Tasks 7–8 append edge, mapping, fan-out, and grounding rules to the **same** `validate` function.

Error codes in this task: `DUP_ID`, `BAD_KIND`, `MISSING_PARENT`, `BAD_AXIS`, `GROUNDING_REPO_PATH`, `CONTAINMENT_CYCLE`, `AXIS_INCONSISTENT`. Warning code: `LINES_AUTHORED`.

> **Precondition (all tasks from here on):** `npm install` (Task 1 Step 4) must have run so the `@archmap/*` workspace symlinks exist under `node_modules/`. If `node_modules/` is missing (fresh checkout / cleaned tree), re-run `npm install` from the repo root before any test command.

- [ ] **Step 1: Write the failing test**

Create `packages/validate/test/schema-rules.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../index.js";

const codes = (issues) => issues.map((i) => i.code).sort();

test("clean minimal model has no errors", () => {
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" }],
    edges: [], mappings: [],
  };
  assert.deepEqual(validate(m).errors, []);
});

test("dup id, bad kind, missing parent, bad axis", () => {
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "a", name: "A", kind: "system", parent: null, axis: "logical" },
      { id: "a", name: "A2", kind: "widget", parent: "ghost", axis: "logical" },
      { id: "b", name: "B", kind: "component", parent: null, axis: "deploy" }, // wrong axis for kind
    ],
    edges: [], mappings: [],
  };
  const c = codes(validate(m).errors);
  assert.ok(c.includes("DUP_ID"));
  assert.ok(c.includes("BAD_KIND"));
  assert.ok(c.includes("MISSING_PARENT"));
  assert.ok(c.includes("BAD_AXIS"));
});

test("grounding missing repo/path is an error; authored lines is a warning", () => {
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "h", name: "H", kind: "component", parent: null, axis: "logical",
      grounding: { path: "", symbol: { fqn: "f", kind: "fn" }, lines: "10-20" } }],
    edges: [], mappings: [],
  };
  const r = validate(m);
  assert.ok(codes(r.errors).includes("GROUNDING_REPO_PATH"));
  assert.ok(codes(r.warnings).includes("LINES_AUTHORED"));
});

test("containment cycle and axis inconsistency", () => {
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "a", name: "A", kind: "container", parent: "b", axis: "logical" },
      { id: "b", name: "B", kind: "container", parent: "a", axis: "logical" },
      { id: "p", name: "P", kind: "system", parent: null, axis: "logical" },
      { id: "w", name: "W", kind: "workload", parent: "p", axis: "deploy" }, // child axis != parent axis
    ],
    edges: [], mappings: [],
  };
  const c = codes(validate(m).errors);
  assert.ok(c.includes("CONTAINMENT_CYCLE"));
  assert.ok(c.includes("AXIS_INCONSISTENT"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/validate/test/schema-rules.test.js`
Expected: FAIL — cannot find `../index.js` / `validate` undefined.

- [ ] **Step 3: Create `packages/validate/index.js`**

```js
import { KINDS, AXES, kindAxis, getNode, ancestorsOf } from "@archmap/schema";

function detectCycle(model, id) {
  const seen = new Set();
  let cur = getNode(model, id);
  while (cur && cur.parent !== null) {
    if (seen.has(cur.id)) return true;
    seen.add(cur.id);
    const p = getNode(model, cur.parent);
    if (p && p.id === id) return true;
    cur = p;
  }
  return false;
}

export function validate(model) {
  const errors = [];
  const warnings = [];
  const err = (code, message, where) => errors.push({ code, message, where });
  const warn = (code, message, where) => warnings.push({ code, message, where });

  const seenIds = new Set();
  for (const n of model.nodes) {
    if (seenIds.has(n.id)) err("DUP_ID", "duplicate node id", n.id);
    else seenIds.add(n.id);

    if (!KINDS.includes(n.kind)) err("BAD_KIND", `unknown kind ${n.kind}`, n.id);

    if (n.parent !== null && !getNode(model, n.parent)) {
      err("MISSING_PARENT", `missing parent ${n.parent}`, n.id);
    }

    const axis = n.axis ?? "logical";
    if (!AXES.includes(axis)) {
      err("BAD_AXIS", `invalid axis ${axis}`, n.id);
    } else if (KINDS.includes(n.kind) && axis !== kindAxis(n.kind)) {
      err("BAD_AXIS", `kind ${n.kind} belongs to axis ${kindAxis(n.kind)}, not ${axis}`, n.id);
    }

    if (n.grounding) {
      if (!n.grounding.repo || !n.grounding.path) {
        err("GROUNDING_REPO_PATH", "grounding requires repo and path", n.id);
      }
      if (n.grounding.lines) {
        warn("LINES_AUTHORED", "lines is derived output, not input", n.id);
      }
    }
  }

  for (const n of model.nodes) {
    if (n.parent === null) continue;
    if (detectCycle(model, n.id)) err("CONTAINMENT_CYCLE", "containment cycle", n.id);
    const p = getNode(model, n.parent);
    if (p) {
      const pAxis = p.axis ?? "logical";
      const nAxis = n.axis ?? "logical";
      if (pAxis !== nAxis) err("AXIS_INCONSISTENT", `child axis ${nAxis} != parent axis ${pAxis}`, n.id);
    }
  }

  return { errors, warnings };
}
```

> Note: `ancestorsOf` is imported now because Tasks 7–8 use it. Keeping the import here avoids a churned import line later.

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/validate/test/schema-rules.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add packages/validate/index.js packages/validate/test/schema-rules.test.js
git commit -m "feat(validate): schema & containment rules"
```

---

## Task 7: validate — edge rules

**Files:**
- Modify: `packages/validate/index.js` (insert edge checks before `return`)
- Test: `packages/validate/test/edge-rules.test.js`

**Interfaces:**
- Consumes: `isLeaf, ancestorsOf, getNode` from `@archmap/schema`.
- Produces (appended to the same `validate`): error codes `EDGE_ENDPOINT_MISSING`, `EDGE_SELF`, `EDGE_CROSS_AXIS`, `EDGE_NOT_LEAF`, `EDGE_SPANS_HIERARCHY`, `EDGE_DUP`, `EDGE_LABEL_BUDGET`.
- Constant: `EDGE_LABEL_MAX_WORDS = 3` (spec §5 rule 4).

- [ ] **Step 1: Write the failing test**

Create `packages/validate/test/edge-rules.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../index.js";

const codes = (issues) => issues.map((i) => i.code);

function model(nodes, edges) {
  return { meta: { name: "x", version: "1", snapshot: "s" }, nodes, edges, mappings: [] };
}

// Anchored so these groundable leaves stay clean once Task 8 adds the
// GROUNDABLE_UNANCHORED rule (the whole validate suite is re-run from Task 8 on).
// Tests below use .includes() so they tolerate extra errors; the "clean" test's
// deepEqual([]) is the one that would break without these anchors.
const leaves = [
  { id: "a", name: "A", kind: "component", parent: null, axis: "logical", grounding: { repo: "r", path: "a", symbol: { fqn: "a", kind: "fn" } } },
  { id: "b", name: "B", kind: "component", parent: null, axis: "logical", grounding: { repo: "r", path: "b", symbol: { fqn: "b", kind: "fn" } } },
  { id: "w", name: "W", kind: "workload", parent: null, axis: "deploy", grounding: { repo: "r", path: "w", iac: "x.y" } },
];

test("clean leaf-to-leaf same-axis edge passes", () => {
  const r = validate(model(leaves, [{ from: "a", to: "b", label: "calls" }]));
  assert.deepEqual(r.errors, []);
});

test("missing endpoint, self edge, cross axis", () => {
  const r = validate(model(leaves, [
    { from: "a", to: "ghost", label: "x" },
    { from: "a", to: "a", label: "loop" },
    { from: "a", to: "w", label: "cross" },
  ]));
  const c = codes(r.errors);
  assert.ok(c.includes("EDGE_ENDPOINT_MISSING"));
  assert.ok(c.includes("EDGE_SELF"));
  assert.ok(c.includes("EDGE_CROSS_AXIS"));
});

test("non-leaf endpoint and spanning hierarchy", () => {
  const nodes = [
    { id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" },
    { id: "api", name: "API", kind: "container", parent: "sys", axis: "logical" },
    { id: "h", name: "H", kind: "component", parent: "api", axis: "logical" },
  ];
  // sys has children (not a leaf); sys->h also spans the hierarchy (ancestor->descendant)
  const r = validate(model(nodes, [{ from: "sys", to: "h", label: "x" }]));
  const c = codes(r.errors);
  assert.ok(c.includes("EDGE_NOT_LEAF"));
  assert.ok(c.includes("EDGE_SPANS_HIERARCHY"));
});

test("duplicate edge and label budget (>3 words)", () => {
  const r = validate(model(leaves, [
    { from: "a", to: "b", label: "calls" },
    { from: "a", to: "b", label: "calls" },
    { from: "b", to: "a", label: "one two three four" },
  ]));
  const c = codes(r.errors);
  assert.ok(c.includes("EDGE_DUP"));
  assert.ok(c.includes("EDGE_LABEL_BUDGET"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/validate/test/edge-rules.test.js`
Expected: FAIL — edge codes not produced.

- [ ] **Step 3: Update `packages/validate/index.js`**

Change the import line to add `isLeaf`:
```js
import { KINDS, AXES, kindAxis, getNode, ancestorsOf, isLeaf } from "@archmap/schema";
```

Add the constant just below the imports:
```js
const EDGE_LABEL_MAX_WORDS = 3;
function wordCount(s) { return String(s ?? "").trim().split(/\s+/).filter(Boolean).length; }
```

Insert this block immediately before `return { errors, warnings };`:
```js
  const edgeKeys = new Set();
  for (const e of model.edges) {
    const f = getNode(model, e.from);
    const t = getNode(model, e.to);
    if (!f || !t) { err("EDGE_ENDPOINT_MISSING", "edge endpoint missing", `${e.from}->${e.to}`); continue; }
    if (e.from === e.to) err("EDGE_SELF", "self edge", e.from);
    const fAxis = f.axis ?? "logical";
    const tAxis = t.axis ?? "logical";
    if (fAxis !== tAxis) err("EDGE_CROSS_AXIS", "edge crosses axes", `${e.from}->${e.to}`);
    if (!isLeaf(model, e.from) || !isLeaf(model, e.to)) {
      err("EDGE_NOT_LEAF", "edges must connect leaves", `${e.from}->${e.to}`);
    }
    if (ancestorsOf(model, e.from).includes(e.to) || ancestorsOf(model, e.to).includes(e.from)) {
      err("EDGE_SPANS_HIERARCHY", "edge spans containment hierarchy", `${e.from}->${e.to}`);
    }
    const key = `${e.from}->${e.to}`;
    if (edgeKeys.has(key)) err("EDGE_DUP", "duplicate edge", key);
    else edgeKeys.add(key);
    if (wordCount(e.label) > EDGE_LABEL_MAX_WORDS) {
      err("EDGE_LABEL_BUDGET", `edge label exceeds ${EDGE_LABEL_MAX_WORDS} words`, key);
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/validate/test/edge-rules.test.js packages/validate/test/schema-rules.test.js`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add packages/validate/index.js packages/validate/test/edge-rules.test.js
git commit -m "feat(validate): edge rules (leaf-only, same-axis, dedup, label budget)"
```

---

## Task 8: validate — mappings, fan-out, grounding anchors + CLI

**Files:**
- Modify: `packages/validate/index.js` (insert checks; add fan-out/grounding loop)
- Create: `packages/validate/validate.mjs` (CLI)
- Test: `packages/validate/test/mapping-fanout-grounding.test.js`, `packages/validate/test/cli.test.js`

**Interfaces:**
- Consumes: `childrenOf, GROUNDABLE_KINDS` from `@archmap/schema`.
- Produces (appended to `validate`): error codes `MAPPING_ENDPOINT_MISSING`, `MAPPING_BAD_LOGICAL`, `MAPPING_BAD_DEPLOY`, `MAPPING_DUP`, `FANOUT_HARD`, `GROUNDABLE_UNANCHORED`; warning code `FANOUT_SOFT`.
- Constants: `FANOUT_SOFT = 7`, `FANOUT_HARD = 14` (spec §5 rule 2).
- CLI `validate.mjs`: `node validate.mjs <model.json>` → prints warnings then errors, prints a summary line, exits `1` if any error, `0` otherwise, `2` on usage error.

- [ ] **Step 1: Write the failing tests**

Create `packages/validate/test/mapping-fanout-grounding.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../index.js";

const codes = (issues) => issues.map((i) => i.code);

test("mapping axis rules + dup + missing", () => {
  const nodes = [
    { id: "a", name: "A", kind: "component", parent: null, axis: "logical" },
    { id: "w", name: "W", kind: "workload", parent: null, axis: "deploy" },
  ];
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" }, nodes, edges: [],
    mappings: [
      { logical: "a", deploy: "w", label: "runs on" },
      { logical: "a", deploy: "w", label: "dup" },
      { logical: "w", deploy: "a", label: "swapped" }, // logical is deploy-kind, deploy is logical-kind
      { logical: "a", deploy: "ghost", label: "x" },
    ],
  };
  const c = codes(validate(m).errors);
  assert.ok(c.includes("MAPPING_DUP"));
  assert.ok(c.includes("MAPPING_BAD_LOGICAL"));
  assert.ok(c.includes("MAPPING_BAD_DEPLOY"));
  assert.ok(c.includes("MAPPING_ENDPOINT_MISSING"));
});

test("fan-out soft warning (>7) and hard error (>14), exact boundaries", () => {
  const mk = (count) => {
    const nodes = [{ id: "p", name: "P", kind: "system", parent: null, axis: "logical" }];
    for (let i = 0; i < count; i++) nodes.push({ id: `c${i}`, name: `C${i}`, kind: "container", parent: "p", axis: "logical", grounding: { repo: "r", path: "p", symbol: { fqn: `f${i}`, kind: "module" } } });
    return { meta: { name: "x", version: "1", snapshot: "s" }, nodes, edges: [], mappings: [] };
  };
  assert.equal(codes(validate(mk(7)).warnings).includes("FANOUT_SOFT"), false); // 7 within soft limit
  assert.ok(codes(validate(mk(8)).warnings).includes("FANOUT_SOFT"));
  assert.equal(codes(validate(mk(8)).errors).includes("FANOUT_HARD"), false);
  assert.ok(codes(validate(mk(14)).warnings).includes("FANOUT_SOFT"));        // 14 still only soft
  assert.equal(codes(validate(mk(14)).errors).includes("FANOUT_HARD"), false); // 14 == cap, not over
  assert.ok(codes(validate(mk(15)).errors).includes("FANOUT_HARD"));           // 15 exceeds cap
});

test("fan-out is enforced at the synthetic axis-root level too", () => {
  const nodes = [];
  for (let i = 0; i < 15; i++) nodes.push({ id: `r${i}`, name: `R${i}`, kind: "system", parent: null, axis: "logical" });
  const m = { meta: { name: "x", version: "1", snapshot: "s" }, nodes, edges: [], mappings: [] };
  const hard = validate(m).errors.filter((x) => x.code === "FANOUT_HARD");
  assert.ok(hard.some((x) => x.where === "__root_logical"));
});

test("groundable leaf without anchor errors; with anchor passes", () => {
  const unanchored = { meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "h", name: "H", kind: "component", parent: null, axis: "logical" }], edges: [], mappings: [] };
  assert.ok(codes(validate(unanchored).errors).includes("GROUNDABLE_UNANCHORED"));

  const anchored = { meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "h", name: "H", kind: "component", parent: null, axis: "logical",
      grounding: { repo: "r", path: "p", iac: "aws_lambda_function.foo" } }], edges: [], mappings: [] };
  assert.ok(codes(validate(anchored).errors).includes("GROUNDABLE_UNANCHORED") === false);
});

test("non-leaf groundable kind does not require an anchor", () => {
  const m = { meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "api", name: "API", kind: "container", parent: null, axis: "logical" }, // has a child -> not a leaf
      { id: "h", name: "H", kind: "component", parent: "api", axis: "logical", grounding: { repo: "r", path: "p", symbol: { fqn: "f", kind: "fn" } } },
    ], edges: [], mappings: [] };
  assert.ok(codes(validate(m).errors).includes("GROUNDABLE_UNANCHORED") === false);
});

test("a complete, realistic model yields zero errors and zero warnings", () => {
  // Proves the validator is actually satisfiable by a model exercising every axis,
  // grounding, an edge, and a mapping together — not just the per-rule fixtures.
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "user", name: "User", kind: "person", parent: null, axis: "logical" },
      { id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" },
      { id: "api", name: "API", kind: "container", parent: "sys", axis: "logical" },
      { id: "h", name: "H", kind: "component", parent: "api", axis: "logical", grounding: { repo: "r", path: "src/h.js", symbol: { fqn: "h", kind: "fn" } } },
      { id: "pod", name: "Pod", kind: "workload", parent: null, axis: "deploy", grounding: { repo: "r", path: "k8s.yaml", iac: "k8s.pod" } },
    ],
    edges: [{ from: "user", to: "h", label: "uses" }],
    mappings: [{ logical: "api", deploy: "pod", label: "runs on" }],
  };
  const r = validate(m);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});
```

Create `packages/validate/test/cli.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../validate.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url)); // resolve @archmap/* from root node_modules

function run(model) {
  const dir = mkdtempSync(join(tmpdir(), "amval-"));
  const file = join(dir, "model.json");
  writeFileSync(file, JSON.stringify(model));
  try {
    const out = execFileSync("node", [cli, file], { encoding: "utf8", cwd: repoRoot });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

test("CLI exits 0 on a clean model", () => {
  const m = { meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" }], edges: [], mappings: [] };
  assert.equal(run(m).code, 0);
});

test("CLI exits 1 and reports the error code on an invalid model", () => {
  const m = { meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "h", name: "H", kind: "component", parent: null, axis: "logical" }], edges: [], mappings: [] };
  const r = run(m);
  assert.equal(r.code, 1);
  assert.match(r.out, /GROUNDABLE_UNANCHORED/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/validate/test/mapping-fanout-grounding.test.js packages/validate/test/cli.test.js`
Expected: FAIL — mapping/fan-out codes absent; `validate.mjs` does not exist.

- [ ] **Step 3a: Update `packages/validate/index.js`**

Extend the import line:
```js
import { KINDS, AXES, kindAxis, getNode, ancestorsOf, isLeaf, childrenOf, GROUNDABLE_KINDS } from "@archmap/schema";
```

Add constants near `EDGE_LABEL_MAX_WORDS`:
```js
const FANOUT_SOFT = 7;
const FANOUT_HARD = 14;
```

Insert this block immediately before `return { errors, warnings };` (after the edge block):
```js
  const mapKeys = new Set();
  for (const mp of model.mappings) {
    const l = getNode(model, mp.logical);
    const d = getNode(model, mp.deploy);
    if (!l || !d) { err("MAPPING_ENDPOINT_MISSING", "mapping endpoint missing", `${mp.logical}~${mp.deploy}`); continue; }
    if ((l.axis ?? "logical") !== "logical") err("MAPPING_BAD_LOGICAL", "mapping.logical must be on the logical axis", mp.logical);
    if ((d.axis ?? "logical") !== "deploy") err("MAPPING_BAD_DEPLOY", "mapping.deploy must be on the deploy axis", mp.deploy);
    const key = `${mp.logical}~${mp.deploy}`;
    if (mapKeys.has(key)) err("MAPPING_DUP", "duplicate mapping", key);
    else mapKeys.add(key);
  }

  for (const n of model.nodes) {
    const kids = childrenOf(model, n.id).length;
    if (kids > FANOUT_HARD) err("FANOUT_HARD", `fan-out ${kids} exceeds hard cap ${FANOUT_HARD}`, n.id);
    else if (kids > FANOUT_SOFT) warn("FANOUT_SOFT", `fan-out ${kids} exceeds soft limit ${FANOUT_SOFT}`, n.id);

    if (GROUNDABLE_KINDS.includes(n.kind) && isLeaf(model, n.id)) {
      const g = n.grounding;
      const anchored = g && (g.symbol || g.region || g.iac);
      if (!anchored) err("GROUNDABLE_UNANCHORED", "groundable leaf needs a symbol, region, or iac anchor", n.id);
    }
  }

  // The axis roots form a rendered level too (the __root_<axis> view), so cap them as well.
  for (const axis of AXES) {
    const roots = model.nodes.filter((n) => n.parent === null && (n.axis ?? "logical") === axis).length;
    if (roots > FANOUT_HARD) err("FANOUT_HARD", `axis ${axis} root level has ${roots} nodes, exceeds hard cap ${FANOUT_HARD}`, `__root_${axis}`);
    else if (roots > FANOUT_SOFT) warn("FANOUT_SOFT", `axis ${axis} root level has ${roots} nodes, exceeds soft limit ${FANOUT_SOFT}`, `__root_${axis}`);
  }
```

> `AXES` is already imported in Task 6's import line, so no import change is needed here.

- [ ] **Step 3b: Create `packages/validate/validate.mjs`**

```js
#!/usr/bin/env node
import { loadModel } from "@archmap/schema";
import { validate } from "./index.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: validate <model.json>");
  process.exit(2);
}

const model = loadModel(path);
const { errors, warnings } = validate(model);

for (const w of warnings) console.log(`warning ${w.code} [${w.where}] ${w.message}`);
for (const e of errors) console.log(`error ${e.code} [${e.where}] ${e.message}`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);

process.exit(errors.length > 0 ? 1 : 0);
```

- [ ] **Step 4: Run to verify everything passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test`
Expected: PASS — all schema + validate tests (schema, edge, mapping/fan-out/grounding, CLI). **Bare `node --test` only; `node --test <dir>` discovers nothing on Node 24.**

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add packages/validate/index.js packages/validate/validate.mjs packages/validate/test/mapping-fanout-grounding.test.js packages/validate/test/cli.test.js
git commit -m "feat(validate): mappings, fan-out, grounding anchors + CLI gate"
```

---

## Task 9: render — edge promotion

**Files:**
- Create: `packages/render/promote.js`
- Test: `packages/render/test/promote.test.js`

**Interfaces:**
- Consumes: `getNode, childrenOf` from `@archmap/schema`.
- Produces:
  - `viewChildren(model, focusId, axis) -> Node[]` — direct children of a view. When `focusId === null`, the view's children are the axis roots (`parent === null && axis matches`); otherwise the direct children of `focusId`.
  - `promoteEdges(model, focusId, axis) -> {from, to, label}[]` — authored leaf edges lifted to the level of the view. Each endpoint is promoted to its ancestor that is a direct child of the view; edges whose endpoints fall outside the view, or that collapse to a single child (internal), are dropped; duplicates are aggregated with labels joined by `", "`.

> **Precondition:** `npm install` must have run (see Task 6 note) so `@archmap/schema` resolves from `packages/render`.

- [ ] **Step 1: Write the failing test**

Create `packages/render/test/promote.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { viewChildren, promoteEdges } from "../promote.js";

// sys > {api > {h1,h2}, db}; w is a deploy root
function model() {
  return {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" },
      { id: "api", name: "API", kind: "container", parent: "sys", axis: "logical" },
      { id: "db", name: "DB", kind: "store", parent: "sys", axis: "logical" },
      { id: "h1", name: "H1", kind: "component", parent: "api", axis: "logical" },
      { id: "h2", name: "H2", kind: "component", parent: "api", axis: "logical" },
      { id: "w", name: "W", kind: "workload", parent: null, axis: "deploy" },
    ],
    edges: [
      { from: "h1", to: "db", label: "reads" },   // promotes to api->db at the sys view
      { from: "h1", to: "h2", label: "calls" },    // internal to api at the sys view (dropped), shown inside api view
      { from: "h2", to: "db", label: "writes" },   // also promotes to api->db at sys view (aggregates)
    ],
    mappings: [],
  };
}

test("viewChildren: roots by axis, then direct children", () => {
  const m = model();
  assert.deepEqual(viewChildren(m, null, "logical").map((n) => n.id), ["sys"]);
  assert.deepEqual(viewChildren(m, null, "deploy").map((n) => n.id), ["w"]);
  assert.deepEqual(viewChildren(m, "sys", "logical").map((n) => n.id), ["api", "db"]);
  assert.deepEqual(viewChildren(m, "api", "logical").map((n) => n.id), ["h1", "h2"]);
});

test("promoteEdges at the sys view aggregates api->db and drops api-internal", () => {
  const e = promoteEdges(model(), "sys", "logical");
  assert.equal(e.length, 1);
  assert.equal(e[0].from, "api");
  assert.equal(e[0].to, "db");
  assert.deepEqual(e[0].label.split(", ").sort(), ["reads", "writes"]);
});

test("promoteEdges inside api shows the internal call", () => {
  const e = promoteEdges(model(), "api", "logical");
  assert.deepEqual(e, [{ from: "h1", to: "h2", label: "calls" }]);
});

test("promoteEdges at the logical root surfaces cross-system edges", () => {
  // Each leaf lifts to its DISTINCT root system, so the edge surfaces at the context view
  // (it is not dropped — dropping only happens when both endpoints lift to the same child).
  const m = {
    meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [
      { id: "s1", name: "S1", kind: "system", parent: null, axis: "logical" },
      { id: "s2", name: "S2", kind: "system", parent: null, axis: "logical" },
      { id: "l1", name: "L1", kind: "component", parent: "s1", axis: "logical" },
      { id: "l2", name: "L2", kind: "component", parent: "s2", axis: "logical" },
    ],
    edges: [{ from: "l1", to: "l2", label: "calls" }],
    mappings: [],
  };
  assert.deepEqual(promoteEdges(m, null, "logical"), [{ from: "s1", to: "s2", label: "calls" }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/render/test/promote.test.js`
Expected: FAIL — cannot find `../promote.js`.

- [ ] **Step 3: Create `packages/render/promote.js`**

```js
import { getNode, childrenOf } from "@archmap/schema";

export function viewChildren(model, focusId, axis) {
  if (focusId === null) {
    return model.nodes.filter((n) => n.parent === null && (n.axis ?? "logical") === axis);
  }
  return childrenOf(model, focusId);
}

// Lift a leaf id up to the ancestor whose parent === focusId (i.e. a direct child of the view).
// Returns null if the leaf is not contained under the view. Cycle-safe: render(model) is
// exported and may be called without the validator gate, so it must not hang on a bad model.
function promoteToView(model, leafId, focusId) {
  const seen = new Set();
  let cur = getNode(model, leafId);
  while (cur && cur.parent !== focusId) {
    if (cur.parent === null || seen.has(cur.id)) return null;
    seen.add(cur.id);
    cur = getNode(model, cur.parent);
  }
  return cur ? cur.id : null;
}

export function promoteEdges(model, focusId, axis) {
  const childIds = new Set(viewChildren(model, focusId, axis).map((n) => n.id));
  const agg = new Map();
  for (const e of model.edges) {
    const f = promoteToView(model, e.from, focusId);
    const t = promoteToView(model, e.to, focusId);
    if (!f || !t || f === t) continue;
    if (!childIds.has(f) || !childIds.has(t)) continue;
    const key = `${f}->${t}`;
    if (!agg.has(key)) agg.set(key, { from: f, to: t, labels: [] });
    if (e.label && !agg.get(key).labels.includes(e.label)) agg.get(key).labels.push(e.label);
  }
  return [...agg.values()].map((x) => ({ from: x.from, to: x.to, label: x.labels.join(", ") }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/render/test/promote.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add packages/render/promote.js packages/render/test/promote.test.js
git commit -m "feat(render): edge promotion lifts leaf edges to each view level"
```

---

## Task 10: render — layering

**Files:**
- Create: `packages/render/layout.js` (layering part)
- Test: `packages/render/test/layout.test.js` (layering tests)

**Interfaces:**
- Produces:
  - `layerize(childIds: string[], edges: {from,to}[]) -> { layers: string[][], layerOf: Map<string,number> }`. Longest-path layering: a node's layer is `1 + max(layer of predecessors)`, 0 if no predecessors. Cycle-safe (bounded relaxation, back-edges simply stop contributing). Within a layer, order is the input order of `childIds` (deterministic, preserves authoring order).

- [ ] **Step 1: Write the failing test**

Create `packages/render/test/layout.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { layerize } from "../layout.js";

test("longest-path layering assigns layers", () => {
  const { layerOf } = layerize(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "c" }]);
  assert.equal(layerOf.get("a"), 0);
  assert.equal(layerOf.get("b"), 1);
  assert.equal(layerOf.get("c"), 2);
});

test("diamond uses the longest path", () => {
  const { layerOf } = layerize(["a", "b", "c", "d"], [
    { from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" },
  ]);
  assert.equal(layerOf.get("d"), 2);
});

test("isolated nodes go to layer 0; within-layer order preserved", () => {
  const { layers } = layerize(["x", "y", "z"], []);
  assert.deepEqual(layers, [["x", "y", "z"]]);
});

test("cycle does not hang and terminates", () => {
  const { layerOf } = layerize(["a", "b"], [{ from: "a", to: "b" }, { from: "b", to: "a" }]);
  assert.ok(Number.isFinite(layerOf.get("a")));
  assert.ok(Number.isFinite(layerOf.get("b")));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/render/test/layout.test.js`
Expected: FAIL — cannot find `../layout.js`.

- [ ] **Step 3: Create `packages/render/layout.js` (layering only for now)**

```js
import { childrenOf } from "@archmap/schema";
import { viewChildren, promoteEdges } from "./promote.js";

export function layerize(childIds, edges) {
  const ids = [...childIds];
  const idx = new Map(ids.map((id, i) => [id, i]));
  const preds = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (idx.has(e.from) && idx.has(e.to)) preds.get(e.to).push(e.from);
  }
  const layer = new Map(ids.map((id) => [id, 0]));
  for (let iter = 0; iter < ids.length; iter++) {
    let changed = false;
    for (const id of ids) {
      for (const p of preds.get(id)) {
        const cand = layer.get(p) + 1;
        if (cand > layer.get(id)) { layer.set(id, cand); changed = true; }
      }
    }
    if (!changed) break;
  }
  const maxLayer = ids.length ? Math.max(...ids.map((id) => layer.get(id))) : 0;
  const layers = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of ids) layers[layer.get(id)].push(id);
  for (const row of layers) row.sort((a, b) => idx.get(a) - idx.get(b));
  return { layers, layerOf: layer };
}
```

> Note: the `childrenOf`, `viewChildren`, `promoteEdges` imports are unused until Task 11; add them now to avoid churning the import line. (If the linter flags unused imports, that is fine — there is no linter in this zero-dep setup.)

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/render/test/layout.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add packages/render/layout.js packages/render/test/layout.test.js
git commit -m "feat(render): longest-path layering (cycle-safe, deterministic)"
```

---

## Task 11: render — view geometry (layoutView)

**Files:**
- Modify: `packages/render/layout.js` (append geometry)
- Test: `packages/render/test/layout.test.js` (append geometry tests)

**Interfaces:**
- Consumes: `viewChildren, promoteEdges` (Task 9), `layerize` (Task 10), `childrenOf` (schema).
- Produces:
  - `boxWidth(node) -> number` — deterministic width from the longer of name vs. `kind · tech`.
  - `layoutView(model, focusId, axis) -> { boxes, edges, width, height, focusId, axis }` where
    - `boxes: { id, x, y, w, h, node, hasChildren }[]`
    - `edges: { from, to, label, points: [number,number][] }[]` (orthogonal 4-point polyline)
    - layers stack top→bottom; each layer is horizontally centered; boxes never overlap.

Geometry constants (module-local): `BOX_H=64, V_GAP=70, H_GAP=40, CHAR_W=8, BOX_PAD=24, BOX_MIN_W=130, MARGIN=40`.

- [ ] **Step 1: Write the failing test (append to `packages/render/test/layout.test.js`)**

```js
import { boxWidth, layoutView } from "../layout.js";

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const m = {
  meta: { name: "x", version: "1", snapshot: "s" },
  nodes: [
    { id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" },
    { id: "api", name: "API", kind: "container", parent: "sys", axis: "logical" },
    { id: "db", name: "DB", kind: "store", parent: "sys", axis: "logical" },
    { id: "h1", name: "H1", kind: "component", parent: "api", axis: "logical" },
  ],
  edges: [{ from: "h1", to: "db", label: "reads" }],
  mappings: [],
};

test("boxWidth grows with the longer label and respects the minimum", () => {
  assert.equal(boxWidth({ name: "x", kind: "component" }), 130);
  assert.ok(boxWidth({ name: "a-very-long-component-name-here", kind: "component", tech: "Rust" }) > 130);
});

test("layoutView produces non-overlapping boxes and routed edges", () => {
  const v = layoutView(m, "sys", "logical");
  assert.deepEqual(v.boxes.map((b) => b.id).sort(), ["api", "db"]);
  assert.equal(v.boxes.find((b) => b.id === "api").hasChildren, true);
  assert.equal(v.boxes.find((b) => b.id === "db").hasChildren, false);
  assert.equal(v.edges.length, 1);
  assert.equal(v.edges[0].points.length, 4);
  for (let i = 0; i < v.boxes.length; i++)
    for (let j = i + 1; j < v.boxes.length; j++)
      assert.equal(rectsOverlap(v.boxes[i], v.boxes[j]), false);
  assert.ok(v.width > 0 && v.height > 0);
});

test("layoutView is deterministic (serialized geometry)", () => {
  const a = layoutView(m, "sys", "logical");
  const b = layoutView(m, "sys", "logical");
  assert.equal(
    JSON.stringify(a.boxes.map((x) => [x.id, x.x, x.y, x.w, x.h])),
    JSON.stringify(b.boxes.map((x) => [x.id, x.x, x.y, x.w, x.h])),
  );
  assert.equal(JSON.stringify(a.edges), JSON.stringify(b.edges));
});

test("layoutView of a childless focus is empty but well-formed", () => {
  const v = layoutView(m, "h1", "logical"); // h1 is a leaf in this fixture
  assert.deepEqual(v.boxes, []);
  assert.deepEqual(v.edges, []);
  assert.ok(v.width > 0 && v.height > 0); // no Math.max(...[]) / -Infinity crash
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/render/test/layout.test.js`
Expected: FAIL — `boxWidth` / `layoutView` not exported.

- [ ] **Step 3: Append geometry to `packages/render/layout.js`**

```js
const BOX_H = 64, V_GAP = 70, H_GAP = 40, CHAR_W = 8, BOX_PAD = 24, BOX_MIN_W = 130, MARGIN = 40;

export function boxWidth(node) {
  const sub = (node.kind ?? "") + (node.tech ? " · " + node.tech : "");
  const chars = Math.max(String(node.name ?? "").length, sub.length);
  return Math.max(BOX_MIN_W, chars * CHAR_W + BOX_PAD);
}

export function layoutView(model, focusId, axis) {
  const children = viewChildren(model, focusId, axis);
  const edges = promoteEdges(model, focusId, axis);
  const childIds = children.map((n) => n.id);
  const { layers } = layerize(childIds, edges);
  const nodeById = new Map(children.map((n) => [n.id, n]));

  const rowWidths = layers.map((row) =>
    row.reduce((w, id) => w + boxWidth(nodeById.get(id)), 0) + Math.max(0, row.length - 1) * H_GAP
  );
  const totalW = Math.max(BOX_MIN_W, ...(rowWidths.length ? rowWidths : [0]));

  const boxes = [];
  layers.forEach((row, li) => {
    let x = MARGIN + (totalW - rowWidths[li]) / 2;
    const y = MARGIN + li * (BOX_H + V_GAP);
    for (const id of row) {
      const n = nodeById.get(id);
      const w = boxWidth(n);
      boxes.push({ id, x, y, w, h: BOX_H, node: n, hasChildren: childrenOf(model, id).length > 0 });
      x += w + H_GAP;
    }
  });

  const boxIndex = new Map(boxes.map((b) => [b.id, b]));
  const routed = edges.map((e) => {
    const a = boxIndex.get(e.from);
    const b = boxIndex.get(e.to);
    const x1 = a.x + a.w / 2, y1 = a.y + a.h;
    const x2 = b.x + b.w / 2, y2 = b.y;
    const ymid = (y1 + y2) / 2;
    return { from: e.from, to: e.to, label: e.label, points: [[x1, y1], [x1, ymid], [x2, ymid], [x2, y2]] };
  });

  const width = totalW + MARGIN * 2;
  const height = MARGIN * 2 + layers.length * BOX_H + Math.max(0, layers.length - 1) * V_GAP;
  return { boxes, edges: routed, width, height, focusId, axis };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/render/test/layout.test.js`
Expected: PASS (7 tests in the file).

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add packages/render/layout.js packages/render/test/layout.test.js
git commit -m "feat(render): layoutView geometry — centered layers, no overlap, routed edges"
```

---

## Task 12: render — SVG emission

**Files:**
- Create: `packages/render/svg.js`
- Test: `packages/render/test/svg.test.js`

**Interfaces:**
- Consumes: a `view` object from `layoutView`.
- Produces:
  - `esc(s) -> string` — XML-escape (`& < > "`).
  - `renderViewSvg(view) -> string` — an `<svg>` string: a `<polyline class="amedge">` per edge (under boxes), a `<g class="ambox kind-… (external|drillable|leaf)" data-id>` per box with name + `kind · tech` sub-label, and edge labels on top in a `<g class="amlabel">` with a background rect. Externals get the `external` class. No raw user text is interpolated unescaped.

- [ ] **Step 1: Write the failing test**

Create `packages/render/test/svg.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/render/test/svg.test.js`
Expected: FAIL — cannot find `../svg.js`.

- [ ] **Step 3: Create `packages/render/svg.js`**

```js
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function poly(points) {
  return points.map((p) => `${p[0]},${p[1]}`).join(" ");
}

export function renderViewSvg(view) {
  const out = [];
  out.push(`<svg class="amview" viewBox="0 0 ${view.width} ${view.height}" width="${view.width}" height="${view.height}" xmlns="http://www.w3.org/2000/svg">`);

  for (const e of view.edges) {
    out.push(`<polyline class="amedge" points="${poly(e.points)}" fill="none" />`);
  }

  for (const b of view.boxes) {
    const n = b.node;
    const cls = ["ambox", `kind-${n.kind}`, n.kind === "external" ? "external" : "", b.hasChildren ? "drillable" : "leaf"]
      .filter(Boolean).join(" ");
    const sub = esc(n.kind + (n.tech ? " · " + n.tech : ""));
    out.push(`<g class="${cls}" data-id="${esc(n.id)}" transform="translate(${b.x},${b.y})">`);
    out.push(`<rect width="${b.w}" height="${b.h}" rx="6" />`);
    out.push(`<text class="amname" x="${b.w / 2}" y="27" text-anchor="middle">${esc(n.name)}</text>`);
    out.push(`<text class="amsub" x="${b.w / 2}" y="47" text-anchor="middle">${sub}</text>`);
    out.push(`</g>`);
  }

  for (const e of view.edges) {
    if (!e.label) continue;
    const lx = (e.points[1][0] + e.points[2][0]) / 2;
    const ly = e.points[1][1];
    const halfW = e.label.length * 3.4 + 6;
    out.push(`<g class="amlabel">`);
    out.push(`<rect x="${lx - halfW}" y="${ly - 9}" width="${halfW * 2}" height="18" rx="3" />`);
    out.push(`<text x="${lx}" y="${ly + 3}" text-anchor="middle">${esc(e.label)}</text>`);
    out.push(`</g>`);
  }

  out.push(`</svg>`);
  return out.join("");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/render/test/svg.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add packages/render/svg.js packages/render/test/svg.test.js
git commit -m "feat(render): SVG emission for a view (boxes, edges, labels, escaping)"
```

---

## Task 13: render — self-contained HTML + CLI

**Files:**
- Create: `packages/render/html.js`, `packages/render/index.js`, `packages/render/render.mjs`
- Test: `packages/render/test/render.test.js`

**Interfaces:**
- Consumes: `getNode, childrenOf, ancestorsOf` (schema); `viewChildren` (promote); `layoutView` (layout); `renderViewSvg, esc` (svg); `validate` (`@archmap/validate`, used only by the CLI).
- Produces:
  - `collectViews(model) -> {focusId, axis}[]` — logical root view (always if logical nodes exist), deploy root view (if deploy nodes exist), plus one view per node that has children.
  - `viewId(focusId, axis) -> string` — `"__root_<axis>"` for roots, else the node id.
  - `render(model) -> string` — the full self-contained HTML document (inline CSS + inline SVG views + inline JS for navigation/detail panel/axis toggle). Deterministic.
  - CLI `render.mjs`: `node render.mjs <model.json> [out.html]` — loads, **runs `validate` and refuses to render if there are errors** (exit 1, prints them), else writes HTML (default `archmap.html`), exit 0.

- [ ] **Step 1: Write the failing test**

Create `packages/render/test/render.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test packages/render/test/render.test.js`
Expected: FAIL — cannot find `../index.js`.

- [ ] **Step 3a: Create `packages/render/html.js`**

```js
import { getNode, childrenOf, ancestorsOf } from "@archmap/schema";
import { layoutView } from "./layout.js";
import { renderViewSvg, esc } from "./svg.js";
import { viewChildren } from "./promote.js";

export function viewId(focusId, axis) {
  return focusId === null ? `__root_${axis}` : focusId;
}

export function collectViews(model) {
  const views = [];
  const axes = new Set(model.nodes.map((n) => n.axis ?? "logical"));
  if (axes.has("logical")) views.push({ focusId: null, axis: "logical" });
  if (axes.has("deploy")) views.push({ focusId: null, axis: "deploy" });
  for (const n of model.nodes) {
    if (childrenOf(model, n.id).length > 0) views.push({ focusId: n.id, axis: n.axis ?? "logical" });
  }
  return views;
}

const STYLE = `
:root{--bg:#0f1419;--panel:#171c24;--box:#1f2630;--ink:#e6edf3;--muted:#9aa7b4;--edge:#43505f;--accent:#4493f8;}
*{box-sizing:border-box}
body{margin:0;font:14px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--ink);display:flex;height:100vh}
#main{flex:1;display:flex;flex-direction:column;min-width:0}
header{padding:10px 16px;border-bottom:1px solid #222b36;display:flex;gap:12px;align-items:center}
header h1{font-size:15px;margin:0;font-weight:600}
.snapshot{color:var(--muted);font-size:12px}
.axis-toggle{margin-left:auto;display:flex;gap:6px}
.axis-toggle button,.crumb button{background:var(--box);color:var(--ink);border:1px solid #2a333f;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
.axis-toggle button.active{background:var(--accent);border-color:var(--accent);color:#fff}
#crumbs{padding:8px 16px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;color:var(--muted)}
#canvas{flex:1;overflow:auto;padding:24px}
.view{display:none}
.view.active{display:block}
svg.amview{max-width:100%;height:auto}
.amedge{stroke:var(--edge);stroke-width:1.5}
.ambox rect{fill:var(--box);stroke:#33414f;stroke-width:1.5}
.ambox .amname{fill:var(--ink);font-weight:600}
.ambox .amsub{fill:var(--muted);font-size:11px}
.ambox.drillable{cursor:pointer}.ambox.drillable rect{stroke:var(--accent)}
.ambox.leaf{cursor:pointer}
.ambox.external rect{fill:#20242b;stroke:#3a4350;stroke-dasharray:4 3}
.ambox.external .amname{fill:var(--muted)}
.amlabel rect{fill:#0f1419;opacity:.85}.amlabel text{fill:var(--muted);font-size:11px}
#panel{width:320px;background:var(--panel);border-left:1px solid #222b36;padding:16px;overflow:auto;display:none}
#panel.open{display:block}
#panel h2{font-size:15px;margin:0 0 4px}
#panel .kindline{color:var(--muted);font-size:12px;margin-bottom:10px}
#panel section{margin:12px 0;font-size:13px}
#panel h3{font-size:11px;text-transform:uppercase;color:var(--muted);margin:0 0 4px;letter-spacing:.04em}
#panel code{background:#0f1419;padding:1px 5px;border-radius:4px;font-size:12px}
#panel a{color:var(--accent)}
#panel .close{float:right;cursor:pointer;color:var(--muted);background:none;border:0;font-size:16px}
`;

const SCRIPT = `
const D = window.__ARCHMAP__;
function show(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===id));
  buildCrumbs(id);
}
function rootId(axis){return '__root_'+axis;}
function buildCrumbs(id){
  const c=document.getElementById('crumbs');c.innerHTML='';
  const axis=document.querySelector('.view[data-view="'+id+'"]').dataset.axis;
  const chain=[rootId(axis)];
  if(id!==rootId(axis)){
    const anc=(D.panel[id]&&D.panel[id].breadcrumb)?D.panel[id].breadcrumb.slice():[];
    chain.push(...anc.filter(a=>document.querySelector('.view[data-view="'+a+'"]')));
    chain.push(id);
  }
  chain.forEach((cid,i)=>{
    const b=document.createElement('button');
    b.textContent = cid===rootId(axis) ? (axis==='deploy'?'Deploy':'Context') : (D.panel[cid]?D.panel[cid].name:cid);
    b.onclick=()=>show(cid); c.appendChild(b);
    if(i<chain.length-1){const s=document.createElement('span');s.textContent='›';c.appendChild(s);}
  });
}
function openPanel(id){
  const d=D.panel[id];if(!d)return;
  const p=document.getElementById('panel');p.classList.add('open');
  let h='<button class="close" onclick="document.getElementById(\\'panel\\').classList.remove(\\'open\\')">×</button>';
  h+='<h2>'+esc(d.name)+'</h2><div class="kindline">'+esc(d.kind)+(d.tech?' · '+esc(d.tech):'')+'</div>';
  if(d.blurb)h+='<section>'+esc(d.blurb)+'</section>';
  if(d.grounding){const g=d.grounding;h+='<section><h3>Grounding</h3>';
    h+='<div><code>'+esc(g.repo||'')+'</code></div><div><code>'+esc(g.path||'')+'</code></div>';
    if(g.symbol)h+='<div>symbol: <code>'+esc(g.symbol.fqn)+'</code> ('+esc(g.symbol.kind)+')</div>';
    if(g.iac)h+='<div>iac: <code>'+esc(g.iac)+'</code></div>';
    if(g.region)h+='<div>region: '+g.region.anchors.map(esc).join(', ')+'<br><em>'+esc(g.region.note)+'</em></div>';
    if(g.lines)h+='<div>lines: <code>'+esc(g.lines)+'</code></div>';
    h+='</section>';}
  if(d.mappings&&d.mappings.length){h+='<section><h3>Runs on</h3>';
    d.mappings.forEach(m=>{h+='<div>'+esc(m.label)+' → <a href="#" data-go="'+esc(m.to)+'">'+esc(m.name)+'</a></div>';});h+='</section>';}
  if(d.links&&d.links.length){h+='<section><h3>Links</h3>';
    d.links.forEach(l=>{h+='<div><a href="'+esc(l.url)+'" target="_blank" rel="noopener">'+esc(l.label)+'</a></div>';});h+='</section>';}
  p.innerHTML=h;
  p.querySelectorAll('[data-go]').forEach(a=>a.onclick=(e)=>{e.preventDefault();const t=a.getAttribute('data-go');
    const v=document.querySelector('.view[data-view="'+t+'"]');if(v)show(t);openPanel(t);});
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
document.querySelectorAll('.ambox').forEach(g=>{
  g.addEventListener('click',()=>{const id=g.dataset.id;
    if(g.classList.contains('drillable')&&document.querySelector('.view[data-view="'+id+'"]'))show(id);
    openPanel(id);});
});
document.querySelectorAll('.axis-toggle button').forEach(b=>{
  b.onclick=()=>{document.querySelectorAll('.axis-toggle button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');show(rootId(b.dataset.axis));};
});
show(D.rootDeploy && location.hash==='#deploy' ? D.rootDeploy : D.rootLogical);
`;

export function render(model) {
  const views = collectViews(model);
  const svgs = views.map((v) => {
    const layout = layoutView(model, v.focusId, v.axis);
    return `<div class="view" data-view="${esc(viewId(v.focusId, v.axis))}" data-axis="${v.axis}">${renderViewSvg(layout)}</div>`;
  }).join("\n");

  const panel = {};
  for (const n of model.nodes) {
    panel[n.id] = {
      name: n.name, kind: n.kind, tech: n.tech ?? null, blurb: n.blurb ?? null,
      links: n.links ?? [], grounding: n.grounding ?? null,
      breadcrumb: ancestorsOf(model, n.id).slice().reverse(),
      mappings: model.mappings.filter((m) => m.logical === n.id)
        .map((m) => ({ to: m.deploy, label: m.label, name: getNode(model, m.deploy)?.name ?? m.deploy })),
    };
  }
  const hasDeploy = model.nodes.some((n) => (n.axis ?? "logical") === "deploy");
  const data = { meta: model.meta, panel, rootLogical: "__root_logical", rootDeploy: hasDeploy ? "__root_deploy" : null };
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");

  const axisButtons = `<button class="axis-toggle-logical active" data-axis="logical">Logical</button>` +
    (hasDeploy ? `<button data-axis="deploy">Deploy</button>` : ``);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(model.meta.name)} — archmap</title>
<style>${STYLE}</style></head>
<body>
<div id="main">
<header><h1>${esc(model.meta.name)}</h1><span class="snapshot">v${esc(model.meta.version)} · ${esc(model.meta.snapshot)}</span>
<span class="axis-toggle">${axisButtons}</span></header>
<div id="crumbs"></div>
<div id="canvas">
${svgs}
</div>
</div>
<aside id="panel"></aside>
<script>window.__ARCHMAP__=${dataJson};</script>
<script>${SCRIPT}</script>
</body></html>
`;
}
```

- [ ] **Step 3b: Create `packages/render/index.js`**

```js
export { render, collectViews, viewId } from "./html.js";
```

- [ ] **Step 3c: Create `packages/render/render.mjs`**

```js
#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { loadModel } from "@archmap/schema";
import { validate } from "@archmap/validate";
import { render } from "./index.js";

const path = process.argv[2];
const out = process.argv[3] ?? "archmap.html";
if (!path) {
  console.error("usage: render <model.json> [out.html]");
  process.exit(2);
}

const model = loadModel(path);
const { errors } = validate(model);
if (errors.length > 0) {
  for (const e of errors) console.error(`error ${e.code} [${e.where}] ${e.message}`);
  console.error(`refusing to render: ${errors.length} validation error(s)`);
  process.exit(1);
}

writeFileSync(out, render(model));
console.log(`wrote ${out}`);
```

- [ ] **Step 4: Run to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test`
Expected: PASS — promote, layout, svg, render tests all green (plus schema + validate). **Bare `node --test` only; `node --test <dir>` discovers nothing on Node 24.**

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add packages/render/html.js packages/render/index.js packages/render/render.mjs packages/render/test/render.test.js
git commit -m "feat(render): self-contained HTML (nav, detail panel, axis toggle) + CLI"
```

---

## Task 14: dogfood model.json + end-to-end + CI + README

**Files:**
- Create: `model.json` (archmap's own architecture)
- Create: `.github/workflows/validate.yml`
- Create: `README.md`
- Test: `packages/render/test/render.test.js` already covers rendering; this task adds an end-to-end check via the CLIs.

**Interfaces:**
- Consumes: the whole stack via the two CLIs.
- Produces: a committed `model.json` that validates clean and renders; a CI workflow that runs tests + validate on every PR.

- [ ] **Step 1: Author `model.json` (archmap modeling itself)**

Build it with the edit ops (write a throwaway script under the scratchpad, run it, inspect output), OR hand-write the JSON below. It must validate with **zero errors**. Hand-written version:

```json
{
  "meta": { "name": "archmap", "version": "0.1.0", "snapshot": "2026-06-23" },
  "nodes": [
    { "id": "agent", "name": "Authoring Agent", "kind": "person", "parent": null, "axis": "logical", "blurb": "Edits model.json through the edit-op API." },
    { "id": "viewer", "name": "Engineer", "kind": "person", "parent": null, "axis": "logical", "blurb": "Reads the rendered map." },
    { "id": "archmap", "name": "archmap", "kind": "system", "parent": null, "axis": "logical", "blurb": "Agent-authored, grounded architecture map." },
    { "id": "schema", "name": "schema", "kind": "container", "parent": "archmap", "axis": "logical", "tech": "Node/ESM", "blurb": "Model shape and the edit-operation API." },
    { "id": "validate", "name": "validate", "kind": "container", "parent": "archmap", "axis": "logical", "tech": "Node/ESM", "blurb": "The gate: errors block render." },
    { "id": "render", "name": "render", "kind": "container", "parent": "archmap", "axis": "logical", "tech": "Node/ESM", "blurb": "Pure model.json to self-contained HTML." },
    { "id": "schema-ops", "name": "edit ops", "kind": "component", "parent": "schema", "axis": "logical", "blurb": "addNode, addEdge, setGrounding, …",
      "grounding": { "repo": "archmap", "path": "packages/schema/index.js", "symbol": { "fqn": "addNode", "kind": "fn" } } },
    { "id": "validate-core", "name": "validate()", "kind": "component", "parent": "validate", "axis": "logical", "blurb": "Runs all rules, returns errors and warnings.",
      "grounding": { "repo": "archmap", "path": "packages/validate/index.js", "symbol": { "fqn": "validate", "kind": "fn" } } },
    { "id": "render-core", "name": "render()", "kind": "component", "parent": "render", "axis": "logical", "blurb": "Builds views and emits HTML.",
      "grounding": { "repo": "archmap", "path": "packages/render/html.js", "symbol": { "fqn": "render", "kind": "fn" } } },
    { "id": "layout", "name": "layout", "kind": "component", "parent": "render", "axis": "logical", "blurb": "Layering and geometry.",
      "grounding": { "repo": "archmap", "path": "packages/render/layout.js", "symbol": { "fqn": "layoutView", "kind": "fn" } } },
    { "id": "ci", "name": "CI Runner", "kind": "infra", "parent": null, "axis": "deploy", "blurb": "Runs tests + validate on PRs.",
      "grounding": { "repo": "archmap", "path": ".github/workflows/validate.yml", "iac": "github_actions.validate" } }
  ],
  "edges": [
    { "from": "agent", "to": "schema-ops", "label": "edits model" },
    { "from": "schema-ops", "to": "validate-core", "label": "gated by" },
    { "from": "validate-core", "to": "render-core", "label": "unblocks" },
    { "from": "render-core", "to": "layout", "label": "calls" },
    { "from": "viewer", "to": "render-core", "label": "reads output" }
  ],
  "mappings": [
    { "logical": "validate", "deploy": "ci", "label": "runs in" }
  ]
}
```

- [ ] **Step 2: Validate it (must be clean)**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node packages/validate/validate.mjs model.json`
Expected: `0 error(s), N warning(s)` and exit 0. If any error prints, fix `model.json` until clean. (Warnings are acceptable.)

- [ ] **Step 3: Render it end-to-end**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node packages/render/render.mjs model.json archmap.html && node -e "const h=require('node:fs').readFileSync('archmap.html','utf8');if(/<script\\s+src=|src=[\"']https?:/i.test(h)){console.error('NOT self-contained');process.exit(1)}console.log('self-contained OK, '+h.length+' bytes')"`
Expected: `wrote archmap.html` then `self-contained OK, …`. (`archmap.html` is git-ignored — it is a build artifact.)

- [ ] **Step 4: Add CI workflow + README, run the full suite**

Create `.github/workflows/validate.yml`:
```yaml
name: validate
on:
  pull_request:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "lts/*" }
      - run: npm install
      - run: npm test
      - run: node packages/validate/validate.mjs model.json
```

Create `README.md`:
````markdown
# archmap

A self-contained, navigable architecture map an agent authors and maintains.
The source of truth is `model.json`; the rendered HTML is a pure function of it.

## Layout
- `packages/schema` — model shape + the edit-operation API (the agent's only surface)
- `packages/validate` — the gate; errors block render, warnings are reviewed
- `packages/render` — pure `model.json` → self-contained `archmap.html`

## Install (Node >= 22)

This repo has **zero runtime dependencies** — the only thing to install is a Node
toolchain and the workspace symlinks. If Node is already present, just run
`npm install`. Otherwise install Node first, via nvm (no sudo, user-scoped):

```bash
# 1. install nvm + Node LTS (skip if `node --version` already prints >= 22)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
nvm install --lts && nvm alias default 'lts/*'

# 2. link the workspace packages (creates ./node_modules with symlinks only)
npm install
```

## Use
```bash
npm test                                              # full test suite
node packages/validate/validate.mjs model.json        # the gate
node packages/render/render.mjs model.json archmap.html
```

## Uninstall

There are no global packages to remove — everything is local. To reclaim space or
hand the machine back:

```bash
# remove this repo's local install + build artifact (keeps source + model.json)
rm -rf node_modules archmap.html

# remove the Node toolchain entirely (only if nothing else on the box needs it)
rm -rf "$HOME/.nvm"
# then delete the nvm lines nvm appended to ~/.bashrc / ~/.zshrc (search for NVM_DIR)
```

Because there are no third-party runtime deps, `node_modules` holds only workspace
symlinks — deleting it is safe and instantly reversible with `npm install`.

See `spec.md` for the full design. Phase 1 = schema + validate + render.
Grounding resolver (`packages/resolve`) is Phase 2.
````

Run the full suite: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/chris/archmap && node --test`
Expected: ALL tests pass across schema, validate, render.

- [ ] **Step 5: Commit**

```bash
cd /home/chris/archmap
git add model.json .github/workflows/validate.yml README.md
git commit -m "feat: dogfood model.json, CI gate, README — Phase 1 complete"
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Covered by |
|---|---|
| §1 repo layout (schema/validate/render, .github/workflows) | Task 1, 14 (resolve/ deferred to Phase 2 by decision) |
| §2 semantics/geometry split | Tasks 9–13 (render owns geometry; agent edits model only) |
| §3 model schema (Node/Edge/Mapping/Grounding/anchors) | Tasks 2–5 (shapes), enforced in 6–8; Grounding types referenced in 4 |
| §4 levels / what each shows | Render views (Task 13): context root, drill-down, deploy axis, detail panel |
| §5 authoring rules 1–8 | Validator rules: two axes (6), fan-out (8), leaf-to-leaf once (7), label budget (7), externals greyed (12 svg), anchored leaves (8), names — author-side |
| §6 edit operations | Tasks 3–5 (all ops; model threaded as first arg, repo added to setGrounding) |
| §7 validator gate (every bullet) | Tasks 6–8; `lines` warning in 6 |
| §8 render contract (pure, geometry, labels on top, externals greyed, swappable layout) | Tasks 10–13 |
| §9–11 resolver / edge-truth | **Out of scope** (Phase 2/3 per the user's decision); README notes it |
| §12 build order step 1 | This entire plan |

No Phase-1 spec requirement is left without a task.

**2. Placeholder scan:** No `TODO`/`TBD`/"add error handling"/"similar to Task N" remain. Every code step contains complete code; every test step contains complete test code.

**3. Type consistency:** `validate()` returns `{errors, warnings}` of `{code, message, where}` consistently across Tasks 6–8 and the CLI. `Issue.where` is always a string. Render: `layoutView` returns `{boxes, edges, width, height, focusId, axis}` — consumed by `renderViewSvg` (Task 12) and `html.js` (Task 13) with matching field names (`points`, `node`, `hasChildren`). `viewId`/`collectViews` exported from `html.js`, re-exported by `index.js`, imported by tests — names match. Edit-op names (`addNode`, `moveNode`, `removeNode`, `setBlurb`, `setTech`, `setLinks`, `setGrounding`, `addEdge`, `removeEdge`, `setEdgeLabel`, `addMapping`, `removeMapping`) are identical across schema definition (Tasks 3–5) and the spec §6. `kindAxis`, `GROUNDABLE_KINDS`, `isLeaf`, `childrenOf`, `ancestorsOf` used by validate/render match their schema definitions (Task 2).

One known cosmetic limitation (acceptable for Phase 1, noted so it is not mistaken for a bug): promoted edges between two boxes in the **same** layer route with a small down-then-up jog rather than a clean sibling connector. The render contract is unchanged, so swapping in elkjs later fixes routing without touching the model.
