import { createModel, addNode, setGrounding } from "@archmap/schema";
import { MAX_COMPONENTS } from "./ground.js";

// Pure (§5). Builds through @archmap/schema ops, which buy id-uniqueness, kind validity,
// parent-existence and cycle checks at authoring time. Ops do NOT guarantee fan-out or
// anchor-completeness -- those live in validate -- so this module owns them.
export const MAX_CONTAINERS = 7;

export function assemble({ meta, system, containers, log = () => {} }) {
  const model = createModel(meta);
  addNode(model, { id: system.id, name: system.name, kind: "system", parent: null });

  // total order by repo-relative path; cap, never synthesize a grouping node (§3.4)
  const ordered = containers.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const kept = ordered.slice(0, MAX_CONTAINERS);
  for (const c of ordered.slice(MAX_CONTAINERS)) {
    log(`deferred: ${c.id} (${c.path}) — over the ${MAX_CONTAINERS}-container cap`);
  }

  for (const c of kept) {
    addNode(model, { id: c.id, name: c.name, kind: "container", parent: system.id, tech: c.lang ?? undefined });

    if (c.undrilled) {
      // THE assembler invariant: `anchors` is an array, never omitted. An omitted anchors
      // key crashed resolveRegion on `.map` of undefined (bootstrap spec probe D).
      setGrounding(model, c.id, {
        repo: meta.name,
        // a single-package repo's container IS the root, whose repo-relative path is "" —
        // and validate treats an empty path as missing, so normalize to "."
        path: c.path || ".",
        region: { anchors: [], note: c.reason },
      });
      continue;
    }

    for (const comp of c.components) {
      addNode(model, { id: comp.id, name: comp.name, kind: "component", parent: c.id });
      setGrounding(model, comp.id, { repo: meta.name, path: comp.path, symbol: comp.symbol });
    }
  }
  return model;
}
