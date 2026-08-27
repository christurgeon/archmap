import { normalizeRegionAnchors } from "@archmap/schema";

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

export const SEVERITY = ["CLEAN", "UNBASELINED", "MOVED", "CHANGED", "RENAMED", "RENAMED?", "AMBIGUOUS", "MISSING"];

// Confirms a CHANGED anchor only ("identity stable, body moved") — MOVED/RENAMED would
// re-anchor the symbol, and doing that in a bulk confirm is exactly the silent-rewrite
// trap this guards against.
export function rebaseline(anchor, state, hit) {
  if (state !== "CHANGED" || !hit) return false;
  anchor.bodyHash = hit.bodyHash;
  if (hit.sigHash) anchor.sigHash = hit.sigHash;
  return true;
}

export function worstState(states) {
  return states.reduce((w, s) => (SEVERITY.indexOf(s) > SEVERITY.indexOf(w) ? s : w), "CLEAN");
}

// A citation claims WHERE a relationship is realized; this falsifies that claim with the
// same machinery as node grounding. Resolution is returned, never stored — the model
// holds the claim, not the verdict.
export function resolveEdgeEvidence(evidence, index, opts = {}) {
  if (!evidence) return { state: "UNEVIDENCED", parts: [] };

  // `doc` is a reviewable assertion, not a checkable one. Saying so beats a fake green.
  if (evidence.kind === "doc") return { state: "SKIPPED", parts: [] };

  if (evidence.kind === "config") {
    // Path existence is all a config citation can claim. Without a predicate to ask, the
    // checker reports SKIPPED rather than inventing a pass — blindness must not read as health.
    if (!opts.pathExists) return { state: "SKIPPED", parts: [] };
    return { state: opts.pathExists(evidence.path) ? "CLEAN" : "MISSING", parts: [] };
  }

  // A call edge's anchors live in DIFFERENT files by construction (caller here, callee there),
  // so each anchor may carry its own path; evidence.path is the fallback for same-file citations.
  const parts = (evidence.anchors ?? []).map((a) => {
    const r = resolve(a, a.path ?? evidence.path, index);
    // carry the anchor + hit so --write can baseline an UNBASELINED anchor in place
    return { fqn: a.fqn, state: r.state, anchor: a, hit: r.hit ?? r.to ?? null };
  });
  return { state: worstState(parts.map((p) => p.state)), parts };
}

export function resolveRegion(region, path, index, opts = {}) {
  // Anchors carry their own hashes now (see normalizeRegionAnchors). `opts.hashes` remains
  // as a fallback for callers holding baselines outside the anchor.
  const hashes = opts.hashes ?? {};
  const anchors = normalizeRegionAnchors(region?.anchors);

  // A region with no anchors claims nothing, so it cannot be CLEAN. It used to be, because
  // [].every() is vacuously true — a green check over an empty set. Bootstrap emits exactly
  // this shape for every undrilled container, so the distinction is load-bearing.
  if (anchors.length === 0) return { state: "UNANCHORED", parts: [] };

  const parts = anchors.map((a) => {
    const anchor = { ...a, bodyHash: a.bodyHash ?? hashes[a.fqn] };
    const r = resolve(anchor, a.path ?? path, index);
    return { fqn: a.fqn, state: r.state, anchor, hit: r.hit ?? r.to ?? null };
  });
  // UNBASELINED is not folded into CLEAN: "never recorded a baseline" is a different claim
  // than "unchanged" — folding it in let a region stay green through an arbitrary rewrite.
  return { state: worstState(parts.map((p) => p.state)), parts };
}
