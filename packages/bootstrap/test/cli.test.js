import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { walkRepo } from "../walk.js";

const cli = fileURLToPath(new URL("../bootstrap.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function run(args) {
  try {
    return { code: 0, out: execFileSync("node", [cli, ...args], { encoding: "utf8", timeout: 120000, stdio: "pipe" }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

// walk is the only library module that reads disk, so it gets the one on-disk unit test
test("walkRepo classifies sources and manifests, honours .gitignore, skips tests", () => {
  const dir = mkdtempSync(join(tmpdir(), "amboot-walk-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "dist/\n");
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "src/a.js"), "export function a(){}");
  writeFileSync(join(dir, "src/a.test.js"), "export function t(){}");
  writeFileSync(join(dir, "src/a.d.ts"), "export declare function a(): void;");
  writeFileSync(join(dir, "dist/bundle.js"), "export function Vr(){}");
  writeFileSync(join(dir, "README.md"), "# hi");

  const files = walkRepo(dir);
  const kind = (k) => files.filter((f) => f.kind === k).map((f) => f.path).sort();
  assert.deepEqual(kind("source"), ["src/a.js"], "tests, .d.ts and gitignored build output excluded");
  assert.deepEqual(kind("manifest"), ["package.json"]);
  assert.ok(kind("other").includes("README.md"));
});

function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "amboot-cli-"));
  mkdirSync(join(dir, "packages/tool"), { recursive: true });
  mkdirSync(join(dir, "packages/lib"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fix", version: "9.9.9", workspaces: ["packages/*"] }));
  writeFileSync(join(dir, "packages/tool/package.json"), JSON.stringify({ name: "tool", bin: { tool: "cli.js" } }));
  writeFileSync(join(dir, "packages/tool/index.js"), "export function go(){ return 1; }\n");
  writeFileSync(join(dir, "packages/lib/package.json"), JSON.stringify({ name: "lib" }));
  writeFileSync(join(dir, "packages/lib/index.js"), "export function helper(){ return 2; }\n");
  symlinkSync(join(repoRoot, "node_modules"), join(dir, "node_modules"));
  return dir;
}

test("CLI writes a model that passes its own self-check, and is deterministic", () => {
  const dir = fixtureRepo();
  const first = run([dir, "--snapshot", "2026-08-27"]);
  assert.equal(first.code, 0, first.out);
  const model = join(dir, "model.json");
  assert.ok(existsSync(model));

  const a = readFileSync(model, "utf8");
  assert.equal(run([dir, "--snapshot", "2026-08-27", "--force"]).code, 0);
  assert.equal(readFileSync(model, "utf8"), a, "same repo + same snapshot -> byte-identical");

  const m = JSON.parse(a);
  assert.equal(m.meta.name, "fix");
  assert.equal(m.meta.version, "9.9.9", "version comes from the target manifest");
  assert.deepEqual(m.edges, []);
  const ids = m.nodes.map((n) => n.id);
  assert.ok(ids.includes("pkg-tool"), "the bin package is a container");
  assert.equal(ids.some((i) => i.startsWith("pkg-lib")), false, "the library is omitted");
});

test("the written model independently passes validate and resolve", () => {
  const dir = fixtureRepo();
  assert.equal(run([dir, "--snapshot", "2026-08-27"]).code, 0);
  const model = join(dir, "model.json");
  const gate = (bin) => {
    try {
      execFileSync("node", [resolvePath(repoRoot, bin), model], { encoding: "utf8", timeout: 120000, stdio: "pipe" });
      return 0;
    } catch (e) { return e.status; }
  };
  assert.equal(gate("packages/validate/validate.mjs"), 0);
  assert.equal(gate("packages/resolve/resolve.mjs"), 0);
});

test("refuses to clobber without --force, and refuses an out outside the target", () => {
  const dir = fixtureRepo();
  assert.equal(run([dir, "--snapshot", "2026-08-27"]).code, 0);
  assert.equal(run([dir, "--snapshot", "2026-08-27"]).code, 2, "existing out needs --force");
  assert.equal(run([dir, "/tmp/elsewhere.json", "--snapshot", "2026-08-27", "--force"]).code, 2);
});

// A bootstrap bug must never ship an invalid model: the temp is deleted and out is untouched.
// The self-check's FAILURE branch is not reachable from a fixture: bootstrap's walk and
// resolve's walk agree on what a repo contains, and every component grounds to its exact
// file, so the path-filtered lookup always returns one. That is the property working, not a
// coverage win -- the branch fired for real during development, on a Next.js repo whose root
// container had an empty path that validate read as missing. What is asserted here is the
// surrounding guarantee: a run never leaves a temp behind, and never damages an existing model.
test("a run leaves no temp behind and never damages an existing model", () => {
  const dir = fixtureRepo();
  assert.equal(run([dir, "--snapshot", "2026-08-27"]).code, 0);
  assert.equal(readdirSync(dir).some((f) => f.startsWith(".archmap-bootstrap-")), false);

  // a refused run must leave the existing model byte-identical
  const model = join(dir, "model.json");
  const sentinel = readFileSync(model, "utf8");
  assert.equal(run([dir, "--snapshot", "2026-08-27"]).code, 2, "refuses without --force");
  assert.equal(readFileSync(model, "utf8"), sentinel, "existing model untouched");
  assert.equal(readdirSync(dir).some((f) => f.startsWith(".archmap-bootstrap-")), false);

  // and a malformed root manifest degrades rather than crashing
  const dir2 = fixtureRepo();
  writeFileSync(join(dir2, "package.json"), "{ not json");
  assert.equal(run([dir2, "--snapshot", "2026-08-27"]).code, 0);
  assert.equal(readdirSync(dir2).some((f) => f.startsWith(".archmap-bootstrap-")), false);
});
test("a target with no deployables still emits a valid system-only model", () => {
  const dir = mkdtempSync(join(tmpdir(), "amboot-empty-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "solo", version: "1.0.0" }));
  writeFileSync(join(dir, "index.js"), "export function a(){}\n");
  symlinkSync(join(repoRoot, "node_modules"), join(dir, "node_modules"));

  const r = run([dir, "--snapshot", "2026-08-27"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no deployables found/);
  const m = JSON.parse(readFileSync(join(dir, "model.json"), "utf8"));
  assert.deepEqual(m.nodes.map((n) => n.kind), ["system"]);
});

test("refuses rather than guessing when the target is not a git repo and no snapshot is given", () => {
  const dir = fixtureRepo();
  const r = run([dir]);
  assert.equal(r.code, 2);
  assert.match(r.out, /not a git repo/);
});
