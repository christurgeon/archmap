// Pure (§5). Detects DEPLOYABILITY, not directories: a C4 container is a deployable/runnable
// unit, so a library that ships no entry point does not get a box. The agent promotes one
// later if it earns it — over-detection is agent-fixable, silent invention is not.
const WORKSPACE_MANIFESTS = ["lerna.json", "nx.json", "turbo.json"];

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const lastSeg = (p) => (p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p);

function readJson(entry) {
  try { return JSON.parse(entry.content); } catch { return null; }
}

// Signal 3 is a directory CONVENTION, not a deployability check — a library nested under
// apps/ is still flagged. Weaker than the other two on purpose (§6).
function signalsFor(dir, files) {
  const at = (name) => files.find((f) => f.kind === "manifest" && f.name === name && dirOf(f.path) === dir);
  const out = [];
  const pkg = at("package.json");
  if (pkg) {
    const j = readJson(pkg);
    if (j && j.bin) out.push("bin");
    // A long-running entry point is a deployability signal. Added in v1 because the three
    // original signals demonstrably do NOT carry the single-app archetype §6 claims they do:
    // a Next.js app has no bin, no Dockerfile and no apps/ prefix — it has a start script.
    // Measured: without this, the most common repo shape yields a one-node model.
    const scripts = (j && j.scripts) || {};
    if (scripts.start || scripts.serve) out.push("start-script");
  }
  if (at("Dockerfile") || at("Containerfile")) out.push("dockerfile");
  if (/^(apps|services)\/[^/]+$/.test(dir)) out.push("apps-convention");
  return out;
}

function rootName(files) {
  const root = files.find((f) => f.kind === "manifest" && f.path === "package.json");
  const j = root ? readJson(root) : null;
  return (j && j.name) || "app";
}

function candidateDirs(files) {
  const dirs = new Set();
  for (const f of files) {
    if (f.kind === "manifest" && (f.name === "package.json" || f.name === "Dockerfile" || f.name === "Containerfile")) {
      dirs.add(dirOf(f.path));
    }
    // enumerate each immediate subdirectory of apps/ or services/ as its own candidate (§6)
    const m = f.path.match(/^((?:apps|services)\/[^/]+)\//);
    if (m) dirs.add(m[1]);
  }
  return [...dirs].sort();
}

export function detectDeployables(files) {
  const langOf = (dir) => {
    const src = files.filter((f) => f.kind === "source" && (dir === "" || f.path.startsWith(dir + "/")));
    return src.length ? src[0].lang : null;
  };

  const out = [];
  for (const dir of candidateDirs(files)) {
    const signals = signalsFor(dir, files);
    if (!signals.length) continue;           // a library: omitted from L2 (§6)
    // The root CAN be a container: in a single-package repo the whole repo is the deployable,
    // and §13.3 expects exactly one container for that archetype. The system still wraps it —
    // a C4 system containing one container is the correct shape, not a redundancy.
    const seg = dir === "" ? rootName(files) : lastSeg(dir);
    out.push({
      id: "pkg-" + slug(seg),
      name: seg,
      path: dir,
      lang: langOf(dir),
      signals,
    });
  }
  // total order by repo-relative path -- stability alone is not a determinism guarantee (§8)
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export { slug, lastSeg };
