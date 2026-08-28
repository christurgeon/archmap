# archmap

[![validate](https://github.com/christurgeon/archmap/actions/workflows/validate.yml/badge.svg)](https://github.com/christurgeon/archmap/actions/workflows/validate.yml)
[![resolve](https://github.com/christurgeon/archmap/actions/workflows/resolve.yml/badge.svg)](https://github.com/christurgeon/archmap/actions/workflows/resolve.yml)
[![node](https://img.shields.io/badge/node-%3E%3D22-3c873a?logo=node.js&logoColor=white)](https://nodejs.org)
[![model](https://img.shields.io/badge/model-C4-8b5cf6)](spec.md)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A self-contained, navigable architecture map an agent authors and maintains.
The source of truth is `model.json`; the rendered HTML is a pure function of it.

## Layout
- `packages/schema` — model shape + the edit-operation API (the agent's only surface)
- `packages/validate` — the gate; errors block render, warnings are reviewed
- `packages/render` — pure `model.json` → self-contained `archmap.html`
- `packages/resolve` — grounding resolver; checks boxes and cited edges against real code
- `packages/bootstrap` — point it at a repo, get a conservative draft `model.json`

## Install (Node >= 22)

`schema`, `validate`, and `render` have **zero runtime dependencies**. `resolve` needs
tree-sitter WASM parsers (~55 MB in `node_modules`, pulled on `npm install`), so the
artifact chain alone is dependency-free but grounding checks are not. If Node is already
present, just run `npm install`. Otherwise install Node first, via nvm (no sudo, user-scoped):

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

`node_modules` holds the workspace symlinks plus resolve's tree-sitter parsers (~55 MB).
Deleting it is safe and instantly reversible with `npm install`.

## Cold start — draft a model for a repo

```bash
node packages/bootstrap/bootstrap.mjs <target-repo> [--snapshot YYYY-MM-DD]
```

Emits a conservative draft that is **valid by construction**: it self-checks against `validate`
and `resolve` as subprocesses and refuses to write a model that fails either. It is not trying
to be smart, it is trying to be *honest* — libraries get no box, a container with more than 7
exported symbols stays undrilled rather than having 7 picked for it, and the deferred tail is
always logged, never silently dropped. The agent refines the draft from there through the
edit-ops.

## Grounding resolver (Phase 2)

`@archmap/resolve` checks that each grounded leaf still points at a real symbol and reports drift (spec §9). JS/TS only, via web-tree-sitter (WASM, no native build).

```bash
node packages/resolve/resolve.mjs model.json            # check: report drift, exit 1 on MISSING/AMBIGUOUS
node packages/resolve/resolve.mjs model.json --write     # establish baselines + write derived resolved/lines
node packages/resolve/resolve.mjs model.json --confirm   # accept CHANGED bodies as the new baseline
```

A green check means the **boxes** are honest (the symbols exist and are unchanged) — never that the **map** is. Edge truth (do the relationships in `edges` actually exist) is out of scope here (spec §§10–11).

See `spec.md` for the contract and `docs/decisions.md` for the reasoning behind it. Phase 1 = schema + validate + render.
Grounding resolver (`packages/resolve`) is Phase 2.

## License

MIT — see [LICENSE](LICENSE).
