import { Parser, Language } from "web-tree-sitter";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const WASM = {
  js: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  ts: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
};

const EXT = {
  ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "js",
  ".ts": "ts", ".mts": "ts", ".cts": "ts",
  ".tsx": "tsx",
};

export function langForPath(path) {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT[path.slice(dot).toLowerCase()] ?? null;
}

let initPromise = null;
const languages = new Map();
const parsers = new Map();

async function ensureInit() {
  if (!initPromise) initPromise = Parser.init();
  await initPromise;
}

export async function getLanguage(lang) {
  if (!WASM[lang]) throw new Error(`unsupported lang: ${lang}`);
  if (!languages.has(lang)) {
    await ensureInit();
    // Buffer-load: passing a path triggers a fs/promises dynamic-require failure in the 0.25 ESM build.
    const bytes = new Uint8Array(readFileSync(require.resolve(WASM[lang])));
    languages.set(lang, await Language.load(bytes));
  }
  return languages.get(lang);
}

export async function getParser(lang) {
  if (!parsers.has(lang)) {
    const language = await getLanguage(lang);
    const parser = new Parser();
    parser.setLanguage(language);
    parsers.set(lang, parser);
  }
  return parsers.get(lang);
}
