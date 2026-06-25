export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function poly(points) {
  return points.map((p) => `${p[0]},${p[1]}`).join(" ");
}

// Per-view marker id: inactive views are display:none, and a url(#id) reference
// to a marker in another (non-rendered) <svg> is unreliable, so each view owns
// its own marker. Derive a stable, id-safe suffix from the view identity.
function markerId(view) {
  const base = view.focusId != null ? view.focusId : `root-${view.axis}`;
  return `arw-${String(base).replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export function renderViewSvg(view) {
  const out = [];
  const mid = markerId(view);
  out.push(`<svg class="amview" viewBox="0 0 ${view.width} ${view.height}" width="${view.width}" height="${view.height}" xmlns="http://www.w3.org/2000/svg">`);
  // Arrowhead. No fill attribute — var() doesn't resolve in presentation
  // attributes, so the colour comes from CSS (.amview marker path). userSpaceOnUse
  // keeps it a fixed size; refX at the tip lets it kiss the target box's top edge.
  out.push(`<defs><marker id="${mid}" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M1,1 L8,4.5 L1,8 Z" /></marker></defs>`);

  for (const e of view.edges) {
    out.push(`<polyline class="amedge" data-from="${esc(e.from)}" data-to="${esc(e.to)}" points="${poly(e.points)}" fill="none" marker-end="url(#${mid})" />`);
  }

  for (const b of view.boxes) {
    const n = b.node;
    const cls = ["ambox", `kind-${n.kind}`, n.kind === "external" ? "external" : "", b.hasChildren ? "drillable" : "leaf"]
      .filter(Boolean).join(" ");
    const sub = esc(n.kind + (n.tech ? " · " + n.tech : ""));
    out.push(`<g class="${cls}" data-id="${esc(n.id)}" transform="translate(${b.x},${b.y})">`);
    out.push(`<rect class="amrect" width="${b.w}" height="${b.h}" rx="6" />`);
    // Left-rail kind accent (filled per-kind via CSS): a full-height category
    // stripe, inset clear of the rounded corners, so kind reads at a glance on
    // leaf boxes too — not just the kind-coloured border of drillable ones.
    out.push(`<rect class="amrail" x="8" y="8" width="4" height="${b.h - 16}" rx="2" />`);
    out.push(`<text class="amname" x="${b.w / 2}" y="27" text-anchor="middle">${esc(n.name)}</text>`);
    out.push(`<text class="amsub" x="${b.w / 2}" y="47" text-anchor="middle">${sub}</text>`);
    out.push(`</g>`);
  }

  for (const e of view.edges) {
    if (!e.label) continue;
    // Prefer the deconflicted geometry from layout; fall back to the segment
    // midpoint for callers that don't compute label placement.
    const lx = e.lx != null ? e.lx : (e.points[1][0] + e.points[2][0]) / 2;
    const ly = e.ly != null ? e.ly : e.points[1][1];
    const halfW = e.lw != null ? e.lw / 2 : e.label.length * 3.4 + 6;
    out.push(`<g class="amlabel" data-from="${esc(e.from)}" data-to="${esc(e.to)}">`);
    out.push(`<rect x="${lx - halfW}" y="${ly - 9}" width="${halfW * 2}" height="18" rx="3" />`);
    out.push(`<text x="${lx}" y="${ly + 3}" text-anchor="middle">${esc(e.label)}</text>`);
    out.push(`</g>`);
  }

  out.push(`</svg>`);
  return out.join("");
}
