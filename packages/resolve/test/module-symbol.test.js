import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSymbols, MODULE_FQN } from "../extract.js";

const mod = (syms) => syms.find((s) => s.fqn === MODULE_FQN);

// Composition roots (CLI entry, main(), DI wiring) are top-level statements, not declarations
// — measured on this repo, render.mjs/validate.mjs/resolve.mjs extracted zero without this.
test("a file of top-level statements yields a module symbol", async () => {
  const src = `
import { validate } from "./index.js";
const model = load();
if (validate(model).errors.length) process.exit(1);
`;
  const syms = await extractSymbols(src, "js");
  const m = mod(syms);
  assert.ok(m, "module symbol emitted");
  assert.equal(m.kind, "module");
  assert.ok(m.bodyHash, "module carries a bodyHash");
  assert.equal(m.sigHash, null);
});

test("the module hash covers wiring, and ignores declaration bodies", async () => {
  const wiring = (call) => `import { a } from "./a.js";\n${call}\n`;
  const h1 = mod(await extractSymbols(wiring("a(1);"), "js")).bodyHash;
  const h2 = mod(await extractSymbols(wiring("a(1);"), "js")).bodyHash;
  const h3 = mod(await extractSymbols(wiring("b(1);"), "js")).bodyHash;
  assert.equal(h1, h2, "stable for identical wiring");
  assert.notEqual(h1, h3, "changing the wiring changes the hash");

  // A function body edit is node-level drift already; the module hash must ignore it
  // or every edit trips every edge in the file.
  const withDecl = (body) => `import { a } from "./a.js";\nexport function f(){ ${body} }\na(1);\n`;
  assert.equal(
    mod(await extractSymbols(withDecl("return 1;"), "js")).bodyHash,
    mod(await extractSymbols(withDecl("return 2;"), "js")).bodyHash,
    "declaration bodies are excluded from the module hash",
  );
});

test("removing an import changes the module hash — that IS the edge change", async () => {
  const a = await extractSymbols(`import { x } from "./x.js";\nrun();\n`, "js");
  const b = await extractSymbols(`run();\n`, "js");
  assert.notEqual(mod(a).bodyHash, mod(b).bodyHash);
});

test("a file with only declarations gets no module symbol", async () => {
  const syms = await extractSymbols(`export function f(){ return 1; }\n`, "js");
  assert.equal(mod(syms), undefined, "nothing was wired, so there is nothing to anchor");
  assert.deepEqual(syms.map((s) => s.fqn), ["f"]);
});

test("declarations are still extracted alongside the module symbol", async () => {
  const syms = await extractSymbols(`import { a } from "./a.js";\nexport function f(){}\na();\n`, "js");
  assert.deepEqual(syms.map((s) => s.fqn).sort(), [MODULE_FQN, "f"].sort());
});

test("module symbols span lines from first to last wiring statement", async () => {
  const m = mod(await extractSymbols(`import { a } from "./a.js";\n\na();\n`, "js"));
  assert.equal(m.startLine, 1);
  assert.equal(m.endLine, 3);
});
