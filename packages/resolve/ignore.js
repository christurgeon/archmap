// A deliberately small .gitignore subset. Reusing it (not a hardcoded list or config knob)
// works because the repo's own .gitignore is reviewed like any diff and is correct per-repo;
// a hardcoded list gets `lib/` wrong across repos, and a config knob stays untuned.
//
// Supported: comments, blank lines, `dir/`, leading `/` anchor, `*`, `**`, `?`, `!` negation
// (last-match-wins). NOT supported: character classes, escapes, nested .gitignore files —
// those simply fail to match, so the index only ever sees MORE than git would, never less.

function toRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` spans zero or more directories; a bare `**` spans anything
        if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
      } else {
        re += "[^/]*"; // a single star never crosses a separator
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return re;
}

function compile(line) {
  let pattern = line;
  let negated = false;
  if (pattern.startsWith("!")) { negated = true; pattern = pattern.slice(1); }

  const dirOnly = pattern.endsWith("/");
  if (dirOnly) pattern = pattern.slice(0, -1);

  // A pattern containing a slash (other than a trailing one) is anchored to the root;
  // a bare name matches at any depth. This is git's rule.
  const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
  if (pattern.startsWith("/")) pattern = pattern.slice(1);

  const body = toRegExp(pattern);
  const prefix = anchored ? "^" : "^(?:.*/)?";
  // Match the path itself, or anything beneath it (a matched directory excludes its subtree).
  const re = new RegExp(`${prefix}${body}(?:/.*)?$`);
  return { re, negated, dirOnly };
}

export function parseIgnore(text) {
  const rules = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map(compile);

  return {
    ignores(relPath) {
      let ignored = false;
      // Last matching rule wins, so a later `!pattern` can re-include.
      for (const r of rules) {
        if (r.re.test(relPath)) ignored = !r.negated;
      }
      return ignored;
    },
  };
}
