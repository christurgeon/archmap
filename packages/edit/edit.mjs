#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadModel, saveModel } from "@archmap/schema";
import { applyOps } from "./index.js";

// The gated write path: apply a JSON batch of edit ops, run the validator, and write the
// model only when the result has zero errors. Warnings print but do not block.
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const [path, opsPath] = args.filter((a) => !a.startsWith("--"));
if (!path || !opsPath) {
  console.error("usage: edit <model.json> <ops.json | -> [--dry-run]");
  console.error('  ops.json: [{"op":"addNode","id":"api","name":"API","kind":"container","parent":"sys"}, …]');
  process.exit(2);
}

// No --init: a new model starts from bootstrap, whose snapshot comes from git, never the clock.
let model;
try {
  model = loadModel(path);
} catch (e) {
  console.error(`edit: cannot read ${path}: ${e.message} (start a new model with bootstrap)`);
  process.exit(2);
}

let batch;
try {
  batch = JSON.parse(readFileSync(opsPath === "-" ? 0 : opsPath, "utf8"));
} catch (e) {
  console.error(`edit: cannot parse ops: ${e.message}`);
  process.exit(2);
}

let result;
try {
  result = applyOps(model, batch);
} catch (e) {
  console.error(`edit: ${e.message}`);
  console.error("nothing written");
  process.exit(1);
}

for (const w of result.warnings) console.log(`warning ${w.code} [${w.where}] ${w.message}`);
for (const e of result.errors) console.log(`error ${e.code} [${e.where}] ${e.message}`);
if (result.errors.length) {
  console.error(`edit: ${result.errors.length} validation error(s) — nothing written`);
  process.exit(1);
}
if (!dry) saveModel(path, result.model);
console.log(`${dry ? "dry run: would apply" : "applied"} ${batch.length} op(s); ${result.warnings.length} warning(s)`);
