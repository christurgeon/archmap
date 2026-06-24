#!/usr/bin/env node
import { dirname } from "node:path";
import { loadModel, saveModel } from "@archmap/schema";
import { walkSourceFiles } from "./repo-files.js";
import { buildIndex } from "./symbol-index.js";
import { resolve, resolveRegion } from "./resolve.js";

const args = process.argv.slice(2);
const modelPath = args.find((a) => !a.startsWith("--"));
const write = args.includes("--write");
if (!modelPath) { console.error("usage: resolve <model.json> [--write]"); process.exit(2); }

const now = process.env.ARCHMAP_NOW ?? new Date().toISOString();
const model = loadModel(modelPath);
const repoRoot = dirname(modelPath);
const index = await buildIndex(walkSourceFiles(repoRoot));

// Collect one row per grounded node, then print GROUPED BY STATE — the batched confirm queue (§9 amendment):
// a human reads "MOVED (3)", "RENAMED (1)", ... and confirms a batch, rather than scanning interleaved lines.
const STATE_ORDER = ["MISSING", "AMBIGUOUS", "RENAMED?", "RENAMED", "CHANGED", "MOVED", "UNBASELINED", "CLEAN", "SKIPPED"];
const BLOCKING = new Set(["MISSING", "AMBIGUOUS"]);
const rows = [];
let blocked = false;

for (const node of model.nodes) {
  const g = node.grounding;
  if (!g) continue;

  if (g.symbol) {
    const r = resolve(g.symbol, g.path, index);
    const where = r.hit ?? r.to ?? null;
    rows.push({ state: r.state, line: `  ${node.id}  ${g.symbol.fqn}${where ? "  -> " + where.path + ":" + where.startLine : ""}` });
    if (BLOCKING.has(r.state)) blocked = true;
    if (write && where && (r.state === "CLEAN" || r.state === "UNBASELINED")) {
      if (r.state === "UNBASELINED") { g.symbol.bodyHash = where.bodyHash; g.symbol.sigHash = where.sigHash ?? undefined; }
      g.resolved = { path: where.path, startLine: where.startLine, endLine: where.endLine, bodyHash: where.bodyHash, resolvedAt: now };
      g.lines = `${where.startLine}-${where.endLine}`;
    }
  } else if (g.region) {
    const r = resolveRegion(g.region, null, index);
    rows.push({ state: r.state, line: `  ${node.id}  region [${g.region.anchors.join(", ")}]` });
    if (BLOCKING.has(r.state)) blocked = true; // regions inherit the block rule (documented extension)
  } else {
    rows.push({ state: "SKIPPED", line: `  ${node.id}  (iac/dashboard — not symbol-resolvable in Phase 2)` });
  }
}

if (write) saveModel(modelPath, model);

const byState = new Map();
for (const row of rows) {
  if (!byState.has(row.state)) byState.set(row.state, []);
  byState.get(row.state).push(row.line);
}
const ordered = [...STATE_ORDER, ...byState.keys()].filter((s, i, a) => a.indexOf(s) === i);
for (const state of ordered) {
  const lines = byState.get(state);
  if (!lines || !lines.length) continue;
  console.log(`== ${state} (${lines.length}) ==`);
  for (const l of lines) console.log(l);
}
console.log("--- " + ordered.filter((s) => byState.get(s)?.length).map((s) => `${byState.get(s).length} ${s}`).join(", "));
process.exit(blocked ? 1 : 0);
