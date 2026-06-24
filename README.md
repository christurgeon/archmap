# archmap

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

See `spec.md` for the full design. Phase 1 = schema + validate + render.
Grounding resolver (`packages/resolve`) is Phase 2.
