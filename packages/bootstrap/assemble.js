import { createModel, addNode, setGrounding } from "@archmap/schema";
import { MAX_COMPONENTS } from "./ground.js";

// Pure. Schema ops guarantee id-uniqueness, parent-existence, and cycle-safety, but not
// fan-out or anchor-completeness — those live in validate, so this module enforces them.
export const MAX_CONTAINERS = 7;

export function assemble({ meta, system, containers, log = () => {} }) {
  const model = createModel(meta);
  addNode(model, { id: system.id, name: system.name, kind: "system", parent: null });

  // total order by repo-relative path; cap, never synthesize a grouping node
  const ordered = containers.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const kept = ordered.slice(0, MAX_CONTAINERS);
  for (const c of ordered.slice(MAX_CONTAINERS)) {
    log(`deferred: ${c.id} (${c.path}) — over the ${MAX_CONTAINERS}-container cap`);
  }

  for (const c of kept) {
    addNode(model, { id: c.id, name: c.name, kind: "container", parent: system.id, tech: c.lang ?? undefined });

    if (c.undrilled) {
      // invariant: anchors must be an array, never omitted — an omitted key crashed
      // resolveRegion's `.map` (spec probe D).
      setGrounding(model, c.id, {
        repo: meta.name,
        // root container's path is "" — validate treats empty as missing, so normalize to "."
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
