#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { loadModel } from "@archmap/schema";
import { validate } from "@archmap/validate";
import { render } from "./index.js";

const path = process.argv[2];
const out = process.argv[3] ?? "archmap.html";
if (!path) {
  console.error("usage: render <model.json> [out.html]");
  process.exit(2);
}

const model = loadModel(path);
const { errors } = validate(model);
if (errors.length > 0) {
  for (const e of errors) console.error(`error ${e.code} [${e.where}] ${e.message}`);
  console.error(`refusing to render: ${errors.length} validation error(s)`);
  process.exit(1);
}

writeFileSync(out, render(model));
console.log(`wrote ${out}`);
