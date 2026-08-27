import { slug } from "./detect.js";

// Pure. Uses the prebuilt index, never re-walks. Carries the package's riskiest logic:
// the export filter, id namespacing, the cap, and the undrilled fallback.
export const MAX_COMPONENTS = 7;

// Why 7, not higher: validate's fan-out cap is 7 soft / 14 hard. Picking an arbitrary 7 of
// 12 exports would be the deterministic layer making a semantic choice — reserved for the
// agent by the one architectural rule. An honest "undrilled" placeholder is the truthful output.

function componentId(containerId, containerPath, symbolPath, fqn) {
  const rel = symbolPath.startsWith(containerPath + "/")
    ? symbolPath.slice(containerPath.length + 1)
    : symbolPath;
  // namespaced by the container-relative PATH, not the basename: two files in different
  // subdirectories exporting the same name must not collide and silently drop a real symbol
  return `${containerId}--${slug(rel.replace(/\.[^.]+$/, ""))}--${slug(fqn)}`;
}

const undrilled = (container, reason) => ({
  ...container,
  components: [],
  undrilled: true,
  reason,
});

export function groundContainer(container, index, opts = {}) {
  const log = opts.log ?? (() => {});
  if (!container.lang) return undrilled(container, "non-JS/TS container; agent to refine into components");

  const inScope = index.all().filter((r) => r.path.startsWith(container.path + "/"));
  const kept = inScope.filter((r) =>
    r.exported === true &&        // §7.1 export filter
    !r.fqn.includes(".") &&       // a class is one component; its methods are not
    r.fqn !== "<module>",         // wiring is not a public surface
  );

  if (kept.length === 0) return undrilled(container, "0 exported symbols; agent to refine into components");
  if (kept.length > MAX_COMPONENTS) {
    return undrilled(container, `>${MAX_COMPONENTS} exports; agent to refine into components`);
  }

  const seen = new Set();
  const components = [];
  for (const r of kept.slice().sort((a, b) => (a.path + "::" + a.fqn < b.path + "::" + b.fqn ? -1 : 1))) {
    const id = componentId(container.id, container.path, r.path, r.fqn);
    if (seen.has(id)) { log(`skip: duplicate component id ${id} (${r.path}::${r.fqn})`); continue; }
    seen.add(id);
    components.push({
      id,
      name: r.fqn,
      // the symbol's own FILE, not the package dir: makes resolve's path-filtered lookup
      // return exactly 1 and avoids the repo-wide AMBIGUOUS block
      path: r.path,
      symbol: { fqn: r.fqn, kind: r.kind, bodyHash: r.bodyHash, sigHash: r.sigHash ?? undefined },
    });
  }
  return { ...container, components, undrilled: false };
}
