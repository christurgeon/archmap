import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSymbols } from "../extract.js";

const flags = async (src) => {
  const syms = await extractSymbols(src, "js");
  return Object.fromEntries(syms.filter((s) => s.fqn !== "<module>").map((s) => [s.fqn, s.exported]));
};

test("inline export forms are flagged", async () => {
  assert.deepEqual(
    await flags("export function a(){}\nexport const b = () => {};\nexport class C {}\n"),
    { a: true, b: true, C: true },
  );
});

test("private helpers are not flagged", async () => {
  assert.deepEqual(await flags(`function helper(){}\nexport function pub(){}\n`), { helper: false, pub: true });
});

test("export-clause marks the declaration", async () => {
  assert.deepEqual(await flags(`function a(){}\nfunction b(){}\nexport { a };\n`), { a: true, b: false });
});

// recorded under the EXPORTED name, not the local binding
test("renamed export-clause is recorded under the exported name", async () => {
  const f = await flags(`function a(){}\nexport { a as b };\n`);
  assert.equal(f.b, true, "exported name present");
  assert.equal("a" in f, false, "local binding not indexed separately");
});

test("named default export is flagged", async () => {
  assert.deepEqual(await flags(`export default function foo(){}\n`), { foo: true });
});

// Deliberately NOT detected in v1 — pins the boundary so it is intentional, not drift
test("anonymous default and CJS are not flagged (conservative)", async () => {
  assert.deepEqual(await flags(`const x = () => {};\nexport default x;\n`), { x: false });
  assert.deepEqual(await flags(`function a(){}\nmodule.exports = { a };\n`), { a: false });
});

test("the exported flag does not disturb existing fields", async () => {
  const [s] = await extractSymbols(`export function f(a,b){ return 1; }\n`, "js");
  assert.equal(s.fqn, "f");
  assert.equal(s.kind, "fn");
  assert.ok(s.bodyHash && s.sigHash);
});
