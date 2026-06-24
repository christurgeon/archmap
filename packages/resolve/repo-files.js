import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { langForPath } from "./grammar.js";

const SKIP = new Set(["node_modules", ".git", ".superpowers"]);

export function walkSourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) { // sorted -> deterministic index order across machines
      if (name.startsWith(".") || SKIP.has(name)) continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else {
        const lang = langForPath(name);
        if (!lang) continue;
        const rel = relative(root, abs).split(sep).join("/");
        out.push({ path: rel, lang, source: readFileSync(abs, "utf8") });
      }
    }
  };
  walk(root);
  return out;
}
