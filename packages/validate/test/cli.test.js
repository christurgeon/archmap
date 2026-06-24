import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../validate.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url)); // resolve @archmap/* from root node_modules

function run(model) {
  const dir = mkdtempSync(join(tmpdir(), "amval-"));
  const file = join(dir, "model.json");
  writeFileSync(file, JSON.stringify(model));
  try {
    const out = execFileSync("node", [cli, file], { encoding: "utf8", cwd: repoRoot });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

test("CLI exits 0 on a clean model", () => {
  const m = { meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "sys", name: "Sys", kind: "system", parent: null, axis: "logical" }], edges: [], mappings: [] };
  assert.equal(run(m).code, 0);
});

test("CLI exits 1 and reports the error code on an invalid model", () => {
  const m = { meta: { name: "x", version: "1", snapshot: "s" },
    nodes: [{ id: "h", name: "H", kind: "component", parent: null, axis: "logical" }], edges: [], mappings: [] };
  const r = run(m);
  assert.equal(r.code, 1);
  assert.match(r.out, /GROUNDABLE_UNANCHORED/);
});
