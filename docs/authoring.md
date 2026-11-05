# Authoring a map — the agent playbook

How an agent turns a target repository into a clean, navigable `archmap.html`. This is the
workflow for mapping *someone else's* code; `AGENTS.md` covers working on archmap itself.

The goal is a map a newcomer can read in two minutes: what the system is, what its deployable
pieces are, how they talk, and where each piece lives in the code. Everything below serves
that. When a rule here and the rubric in `spec.md` §5 seem to disagree, the spec wins.

## The loop

```bash
ARCHMAP=/path/to/archmap          # this checkout
TARGET=/path/to/target-repo

# 1. draft: conservative, valid by construction, never invents structure
node $ARCHMAP/packages/bootstrap/bootstrap.mjs $TARGET

# 2. read the code, then refine in batches (each batch is validated; errors write nothing)
node $ARCHMAP/packages/edit/edit.mjs $TARGET/model.json ops.json

# 3. baseline the grounding (hashes + derived line ranges) once the boxes are right
node $ARCHMAP/packages/resolve/resolve.mjs $TARGET/model.json --write

# 4. render and LOOK at it — every view, not just the first
node $ARCHMAP/packages/render/render.mjs $TARGET/model.json $TARGET/archmap.html
```

Repeat 2–4 until every view passes the checklist at the end. The model must live inside the
target repo: resolve roots its symbol lookup at the model's directory.

## What bootstrap gives you, and what it leaves to you

Bootstrap detects *deployables*: packages with a `bin`, a `start`/`serve` script, a
`Dockerfile`, or an `apps/*` / `services/*` directory. It drills a container into components
only when it has at most 7 exports. Expect to do this yourself:

- **Undrilled containers** (grounding `region` with no anchors, note "agent to refine"). Read
  the package, pick its 3–7 architecturally significant modules, add them as components, ground
  each, and the container's placeholder region stops mattering (only leaves need anchors).
- **Libraries got no box.** If a workspace library is a real architectural part (the core
  engine an app wraps), model its significant modules as components of the app that uses it.
- **People and externals.** Bootstrap emits none. Add the actors (`person`) and the third-party
  systems the code talks to (`external`: Stripe, S3, an identity provider).
- **Edges.** Bootstrap emits none, on purpose: guessing relationships is what makes maps lie.

## Keeping it readable

The renderer handles layout, routing and label placement. It cannot make a crowded model
readable. Readability comes from what you decide to put in.

1. **3–7 boxes per view.** The validator warns above 7 and errors above 14. If a view needs
   more, it needs a grouping node: put the detail one level down.
2. **Draw only the relationships a newcomer must know.** Aim for no more edges in a view than
   about 1.5× its boxes. Leave out logging, metrics, config loading, shared utils, and
   "everything imports the types package". If every box connects to X, say so in X's blurb
   and draw none of those edges. Validate warns `VIEW_DENSE` when a view goes past 2 lines
   per box. Treat that warning as a request to prune.
3. **One edge per relationship, authored at the leaves.** Edges connect leaves and are promoted
   automatically: `checkout → orders-db` appears as `Order Service → Postgres` one level up.
   Never also draw the container-level edge. Promotion merges parallel leaf edges into one
   line, labelled with the first label plus a count (`SQL +2`) when there are several.
4. **Chatty pairs are a modelling smell.** Several edges both ways between two boxes usually
   mean they are one component, or that a shared store or queue between them is missing.
5. **Labels: a verb or a protocol, at most 3 words.** `reads`, `publishes events`, `HTTPS/JSON`,
   `SQL`. The name of a function is not a label.
6. **Name boxes the way the team does.** Use "Checkout Flow", not `CheckoutServiceImplV2`. The
   symbol goes in grounding, not in the name.
7. **First sentence of `blurb` = what it is for.** It shows in the hover tooltip and the
   detail panel. One sentence, no "This module…".
8. **Cycles are fine.** Request/ack and callback loops render correctly. Draw them when they
   are real. Don't drop an edge just to make the picture look acyclic.

## The edit ops, as JSON

`edit.mjs` takes a JSON array. Ops apply in order to a copy. If any op throws, or the result
fails validation, nothing is written. `--dry-run` validates without writing; `-` reads ops from
stdin.

```json
[
  { "op": "addNode", "id": "customer", "name": "Customer", "kind": "person", "parent": null },
  { "op": "addNode", "id": "stripe", "name": "Stripe", "kind": "external", "parent": null,
    "blurb": "Card payments." },

  { "op": "addNode", "id": "checkout", "name": "Checkout Flow", "kind": "component",
    "parent": "pkg-api", "blurb": "Turns a cart into a paid order." },
  { "op": "setGrounding", "id": "checkout",
    "grounding": { "repo": "shop", "path": "apps/api/src/checkout.ts",
                   "symbol": { "fqn": "CheckoutService", "kind": "class" } } },

  { "op": "addEdge", "from": "checkout", "to": "stripe", "label": "charges card" },
  { "op": "setEdgeEvidence", "from": "checkout", "to": "stripe",
    "evidence": { "kind": "call", "path": "apps/api/src/checkout.ts",
                  "anchors": [{ "fqn": "CheckoutService.pay", "kind": "method" }] } }
]
```

| op | fields |
|---|---|
| `addNode` | `id`, `name`, `kind`, `parent`, optional `axis`, `tech`, `blurb` (flat, or nested under `node`) |
| `moveNode` | `id`, `parent` (`null` = top level) |
| `removeNode` | `id` (fails if it has children; drops its edges and mappings) |
| `setBlurb` / `setTech` / `setLinks` | `id`, `blurb` / `tech` / `links` (`[{label,url}]`) |
| `setGrounding` | `id`, `grounding` (`{repo, path, symbol \| region \| iac}`) |
| `addEdge` / `setEdgeLabel` | `from`, `to`, `label` |
| `removeEdge` | `from`, `to` |
| `setEdgeEvidence` | `from`, `to`, `evidence` (`null` clears) |
| `addMapping` / `removeMapping` | `logical`, `deploy`, `label` (add only) |

Kinds: logical `person` `system` `external` `container` `store` `tenant` `component`; deploy
`cloud` `network` `infra` `workload`. An edge never crosses axes. A `mapping` ("runs on") is
the only link between them.

## Grounding

Every groundable leaf (`component`, `store`, `container`, `infra`, `workload` with no
children) needs an anchor:

- **`symbol`**: the one class or function that *is* the component. `fqn` is the name as
  declared, with methods written as `Class.method`. `kind` is one of `fn`, `method`, `class`,
  `type`, `module`.
- **`region`**: for a concern spread over several symbols. `anchors` lists them, and a `note`
  explaining why it isn't one symbol is required.
- **`iac`**: an infrastructure resource address (`aws_s3_bucket.assets`).

Don't write `lines`, `bodyHash` or `resolved` yourself. `resolve --write` derives them. If
resolve says `AMBIGUOUS`, two files declare that name: set `path` to the right file. If it says
`MISSING`, the fqn is wrong.

Edge citations (`setEdgeEvidence`) are optional. Add one when you have read the call site
anyway, because a cited edge is one resolve can check from then on. Never invent one to make
the legend look better: an uncited edge is an honest fact about the model.

## Done checklist

- [ ] validate: 0 errors. Warnings reviewed (an empty-region warning on a container you
      drilled is expected, since only its leaves need anchors).
- [ ] resolve: no `MISSING` / `AMBIGUOUS`.
- [ ] Context view: the system, its users, and its externals. Nothing internal.
- [ ] Every view has ≤ 7 boxes, and you can trace every line in it without the Labels toggle.
- [ ] Every box has a one-sentence blurb that a newcomer would understand.
- [ ] No two views draw the same relationship at different levels.
