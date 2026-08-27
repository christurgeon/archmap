#!/usr/bin/env node
import { existsSync, writeFileSync, unlinkSync, renameSync, copyFileSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath, dirname, basename, relative, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildIndex } from "@archmap/resolve/symbol-index";
import { walkRepo } from "./walk.js";
import { detectDeployables, slug } from "./detect.js";
import { groundContainer } from "./ground.js";
import { assemble } from "./assemble.js";

// The CLI owns every side effect (§5): disk writes, subprocesses, and reading git.
const here = dirname(fileURLToPath(import.meta.url));
const VALIDATE = resolvePath(here, "../validate/validate.mjs");
const RESOLVE = resolvePath(here, "../resolve/resolve.mjs");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--snapshot");

const targetArg = positional[0];
if (!targetArg) {
  console.error("usage: bootstrap <target-repo> [out] [--snapshot YYYY-MM-DD] [--force]");
  process.exit(2);
}
const targetRoot = resolvePath(targetArg);
if (!existsSync(targetRoot)) { console.error(`bootstrap: no such directory: ${targetRoot}`); process.exit(2); }

// Default out INSIDE the target root, so resolve's repoRoot = dirname(modelPath) is correct by
// construction. An out-of-tree out would self-check green against the temp and then mis-root at
// real invocation, shipping a model that fails resolve — worse than no self-check, since it
// looks green (§9).
const out = positional[1] ? resolvePath(targetRoot, positional[1]) : join(targetRoot, "model.json");
const relOut = relative(targetRoot, out);
if (relOut.startsWith("..") || isAbsolute(relOut)) {
  console.error(`bootstrap: out must resolve inside ${targetRoot} (got ${out})`);
  process.exit(2);
}
if (existsSync(out) && !flag("--force")) {
  console.error(`bootstrap: ${out} exists — pass --force to overwrite`);
  process.exit(2);
}

function targetPkg() {
  const p = join(targetRoot, "package.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

// meta.snapshot is the ONE explicit non-content input. Never wall-clock: that would break the
// byte-identical-output guarantee, so with no git and no --snapshot we refuse rather than guess.
function snapshot() {
  const given = opt("--snapshot");
  if (given) return given;
  try {
    return execFileSync("git", ["-C", targetRoot, "log", "-1", "--format=%cs"], { encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    console.error("bootstrap: target is not a git repo — pass --snapshot YYYY-MM-DD explicitly");
    process.exit(2);
  }
}

const pkg = targetPkg();
const name = pkg.name ?? basename(targetRoot);
const files = walkRepo(targetRoot);
const index = await buildIndex(
  files.filter((f) => f.kind === "source").map((f) => ({ ...f, source: f.content })),
);
const log = (m) => console.log(`  ${m}`);
const containers = detectDeployables(files).map((c) => groundContainer(c, index, { log }));
if (!containers.length) {
  log("no deployables found — likely a single-package app or a library workspace");
}

const model = assemble({
  meta: { name, version: pkg.version ?? "0.0.0", snapshot: snapshot() },
  system: { id: slug(name), name },
  containers,
  log,
});

// Self-check against a temp file INSIDE targetRoot, so resolve roots at the right tree.
// A bootstrap bug must never ship an invalid model.
const temp = join(targetRoot, `.archmap-bootstrap-${process.pid}.json`);
writeFileSync(temp, JSON.stringify(model, null, 2) + "\n");
const cleanup = () => { try { unlinkSync(temp); } catch { /* already gone */ } };

for (const [label, cli] of [["validate", VALIDATE], ["resolve", RESOLVE]]) {
  try {
    execFileSync("node", [cli, temp], { encoding: "utf8", timeout: 120000, stdio: "pipe" });
  } catch (e) {
    console.error(`bootstrap: self-check failed at ${label} (exit ${e.status})`);
    console.error((e.stdout ?? "") + (e.stderr ?? ""));
    cleanup();
    process.exit(1);
  }
}

try {
  renameSync(temp, out);
} catch (e) {
  if (e.code !== "EXDEV") { cleanup(); throw e; }
  copyFileSync(temp, out); // different filesystem (bind mount / overlay): rename unavailable
  cleanup();
}

const comps = model.nodes.filter((n) => n.kind === "component").length;
const undr = model.nodes.filter((n) => n.grounding?.region?.anchors?.length === 0).length;
console.log(`bootstrap: wrote ${out}`);
console.log(`  ${model.nodes.length} nodes — ${containers.length} containers, ${comps} components, ${undr} undrilled`);
