import { extractSymbols } from "./extract.js";

export async function buildIndex(files) {
  const records = [];
  for (const f of files) {
    const syms = await extractSymbols(f.source, f.lang);
    for (const s of syms) records.push({ ...s, path: f.path });
  }

  const byFqn = new Map();
  const byBody = new Map();
  const bySig = new Map();
  const push = (map, key, rec) => {
    if (key == null) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(rec);
  };
  for (const r of records) {
    push(byFqn, r.fqn, r);
    push(byBody, r.bodyHash, r);
    push(bySig, r.sigHash, r);
  }

  return {
    all: () => records.slice(),
    lookup: (fqn, opts = {}) => {
      const hits = byFqn.get(fqn) ?? [];
      return opts.path ? hits.filter((r) => r.path === opts.path) : hits.slice();
    },
    lookupByBodyHash: (h) => (byBody.get(h) ?? []).slice(),
    bodyHashIsUnique: (h) => (byBody.get(h) ?? []).length === 1,
    lookupBySigHash: (h) => (bySig.get(h) ?? []).slice(),
  };
}
