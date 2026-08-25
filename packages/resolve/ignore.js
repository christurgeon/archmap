// A deliberately small .gitignore subset, used to decide what the symbol index may see.
//
// Why gitignore rather than a config knob or a hardcoded list: the repo already states
// which paths are generated, that statement is reviewed like any other diff, and it is
// correct by construction per-repo. A hardcoded list gets `lib/` wrong (source in one repo,
// build output in the next); a config knob stays untuned until it burns someone.
//
// Supported: comments, blank lines, `dir/`, leading `/` anchoring, `*` (within a segment),
// `**` (spanning segments), `?`, and `!` negation with last-match-wins.
// NOT supported: character classes, escapes, nested .gitignore files. Anything unsupported
// simply fails to match, so the index sees MORE than git would — never less. That direction
// is the safe one: extra files are visible and countable, missing files are silent.

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
