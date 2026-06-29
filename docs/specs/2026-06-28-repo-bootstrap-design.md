# archmap repo-bootstrap — design

- **Status:** approved design, pre-implementation
- **Date:** 2026-06-28
- **Scope:** a new `packages/bootstrap` that turns a target source repo into a conservative, valid, gate-passing draft `model.json`.

---

## 1. Problem

archmap's pitch is "an agent authors *and maintains* a grounded architecture map." The
maintain/detect half exists (schema ops, validator, renderer, resolver). The **author half
has no on-ramp**: nothing turns a repo into a first model. Today every node is hand-authored,
and the only `model.json` in existence is archmap modeling itself. Cold-start is the single
biggest adoption barrier — "hand-write 200 nodes" is a non-starter.

Bootstrap closes that gap: point it at a repo, get a conservative draft the agent refines
through the existing edit-ops. It does **not** try to be smart; it tries to be *honest* and
*valid*, producing a starting point that already passes the gate.

## 2. Goals / non-goals

**Goals**
- Deterministically emit a draft `model.json` from a repo that passes **both** CI gates
  (`validate` with zero errors, `resolve` without crashing or blocking).
- Ground what can be grounded *exactly* (real symbols), and flag what can't *loudly*
  (visible "undrilled" markers) — never silently omit and never fake a green check.
- Reuse `packages/resolve` where it genuinely helps; be honest where it doesn't.
- Hand the agent a head start, not a finished map.

**Non-goals (v1)**
- Edge / import-graph inference — stays deferred per spec §12 (edge-truth hold).
- Real grounding for non-JS/TS code — the resolver is JS/TS-only; non-JS/TS deployables get
  honest placeholders, not grounding.
- Inferring `person` / `external` / the full Context layer from code — emit a `system` stub
  only; actors are the agent's job.
- Incremental re-scan / merging into an existing model — v1 is blank → draft. Re-running
  produces a fresh draft.

## 3. Locked decisions

1. **Scanner drafts → agent refines.** The deterministic scanner emits honest *candidate
   material*; the agent emits *semantics* by refining through `@archmap/schema` ops; the
   validator gates throughout. This is the only option consistent with archmap's core rule
   (agent owns semantics, deterministic layer owns mechanics, validator between).
2. **Deployable-scoped skeleton — not directory-per-box.** A node becomes a **container**
   only if it shows a *deployability signal* (§6). Libraries are excluded (a C4 container is a
   deployable/runnable unit, not any code grouping). JS/TS deployables with ≤7 exported
   top-level symbols additionally get real, symbol-grounded **components**; everything else
   stays an **undrilled** container.
3. **Ungroundable deployables → honest in-model placeholders.** Deployables the scanner can't
   symbol-ground (non-JS/TS, or JS/TS containers over the export cap) are emitted as container
   leaves anchored with an empty `region: { anchors: [], note }` and flagged undrilled —
   never omitted (would make the map silently incomplete) and never written to a side-car
   (would break single-source-of-truth).

## 4. The validator constraints that shape the design (load-bearing, verified)

The entire design is constrained by what the gate accepts. These were confirmed by reading
`packages/validate/index.js` + `packages/schema/index.js` and **proven at runtime** with four
probe drafts:

| Probe | Draft | `validate` | `resolve` |
|---|---|---|---|
| A | container leaf, **path-only** grounding | ❌ `GROUNDABLE_UNANCHORED` (exit 1) | — |
| B | 15 containers under one system | ❌ `FANOUT_HARD` (exit 1) | — |
| C | container leaf w/ `region:{anchors:[],note}` + isolated `iac` deploy node | ✅ 0/0 | ✅ CLEAN + SKIPPED |
| D | `region` with **omitted** `anchors` | ✅ 0/0 | 💥 **crash** `resolve.js:38` (`.map` of undefined) |

Consequences the assembler **must** honor:
- `container` ∈ `GROUNDABLE_KINDS`. A container with no children is a **leaf**, so it must
  carry a `symbol` / `region` / `iac` anchor. **Path-only grounding is rejected** (probe A).
- The only validator-legal anchors for a package-as-leaf are: real **components** (making it a
  non-leaf, exempt from the rule — confirmed by `validate` test
  `mapping-fanout-grounding.test.js:61`), or an **empty `region`** (probe C).
- Empty `region` **must** be `anchors: []` — omitting the field passes `validate` but
  **crashes `resolve`** (probe D). Never put fake fqns (e.g. package names) in `anchors` —
  they resolve `MISSING`, which blocks CI.
- Fan-out: per-parent and per-axis-root, `>7` warns, `>14` errors (probe B). The assembler
  must group to stay under the hard cap.
- Deploy nodes must form their **own axis tree** (`parent: null` or under deploy nodes only);
  parenting a `deploy` node under the logical `system` is an `AXIS_INCONSISTENT` error.
- Never set `axis` manually (let `addNode` derive it), never emit `lines` (resolver-derived;
  hand-authoring warns), always include both `repo` and `path` (missing either errors), keep
  ids unique (path-namespace them), parents emitted before children.

## 5. Architecture — pipeline & modules

New workspace package `packages/bootstrap`. One responsibility per module; later modules
depend on earlier ones.

```
repo dir
  │
  ▼
walk.js          generalized repo walk → file inventory (source + manifests + IaC)
  │
  ▼
deployables.js   file inventory → candidate containers (deployability heuristic, libs excluded)
  │
  ▼
components.js    per JS/TS deployable → ≤7 grounded components, else mark undrilled  [reuses resolve]
  │
deploy-stub.js   file inventory → deploy-axis tree (iac-anchored, own tree)
  │
  ▼
assemble.js      candidates → model via @archmap/schema ops; fan-out grouping; gate-safe anchoring
  │
  ▼
bootstrap.mjs    CLI: run pipeline, self-check with validate + resolve, emit or refuse
```

**Module interfaces (what each does / how used / what it depends on):**

- **`walk.js`** — `walkRepo(root) → FileEntry[]` where
  `FileEntry = { path, name, kind: "source"|"manifest"|"iac"|"other", lang? }`.
  A *generalized* walk: resolve's `walkSourceFiles` filters to JS/TS source and **drops**
  `package.json` / `Dockerfile` / `*.tf` / `*.yml` — exactly the files bootstrap needs. Same
  skip-list (`node_modules`, `.git`, dotfiles), same deterministic sort. **Net-new.**
- **`deployables.js`** — `detectDeployables(files, root) → Container[]` where
  `Container = { id, name, path, lang, deployable: true, signals: string[] }`. The boundary
  heuristic (§6). Language-agnostic (reads manifests/layout, not symbols). **Net-new.**
- **`components.js`** — `componentsFor(container, root) → { components: Component[], undrilled: bool, reason? }`.
  For a JS/TS container, **reuses** resolve's `langForPath`/`getParser` (`grammar.js`),
  `extractSymbols` (`extract.js`), `buildIndex` (`symbol-index.js`), `bodyHash`/`sigHash`
  (`hash.js`) to list exported top-level symbols. ≤7 → emit components grounded to each symbol
  (`{ fqn, kind, bodyHash, sigHash }`); >7 or non-JS/TS → `undrilled`. **Thin glue over
  resolve.**
- **`deploy-stub.js`** — `detectDeploy(files, root) → DeployNode[]`. Maps `.github/workflows/*`,
  `Dockerfile`, `*.tf`, k8s manifests to `infra`/`workload` leaves with `iac` anchors, grouped
  under non-groundable `cloud`/`network` parents, in their own axis tree. **Net-new** (small;
  a hardcoded stub is acceptable for v1 if real IaC parsing is too much). **Net-new.**
- **`assemble.js`** — `assemble({ system, containers, deploy }) → model`. Builds the model
  **through `@archmap/schema` ops** (so id/kind/parent/cycle checks fire at authoring time),
  enforces the §4 gate-safety checklist, inserts grouping nodes when a level exceeds 7, and
  anchors undrilled containers with `region:{ anchors: [], note }`. **Net-new.**
- **`bootstrap.mjs`** — CLI `node packages/bootstrap/bootstrap.mjs <repo-dir> [out.json]`.
  Runs the pipeline, then runs `validate` and `resolve` against the produced draft as a
  **self-check**; refuses to emit (exit 1) if either fails. Default `out.json` = `model.json`
  in cwd, but never overwrites an existing model without `--force`.

**Reuse inventory (≈20–25% reuse, concentrated in `components.js`):** `grammar.js`,
`extract.js`, `symbol-index.js`, `hash.js` reused as-is. `walk.js` is a *generalized* sibling
of resolve's walker (not reusable as-is — it discards the manifests bootstrap needs).
Everything else is net-new but cheap and language-agnostic.

## 6. Boundary heuristic — what becomes a container

Detect **deployability**, not directories. A candidate becomes a container if it shows any:
- a `Dockerfile` / `Containerfile` at its root;
- a `package.json` with a `bin` field, or a `start` / `serve` script;
- residence under an `apps/*` or `services/*` workspace convention;
- a service manifest (compose service, k8s Deployment/Service, `serverless.yml` function,
  `Procfile` line);
- (deploy axis) a Terraform module / k8s manifest → handled by `deploy-stub.js`, not here.

**Libraries are not containers.** A workspace package with none of the above is omitted from
L2 (it may be surfaced later by the agent if it earns a box). Workspace membership comes from
root `package.json` `workspaces`, `pnpm-workspace.yaml`, or lerna/nx/turbo config; absent
those, fall back to top-level directory grouping.

If detected deployables exceed 7, the assembler groups them (e.g. `apps/` vs `services/`) or
emits the top-N and defers the rest **explicitly** (logged), never by silent truncation.

## 7. Components & grounding strategy

For a JS/TS container, list exported top-level symbols via resolve's extractor. Then:
- **≤7 exports:** emit each as a `component` grounded to its symbol
  (`grounding.symbol = { fqn, kind, bodyHash, sigHash }`, plus `repo` + `path`). The container
  becomes a **non-leaf** → exempt from the anchor rule, and each component is *exactly*
  drift-checkable. This is the real differentiator: mechanically-exact grounding.
- **>7 exports, or non-JS/TS:** do **not** guess which exports matter (no import graph in v1,
  so no honest ranking). Leave the container an **undrilled leaf** anchored with
  `region: { anchors: [], note: "<n> exports / non-JS-TS; agent to refine into components" }`.

Note: `extract.js` captures only top-level `function`/`class`(+methods)/`const`-fn and unwraps
`export`; it does **not** capture TS `interface`/`type`/`enum`. v1 inherits that limit — those
won't appear as components. Acceptable for a draft.

## 8. Validator addition — `UNDRILLED_CONTAINER`

Probe C showed an empty `region` resolves to **CLEAN** — so an undrilled placeholder would
masquerade as a healthy, drift-checked box forever. To keep weak boxes *loud*, add a
non-blocking **warning** in `packages/validate/index.js`: a `container` leaf whose only anchor
is a `region` with an empty `anchors` array emits `UNDRILLED_CONTAINER` ("container is a draft
placeholder; refine into components or add real anchors"). Warning, not error — the draft is
valid, just visibly incomplete.

**Render badge (out of scope here, noted):** the renderer should later badge undrilled
containers as "draft" so a viewer sees the incompleteness. That belongs to the separate
render-trust-surfacing feature; this spec only guarantees the warning exists at the gate.

## 9. Output contract (illustrative — bootstrapping archmap itself)

```jsonc
{
  "meta": { "name": "archmap", "version": "0.0.0", "snapshot": "2026-06-28" },
  "nodes": [
    { "id": "archmap", "name": "archmap", "kind": "system", "parent": null },

    // packages/schema has no bin / Dockerfile / start script → a library, NOT a
    // container. It is omitted; the agent promotes it later if it deserves a box.

    // validate exposes a CLI (package.json "bin") → deployable; ≤7 exports → grounded
    // components, so the container is a non-leaf and needs no anchor of its own.
    { "id": "pkg-validate", "name": "validate", "kind": "container", "parent": "archmap" },
    { "id": "pkg-validate--validate", "name": "validate", "kind": "component", "parent": "pkg-validate",
      "grounding": { "repo": "archmap", "path": "packages/validate/index.js",
        "symbol": { "fqn": "validate", "kind": "fn", "bodyHash": "…", "sigHash": "…" } } },

    // resolve also exposes a CLI → deployable; >7 exports → undrilled placeholder
    // (loud, gate-passing), for the agent to refine into components.
    { "id": "pkg-resolve", "name": "resolve", "kind": "container", "parent": "archmap",
      "grounding": { "repo": "archmap", "path": "packages/resolve",
        "region": { "anchors": [], "note": ">7 exports; agent to refine into components" } } },

    // deploy axis — own tree, iac-anchored
    { "id": "ci", "name": "CI", "kind": "infra", "parent": null, "axis": "deploy",
      "grounding": { "repo": "archmap", "path": ".github/workflows/validate.yml",
        "iac": "github_actions.validate" } }
  ],
  "edges": [],      // none in v1 — edge inference deferred (spec §12)
  "mappings": []    // none in v1 — agent links axes
}
```

This draft passes `validate` (0 errors; one `UNDRILLED_CONTAINER` warning for `pkg-resolve`)
and `resolve` (components CLEAN, undrilled region CLEAN, iac SKIPPED).

## 10. Error handling

- **Empty / non-repo input:** emit a minimal valid model (system stub only) and warn; never
  crash.
- **No deployables detected:** emit the system stub + deploy stub (if any) and warn that no
  containers were found (likely a single-package app — the agent adds the one container).
- **Self-check failure:** if the produced draft fails `validate` or crashes `resolve`, the CLI
  **refuses to write** and prints the failing rule — a bootstrap bug must never ship an invalid
  model. This is the backstop that makes "valid by construction" enforceable.
- **Existing `model.json`:** refuse to overwrite without `--force`.

## 11. Testing strategy

- **Unit — `deployables.js`** across the five archetypes from review: monorepo (libs excluded,
  apps kept), single-package app (one container), framework app (no per-folder containers),
  microservices (`services/*` kept, `libs/*` excluded), polyglot (non-JS/TS detected but
  marked undrilled).
- **Unit — `components.js`:** ≤7 exports → grounded components; >7 → undrilled; non-JS/TS →
  undrilled; verify `anchors: []` is always an array (the probe-D guard).
- **Integration:** run the full pipeline on fixture repos and assert output passes `validate`
  (0 errors) **and** `resolve` (exit 0, no crash). Encodes the probe findings as regression
  tests.
- **Dogfood:** running bootstrap on archmap itself yields a *conservative subset* of its
  hand-authored `model.json` — the `system` box plus the CLI-exposing packages
  (`validate`/`render`/`resolve`, each has a `bin`) as containers, with grounded components
  where exports ≤7; `schema` (a pure library, no `bin`) is correctly excluded. The output is
  what the agent would then refine *toward* the full model — not a byte-match. Acts as an
  end-to-end acceptance test against a known-good target.

## 12. Out of scope / future

- Edge & mapping inference (needs the import graph — net-new; deferred per spec §12).
- Real grounding for non-JS/TS (needs more extractors; placeholder-only for now).
- Context-layer (`person`/`external`) inference.
- Incremental re-scan / merge into an existing model.
- The render "draft" badge for undrilled containers (render-trust feature).

## 13. Risks

- **Deployability heuristic accuracy.** Misclassifying a lib as a deployable (or vice-versa)
  produces a box the agent must delete/add. Mitigated by conservative signals + the archetype
  test matrix; residual misses are the agent's to fix (a draft, not a final map).
- **"Thin value" critique.** A skeleton without edges may feel light. Accepted: a valid,
  grounded Context+Container draft with honest undrilled markers is strictly more than a blank
  file, and edges are deferred deliberately, not forgotten.
- **JS/TS-first framing.** v1's *real grounded value* is JS/TS-only (matching the resolver).
  Documented as a scope boundary, not hidden.
- **Library-only repos yield thin drafts.** A workspace of pure libraries (no deployables)
  produces just the system box — correct by the C4 definition (a library is not a container),
  but it means the agent does most of the container authoring. The `bin`-as-deployable signal
  mitigates this for CLI/tool repos (it catches archmap's own three CLI packages). A repo with
  neither deployables nor CLIs is a legitimate "system stub only" outcome, with a warning.
