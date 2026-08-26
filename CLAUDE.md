# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

archmap produces a self-contained, navigable architecture map that an agent authors and
maintains. `model.json` is the single source of truth; the rendered `archmap.html` is a pure
function of it. The shape is C4 (Context → Container → Component → Code) plus a separate
deployment axis.

**The one architectural rule:** the agent emits *semantics* (the model); the renderer owns
*geometry* (layout, routing, colors, placement). A validator gates every change in between.
An LLM is never asked to place pixels — those are algorithmic guarantees, not prompt outcomes.

`spec.md` is the authoritative design doc. Where the code and the spec disagree, the spec wins.

## Layout

An npm workspace (`packages/*`), ESM, Node >= 22, zero runtime deps except `resolve`'s
tree-sitter WASM parsers. The packages form a one-way chain — later ones depend on earlier:

- `packages/schema` — model shape + the edit-operation API. **This is the agent's only write surface.**
- `packages/validate` — the gate; errors block render, warnings are reviewed.
- `packages/render` — pure `model.json` → self-contained `archmap.html`. **Never hand-edit the agent's model through the renderer.**
- `packages/resolve` — grounding resolver (spec §9); checks each grounded leaf still points at a real JS/TS symbol and reports drift.

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
```

CI runs `npm test` + validate + resolve on every PR and on push to `main`. Resolve has no path
filter on purpose: citations anchor into arbitrary files, so a filter would skip the run
exactly when drift happened somewhere it wasn't watching.

## Working in this repo

- Edit models only through `@archmap/schema`'s operations, then run validate. Don't write `model.json` fields ad hoc.
- A green resolve check means the **boxes** are honest (symbols exist and are unchanged), and that **cited** edges still point at live code. It does not mean the map is true: uncited edges are unchecked, `doc` citations are checked by nothing, and relationships the code has but the model omits are invisible entirely (spec §§10.5, 11).
- The index only sees what git tracks — exclusions come from `.gitignore`, plus tests and `.d.ts` by convention.
