import { test } from "node:test";
import assert from "node:assert/strict";
import { walkSourceFiles } from "../repo-files.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("walkSourceFiles skips node_modules/.git/dotdirs, filters by lang, yields posix relative paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "amwalk-"));
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  mkdirSync(join(dir, "src", "sub"), { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "poison.js"), "export function poison(){}");
  writeFileSync(join(dir, ".git", "x.js"), "export function git(){}");
  writeFileSync(join(dir, "keep.js"), "export function keep(){}");
  writeFileSync(join(dir, "src", "sub", "deep.ts"), "export function deep(){}");
  writeFileSync(join(dir, "notes.md"), "# not code");
  const paths = walkSourceFiles(dir).map((f) => f.path).sort();
  assert.deepEqual(paths, ["keep.js", "src/sub/deep.ts"]);
});

test("walkSourceFiles is deterministic (sorted output)", () => {
  const dir = mkdtempSync(join(tmpdir(), "amwalk2-"));
  writeFileSync(join(dir, "b.js"), "export function b(){}");
  writeFileSync(join(dir, "a.js"), "export function a(){}");
  assert.deepEqual(walkSourceFiles(dir).map((f) => f.path), ["a.js", "b.js"]);
});

test("gitignore adds exclusions on top of the floor; tests and .d.ts are excluded", () => {
  const dir = mkdtempSync(join(tmpdir(), "amwalk3-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  mkdirSync(join(dir, "src", "__tests__"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "dist/\n");
  writeFileSync(join(dir, "dist", "bundle.js"), "export function Vr(){}");
  writeFileSync(join(dir, "src", "keep.ts"), "export function keep(){}");
  writeFileSync(join(dir, "src", "keep.d.ts"), "export declare function keep(): void;");
  writeFileSync(join(dir, "src", "keep.test.ts"), "export function t(){}");
  writeFileSync(join(dir, "src", "__tests__", "x.ts"), "export function x(){}");

  const files = walkSourceFiles(dir);
  assert.deepEqual(files.map((f) => f.path), ["src/keep.ts"]);
  assert.equal(files.skipped.ignored, 1, "the dist/ directory, counted once");
  assert.equal(files.skipped.declarations, 1, "keep.d.ts");
  assert.equal(files.skipped.tests, 2, "keep.test.ts + __tests__/x.ts");
});

test("includeTests re-admits test files", () => {
  const dir = mkdtempSync(join(tmpdir(), "amwalk4-"));
  writeFileSync(join(dir, "a.js"), "export function a(){}");
  writeFileSync(join(dir, "a.test.js"), "export function t(){}");
  assert.equal(walkSourceFiles(dir).length, 1);
  assert.equal(walkSourceFiles(dir, { includeTests: true }).length, 2);
});
