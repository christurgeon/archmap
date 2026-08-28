# AGENTS.md

Guidance for coding agents working in this repository. `CLAUDE.md` is a symlink to this file,
so Claude Code picks it up too — edit this one.

archmap's whole premise is that an *agent* authors and maintains the map, so its own
instructions are deliberately not tied to a single vendor.

## What this is

archmap produces a self-contained, navigable architecture map that an agent authors and
maintains. `model.json` is the single source of truth; the rendered `archmap.html` is a pure
function of it. The shape is C4 (Context → Container → Component → Code) plus a separate
deployment axis.

**The one architectural rule:** the agent emits *semantics* (the model); the renderer owns
*geometry* (layout, routing, colors, placement). A validator gates every change in between.
An LLM is never asked to place pixels — those are algorithmic guarantees, not prompt outcomes.

`spec.md` is the authoritative contract — where the code and the spec disagree, the spec wins.
`docs/decisions.md` is the reasoning behind it: the measurements, and the arguments that were
tried and lost. Read the log before re-proposing anything the spec records as closed; two
proposals have already been argued down there.

## Layout

An npm workspace (`packages/*`), ESM, Node >= 22, zero runtime deps except `resolve`'s
tree-sitter WASM parsers. The packages form a one-way chain — later ones depend on earlier:

- `packages/schema` — model shape + the edit-operation API. **This is the agent's only write surface.**
- `packages/validate` — the gate; errors block render, warnings are reviewed.
- `packages/render` — pure `model.json` → self-contained `archmap.html`. **Never hand-edit the agent's model through the renderer.**
- `packages/resolve` — grounding resolver (spec §9); checks each grounded leaf still points at a real JS/TS symbol and reports drift, including edge citations.
- `packages/bootstrap` — target repo → conservative draft `model.json`, valid by construction (self-checks against validate + resolve before writing).

## Commands

```bash
npm install                                            # workspace symlinks (+ resolve's tree-sitter)
npm test                                               # full suite (node --test)
node --test packages/render/test/layout.test.js        # one test file
node --test --test-name-pattern="<regex>"              # tests matching a name

node packages/validate/validate.mjs model.json         # the gate (run before relying on a model)
node packages/render/render.mjs model.json archmap.html
node packages/resolve/resolve.mjs model.json           # check grounding + edge citations; exit 1 on MISSING/AMBIGUOUS
node packages/resolve/resolve.mjs model.json --write   # establish baselines / write derived fields
node packages/resolve/resolve.mjs model.json --confirm # accept CHANGED bodies as the new baseline (§9)

node packages/bootstrap/bootstrap.mjs <target-repo> [out] [--snapshot YYYY-MM-DD] [--force]
                                                       # draft a model for a repo; never point it at archmap's own checkout
```

CI runs `npm test` + validate + resolve on every PR and on push to `main`. Resolve has no path
filter on purpose: citations anchor into arbitrary files, so a filter would skip the run
exactly when drift happened somewhere it wasn't watching.

## Working in this repo

- Edit models only through `@archmap/schema`'s operations, then run validate. Don't write `model.json` fields ad hoc.
- A green resolve check means the **boxes** are honest (symbols exist and are unchanged), and that **cited** edges still point at live code. It does not mean the map is true: uncited edges are unchecked, `doc` citations are checked by nothing, and relationships the code has but the model omits are invisible entirely (spec §§10.5, 11).
- The index only sees what git tracks — exclusions come from `.gitignore`, plus tests and `.d.ts` by convention.
- `npm test` runs serially (`--test-concurrency=1`). `web-tree-sitter`'s `Parser.init()` intermittently never settles when several processes initialize WASM at once (measured: 3–4 of 12 concurrent runs wedge forever, 0 of 15 serial), which made the suite flake roughly 1 run in 5. Resolve carries a watchdog for the same reason and exits 3 if the index stalls; raise
`ARCHMAP_TIMEOUT_MS` on very large repos. Bootstrap spawns three tree-sitter inits per run (its
own index plus validate and resolve), so it hits the wedge hardest: its self-check retries once
when a subprocess reports "could not run" (exit 3 or a timeout), and never when it reports a
real failure.
