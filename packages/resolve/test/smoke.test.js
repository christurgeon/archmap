import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

test("prebuilt grammar wasm files are present (no native build needed)", () => {
  const require = createRequire(import.meta.url);
  const js = require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm");
  const ts = require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm");
  assert.ok(existsSync(js), "js grammar wasm present");
  assert.ok(existsSync(ts), "ts grammar wasm present");
});
