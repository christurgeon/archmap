# archmap — build spec (single source of truth)

A self-contained, navigable architecture map that an agent authors and maintains. The
source of truth is a structured model (`model.json`); the rendered HTML is a pure function
of it. Agents edit the model through a small set of operations and never touch the
renderer. A deterministic validator gates every change. A grounding resolver ties leaves to
real code and reports drift.

The shape of the idea is C4 (Context → Container → Component → Code) plus a separate
deployment axis. What's specific: agent-authored, surgically editable, grounded to symbols
(not line ranges), self-contained in one shareable file.

This doc supersedes earlier drafts and transcripts. `validate.mjs` and `resolve.mjs` are
runnable reference implementations; where they differ from this spec, the spec wins (the
resolver below is the upgraded design).

---

## 0. Read first — scope and build priorities

Value is in three layers. Build them in order, and be honest about which one is actually
worth your time:

1. **Artifact chain — semantics/geometry/gate separation.** Cheap, necessary, and the
   foundation everything writes into. Build first, fully. (§§3–8, 12)
2. **Node-freshness resolver — symbol-anchored grounding.** Useful, tractable, *and
   commodity* — Erode and LikeC4 roughly have it. Build the cheap, correct parts (FQN
   identity, dual hash, RegionAnchor, never-auto-bump). Do **not** gold-plate the heavy
   content-hash rename-recovery index before deciding you're even in this business. (§9)
3. **Edge-truth verification — does the code actually have the relationships the model
   claims.** Genuinely hard, and the **only defensible wedge**. Symbol grounding structurally
   cannot produce this signal, and it's where architecture maps actually go fiction.
   **Half-built (2026-08-25):** edge *citations* (§9.1) ship the authored-claim half — an
   edge names where it is realized and the resolver falsifies it. The *discovery* half —
   finding relationships the code has and the map denies — remains unbuilt, and §11 records
   the measurements behind deferring it. (§10, §11)

The through-line: a green grounding check means the **boxes** are honest, never that the
**map** is. Maps rot at the relationships, not the boxes.

---

## 1. Repo layout

```
archmap/
  model.json            # single source of truth — the only thing the agent edits
  packages/
    schema/             # types + the edit-operation API
    validate/           # the gate (errors block render; warnings reviewed)
    resolve/            # grounding resolver + the symbol index (tree-sitter / SCIP)
    render/             # pure model.json -> archmap.html (agent never edits)
  .github/workflows/    # validate on every PR; resolve on PRs touching grounded paths
```

---

## 2. The one architectural rule

The agent emits **semantics** (the model). The renderer owns **geometry** (layout,
ranking, edge routing, label placement, colors, boundary boxes). A validator sits between
them. An LLM is never asked to place pixels or to keep a diagram non-overlapping — those are
algorithmic guarantees, not prompt outcomes.

---

## 3. Model schema

```ts
type Axis = "logical" | "deploy";

type Kind =
  | "person" | "system" | "external"            // logical · L1 context
  | "container" | "store" | "tenant"            // logical · L2 containers
  | "component"                                 // logical · L3 components
  | "cloud" | "network" | "infra" | "workload"; // deploy axis

interface Node {
  id: string;             // stable, slug-like, unique
  name: string;           // end-user / engineer terms, not jargon
  kind: Kind;             // drives color, in-box label, and which level it reads as
  parent: string | null;  // containment; null = top of its axis
  axis?: Axis;            // default "logical"
  tech?: string;          // rendered as [kind · tech]
  blurb?: string;         // markdown-lite; first sentence = the in-box description
  links?: { label: string; url: string }[];
  grounding?: Grounding;  // REQUIRED on groundable leaves (component/store/infra/workload/container)
}

interface Edge {
  from: string; to: string; label: string;   // leaf-to-leaf, SAME axis
  evidence?: EdgeEvidence;                   // OPTIONAL citation: where this edge is realized
}

// An edge citation is a claim about the CODE ("realized at layout.js::layoutView"), not a
// claim about the checker ("this edge is verifiable"). The first is falsifiable by the
// resolver; the second would be author self-certification. See §9.1.
interface EdgeEvidence {
  kind: "call" | "import" | "test" | "config" | "doc";
  path: string;             // primary location; default path for anchors that omit one
  anchors: SymbolAnchor[];  // >= 1 for call/import/test; empty for config/doc
  note?: string;            // REQUIRED for "doc" (the kind no machine can check)
}
interface Mapping { logical: string; deploy: string; label: string; } // the ONLY cross-axis link

interface Model {
  meta: { name: string; version: string; snapshot: string };
  nodes: Node[]; edges: Edge[]; mappings: Mapping[];
}
```

### Grounding (symbol-anchored)

Identity is a symbol, not a line range. `lines: "40-130"` is identity-by-position: any
insert above the range invalidates it with no architectural change. The escape hatch for
nodes that genuinely aren't one symbol is explicit (`region`) so the weak case fails loud
instead of pretending.

```ts
interface Grounding {
  repo: string;
  path: string;            // last-known HINT, not identity — resolver may rewrite it
  symbol?: SymbolAnchor;   // identity for symbol-backed leaves
  region?: RegionAnchor;   // escape hatch: the node is a concern, not one symbol
  iac?: string;            // infra leaves: a resource address ("aws_lambda_function.foo")
  dashboard?: string;
  lines?: string;          // DERIVED at check time. Authoring it = validator warning.
  resolved?: Resolved;     // written by the resolver; never authored; never identity
}

interface SymbolAnchor {
  fqn: string;             // language-normalized fully-qualified name (SCIP-style)
  path?: string;           // per-anchor override; an edge's caller and callee are in
                           // DIFFERENT files by construction, so a single path can't serve both
  kind: "fn" | "method" | "class" | "type" | "module" | "iac_resource";
  bodyHash?: string;       // hash of NORMALIZED AST (comments/whitespace/local names stripped)
  sigHash?: string;        // signature only — survives body edits, dies on rename
}

interface RegionAnchor {
  anchors: SymbolAnchor[]; // the several symbols the concern spreads across.
                           // Bare `string` fqns are still accepted and normalized, but they
                           // carry no baseline — and an anchor with no bodyHash resolves
                           // UNBASELINED, which is NOT clean. See §10.1.
  note: string;            // REQUIRED: why this isn't a single symbol — forces the honesty
}

interface Resolved { path: string; startLine: number; endLine: number; bodyHash: string; resolvedAt: string; }
```

---

## 4. What each level shows

| Level | Shows | Audience | An edge means |
|---|---|---|---|
| L1 Context | actors, the system (one box), external black boxes | anyone | intent ("pushes code") |
| L2 Container | deployable units, stores, tenant workloads | any engineer | protocol / data (HTTP, SQL) |
| L3 Component | modules inside one container | devs on that service | a call |
| L4 Code | the grounded leaf panel — file, lines, snippet | the implementer | — |
| Deploy axis | account → VPC → cluster → node group → pod, plus account-level resources | SRE / infra | infra dependency |

The deploy axis is reached through **mappings** ("runs on"), not by drilling deeper. Infra
is a parallel view, not a level below components.

---

## 5. Authoring rules (the rubric)

Modeling decisions no layout engine can fix; the validator enforces them.

1. **Two axes, never mixed.** Logical = what it does, deploy = where it runs. Connect them
   only with `mappings`; an `edge` is always within one axis.
2. **Fan-out ≤ ~7 children per level** (hard cap 14). More is unreadable at any layout
   quality — add a grouping node and push detail down.
3. **Edges leaf-to-leaf, defined once.** Let promotion surface them upward; never author the
   same relationship twice. When a node gains children, migrate its edges down onto them.
4. **Label budget.** Edge labels ≤ 3 words; in-box description is one line (first sentence of
   `blurb`).
5. **One responsibility per node.** Many edges between two nodes → probably one node.
6. **Externals are black boxes** — no internals, rendered greyed.
7. **Every groundable leaf is anchored.** A `symbol`, a `region` (with note), or an `iac`
   address. No anchor → can't be drift-checked → silent rot.
8. **Consistent names and kinds.** Name things the way the people who use them do.

---

## 6. Edit operations (the agent's surface)

The agent mutates `model.json` through these; it never edits HTML. Render is a pure rebuild,
so diffs stay small and reviewable.

```
addNode({ id, name, kind, parent, axis?, tech?, blurb? })
moveNode(id, newParent)               # reparent — logical reorg, NOT pixel position
removeNode(id)                        # fails if it has children
setBlurb(id, text) | setTech(id, tech) | setLinks(id, links)
setGrounding(id, { symbol|region|iac, path, dashboard? })
addEdge(from, to, label) | removeEdge(from, to) | setEdgeLabel(from, to, label)
setEdgeEvidence(from, to, { kind, path, anchors, note? })   # cite where the edge is realized; null clears
addMapping(logical, deploy, label) | removeMapping(logical, deploy)
```

---

## 7. Validator — the gate

`validate.mjs model.json` runs before every render. **Errors block; warnings are reviewed.**

- Schema: unique ids, known kinds, existing parents, valid axis; grounding has repo+path.
- Containment is a tree (no cycles) and axis-consistent (a child shares its parent's axis).
- Edges: endpoints exist, same axis, no self-edge, no edge spanning the containment
  hierarchy, no duplicates, label within budget, authored at leaf level.
- Mappings: logical endpoint is logical, deploy endpoint is deploy.
- Fan-out within limits; groundable leaves carry an anchor (symbol/region/iac).
- **`lines` authored by hand → warning** (it is derived output, not input).
- Regions: `note` required, `anchors` must be an array, each anchor needs an `fqn`. An
  **empty** `anchors` array is legal but **warns** — it is a placeholder that verifies
  nothing, and it must not read as a passing grounding.
- Edge evidence, **when present**, is well-formed: known `kind`, non-empty `path`, anchors for
  the symbol kinds, `fqn`+`kind` on each anchor, and a `note` on `doc`. Evidence itself stays
  **optional** — requiring it would push authors toward fabricated citations, which is the
  self-certification failure §9.1 exists to prevent. An uncited edge is an honest model fact.
- **Edge evidence resolution authored by hand → warning** (same rule as `lines`).

Cleanliness is a guarantee, not a hope: the prompt encourages it, the gate rejects what
slips through.

---

## 8. Render contract

The renderer is a pure function of `model.json`; it owns all geometry. Swapping the layout
engine (e.g. **elk** for layered ranking + obstacle-avoiding orthogonal routing) changes
nothing about the model. Edge labels render on a layer above the boxes (legibility).
Boundary boxes render from containment. Externals greyed. This is what lets an agent
maintain the architecture without ever producing pixels.

**Visual system (renderer-owned, never authored).** `kind` drives a per-kind accent — shown
as a left rail and, on drillable boxes, the border — so each level reads at a glance; the
in-box `kind · tech` text keeps kind legible without colour (colourblind-safe). Edges carry
arrowheads; boxes carry subtle depth; a legend lists the kinds present. Output ships a light
and a dark theme as CSS-variable sets: a stored choice wins via `:root[data-theme]`, otherwise
`prefers-color-scheme` governs (`:root:not([data-theme])`), and a pre-paint `<head>` script
applies the stored choice with no flash. The default render stays deterministic — the theme is
client runtime state, not output variance.

---

## 9. Grounding resolver — resolve-at-check-time

Per grounded leaf, against the repo at the current commit. The **symbol index** is the heavy
dependency: tree-sitter queries per language (syntactic, no build), or SCIP/LSIF for
cross-file FQN resolution. `bodyHash` is over a normalized AST, never raw text.

```ts
function resolve(g: SymbolAnchor, index: SymbolIndex): Resolution {
  // 1. fast path: expected file still has the symbol
  let hits = index.lookup(g.fqn, { path: g.path });
  if (hits.length === 1) return classify(g, hits[0]);

  // 2. file moved / symbol relocated: repo-wide FQN lookup
  hits = index.lookup(g.fqn);
  if (hits.length === 1) return { ...classify(g, hits[0]), pathChanged: true }; // MOVED
  if (hits.length > 1)   return { state: "AMBIGUOUS", candidates: hits };       // overloads / dup names

  // 3. FQN gone: recover identity from CONTENT, not name (the rename signal)
  if (g.bodyHash) {
    const byBody = index.lookupByBodyHash(g.bodyHash);
    // AMENDMENT: gate on uniqueness of the hash itself. Identical boilerplate / generated
    // bodies collide and would confidently report a WRONG rename. Only recover when the
    // body hash is globally unique in the index.
    if (byBody.length === 1 && index.bodyHashIsUnique(g.bodyHash))
      return { state: "RENAMED", to: byBody[0] };
  }
  // 4. weaker recovery: same shape, body rewritten
  if (g.sigHash) {
    const bySig = index.lookupBySigHash(g.sigHash);
    if (bySig.length === 1) return { state: "RENAMED?", to: bySig[0], confidence: "low" };
  }
  return { state: "MISSING" };
}

function classify(g: SymbolAnchor, hit: Symbol): Resolution {
  if (g.bodyHash && g.bodyHash === hit.bodyHash) return { state: "CLEAN", hit };
  return { state: "CHANGED", hit }; // identity stable, body moved — the ambiguous middle
}
```

### State → action (different states, different actions — this is the "middle" a binary check lacks)

| State | Meaning | Action |
|---|---|---|
| `CLEAN` | symbol present, body hash unchanged | none |
| `MOVED` | found at a different path | recompute `lines`; **queue for human confirm — never auto-bump `path`** |
| `CHANGED` | found, body hash differs | route to **semantic review** — body shifted under a stable name |
| `RENAMED` | recovered by unique body hash | suggest new `fqn`; confirm |
| `RENAMED?` | recovered by sig hash (low confidence) | surface; human decides |
| `AMBIGUOUS` | matches in >1 place | qualify the symbol (block) |
| `MISSING` | not found by name or content | hard drift; human decides (block) |

**Never auto-bump `path` on a confident MOVE.** A wrong-but-confident move (a misresolved
ambiguity) silently re-anchors a node to the wrong symbol — a green check on a lie, strictly
worse than visible drift. The asymmetry says bias to surfacing.

**AMENDMENT — batched confirm queue.** "Auto-bump vs. never" is a false binary. Collect
MOVED/RENAMED into a review queue ("12 moves, confirm all") so you keep the guarantee that
automation never makes drift invisible *without* per-PR friction. Whether you can afford
per-PR surfacing at all is a function of churn rate — measure it on your own repos before
choosing the queue cadence.

**Implemented as `resolve --confirm`.** It accepts CHANGED bodies as the new baseline and
touches nothing else — MOVED/RENAMED re-anchor a symbol and must stay explicit decisions, per
the never-auto-bump rule above. Until this existed there was **no re-baseline path at all**:
`--write` only writes CLEAN/UNBASELINED anchors, so a CHANGED node stayed CHANGED forever
unless someone hand-edited `model.json`. That, not neglect, is why this repo carried stale
CHANGED nodes from one render commit to the next — the tooling offered no way to clear them.

### 9.1 Edge citations — the same machinery, applied to relationships

An edge may carry an `evidence` citation (§3) naming where the relationship is realized. The
resolver checks it with the **same** `resolve()`, the same state machine, and the same exit
rule (`MISSING`/`AMBIGUOUS` block). Edge state is the **worst** of its anchors, matching
`RegionAnchor` semantics. `doc` is SKIPPED; `config` is path-checked only; an uncited edge
reports `UNEVIDENCED` and never blocks.

**Why a citation and not a `verify: "call" | "none"` flag.** A flag asserts a property of the
*checking process*, so nothing in the repo can contradict it — an author who lied is
indistinguishable from a checker that is blind, and the field would be the first **authored
input to a gate** in a system where every other derived field exists precisely because authored
values drift. A citation asserts a property of the *code*, which the resolver can falsify. This
is the same upgrade §3 made when it replaced `lines: "40-130"` with a symbol anchor.

**Resolution state is never stored.** Anchor `bodyHash`/`sigHash` are baselines written by
`--write`; the verdict is computed at check time and reported. Persisting it would put a
field that changes on nearly every PR into the agent's only write surface, producing merge
conflicts on changes that never touched the architecture — and §10.8's silent-rewrite hazard
applies to any machine write into `model.json`.

**Composition roots — the `<module>` symbol.** A file of top-level statements (CLI entry
points, `main()`, route registration, DI wiring) contains no declarations, so a
declaration-only extractor sees nothing there — and that is exactly where wiring
relationships are realized. `extract.js` therefore emits a synthetic per-file symbol with
`fqn: "<module>"` and `kind: "module"`, hashed over the file's **wiring statements only**
(imports, re-exports, top-level calls). Declaration bodies are excluded: those carry their own
`bodyHash`, and folding them in would make any edit anywhere in the file trip every edge
anchored to that module.

The module hash uses a **name-preserving** canonicalization, unlike `bodyHash`. Stripping
identifiers is right for a function body (a local rename is not architectural drift) and wrong
for wiring, where `validate(m)` versus `render(m)` *is* the relationship.

Verified on this repo: removing the `validate` import from `render.mjs` moves
`validate-core → render-core` to CHANGED and leaves the other edges CLEAN.

---

## 10. What grounding cannot catch (don't oversell "live")

1. **The node often isn't a symbol — and that's the common case.** "Tenant isolation
   boundary," "the retry/backoff policy," "the publish path" are concerns smeared across
   many symbols. `RegionAnchor` makes the gap visible but doesn't close it: a multi-anchor
   region is CLEAN only if *all* anchors resolve clean — noisier (any one moving trips it)
   and weaker (it can't tell you the *concern* drifted, only that a constituent symbol did).
   Symbol grounding is high-fidelity for the minority of leaves that are one symbol and
   degrades to "a bag of file pointers" for the rest.

   **Fixed 2026-08-25 — regions were reporting CLEAN unconditionally.** Two independent
   causes, both verified: an empty `anchors` array made `[].every()` vacuously true, and the
   resolver never passed hashes, so every anchor came back UNBASELINED and was folded into
   "clean enough". A region leaf was green as long as its names existed — and green even with
   *no names at all*, which is exactly the shape `packages/bootstrap` emits for every
   undrilled container. Anchors are now `SymbolAnchor`s carrying baselines, an empty region
   reports `UNANCHORED` and warns, and UNBASELINED is no longer treated as clean. The
   *modelling* limitation above is unchanged; only the false green is gone.
2. **`bodyHash` is over- and under-sensitive at once, and no hash fixes it.** Normalize hard
   and you go silent on the changes that matter most — a flipped boolean, a swapped queue
   name in a string literal, a changed timeout. Normalize lightly and CHANGED is constant
   noise. "Meaningful" is defined relative to the architectural claim, which the hash can't
   see. CHANGED is permanently a heuristic that both false-positives and false-negatives.
3. **Rename-with-refactor is undecidable, and it's the case that matters.** Body-hash
   recovery works only when the body survives the rename. People usually rename *because* the
   responsibility changed, so the body changes too → collapses to MISSING + an unrelated new
   symbol, indistinguishable from delete+add. Git's `-M` has the identical blind spot. The
   resolver is weakest exactly where the architectural signal is strongest.
4. **FQN isn't unique where code is most fluid.** Rust `impl` blocks, overloads, generic
   instantiations, aliased imports → N candidates, disambiguated by signature, which is the
   thing that just changed.
5. **THE KILLER — grounding verifies the node, never the edge.** `Auth.validate` can sit
   byte-identical and CLEAN while someone deletes the `Gateway → auth` call or adds a
   `Gateway → UserStore` call the model denies. Every node passes; the architecture is a lie.
   Edges are where most real drift lives.

   **Partially addressed (2026-08-25) by edge citations (§9.1) — read the scope carefully.**
   A cited edge names the symbols that realize it, so *deleting the call* now surfaces:
   the call-site symbol's body changes and the edge goes CHANGED (verified on this repo —
   removing the `layoutView` call from `render` moved `render-core → layout` from CLEAN to
   CHANGED while `layoutView` itself stayed intact). What this does **not** close:
   - **The undeclared direction is still invisible.** Adding a `Gateway → UserStore` call the
     model denies is caught by nothing. That needs call/import-graph extraction (§11).
   - **A citation is only as good as its author.** It proves the cited code still exists and is
     unchanged, not that it implements the relationship. Same epistemic status as any node's
     `grounding`, reviewable once at authoring time.
   - **CHANGED is low-precision.** It fires on *any* edit to the cited symbol, not just call
     deletion — §10.2 applies unchanged, which is why CHANGED reports and never blocks.
   - **Composition roots degrade to `doc`** (§9.1), which is checked by nothing.

   Catching the rest needs call/import-graph extraction — a separate, heavier analysis — and
   even then it sees only *static* calls.
6. **Polyglot + infra is where it falls apart — and that's the target stack.** Rust/Python/
   TS/Java = four extractors at four quality levels. `infra`/`workload` nodes live in
   Terraform and k8s YAML where the closest thing to a symbol is a resource address with its
   own semantics; SQL/config have no symbol model at all. A real fraction of the deploy axis
   can't be symbol-anchored and falls back to path-or-nothing.
7. **Generated and cross-repo code.** Anchoring into `gen/` relocates on every codegen bump
   (pure noise). Cross-repo edges force a cross-repo index — more cost, more auth surface,
   and version-skew that looks like drift but isn't.
8. (covered in §9) **Auto-bumping `path` is a silent-rewrite trap.**

---

## 11. Edge truth — partially built

The most valuable drift signal is the one symbol grounding structurally cannot produce.
**Edge citations (§9.1) build the half that is tractable:** an authored claim about where a
relationship lives, falsified by the existing resolver. What remains unbuilt is the
*discovery* half — finding relationships the code has and the map denies — which needs an
import/call-graph extracted per language and reconciled against `edges`. Even a perfect
static call graph misses the edges that dominate an agent platform: HTTP, message bus,
queue, and DI-resolved dispatch are invisible to it. A real edge-truth engine would combine
static extraction with runtime signals (OpenTelemetry spans, access logs) to confirm
declared transports.

**Why the static reconciler is deferred, with measurements (2026-08-25).** A reflexion-model
engine (extract the graph, reconcile against `edges`) was designed and rejected:

| | measured |
|---|---|
| reconcilable dependencies on this repo | **1 of 69** extracted (1.4%) |
| first-party specifiers resolved on a normal TS app | **0 of 112** (79% behind `tsconfig` `paths`, 0 with extensions) |
| symbol index that was build output on one repo | **94%** |
| bootstrap-generated corpus | 3 containers, **1 component**, **0 verifiable edge pairs** |

Three structural objections outlive any implementation effort. **Circularity:** reconciliation
carries information only when the model is authored *independently* of the extracted graph, and
archmap's premise is an agent that authors after reading the code — so confirmation is
near-tautological at t=0 and a baseline diff at t>0. **The level carve-out inverts the
technique:** scoping to L3 ("an edge means a call", §4) discards L1/L2, which are the
independently-authored edges where reconciliation would have carried signal. **Incompatibility
with bootstrap:** `EDGE_NOT_LEAF` means a drilled container cannot be an edge endpoint, while an
undrilled one carries `region:{anchors:[]}` and has no symbols — so every edge in a
bootstrap-generated model would be unverifiable by construction.

Citations do not foreclose that engine; they enable a better version. Once edges carry anchors,
a later pass can **propose** citations and **corroborate** them ("you cited `X`, but nothing in
this scope references `X`") — non-circular, because an independently authored claim is being
contradicted. Revisit with a real corpus, not on this repo.

Don't let a green check convince you the map is honest. Cited edges are *checkable*, never
*proven*; uncited ones are unchecked; and the undeclared direction is unwatched entirely.

---

## 12. Build order for the repo

1. **schema + validate + render** (§§3–8, 12). The artifact chain. A model authored and
   edited through the ops, gated, rendered to the self-contained HTML.
2. **resolve — cheap parts only** (§9): FQN identity, `bodyHash`/`sigHash`, the state machine,
   RegionAnchor, never-auto-bump + batched confirm. Pluggable index behind tree-sitter for
   one language first.
3. **Decide** node-freshness vs edge-truth (§§10–11) before investing further. If edge-truth,
   that's a separate analysis package and a different (harder, defensible) product.

   **Decision (2026-06-25): edge-truth deferred.** A static MVP is mostly noise for this
   codebase — most architecture edges are deliberate abstractions, not function calls (4 of 5
   edges in `model.json` have no backing call), and §11's transport blind spot (HTTP/bus/DI)
   guts the signal for the polyglot target it's ostensibly for. The valuable form is
   runtime-backed (OpenTelemetry spans / access logs) and should be decided against a real
   target system, not archmap itself. §§10–11 stay as the analysis behind this hold.

   **Amendment (2026-08-25): the deferral held; edge citations shipped instead.** An attempt to
   reverse the 2026-06-25 decision was tested against measurement and failed — the reversal's
   central argument (that `packages/bootstrap` would produce densely grounded components) is
   false: bootstrap's ≤7-export drill rule yields 3 containers and **1 component** on this repo,
   and `EDGE_NOT_LEAF` makes bootstrap edges unverifiable by construction. The June reasoning
   stands and §11 records the numbers.

   What shipped is the *other* half: **edge citations** (§9.1) — authored, falsifiable claims
   about where a relationship is realized, checked by the existing resolver with no new package,
   no new dependency, and no new gate. Honest scope on this repo: **3 of 5 edges machine-checked**
   (the remaining 2 are `person` endpoints, which are not call-verifiable at any level).
   Static reconciliation stays deferred.

   Current shipped scope is steps 1–2 plus edge citations.
