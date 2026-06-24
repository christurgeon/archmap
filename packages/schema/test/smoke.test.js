import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS } from "../index.js";

test("schema exports KINDS", () => {
  assert.ok(Array.isArray(KINDS));
  assert.ok(KINDS.includes("component"));
});
