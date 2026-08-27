import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDeployables } from "../detect.js";

// detect is pure, so fixtures are in-memory FileEntry[] — no on-disk repos needed
const pkg = (path, json) => ({ path, name: "package.json", kind: "manifest", content: JSON.stringify(json) });
const src = (path) => ({ path, name: path.slice(path.lastIndexOf("/") + 1), kind: "source", lang: "js", content: "" });
const ids = (cs) => cs.map((c) => c.id);

test("monorepo: libraries are excluded, deployables kept", () => {
  const files = [
    pkg("package.json", { name: "root", workspaces: ["packages/*"] }),
    pkg("packages/cli/package.json", { name: "cli", bin: { cli: "cli.js" } }),
    pkg("packages/lib/package.json", { name: "lib" }), // no bin -> a library
    src("packages/cli/index.js"), src("packages/lib/index.js"),
  ];
  assert.deepEqual(ids(detectDeployables(files)), ["pkg-cli"]);
});

test("a Dockerfile is a deployability signal on its own", () => {
  const files = [
    pkg("svc/package.json", { name: "svc" }),
    { path: "svc/Dockerfile", name: "Dockerfile", kind: "manifest", content: "FROM node" },
    src("svc/main.js"),
  ];
  const [c] = detectDeployables(files);
  assert.equal(c.id, "pkg-svc");
  assert.deepEqual(c.signals, ["dockerfile"]);
});

// A directory CONVENTION, not a true deployability check — over-detection here is the
// agent-fixable kind, and each immediate subdirectory is its own candidate.
test("apps/* enumerates each subdirectory, not the parent", () => {
  const files = [src("apps/web/index.js"), src("apps/api/index.js"), src("apps/web/util.js")];
  assert.deepEqual(ids(detectDeployables(files)), ["pkg-api", "pkg-web"]);
});

test("polyglot: a non-JS container is detected, with lang null", () => {
  const files = [
    pkg("py/package.json", { name: "py", bin: { py: "run" } }),
    { path: "py/main.py", name: "main.py", kind: "other" },
  ];
  const [c] = detectDeployables(files);
  assert.equal(c.id, "pkg-py");
  assert.equal(c.lang, null, "no JS/TS source -> ungroundable, will be undrilled");
});

// the single-package archetype yields exactly ONE container — the whole repo is the deployable.
test("single-package repo yields one container, named from the manifest", () => {
  const files = [pkg("package.json", { name: "solo", bin: { solo: "x.js" } }), src("index.js")];
  const [c] = detectDeployables(files);
  assert.equal(c.id, "pkg-solo");
  assert.equal(c.path, "");
  assert.deepEqual(c.signals, ["bin"]);
});

// a framework app has no bin, Dockerfile, or apps/ prefix — only a start script.
test("a start or serve script is a deployability signal", () => {
  const app = [pkg("package.json", { name: "web", scripts: { dev: "next dev", build: "next build", start: "next start" } }), src("app/page.js")];
  assert.deepEqual(detectDeployables(app).map((c) => c.id), ["pkg-web"]);

  const lib = [pkg("package.json", { name: "lib", scripts: { test: "node --test", build: "tsc" } }), src("index.js")];
  assert.deepEqual(detectDeployables(lib), [], "build/test scripts are not deployability");
});

test("output is ordered by repo-relative path, a total order", () => {
  const mk = (d) => pkg(`${d}/package.json`, { name: d, bin: { x: "y" } });
  const files = [mk("z"), mk("a"), mk("m")];
  assert.deepEqual(ids(detectDeployables(files)), ["pkg-a", "pkg-m", "pkg-z"]);
});

test("an unparseable package.json does not crash detection", () => {
  const files = [{ path: "bad/package.json", name: "package.json", kind: "manifest", content: "{not json" }];
  assert.deepEqual(detectDeployables(files), []);
});
