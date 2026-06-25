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

export function renderViewSvg(view) {
  const out = [];
  out.push(`<svg class="amview" viewBox="0 0 ${view.width} ${view.height}" width="${view.width}" height="${view.height}" xmlns="http://www.w3.org/2000/svg">`);

  for (const e of view.edges) {
    out.push(`<polyline class="amedge" data-from="${esc(e.from)}" data-to="${esc(e.to)}" points="${poly(e.points)}" fill="none" />`);
  }

  for (const b of view.boxes) {
    const n = b.node;
    const cls = ["ambox", `kind-${n.kind}`, n.kind === "external" ? "external" : "", b.hasChildren ? "drillable" : "leaf"]
      .filter(Boolean).join(" ");
    const sub = esc(n.kind + (n.tech ? " · " + n.tech : ""));
    out.push(`<g class="${cls}" data-id="${esc(n.id)}" transform="translate(${b.x},${b.y})">`);
    out.push(`<rect width="${b.w}" height="${b.h}" rx="6" />`);
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
