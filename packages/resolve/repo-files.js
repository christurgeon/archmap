import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { langForPath } from "./grammar.js";
import { parseIgnore } from "./ignore.js";

// The prior floor, kept intact: `.git` is never gitignored, `node_modules` is not always,
// and dotdirs hid a lot of build output for free (`.next/`, `.nuxt/`). .gitignore ADDS to
// this, it never relaxes it — so this change can only ever exclude more, never less.
const ALWAYS_SKIP = new Set([".git", "node_modules"]);

// Tests are TRACKED, so .gitignore cannot express them — this is the one exclusion that must
// be convention. Test files import everything they touch, which would bury the signal and
// (worse) duplicate FQNs into AMBIGUOUS. Reported, never silent.
const TEST_PATTERNS = [
  /(^|\/)__tests__\//, /(^|\/)__mocks__\//, /(^|\/)tests?\//, /(^|\/)e2e\//,
  /\.test\.[cm]?[jt]sx?$/, /\.spec\.[cm]?[jt]sx?$/,
];

export function isTestPath(relPath) {
  return TEST_PATTERNS.some((re) => re.test(relPath));
}

// Declaration files carry no calls and only manufacture FQN collisions against the .ts
// they describe (measured: a repo shipping dist/*.d.ts indexes every symbol three times).
function isDeclaration(relPath) {
  return relPath.endsWith(".d.ts");
}

export function walkSourceFiles(root, opts = {}) {
  const includeTests = opts.includeTests ?? false;
  const ignoreFile = join(root, ".gitignore");
  const ig = parseIgnore(existsSync(ignoreFile) ? readFileSync(ignoreFile, "utf8") : "");

  const out = [];
  const skipped = { ignored: 0, tests: 0, declarations: 0 };

  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) { // sorted -> deterministic index order across machines
      if (name.startsWith(".") || ALWAYS_SKIP.has(name)) continue;
      const abs = join(dir, name);
      const rel = relative(root, abs).split(sep).join("/");
      const st = statSync(abs);

      // Counts ENTRIES, not files: an ignored directory counts once and is not descended
      // into (descending purely to count would defeat the point of excluding it).
      if (ig.ignores(rel)) { skipped.ignored++; continue; }

      if (st.isDirectory()) { walk(abs); continue; }

      if (!langForPath(name)) continue;
      if (isDeclaration(rel)) { skipped.declarations++; continue; }
      if (!includeTests && isTestPath(rel)) { skipped.tests++; continue; }

      out.push({ path: rel, lang: langForPath(name), source: readFileSync(abs, "utf8") });
    }
  };
  walk(root);

  // Attached, not logged: what the index could not see is part of the result, so a caller
  // can report blindness rather than let it read as health.
  Object.defineProperty(out, "skipped", { value: skipped, enumerable: false });
  return out;
}
