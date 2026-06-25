# archmap

[![node](https://img.shields.io/badge/node-%3E%3D22-3c873a?logo=node.js&logoColor=white)](https://nodejs.org)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-zero-2563eb)](#install-node--22)
[![tests](https://img.shields.io/badge/tests-94%20passing-3c873a)](packages)
[![model](https://img.shields.io/badge/model-C4-8b5cf6)](spec.md)

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

## Grounding resolver (Phase 2)

`@archmap/resolve` checks that each grounded leaf still points at a real symbol and reports drift (spec §9). JS/TS only, via web-tree-sitter (WASM, no native build).

```bash
node packages/resolve/resolve.mjs model.json            # check: report drift, exit 1 on MISSING/AMBIGUOUS
node packages/resolve/resolve.mjs model.json --write     # establish baselines + write derived resolved/lines
```

A green check means the **boxes** are honest (the symbols exist and are unchanged) — never that the **map** is. Edge truth (do the relationships in `edges` actually exist) is out of scope here (spec §§10–11).

See `spec.md` for the full design. Phase 1 = schema + validate + render.
Grounding resolver (`packages/resolve`) is Phase 2.
