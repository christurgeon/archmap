#!/usr/bin/env node
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { loadModel, saveModel } from "@archmap/schema";
import { walkSourceFiles } from "./repo-files.js";
import { buildIndex } from "./symbol-index.js";
import { resolve, resolveRegion, resolveEdgeEvidence, rebaseline } from "./resolve.js";

const args = process.argv.slice(2);
const modelPath = args.find((a) => !a.startsWith("--"));
const write = args.includes("--write");
// --confirm accepts CHANGED bodies as the new baseline (§9 batched confirm). It never
// touches MOVED/RENAMED: those re-anchor a symbol and must stay an explicit decision.
const confirm = args.includes("--confirm");
if (!modelPath) { console.error("usage: resolve <model.json> [--write] [--confirm]"); process.exit(2); }

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
let confirmed = 0;

for (const node of model.nodes) {
  const g = node.grounding;
  if (!g) continue;

  if (g.symbol) {
    const r = resolve(g.symbol, g.path, index);
    const where = r.hit ?? r.to ?? null;
    rows.push({ state: r.state, line: `  ${node.id}  ${g.symbol.fqn}${where ? "  -> " + where.path + ":" + where.startLine : ""}` });
    if (BLOCKING.has(r.state)) blocked = true;
    if (confirm && rebaseline(g.symbol, r.state, where)) confirmed++;
    if ((write || confirm) && where && (r.state === "CLEAN" || r.state === "UNBASELINED" || (confirm && r.state === "CHANGED"))) {
      if (r.state === "UNBASELINED") { g.symbol.bodyHash = where.bodyHash; g.symbol.sigHash = where.sigHash ?? undefined; }
      g.resolved = { path: where.path, startLine: where.startLine, endLine: where.endLine, bodyHash: where.bodyHash, resolvedAt: now };
      g.lines = `${where.startLine}-${where.endLine}`;
    }
  } else if (g.region) {
    // Was `null`, which symbol-index.js treats as "search the whole repo" — so a region
    // anchored on a common name like `model` (4 files here) silently owned every match.
    // Constrain to the leaf's own path, exactly as symbol anchors are.
    const r = resolveRegion(g.region, g.path, index);
    rows.push({ state: r.state, line: `  ${node.id}  region [${g.region.anchors.join(", ")}]` });
    if (BLOCKING.has(r.state)) blocked = true; // regions inherit the block rule (documented extension)
  } else {
    rows.push({ state: "SKIPPED", line: `  ${node.id}  (iac/dashboard — not symbol-resolvable in Phase 2)` });
  }
}

// Edge citations: falsify the claim that a relationship is realized where the model says.
// Reported separately from node drift — a green box set and a green edge set are different
// guarantees, and collapsing them is exactly the overselling spec §10 warns against.
const edgeRows = [];
for (const e of model.edges) {
  const r = resolveEdgeEvidence(e.evidence, index, {
    pathExists: (p) => existsSync(join(repoRoot, p)),
  });
  const key = `${e.from}->${e.to}`;
  const detail = e.evidence
    ? `${e.evidence.kind} [${(e.evidence.anchors ?? []).map((a) => a.fqn).join(", ") || e.evidence.path}]`
    : "(no citation)";
  edgeRows.push({ state: r.state, line: `  ${key}  ${detail}` });
  if (BLOCKING.has(r.state)) blocked = true;

  for (const p of r.parts) {
    if (write && p.state === "UNBASELINED" && p.hit) {
      p.anchor.bodyHash = p.hit.bodyHash;
      if (p.hit.sigHash) p.anchor.sigHash = p.hit.sigHash;
    }
    if (confirm && rebaseline(p.anchor, p.state, p.hit)) confirmed++;
  }
}

if (write || confirm) saveModel(modelPath, model);

function report(title, list, order) {
  const byState = new Map();
  for (const row of list) {
    if (!byState.has(row.state)) byState.set(row.state, []);
    byState.get(row.state).push(row.line);
  }
  const ordered = [...order, ...byState.keys()].filter((s, i, a) => a.indexOf(s) === i);
  console.log(`### ${title}`);
  for (const state of ordered) {
    const lines = byState.get(state);
    if (!lines || !lines.length) continue;
    console.log(`== ${state} (${lines.length}) ==`);
    for (const l of lines) console.log(l);
  }
  const summary = ordered.filter((s) => byState.get(s)?.length).map((s) => `${byState.get(s).length} ${s}`);
  console.log("--- " + (summary.length ? summary.join(", ") : "nothing to check"));
}

if (confirm) console.log(`confirmed ${confirmed} CHANGED anchor(s) as the new baseline\n`);
report("nodes", rows, STATE_ORDER);
report("edges", edgeRows, [...STATE_ORDER, "UNEVIDENCED"]);
process.exit(blocked ? 1 : 0);
