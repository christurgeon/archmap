# archmap edge citations — design

- **Status:** implemented 2026-08-25. Design hardened by three independent adversarial reviews.
  One correction found during implementation (per-anchor `path`, §3). Dogfood result differed
  from the §8 estimate — see the note there.
- **Scope:** `edges[].evidence` — declared, falsifiable citations checked by the **existing**
  grounding resolver. No new package, no new dependency, no new gate.
- **Supersedes:** the static reflexion/import-graph engine explored earlier the same day and
  rejected (§10 records why, with measurements).

---

## 1. Problem

`spec.md` §10.5 names the gap: *"grounding verifies the node, never the edge."* `Auth.validate`
can sit byte-identical and CLEAN while someone deletes the `Gateway → auth` call. Every node
passes; the architecture is a lie. Edges are where maps actually rot.

Nothing in archmap checks a relationship. `validate` checks that edges are *well-formed*
(endpoints exist, same axis, leaf-to-leaf, no hierarchy span). It cannot check that an edge is
*true*.

## 2. Decision

Edges become first-class citizens of the grounding model. An edge may carry an **evidence
citation** — a claim about *where in the code this relationship is realized* — anchored the
same way node grounding is anchored, and checked by the same resolver, with the same state
machine and the same exit codes.

This is the upgrade `spec.md` §3 already made for nodes when it replaced `lines: "40-130"`
(identity-by-position, rots invisibly) with a symbol anchor (fails loud). Edge citations do for
edges what symbol anchors did for boxes, reusing the mechanism rather than building a parallel
one.

### 2.1 Why a citation and not a flag

An earlier draft proposed `edge.verify: "call" | "none"` with a required justification note.
That was rejected, and the reason generalizes:

- A **flag** asserts a property of *the checking process* — "this edge is call-verifiable."
  Nothing in the repo can ever contradict it. When a checker finds no call, an author who lied
  is indistinguishable from an extractor that is blind. Worse, the field would have been the
  first **authored input to a gate** in a system where every other derived field
  (`lines`, `resolved`) is derived *precisely because* authored values drift — so an author
  facing a red build could turn it green by editing prose.
- A **citation** asserts a property of *the code* — "this edge is realized at
  `packages/render/layout.js::layoutView`." It is falsifiable by machinery that already exists:
  the symbol resolves CLEAN, CHANGED, MOVED, RENAMED, AMBIGUOUS, or MISSING. No author can
  self-certify past a MISSING.

Falsifiability is the whole distinction. Keep it.

## 3. Schema

```ts
type EvidenceKind =
  | "call"     // a call/construction site — symbol-anchored, resolver-checked
  | "import"   // a module-level dependency — symbol-anchored, resolver-checked
  | "test"     // a test that exercises the relationship — symbol-anchored, resolver-checked
  | "config"   // realized in config (route table, manifest) — path-checked only
  | "doc";     // narrative justification — never machine-checked, note REQUIRED

interface EdgeEvidence {
  kind: EvidenceKind;
  path: string;             // primary location; DEFAULT path for anchors that omit one
  anchors: SymbolAnchor[];  // >= 1 for call/import/test; empty for config/doc
  note?: string;            // REQUIRED when kind === "doc"
}

// SymbolAnchor gains an optional per-anchor `path`. Discovered during implementation:
// an edge's caller and callee live in DIFFERENT files by construction, so one
// evidence-level path cannot serve both — the callee falls through to a repo-wide
// lookup and resolves MOVED instead of CLEAN.

interface Edge {
  from: string;
  to: string;
  label: string;
  evidence?: EdgeEvidence;  // optional — absence is an honest model fact ("unevidenced")
}
```

`SymbolAnchor` is reused **unchanged** from `spec.md` §3 (`fqn`, `kind`, `bodyHash?`,
`sigHash?`).

### 3.1 What the anchors point at

**Convention: anchor the symbols that *realize* the relationship, source side first.** For a
`call` edge from A to B, that is `[the symbol in A that makes the call, the symbol in B being
called]`.

Anchoring only the callee is insufficient on its own — deleting the call site leaves the callee
intact and the citation green. Anchoring the call site catches deletion, because removing the
call changes that symbol's body. Recording both gives:

| What happened | Signal |
|---|---|
| call site deleted entirely | caller MISSING → block |
| call removed from a surviving function | caller CHANGED → review |
| callee deleted | callee MISSING → block |
| callee renamed | callee RENAMED / MISSING |

**All anchors must resolve; the edge's state is the worst of them.** This matches
`RegionAnchor` semantics in `spec.md` §10.1 (a multi-anchor region is CLEAN only if *all*
anchors resolve clean) — same trade, same noisiness, already documented.

**When the call site is not inside an extractable symbol, anchor the callee alone.**
`packages/resolve/extract.js` walks only top-level declarations, so a file of top-level
statements yields **zero symbols** — which is exactly the shape of composition roots, CLI
entry files, `main()`, and DI wiring. Measured: `render.mjs`, `validate.mjs`, `resolve.mjs`,
and `render/index.js` each extract zero symbols. An edge realized in such a file cannot
anchor its call site. Anchor the callee only and accept the weaker signal (deletion of the
callee is caught; deletion of the call is not), or use `doc` and say so in the note. Do not
fabricate a call-site anchor that the resolver would report MISSING.

### 3.2 Evidence state is NOT persisted

`grounding.resolved` writes derived resolution data into `model.json`. **Edge evidence does
not.** The anchor's `bodyHash`/`sigHash` are the baseline (authored once via `--write`); the
resolution *result* is computed at check time and reported, never stored.

Rationale, and this is a deliberate deviation from an earlier decision to derive verdicts into
`model.json`:

1. `model.json` is the agent's **only write surface**. Verdicts scale with edges × code churn
   and would change on nearly every PR, producing textual merge conflicts in a JSON object on
   PRs that never intended to touch the architecture map.
2. A `checkedAt` timestamp guarantees a diff on every run. `resolve.mjs:13` already needed an
   `ARCHMAP_NOW` escape hatch to keep its own output testable; a second timestamp field repeats
   a cost the codebase has already paid once.
3. Diff churn trains reviewers to rubber-stamp `model.json` diffs, which destroys the
   reviewability that motivated persisting verdicts in the first place.

The rendered map therefore shows the **citation** (authored, stable) and not the **verdict**
(derived, volatile). Drift lives where drift already lives: the resolver's report.

## 4. Edit operation

One addition to the agent's surface (`spec.md` §6):

```
setEdgeEvidence(from, to, { kind, path, anchors, note? })
```

Guards, consistent with existing ops: the edge must exist; `kind` must be known; `note` is
required when `kind === "doc"`; `anchors` must be non-empty for `call`/`import`/`test`.
Clearing evidence is `setEdgeEvidence(from, to, null)`.

## 5. Validator rules

New **errors** (block render, consistent with `spec.md` §7):

| Code | Condition |
|---|---|
| `EDGE_EVIDENCE_BAD_KIND` | `kind` not in the known set |
| `EDGE_EVIDENCE_NO_PATH` | `path` missing or empty |
| `EDGE_EVIDENCE_NO_ANCHORS` | `kind` ∈ {call, import, test} and `anchors` is empty |
| `EDGE_EVIDENCE_DOC_NEEDS_NOTE` | `kind === "doc"` and `note` missing |
| `EDGE_EVIDENCE_BAD_ANCHOR` | an anchor is missing `fqn` or `kind` |

`EDGE_EVIDENCE_DOC_NEEDS_NOTE` is the honesty forcing function, and it is the *only* place a
note is load-bearing — mirroring `RegionAnchor.note` in `spec.md` §3, which exists for the same
reason: when the machine cannot check the claim, the human must state why.

New **warning**:

| Code | Condition |
|---|---|
| `EDGE_EVIDENCE_UNANCHORED_PATH` | `kind` ∈ {call, import, test} and `path` names a file the walker cannot parse |

Note there is deliberately **no** `EDGE_UNEVIDENCED` error. Requiring evidence on every edge
would push authors toward fabricated citations — the exact self-certification failure §2.1
rejects. Unevidenced edges are counted and reported, never blocked.

## 6. Resolver

`packages/resolve` gains an edge pass. It reuses `resolve()`, `resolveRegion()`, the symbol
index, and the state machine **unchanged**.

```
for each edge with evidence:
  kind call|import|test -> resolve each anchor against the index
                           edge state = worst anchor state
  kind config           -> check `path` exists on disk -> PRESENT | MISSING
  kind doc              -> SKIPPED (as `iac`/`dashboard` nodes are today)
edges without evidence  -> UNEVIDENCED (counted, reported, never blocking)
```

State precedence, worst first:

```
MISSING > AMBIGUOUS > RENAMED? > RENAMED > MOVED > CHANGED > CLEAN
```

### 6.1 Exit codes — no new gate

**`exit 1` on MISSING or AMBIGUOUS. Identical to the existing node rule.** This is the central
property of the design: it introduces no gate whose false-positive rate is unmeasured. A cited
symbol that no longer exists is an unambiguous, cheap-to-fix fact.

`CHANGED` reports and does not block. It inherits `spec.md` §10.2's over/under-sensitivity
exactly — a cited symbol's body churning produces the same noise it produces for nodes — and a
chronically-yellow check is one people learn to ignore. The dogfood is the evidence: 2 of
archmap's 4 grounded nodes have been CHANGED since the Aurora render commit at `exit 0`, and
nobody re-baselined.

### 6.2 `--write`

Establishes baselines for cited anchors (`bodyHash`, `sigHash`), exactly as it does for node
grounding. **Never auto-bumps `path`** — `spec.md` §9's never-auto-bump rule applies unchanged
and for the same reason: a wrong-but-confident re-anchor is a green check on a lie.

## 7. Render

Minimal, and a pure function of *authored* data only (so the render contract in `spec.md` §8
holds trivially and output stays byte-stable across check runs):

- **Edge stroke** distinguishes evidenced from unevidenced. Nothing else.
- **Panel** gains an Evidence section on the focused node's relationships: kind, path, anchor
  FQNs, and the note when present.
- **Legend** gains one entry.

Explicitly **not** rendered: resolution verdicts (not persisted, §3.2) and "ghost" edges for
undeclared dependencies (there are none — the engine that produced them was rejected, §10).

`promoteEdges` (`packages/render/promote.js`) aggregates leaf edges to view level. A promoted
edge renders evidenced only if **every** constituent leaf edge is evidenced — bias to
surfacing, consistent with `spec.md` §9.

## 8. Dogfood

Author citations for all five edges in the repo's own `model.json`:

| Edge | Kind | Anchors | Strength |
|---|---|---|---|
| `render-core → layout` | `call` | `html.js::render` + `layout.js::layoutView` | **full** — both sides anchored |
| `validate-core → render-core` | `call` | `validate/index.js::validate` only | callee-only — the call site is `render.mjs`, which extracts zero symbols (§3.1) |
| `schema-ops → validate-core` | `call` | `schema/index.js::addNode` only | callee-only — same reason |
| `agent → schema-ops` | `doc` | — | `person` endpoint; never call-verifiable at any level |
| `viewer → render-core` | `doc` | — | `person` endpoint |

The coverage argument in concrete form: **5 of 5 edges are honestly authorable**, against 1 of
5 for the rejected static engine. But note the honest breakdown — **one** full citation, **two**
callee-only (weakened by the composition-root limitation in §3.1), **two** `doc`. Two are `doc`
because a `person` endpoint is structurally not call-verifiable at any level, and saying so
explicitly is the honest outcome rather than a gap.

This distribution is itself a finding: on a repo this small, the composition root is where two
of five architectural relationships live, and it is invisible to symbol extraction. Expect the
same shape on real repos.

**Correction after implementation — the two callee-only rows became `doc`.** Anchoring the two
endpoint symbols (`validate`, `render`) would merely restate what node `grounding` already
asserts about those nodes; it adds no claim about the *relationship*, because neither symbol is
the call site. A citation that carries no information beyond existing grounding is decoration,
so the honest citation for both is `doc` naming the wiring file. **Dogfood result at implementation: 1 of 5
edges machine-checked, 4 `doc`** — 2 irreducible (`person` endpoints), 2 blocked on the
composition-root gap.

**Resolved (same day) by the `<module>` symbol.** `extract.js` now emits a synthetic per-file
symbol over wiring statements, so both composition-root edges anchor their real call site.
**Final: 3 of 5 machine-checked**, the remaining 2 being `person` endpoints. Verified by
removing the `validate` import from `render.mjs` — `validate-core → render-core` goes CHANGED
and the other edges stay CLEAN.

## 9. What this does NOT do

Stated plainly, because overselling is the failure mode `spec.md` §10 exists to prevent.

1. **It verifies the cited code still exists and is unchanged — not that the relationship
   holds.** An author can cite a plausible symbol that does not implement the edge. This is the
   *identical* epistemic status the project already accepts for every node's `grounding`: if it
   is good enough to anchor a box, it is good enough to anchor an edge. It is reviewable once,
   in the PR that introduces the citation, after which the resolver keeps it honest.
2. **It does not discover undeclared edges.** A relationship the code has and the map lacks is
   invisible. That direction requires the static engine rejected in §10.
3. **It inherits every limitation in `spec.md` §10.** Anchors are symbols, so §10.1–§10.4,
   §10.6, §10.7 apply unchanged.
4. **`doc` evidence is never machine-checked.** It is a reviewable assertion, no more.
5. **Relationships realized in composition roots degrade to callee-only citations.** Per §3.1,
   `extract.js` yields no symbols for top-level statement code, so the call site cannot be
   anchored. Deletion of the *callee* is caught; deletion of the *call* is not. On archmap's own
   model this affects 2 of 5 edges (§8) — and composition roots are where wiring relationships
   concentrate, so this is a structural limitation rather than a small-repo artifact. Closing it
   needs a synthetic per-file module symbol (`fqn: "<module>"`, a `SymbolAnchor.kind` that
   `spec.md` §3 already declares but `extract.js` cannot currently emit). Deferred, and recorded
   here so the gap is visible rather than discovered later.

## 10. Rejected alternative: the static reflexion engine

A static JS/TS import/call-graph engine reconciling extracted edges against declared ones
(Reflexion Model: convergence / divergence / absence) was designed and rejected the same day.
Recorded here so it is not re-proposed without new information.

**Measured on this repo and on four external repos:**

| Finding | Measurement |
|---|---|
| Reconcilable dependencies | **1 of 69** extracted (1.4% reconciliation coverage) |
| Specifier resolution on a normal TS app | **0 of 112** first-party imports resolved (79% behind `tsconfig` `paths`, 0 with extensions) |
| Index pollution from build output | **94%** of one repo's symbol index was minified bundles |
| Bootstrap-generated corpus | 3 containers, **1 component**, **0 verifiable edge pairs** |

**Structural objections:**

- **Circularity.** Reflexion carries information only when the model is authored
  *independently* of the extracted graph — that independence is the signal. archmap's premise is
  an agent that authors the map *after reading the code*, so declared L3 edges are a lossy
  projection of the same tokens the extractor reads. Confirmation is near-tautological at t=0
  and a baseline diff at t>0 — the same information class as node-freshness.
- **The level carve-out inverts the technique.** Scoping to L3 ("an edge means a call",
  `spec.md` §4) removes L1/L2 — the *independently authored* edges where reconciliation would
  have carried signal — and keeps the subset closest to circular.
- **It is structurally incompatible with `packages/bootstrap`.** `validate/index.js:75`
  enforces `EDGE_NOT_LEAF`. A container that drills becomes a non-leaf and cannot be an edge
  endpoint; a container that stays undrilled is a leaf but carries `region:{anchors:[]}` — no
  symbols. Under inferred verifiability, **every edge in a bootstrap-generated model is
  UNVERIFIABLE by construction.**
- **The gate's only remedy degrades the artifact.** Blocking on undeclared references pushes
  `model.json` toward call-graph isomorphism (7 components = 42 ordered pairs), which is
  precisely what C4's Component level is defined not to be.
- **A runtime `EvidenceSource` seam is speculative generality.** Static analysis is a *decision
  procedure* (absence of a call proves absence); a span is an *existence witness* (absence
  proves nothing — sampling, seasonality). They cannot share a verdict enum. Under this design
  the seam is free anyway: a future `kind: "runtime"` is a string.

**Complementarity.** Citations do not foreclose the static engine — they *enable* a better
version of it. Once edges carry anchors, a later pass can **propose** citations
(`--suggest-evidence`) and **corroborate** them ("you cited `X`, but nothing in this scope
references `X`"). Corroboration is non-circular, because an independently authored claim is
being contradicted — Reflexion's three-input structure properly restored. Revisit only with a
real corpus.

## 11. Amendments to `spec.md`

| Section | Change |
|---|---|
| §3 | Add `EdgeEvidence` and `EvidenceKind`; extend `Edge` |
| §6 | Add `setEdgeEvidence` to the edit-operation list |
| §7 | Add the five errors and one warning from §5 |
| §9 | Extend: the resolver checks cited edge anchors alongside node grounding |
| §10.5 | **Rescope, do not delete.** Narrow to: node grounding still cannot verify a relationship; citations make the claim *checkable*, not *proven*. Keep the final clause verbatim |
| §11 | **Rewrite.** Static extraction stays unbuilt; record §10's measurements as the reason. Keep the HTTP/bus/DI sentence **verbatim** — nothing here touches it. Delete "the part nobody does well" (unearned; Structure101/Lattix/ArchUnit do conformance well in scope) |
| §12 | Update the 2026-06-25 decision record: edge-truth is now *partially* addressed by citations; static extraction remains deferred, with measurements |

**Honest accounting:** of `spec.md` §10's eight numbered limitations, **zero are closed**.
§10.5 is narrowed. §§10–11 shrink by roughly 15–20% by volume. "Fully implemented, references
removed" was never reachable — §11's transport blind spot is untouched by this design and by
any static one.

## 12. Test plan

`node --test`, per existing package conventions.

- **schema** — `setEdgeEvidence` happy path; guards (unknown kind, missing edge, empty anchors
  on a symbol kind, `doc` without note); clearing evidence; `removeEdge` drops evidence with it.
- **validate** — each of the five errors and the warning fires exactly on its condition; a
  complete model with mixed `call`/`doc` evidence yields zero errors; unevidenced edges produce
  no error.
- **resolve** — anchor state precedence (worst-of); `exit 1` on MISSING and AMBIGUOUS only;
  CHANGED reports at `exit 0`; `config` path check; `doc` SKIPPED; `UNEVIDENCED` counted;
  `--write` establishes anchor baselines and never rewrites `path`.
- **render** — evidenced/unevidenced stroke; panel Evidence section; promotion requires all
  constituents evidenced; output byte-identical across two runs.

## 13. Build order

1. `schema` — type + op + tests
2. `validate` — rules + tests
3. `resolve` — edge pass + exit codes + tests
4. `model.json` — author the five citations, run `--write` for baselines
5. `render` — stroke + panel + legend
6. `spec.md` — the §11 amendments

## 14. Related findings, out of scope here

Surfaced by the adversarial reviews, independently actionable, **not** part of this design:

- **`tree.delete()` is never called** anywhere in `packages/`. `web-tree-sitter` trees hold WASM
  linear memory JS cannot reclaim, so `buildIndex` grows monotonically (~65 MB retained per MB
  of source; a large monorepo aborts at the wasm32 ceiling rather than slowing down).
- **`walkSourceFiles` indexes build output.** `SKIP` covers only `node_modules`, `.git`,
  `.superpowers`. One external repo's index was 94% minified bundles; another already fails
  `resolve` with AMBIGUOUS from `src`/`dist` FQN collisions. Deriving exclusions from
  `.gitignore` is correct by construction and needs no dependency.
- **`RegionAnchor` resolution is unqualified.** `resolve.mjs:40` passes `path: null`, and
  `symbol-index.js:28` treats a falsy path as repo-wide — so region anchors match anywhere in
  the repo. This repo has 7 duplicated FQNs; `model` appears in 4 files.
- **Region leaves are never body-verified.** `resolveRegion` receives no hashes, so `bodyHash`
  is `undefined` → `UNBASELINED` → `CLEAN_ENOUGH`.
- **`sigHash` collides heavily.** 53 of 58 non-test symbols fall into 4 collision groups, so
  §9's `RENAMED?` recovery path is near-dead in practice.
- **The `runtime deps: zero` badge is inaccurate.** `node_modules` is 55 MB including
  `node-addon-api` and `node-gyp-build`. README's uninstall section is wrong for anyone who runs
  `resolve`.
