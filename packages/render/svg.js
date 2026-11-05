import { nameFits } from "./layout.js";

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Orthogonal polyline -> path with small rounded bends; bends are where a reader loses an
// edge, and a sharp corner at a junction looks like a T into another line.
export function edgePath(points, radius = 6) {
  if (!points.length) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (i === points.length - 1) { d += ` L${p[0]},${p[1]}`; break; }
    const a = points[i - 1], c = points[i + 1];
    const r = Math.min(radius, Math.hypot(p[0] - a[0], p[1] - a[1]) / 2, Math.hypot(c[0] - p[0], c[1] - p[1]) / 2);
    const ux = Math.sign(p[0] - a[0]), uy = Math.sign(p[1] - a[1]);
    const vx = Math.sign(c[0] - p[0]), vy = Math.sign(c[1] - p[1]);
    const r2 = (v) => Math.round(v * 10) / 10;
    d += ` L${r2(p[0] - ux * r)},${r2(p[1] - uy * r)} Q${p[0]},${p[1]} ${r2(p[0] + vx * r)},${r2(p[1] + vy * r)}`;
  }
  return d;
}

// Per-view marker id: inactive views are display:none, and a url(#id) reference
// to a marker in another (non-rendered) <svg> is unreliable, so each view owns
// its own marker. Derive a stable, id-safe suffix from the view identity.
function markerId(view) {
  const base = view.focusId != null ? view.focusId : `root-${view.axis}`;
  return `arw-${String(base).replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function firstSentence(s) {
  const m = String(s ?? "").match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : String(s ?? "")).trim();
}

function edgeTitle(e, names) {
  const head = `${names.get(e.from) ?? e.from} → ${names.get(e.to) ?? e.to}`;
  const ls = e.labels && e.labels.length ? e.labels : (e.label ? [e.label] : []);
  const n = e.count > 1 ? ` (${e.count} relationships)` : "";
  return ls.length ? `${head}${n}: ${ls.join(", ")}` : head + n;
}

export function renderViewSvg(view) {
  const out = [];
  const mid = markerId(view);
  const names = new Map(view.boxes.map((b) => [b.id, b.node.name]));
  out.push(`<svg class="amview" viewBox="0 0 ${view.width} ${view.height}" width="${view.width}" height="${view.height}" xmlns="http://www.w3.org/2000/svg">`);
  // Arrowhead. No fill attribute — var() doesn't resolve in presentation
  // attributes, so the colour comes from CSS (.amview marker path). userSpaceOnUse
  // keeps it a fixed size; refX at the tip lets it kiss the target box's edge.
  out.push(`<defs><marker id="${mid}" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M1,1 L8,4.5 L1,8 Z" /></marker></defs>`);

  for (const e of view.edges) {
    // `uncited` is a pure function of authored data (does the edge carry a citation),
    // never of resolution state — that is computed at check time and deliberately not
    // stored in the model, so render output stays byte-stable across resolve runs.
    const cls = e.cited === false ? "amedge uncited" : "amedge";
    const d = edgePath(e.points);
    const attrs = `data-from="${esc(e.from)}" data-to="${esc(e.to)}"`;
    out.push(`<path class="${cls}" ${attrs} d="${d}" marker-end="url(#${mid})" />`);
    // A wide transparent twin: a 1.5px line is too thin to hover reliably.
    out.push(`<path class="amhit" ${attrs} d="${d}"><title>${esc(edgeTitle(e, names))}</title></path>`);
  }

  for (const b of view.boxes) {
    const n = b.node;
    const cls = ["ambox", `kind-${n.kind}`, n.kind === "external" ? "external" : "", b.hasChildren ? "drillable" : "leaf"]
      .filter(Boolean).join(" ");
    const sub = esc(n.kind + (n.tech ? " · " + n.tech : ""));
    const fit = nameFits(n, b.w, { drillable: b.hasChildren });
    const name = String(n.name ?? "");
    const shown = name.length > fit ? name.slice(0, Math.max(1, fit - 1)) + "…" : name;
    // Text centres in the area right of the rail (and left of the drill badge).
    const tx = (16 + b.w - (b.hasChildren ? 26 : 0)) / 2 + 2;
    const tip = [name, firstSentence(n.blurb)].filter(Boolean).join(" — ");
    out.push(`<g class="${cls}" data-id="${esc(n.id)}" transform="translate(${b.x},${b.y})">`);
    out.push(`<title>${esc(tip)}${b.hasChildren ? esc(` (click to open · ${b.childCount} inside)`) : ""}</title>`);
    out.push(`<rect class="amrect" width="${b.w}" height="${b.h}" rx="6" />`);
    // Left-rail kind accent: a full-height stripe, inset clear of the rounded corners,
    // so kind reads at a glance on leaf boxes too — not just drillable ones' border.
    out.push(`<rect class="amrail" x="8" y="8" width="4" height="${b.h - 16}" rx="2" />`);
    out.push(`<text class="amname" x="${tx}" y="27" text-anchor="middle">${esc(shown)}</text>`);
    out.push(`<text class="amsub" x="${tx}" y="47" text-anchor="middle">${sub}</text>`);
    if (b.hasChildren) {
      // Drill affordance: how much is inside, so nobody has to click to find out.
      out.push(`<g class="amdrill" transform="translate(${b.w - 22},${b.h / 2})"><rect x="-6" y="-10" width="22" height="20" rx="10" /><text x="5" y="4" text-anchor="middle">${b.childCount}</text></g>`);
    }
    out.push(`</g>`);
  }

  for (const e of view.edges) {
    if (!e.label) continue;
    // Prefer the deconflicted geometry from layout; fall back to the first segment's
    // midpoint for callers that don't compute label placement.
    const p = e.points, q = p.length > 1 ? 1 : 0;
    const lx = e.lx != null ? e.lx : (p[0][0] + p[q][0]) / 2;
    const ly = e.ly != null ? e.ly : (p[0][1] + p[q][1]) / 2;
    const halfW = e.lw != null ? e.lw / 2 : e.label.length * 3.4 + 6;
    out.push(`<g class="amlabel" data-from="${esc(e.from)}" data-to="${esc(e.to)}">`);
    out.push(`<title>${esc(edgeTitle(e, names))}</title>`);
    out.push(`<rect x="${lx - halfW}" y="${ly - 9}" width="${halfW * 2}" height="18" rx="3" />`);
    out.push(`<text x="${lx}" y="${ly + 3}" text-anchor="middle">${esc(e.label)}</text>`);
    out.push(`</g>`);
  }

  out.push(`</svg>`);
  return out.join("");
}
