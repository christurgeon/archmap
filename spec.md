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
   claims.** Mostly unbuilt, genuinely hard, and the **only defensible wedge**. Symbol
   grounding structurally cannot produce this signal, and it's where architecture maps
   actually go fiction. Decide whether you're building node-freshness or edge-truth before
   sinking effort into layer 2. (§10, §11)

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

interface Edge { from: string; to: string; label: string; } // leaf-to-leaf, SAME axis
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
  kind: "fn" | "method" | "class" | "type" | "module" | "iac_resource";
  bodyHash?: string;       // hash of NORMALIZED AST (comments/whitespace/local names stripped)
  sigHash?: string;        // signature only — survives body edits, dies on rename
}

interface RegionAnchor {
  anchors: string[];       // the several fqns the concern spreads across
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

Cleanliness is a guarantee, not a hope: the prompt encourages it, the gate rejects what
slips through.

---

## 8. Render contract

The renderer is a pure function of `model.json`; it owns all geometry. Swapping the layout
engine (e.g. **elk** for layered ranking + obstacle-avoiding orthogonal routing) changes
nothing about the model. Edge labels render on a layer above the boxes (legibility).
Boundary boxes render from containment. Externals greyed. This is what lets an agent
maintain the architecture without ever producing pixels.

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

---

## 10. What grounding cannot catch (don't oversell "live")

1. **The node often isn't a symbol — and that's the common case.** "Tenant isolation
   boundary," "the retry/backoff policy," "the publish path" are concerns smeared across
   many symbols. `RegionAnchor` makes the gap visible but doesn't close it: a multi-anchor
   region is CLEAN only if *all* anchors resolve clean — noisier (any one moving trips it)
   and weaker (it can't tell you the *concern* drifted, only that a constituent symbol did).
   Symbol grounding is high-fidelity for the minority of leaves that are one symbol and
   degrades to "a bag of file pointers" for the rest.
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
   Edges are where most real drift lives. Catching it needs call/import-graph extraction — a
   separate, heavier analysis — and even then it sees only *static* calls.
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

## 11. Edge truth — the wedge (mostly unbuilt)

The most valuable drift signal is the one symbol grounding structurally cannot produce.
Verifying that the code actually has the relationships the model declares needs an
import/call-graph extracted per language and reconciled against `edges`. Even a perfect
static call graph misses the edges that dominate an agent platform: HTTP, message bus,
queue, and DI-resolved dispatch are invisible to it. A real edge-truth engine would combine
static extraction with runtime signals (OpenTelemetry spans, access logs) to confirm
declared transports.

This is the part nobody does well, the part that would make archmap more than internal
tooling, and the part to decide on *before* gold-plating the node resolver. Build the node
resolver because it's tractable and useful — but don't let its green checks convince you the
map is honest, only that the boxes are.

---

## 12. Build order for the repo

1. **schema + validate + render** (§§3–8, 12). The artifact chain. A model authored and
   edited through the ops, gated, rendered to the self-contained HTML.
2. **resolve — cheap parts only** (§9): FQN identity, `bodyHash`/`sigHash`, the state machine,
   RegionAnchor, never-auto-bump + batched confirm. Pluggable index behind tree-sitter for
   one language first.
3. **Decide** node-freshness vs edge-truth (§§10–11) before investing further. If edge-truth,
   that's a separate analysis package and a different (harder, defensible) product.
