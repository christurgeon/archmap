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
