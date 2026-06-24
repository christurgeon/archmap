import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../resolve.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function scratchRepo(model, files) {
  const dir = mkdtempSync(join(tmpdir(), "amres-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  for (const [rel, src] of Object.entries(files)) writeFileSync(join(dir, rel), src);
  writeFileSync(join(dir, "model.json"), JSON.stringify(model, null, 2));
  return dir;
}
function run(dir, args = []) {
  try {
    const out = execFileSync("node", [cli, join(dir, "model.json"), ...args], { encoding: "utf8", cwd: repoRoot, env: { ...process.env, ARCHMAP_NOW: "2026-06-24T00:00:00Z" } });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout ?? "") + (e.stderr ?? "") }; }
}
const model = (nodes) => ({ meta: { name: "t", version: "1", snapshot: "s" }, nodes, edges: [], mappings: [] });

test("CLEAN/UNBASELINED exit 0; --write records resolved + baseline", () => {
  const dir = scratchRepo(
    model([{ id: "h", name: "H", kind: "component", parent: null, axis: "logical",
      grounding: { repo: "r", path: "src/h.js", symbol: { fqn: "handle", kind: "fn" } } }]),
    { "src/h.js": "export function handle(a){ return a + 1; }\n" },
  );
  const r = run(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /UNBASELINED|CLEAN/);
  const w = run(dir, ["--write"]);
  assert.equal(w.code, 0);
  const m = JSON.parse(readFileSync(join(dir, "model.json"), "utf8"));
  const g = m.nodes[0].grounding;
  assert.ok(g.symbol.bodyHash, "baseline bodyHash written");
  assert.ok(g.resolved && g.resolved.path === "src/h.js");
  assert.equal(g.resolved.resolvedAt, "2026-06-24T00:00:00Z");
  assert.match(g.lines, /^\d+-\d+$/);
});

test("MISSING blocks with exit 1", () => {
  const dir = scratchRepo(
    model([{ id: "h", name: "H", kind: "component", parent: null, axis: "logical",
      grounding: { repo: "r", path: "src/h.js", symbol: { fqn: "ghost", kind: "fn", bodyHash: "ZZZ" } } }]),
    { "src/h.js": "export function other(){ return 1; }\n" },
  );
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /MISSING/);
});

test("--write never changes fqn or path on a CHANGED node", () => {
  const dir = scratchRepo(
    model([{ id: "h", name: "H", kind: "component", parent: null, axis: "logical",
      grounding: { repo: "r", path: "src/h.js", symbol: { fqn: "handle", kind: "fn", bodyHash: "STALE" } } }]),
    { "src/h.js": "export function handle(a){ return a + 999; }\n" },
  );
  const w = run(dir, ["--write"]);
  const m = JSON.parse(readFileSync(join(dir, "model.json"), "utf8"));
  assert.equal(m.nodes[0].grounding.symbol.fqn, "handle"); // unchanged
  assert.equal(m.nodes[0].grounding.path, "src/h.js");      // unchanged
  assert.equal(m.nodes[0].grounding.resolved, undefined, "CHANGED must not get resolved written (no silent re-anchor)");
  assert.match(w.out, /CHANGED/);
});

test("MOVED: symbol found at a different path — reported, path NOT auto-bumped, no resolved, exit 0", () => {
  const dir = scratchRepo(
    model([{ id: "h", name: "H", kind: "component", parent: null, axis: "logical",
      grounding: { repo: "r", path: "src/old.js", symbol: { fqn: "handle", kind: "fn", bodyHash: "B" } } }]),
    { "src/new.js": "export function handle(a){ return a + 1; }\n" }, // defined elsewhere; src/old.js absent
  );
  const w = run(dir, ["--write"]);
  assert.equal(w.code, 0); // MOVED is a queue state, not a block
  assert.match(w.out, /MOVED/);
  const m = JSON.parse(readFileSync(join(dir, "model.json"), "utf8"));
  assert.equal(m.nodes[0].grounding.path, "src/old.js");      // never auto-bumped
  assert.equal(m.nodes[0].grounding.resolved, undefined);     // MOVED is not written
});

test("AMBIGUOUS: fqn defined in two files — blocks with exit 1", () => {
  const dir = scratchRepo(
    model([{ id: "h", name: "H", kind: "component", parent: null, axis: "logical",
      grounding: { repo: "r", path: "src/none.js", symbol: { fqn: "dup", kind: "fn" } } }]),
    { "src/a.js": "export function dup(){ return 1; }\n", "src/b.js": "export function dup(){ return 2; }\n" },
  );
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /AMBIGUOUS/);
});
