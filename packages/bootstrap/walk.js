import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { langForPath } from "@archmap/resolve/grammar";
import { parseIgnore } from "@archmap/resolve/ignore";
import { isTestPath } from "@archmap/resolve/repo-files";

// The only module here that reads disk. Like resolve's source-only walker, but also
// collects manifests (package.json, Dockerfile); same skip discipline keeps the two in sync.
const ALWAYS_SKIP = new Set([".git", "node_modules"]);
const MANIFESTS = new Set([
  "package.json", "Dockerfile", "Containerfile",
  "lerna.json", "nx.json", "turbo.json", "pnpm-workspace.yaml",
]);

export function walkRepo(root) {
  const ignoreFile = join(root, ".gitignore");
  const ig = parseIgnore(existsSync(ignoreFile) ? readFileSync(ignoreFile, "utf8") : "");
  const out = [];

  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) { // sorted -> a total order, so output is deterministic
      if (name.startsWith(".") || ALWAYS_SKIP.has(name)) continue;
      const abs = join(dir, name);
      const rel = relative(root, abs).split(sep).join("/");
      if (ig.ignores(rel)) continue;

      const st = statSync(abs);
      if (st.isDirectory()) { walk(abs); continue; }

      const lang = langForPath(name);
      if (MANIFESTS.has(name)) {
        out.push({ path: rel, name, kind: "manifest", content: readFileSync(abs, "utf8") });
      } else if (lang && !rel.endsWith(".d.ts") && !isTestPath(rel)) {
        // tests are excluded from `source` for the same reason resolve excludes them: they
        // import everything and duplicate FQNs, and this index is what grounding resolves against
        out.push({ path: rel, name, kind: "source", lang, content: readFileSync(abs, "utf8") });
      } else {
        out.push({ path: rel, name, kind: "other" });
      }
    }
  };
  walk(root);
  return out;
}
