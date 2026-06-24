export function classify(anchor, hit) {
  if (!anchor.bodyHash) return { state: "UNBASELINED", hit };
  return { state: anchor.bodyHash === hit.bodyHash ? "CLEAN" : "CHANGED", hit };
}

export function resolve(anchor, path, index) {
  // 1. fast path: expected file still has the symbol
  const atPath = index.lookup(anchor.fqn, { path });
  if (atPath.length === 1) return classify(anchor, atPath[0]);

  // 2. file moved / symbol relocated: repo-wide fqn lookup
  const wide = index.lookup(anchor.fqn);
  if (wide.length === 1) return { state: "MOVED", hit: wide[0], bodyState: classify(anchor, wide[0]).state };
  if (wide.length > 1) return { state: "AMBIGUOUS", candidates: wide };

  // 3. fqn gone: recover identity from content, gated on global uniqueness of the hash
  if (anchor.bodyHash) {
    const byBody = index.lookupByBodyHash(anchor.bodyHash);
    if (byBody.length === 1 && index.bodyHashIsUnique(anchor.bodyHash)) {
      return { state: "RENAMED", to: byBody[0] };
    }
  }

  // 4. weaker recovery: same signature, body rewritten
  if (anchor.sigHash) {
    const bySig = index.lookupBySigHash(anchor.sigHash);
    if (bySig.length === 1) return { state: "RENAMED?", to: bySig[0], confidence: "low" };
  }

  return { state: "MISSING" };
}

const SEVERITY = ["CLEAN", "UNBASELINED", "MOVED", "CHANGED", "RENAMED", "RENAMED?", "AMBIGUOUS", "MISSING"];
const CLEAN_ENOUGH = new Set(["CLEAN", "UNBASELINED"]);

export function resolveRegion(region, path, index, opts = {}) {
  const hashes = opts.hashes ?? {};
  const parts = region.anchors.map((fqn) => {
    const anchor = { fqn, kind: "fn", bodyHash: hashes[fqn] };
    return { fqn, state: resolve(anchor, path, index).state };
  });
  const allClean = parts.every((p) => CLEAN_ENOUGH.has(p.state));
  const worst = parts.reduce((w, p) => (SEVERITY.indexOf(p.state) > SEVERITY.indexOf(w) ? p.state : w), "CLEAN");
  return { state: allClean ? "CLEAN" : worst, parts };
}
