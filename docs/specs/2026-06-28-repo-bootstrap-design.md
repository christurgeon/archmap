# archmap repo-bootstrap — design

- **Status:** approved design, hardened by staff review (2026-06-28), pre-implementation
- **Scope:** a new `packages/bootstrap` that turns a target source repo into a conservative,
  valid, gate-passing draft `model.json`.

> This revision integrates three independent staff-level reviews (correctness, minimalism,
> interface/testing). Their findings are folded inline; §16 records what changed and why.

---

## 1. Problem

archmap's pitch is "an agent authors *and maintains* a grounded architecture map." The
maintain/detect half exists (schema ops, validator, renderer, resolver). The **author half
has no on-ramp**: nothing turns a repo into a first model. Today every node is hand-authored,
and the only `model.json` in existence is archmap modeling itself. Cold-start is the single
biggest adoption barrier.

Bootstrap closes that gap: point it at a repo, get a conservative draft the agent refines
through the existing edit-ops. It does not try to be smart; it tries to be *honest* and
*valid*, producing a starting point that already passes the gate.

## 2. Goals / non-goals

**Goals**
- Deterministically emit a draft `model.json` that passes **both** CI gates (`validate` with
  zero errors; `resolve` without crashing or blocking) — *valid by construction*.
- Determinism: the same repo at the same commit + the same `--snapshot` input → byte-identical
  output.
- Ground what can be grounded *exactly* (real exported symbols), flag what can't *honestly*
  (visible undrilled markers), never silently omit and never fake a green check.
- Reuse `packages/resolve` where it genuinely helps; be honest where it doesn't (~20–25%).

**Non-goals (v1)** — all are additive fast-follows; none require reworking the v1 spine:
- The **deploy axis** (CI/IaC → deploy nodes). v1 emits the **logical axis only**.
- Edge / import-graph inference (deferred per spec §12).
- Real grounding for **non-JS/TS** code (the resolver is JS/TS-only → undrilled placeholders).
- Inferring `person` / `external` / the full Context layer (emit a `system` stub only).
- A `UNDRILLED_CONTAINER` validator warning + render badge (lands with the render-trust feature).
- Grouping-node synthesis, incremental re-scan / model merge.

## 3. Locked decisions

1. **Scanner drafts → agent refines.** Deterministic layer emits honest *candidate material*;
   the agent emits *semantics* by refining through `@archmap/schema` ops; the validator gates.
2. **Deployable-scoped containers — not directory-per-box.** A node becomes a **container**
   only on a *deployability signal* (§6). Libraries are excluded (a C4 container is a
   deployable/runnable unit). JS/TS containers with ≤7 **exported** top-level symbols get
   real, symbol-grounded **components**; others stay **undrilled**.
3. **Ungroundable deployables → honest in-model placeholders** — container leaves anchored with
   an empty `region:{ anchors:[], note }`. Never omitted (silent incompleteness), never a
   side-car (breaks single-source-of-truth).
4. **Cap, don't synthesize.** When a level exceeds 7 deployables, emit the top-7 (stable sort)
   and **log the deferred tail** — never invent grouping nodes (that would be the deterministic
   layer authoring semantics, which archmap's one rule forbids).

## 4. The validator constraints that shape the design (load-bearing, verified)

Confirmed by reading `packages/validate/index.js` + `packages/schema/index.js` and **proven at
runtime** with four probe drafts (all four re-verified against source in review):

| Probe | Draft | `validate` | `resolve` |
|---|---|---|---|
| A | container leaf, **path-only** grounding | ❌ `GROUNDABLE_UNANCHORED` | — |
| B | 15 containers under one system | ❌ `FANOUT_HARD` (`validate:103`) | — |
| C | container leaf w/ `region:{anchors:[],note}` | ✅ 0/0 | ✅ CLEAN (`resolve.js:42`) |
| D | `region` with **omitted** `anchors` | ✅ 0/0 | 💥 crash `resolve.js:38` (`.map` of undefined) |

Rules the assembler must honor (each maps to a §7/§8 requirement):
- `container` ∈ `GROUNDABLE_KINDS`; a childless container is a **leaf** and must carry a
  `symbol`/`region`/`iac` anchor — **path-only is rejected** (probe A). Components make it a
  non-leaf and exempt (`mapping-fanout-grounding.test.js:61`); an empty `region` is the
  leaf-legal fallback (probe C).
- Empty `region` **must** be `anchors:[]` — omitting it passes `validate` but **crashes
  `resolve`** (probe D). Never put fake fqns in `anchors` (→ `MISSING` → blocks CI).
- Fan-out: `>7` warns, `>14` errors, per parent and per axis-root (probe B).
- `setGrounding` **does** persist `repo` (`schema:94` — `repo: repo ?? node.grounding?.repo`);
  the assembler must pass `repo` on every grounding. (spec.md §6's documented signature is
  stale — it omits `repo`; trust the code.)
- Never set `axis` manually (let `addNode` derive it), never emit `lines`, keep ids unique,
  emit parents before children (`addNode` throws on a missing parent at call time, `schema:62`).

## 5. Architecture — pipeline & modules

New workspace package `packages/bootstrap`. **All filesystem IO is confined to `walk.js`; every
other module is a pure function of in-memory inputs** (matches the house style, where only
resolve's `repo-files` test touches a tmpdir). The symbol index is built **once** in the CLI
and passed down — never rebuilt per container.

```
bootstrap.mjs (CLI / only side effects)
  files   = walkRepo(targetRoot)                       // walk.js  — the only disk reader
  index   = buildIndex(files.filter(f => f.kind==="source"))   // resolve, built ONCE
  conts   = detectDeployables(files)                   // detect.js — pure
  rconts  = conts.map(c => groundContainer(c, index))  // ground.js — pure
  model   = assemble({ meta, system, containers: rconts })     // assemble.js — pure, via ops
  selfCheck(model, targetRoot)                         // subprocess validate + resolve
```

**Module interfaces & data contracts** (types written out; `assemble` is a pure fn of fully
resolved material, so it needs no disk access):

```js
// walk.js — the ONLY module that reads disk
FileEntry = {
  path,                 // posix, repo-relative
  name,
  kind: "source" | "manifest" | "other",
  lang?,                // set for source (via resolve's langForPath)
  content?: string,     // present for source|manifest (the kinds we parse); omitted otherwise
}
walkRepo(root) -> FileEntry[]            // deterministic (sorted, same skip-list as resolve)

// detect.js — pure
Container = { id, name, path, lang | null, signals: string[] }   // path = package dir, repo-relative
detectDeployables(files) -> Container[]   // applies §6 heuristic, excludes libs, stable order

// ground.js — pure; uses the prebuilt index, never re-walks
Component        = { id, name, path, symbol: { fqn, kind, bodyHash, sigHash } }  // path = the symbol's FILE
ResolvedContainer = Container & { components: Component[], undrilled: boolean, reason?: string }
groundContainer(container, index) -> ResolvedContainer

// assemble.js — pure; builds through @archmap/schema ops
assemble({ meta, system, containers }) -> model
//   meta:       { name, version, snapshot }   // from CLI (§8 determinism)
//   system:     { id, name }
//   containers: ResolvedContainer[]
```

**Modules (4 libs + 1 CLI):** `walk.js`, `detect.js`, `ground.js`, `assemble.js`,
`bootstrap.mjs`. `ground.js` is kept separate from `detect.js` because, after the correctness
fixes (export filter, file-path id-namespacing, dedupe, exact-path grounding, cap), it carries
the package's riskiest logic and deserves isolated tests — it is no longer trivial glue.

**Reuse inventory (~20–25%, concentrated in `ground.js`):** reuses resolve's `langForPath`
(`grammar.js`), `extractSymbols` (`extract.js`), `buildIndex` (`symbol-index.js`). Hashes are
read **off the extractor's records** (`s.bodyHash`/`s.sigHash`) — **never** by calling
`hash.js` directly (it takes an AST node bootstrap no longer holds; calling it on a record
hashes `""` → a constant). `walk.js` is a *generalized* sibling of resolve's source-only walker
(which drops the manifests bootstrap needs), not a reuse.

## 6. Boundary heuristic — what becomes a container (3 signals for v1)

Detect **deployability**, not directories. A candidate package/dir becomes a container on any:
- **`package.json` with a `bin` field** (a CLI is a runnable unit — catches archmap's own three
  CLI packages, which the dogfood test depends on);
- a **`Dockerfile` / `Containerfile`** at its root;
- residence under an **`apps/*` or `services/*`** workspace convention.

These three carry the monorepo, single-app, microservices, and CLI-repo archetypes. Other
signals (`start`/`serve` scripts, compose/k8s/serverless/Procfile) are a **v1.1 expansion** as
the heuristic earns trust. **Libraries** (a workspace package with none of the above) are
**omitted** from L2 — the agent promotes one to a box later if it earns one. Workspace
membership comes from root `package.json` `workspaces` / `pnpm-workspace.yaml` / lerna·nx·turbo
config; absent those, fall back to top-level directory grouping.

If detected deployables exceed 7, emit the **top-7 by stable sort** and **log the deferred
tail** explicitly (§3.4) — never silently truncate, never synthesize grouping nodes.

## 7. Grounding strategy — components vs undrilled

For a JS/TS container, take its files' symbols from the prebuilt index, then:
1. **Filter to exported, top-level declarations.** `extract.js` returns *all* top-level
   decls and does not flag exports, so v1 adds a small **`exported: boolean`** field to
   `extractSymbols`' records (set true when the decl is unwrapped from an `export_statement`).
   `ground.js` keeps only `exported === true` **and** fqn without a `.` (i.e. exclude flattened
   `Class.method` records — a class is one component; its methods are not separate components
   in v1).
2. **≤7 kept symbols (and ≥1):** emit each as a `component`, grounded to its **exact file
   path** (`grounding = { repo, path: <symbol file>, symbol: { fqn, kind, bodyHash, sigHash } }`).
   The exact path matters: it makes resolve's path-filtered lookup return 1
   (`resolve.js:8-9`), avoiding the repo-wide `AMBIGUOUS` block. The container becomes a
   **non-leaf** → no anchor of its own.
3. **0 exported, >7, or non-JS/TS:** **undrilled** — container leaf anchored
   `region:{ anchors:[], note: "<reason>; agent to refine into components" }`.

**Id scheme (collision-safe).** Component ids are namespaced by **file-path slug + fqn slug**
(`<container-id>--<file-slug>--<fqn-slug>`), not by container alone — two files in one container
exporting the same name would otherwise collide into a `DUP_ID` throw. Residual collisions
(same file, same slug) are **deduped with a logged skip**, never an uncaught throw.

## 8. Assembly & gate-safety

`assemble` builds the model **through `@archmap/schema` ops** — buying id-uniqueness, kind
validity, parent-existence, and cycle checks at authoring time (all `assert.throws`-testable).
Ops do **not** guarantee fan-out or anchor-completeness (those live in `validate`), so the
assembler owns:
- **Emission order:** system → containers → components (parents before children, `schema:62`).
- **The empty-region invariant:** every undrilled leaf gets `region:{ anchors:[], note }` with
  `anchors` an **array, never omitted** (probe D). This is the single most important assembler
  invariant and gets a model-level test (§13).
- **Cap at 7** deployables (stable sort, log the tail). No grouping nodes.
- **`repo` on every grounding** (§4).
- **Deterministic `meta`:** `version` from the target root `package.json` (`"0.0.0"` if absent);
  `snapshot` from `--snapshot <YYYY-MM-DD>`, defaulting to the target repo's **git HEAD commit
  date** (deterministic per commit). `meta.snapshot` is the one explicit non-content input;
  everything else is a pure function of repo contents. Never use wall-clock `new Date()`.

## 9. CLI & self-check (resolves the blocker)

`node packages/bootstrap/bootstrap.mjs <target-repo> [out] [--snapshot D] [--force]`.

- **Default `out` = `<targetRoot>/model.json`.** Writing the draft *into the target root* makes
  resolve's hard-wired root (`repoRoot = dirname(modelPath)`, `resolve.mjs:15`) **correct by
  construction** — the original design's cwd-relative output would have indexed the wrong tree
  and spuriously failed for every external target.
- **Self-check sequence:** write the draft to a **temp file inside `<targetRoot>`** →
  run `validate.mjs <temp>` and `resolve.mjs <temp>` **as subprocesses** (capture exit codes;
  resolve calls `process.exit`, so it must not be imported) → on both passing, atomically rename
  the temp into the final `out`; on any failure, print the failing output, **delete the temp,
  exit 1** (never leave a broken `model.json`).
- Refuse to overwrite an existing `out` without `--force`.

This makes "valid by construction" enforceable for real targets, not just the dogfood.

## 10. `@archmap/resolve` changes (small, required)

- **Public surface.** `@archmap/resolve` currently has no `exports` map and `resolve.js`
  re-exports nothing, so bootstrap would deep-import private internals. Add an `exports` map
  exposing `./extract`, `./symbol-index`, `./grammar` (the modules bootstrap consumes), and
  declare `@archmap/resolve` in `packages/bootstrap/package.json` dependencies (this also pulls
  the tree-sitter WASM deps).
- **`exported` flag.** Add `exported: boolean` to `extractSymbols`' records (§7.1). Additive and
  harmless to resolve's existing index use (lookups are by fqn/hash).

## 11. Output contract (illustrative — bootstrapping archmap itself, post-export-filter)

```jsonc
{
  "meta": { "name": "archmap", "version": "0.1.0", "snapshot": "<git HEAD date>" },
  "nodes": [
    { "id": "archmap", "name": "archmap", "kind": "system", "parent": null },

    // packages/schema: no bin/Dockerfile, not under apps|services -> a library, NOT a
    // container. Omitted; the agent promotes it later if it deserves a box.

    // validate exposes a CLI (package.json "bin") -> container. After the export filter,
    // its only EXPORTED top-level symbol is `validate` (wordCount/detectCycle are private
    // helpers, correctly excluded) -> 1 grounded component -> container is a non-leaf.
    { "id": "pkg-validate", "name": "validate", "kind": "container", "parent": "archmap" },
    { "id": "pkg-validate--index--validate", "name": "validate", "kind": "component", "parent": "pkg-validate",
      "grounding": { "repo": "archmap", "path": "packages/validate/index.js",
        "symbol": { "fqn": "validate", "kind": "fn", "bodyHash": "…", "sigHash": "…" } } },

    // resolve exposes a CLI -> container; >7 exported symbols -> undrilled placeholder.
    { "id": "pkg-resolve", "name": "resolve", "kind": "container", "parent": "archmap",
      "grounding": { "repo": "archmap", "path": "packages/resolve",
        "region": { "anchors": [], "note": ">7 exports; agent to refine into components" } } }
  ],
  "edges": [],      // none in v1 — edge inference deferred (spec §12)
  "mappings": []    // none in v1 — no deploy axis in v1; agent links axes later
}
```

This draft passes `validate` (**0 errors, 0 warnings** in v1 — the `UNDRILLED_CONTAINER`
warning is deferred) and `resolve` (component CLEAN; undrilled region CLEAN; exit 0).
**Known v1 limitation:** an undrilled empty-`region` resolves CLEAN, so it reads as healthy
until the render badge / `UNDRILLED_CONTAINER` warning ships (out of scope here); the
`region.note` is the v1 honesty signal.

## 12. Error handling

- **Empty / non-repo / no-deployables input:** emit a minimal valid model (system stub only)
  and warn (e.g. "no deployables found — likely a single-package app or a library workspace");
  never crash.
- **Id collisions:** deduped with a logged skip (§7) — never an uncaught `addNode` throw. Wrap
  ops in the assembler so any unexpected throw becomes a clean refuse-with-message, not a stack
  trace.
- **Self-check failure:** refuse to write final `out`, delete the temp, print the failing
  rule/output, exit 1 (§9). A bootstrap bug must never ship an invalid model.
- **Existing `out`:** refuse without `--force`.

## 13. Testing strategy (invariant-first, in-memory)

With IO confined to `walk.js`, `detect`/`ground`/`assemble` are tested on in-memory
`FileEntry[]` / index fixtures — no on-disk repos except the one `walk.js` test (house style).

1. **Highest value — "valid by construction" invariant:** `validate(assemble(fixture)).errors`
   is empty across all fixtures + the dogfood model. This is the central promise; `validate` is
   a cheap pure call, so it guards every future heuristic change.
2. **Empty-region invariant (probe-D guard) at the assembler output:** every undrilled leaf has
   `region.anchors` present and an array; plus an in-memory `resolveRegion`-over-assembled-
   regions check asserting no throw.
3. **`detect.js` — 3 fixtures:** monorepo-with-libs (libs excluded, apps kept), single-package
   (one container), polyglot (non-JS container detected but undrilled). (Monorepo and
   microservices share a code path; framework-app == single-package — add the 4th/5th only when
   a bug demands them.)
4. **`ground.js`:** exact `>7` boundary (N grounded / N+1 undrilled, mirroring
   `mapping-fanout-grounding.test.js:28`); **export filter pinned** (a private helper is
   excluded — locks the §7 behavior); method exclusion; id-collision dedupe is stable and
   logged; grounding path is the symbol's file, not the package dir.
5. **Dogfood (acceptance):** run the CLI on archmap → conservative subset (`system` +
   `validate`/`render`/`resolve` containers, `schema` excluded), `validate` 0 errors, `resolve`
   exit 0 via subprocess. A *subset*, not a byte-match of the hand-authored model.

Match house style: ESM, named exports, `node:test` + `node:assert/strict`, `test/` dir,
`const codes = (issues) => issues.map(i => i.code)` for assertions.

## 14. Out of scope / future (v1.1+)

Deploy axis (`detect` IaC → deploy tree, with the §4 own-axis-tree discipline); the
`UNDRILLED_CONTAINER` validator warning + render "draft" badge (one coherent change in the
render-trust feature); real grounding for non-JS/TS; expanded deployability signals; Context
(`person`/`external`) inference; edge/mapping inference; grouping-node synthesis; incremental
re-scan / model merge.

## 15. Risks

- **Deployability heuristic accuracy.** Misclassifying a lib/deployable produces a box the
  agent fixes — a draft, not a final map. Mitigated by conservative signals + the fixture
  matrix.
- **Undrilled boxes read as healthy in v1** (resolve CLEAN; no badge yet). Accepted and
  documented (§11); closed by the render-trust fast-follow.
- **Library-only / infra-only repos yield thin drafts** (system stub only) — correct by the C4
  definition, with a warning. The `bin` signal mitigates for CLI/tool repos.
- **JS/TS-first.** v1's real grounded value is JS/TS-only (matching the resolver); non-JS/TS is
  honest placeholders. A documented scope boundary, not a hidden gap.

## 16. Hardening from staff review (2026-06-28) — what changed and why

- **BLOCKER fixed:** self-check now writes into the **target root** + runs validate/resolve as
  **subprocesses** (§9). The original cwd-relative output would have indexed the wrong tree and
  failed for every external repo (resolve's root is `dirname(modelPath)`, no override).
- **MAJOR fixed:** **file-path-namespaced component ids + exact-file-path grounding + dedupe**
  (§7) — kills `DUP_ID` throws and resolve `AMBIGUOUS` blocks from bare-local fqns.
- **MAJOR fixed:** **export filter via a new `exported` flag** (§7, §10) — `extract.js` returns
  *all* top-level decls, so "exported symbols" was uncomputable; without this, private helpers
  leak as components. §11 re-baselined accordingly.
- **MINOR fixed:** read `bodyHash`/`sigHash` off extractor records, not `hash.js` (§5);
  deterministic `meta.snapshot` from git HEAD / flag (§8); documented stale `setGrounding`
  signature (§4).
- **Cuts (minimalism):** deploy axis, grouping-node synthesis, the `UNDRILLED_CONTAINER`
  validator change, and 3 deployability signals all deferred to v1.1 (§2, §14). 6 modules → 4+CLI.
- **Interfaces (testing):** `FileEntry.content` + IO confined to `walk.js`; `ResolvedContainer`
  defined; index built once; `@archmap/resolve` given a public `exports` surface (§5, §10);
  invariant-first test plan (§13).
