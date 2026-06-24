#!/usr/bin/env node
import { loadModel } from "@archmap/schema";
import { validate } from "./index.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: validate <model.json>");
  process.exit(2);
}

const model = loadModel(path);
const { errors, warnings } = validate(model);

for (const w of warnings) console.log(`warning ${w.code} [${w.where}] ${w.message}`);
for (const e of errors) console.log(`error ${e.code} [${e.where}] ${e.message}`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);

process.exit(errors.length > 0 ? 1 : 0);
