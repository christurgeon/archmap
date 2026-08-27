// Pure. Detects DEPLOYABILITY, not directories — a library with no entry point gets no box.
// Over-detection is agent-fixable; silent invention is not.
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
// apps/ is still flagged, weaker than the other two on purpose.
function signalsFor(dir, files) {
  const at = (name) => files.find((f) => f.kind === "manifest" && f.name === name && dirOf(f.path) === dir);
  const out = [];
  const pkg = at("package.json");
  if (pkg) {
    const j = readJson(pkg);
    if (j && j.bin) out.push("bin");
    // A start/serve script signals a long-running deployable; build/test scripts don't —
    // e.g. a Next.js app has no bin, Dockerfile, or apps/ prefix, only a start script.
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
    // enumerate each immediate subdirectory of apps/ or services/ as its own candidate
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
    if (!signals.length) continue;           // a library: omitted from L2
    // The root can be a container: in a single-package repo the whole repo IS the deployable.
    // The system still wraps it — a C4 system with one container is correct, not redundant.
    const seg = dir === "" ? rootName(files) : lastSeg(dir);
    out.push({
      id: "pkg-" + slug(seg),
      name: seg,
      path: dir,
      lang: langOf(dir),
      signals,
    });
  }
  // total order by repo-relative path -- stability alone is not a determinism guarantee
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export { slug, lastSeg };
