import { getNode, childrenOf, ancestorsOf, KINDS } from "@archmap/schema";
import { layoutView } from "./layout.js";
import { renderViewSvg, esc } from "./svg.js";

export function viewId(focusId, axis) {
  return focusId === null ? `__root_${axis}` : focusId;
}

export function collectViews(model) {
  const views = [];
  const axes = new Set(model.nodes.map((n) => n.axis ?? "logical"));
  if (axes.has("logical")) views.push({ focusId: null, axis: "logical" });
  if (axes.has("deploy")) views.push({ focusId: null, axis: "deploy" });
  for (const n of model.nodes) {
    if (childrenOf(model, n.id).length > 0) views.push({ focusId: n.id, axis: n.axis ?? "logical" });
  }
  return views;
}

// Two surface sets, one accent identity per kind. The agent never picks a colour
// (spec §2: colours are renderer-owned geometry); these are the renderer's.
const DARK = "--bg:#0d1219;--panel:#141b24;--box:#1a2230;--stroke:#2b3543;--ink:#e8eef5;--muted:#8b97a6;--edge:#46586b;--accent:#58a6ff;--shadow:0 1px 2px rgba(0,0,0,.45);"
  + "--k-person:#e0a458;--k-system:#8b7cf0;--k-external:#6b7685;--k-container:#3fb6ac;--k-store:#56c08d;--k-tenant:#a06cd9;--k-component:#58a6ff;--k-cloud:#e0794b;--k-network:#d9a94e;--k-infra:#b56a52;--k-workload:#8fa05a;";
const LIGHT = "--bg:#f6f8fc;--panel:#ffffff;--box:#ffffff;--stroke:#dce3ec;--ink:#1f2933;--muted:#5b6b7d;--edge:#9aa9ba;--accent:#2f7fd8;--shadow:0 1px 2px rgba(31,41,51,.12);"
  + "--k-person:#c4842c;--k-system:#6c5ce0;--k-external:#8a96a5;--k-container:#1f9b92;--k-store:#2f9e63;--k-tenant:#8a4fc0;--k-component:#2f7fd8;--k-cloud:#cf6a3a;--k-network:#bf8d2e;--k-infra:#9e5640;--k-workload:#6f8038;";

// Per-kind rail fill + per-kind drillable border. These MUST come after the
// generic `.drillable .amrect` rule (same specificity, source-order wins) and
// before `.ambox.external .amrect`, which stays last so externals read grey.
const KIND_RULES = KINDS.map((k) =>
  `.kind-${k} .amrail{fill:var(--k-${k})}.kind-${k}.drillable .amrect{stroke:var(--k-${k})}`
).join("");

const STYLE = `
:root{${DARK}}
:root[data-theme="dark"]{${DARK}}
:root[data-theme="light"]{${LIGHT}}
@media (prefers-color-scheme: light){:root:not([data-theme]){${LIGHT}}}
*{box-sizing:border-box}
body{margin:0;font:14px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--ink);display:flex;height:100vh}
#main{flex:1;display:flex;flex-direction:column;min-width:0}
header{padding:10px 16px;border-bottom:1px solid var(--stroke);display:flex;gap:12px;align-items:center}
header h1{font-size:15px;margin:0;font-weight:600}
.snapshot{color:var(--muted);font-size:12px}
.axis-toggle{margin-left:auto;display:flex;gap:6px}
.axis-toggle button,#crumbs button{background:var(--box);color:var(--ink);border:1px solid var(--stroke);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
.axis-toggle button.active{background:var(--accent);border-color:var(--accent);color:#fff}
#crumbs{padding:8px 16px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;color:var(--muted)}
#legend{padding:0 16px 10px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;color:var(--muted);font-size:11px}
#legend .lg{display:inline-flex;align-items:center;gap:5px}
#legend .dot{width:9px;height:9px;border-radius:50%;display:inline-block}
#canvas{flex:1;overflow:auto;padding:24px}
.view{display:none}
.view.active{display:block}
svg.amview{max-width:100%;height:auto}
.amedge{stroke:var(--edge);stroke-width:1.5}
.amview marker path{fill:var(--edge)}
.amrect{fill:var(--box);stroke:var(--stroke);stroke-width:1.5;filter:drop-shadow(var(--shadow))}
.amrail{stroke:none}
.ambox{transition:opacity .12s}
.ambox .amname{fill:var(--ink);font-weight:600}
.ambox .amsub{fill:var(--muted);font-size:11px}
.ambox.drillable{cursor:pointer}
.ambox.leaf{cursor:pointer}
.drillable .amrect{stroke:var(--accent)}
${KIND_RULES}
.ambox.external .amrect{fill:var(--box);stroke:var(--k-external);stroke-dasharray:4 3}
.ambox.external .amname{fill:var(--muted)}
.amlabel rect{fill:var(--panel);opacity:.92;stroke:var(--stroke);stroke-width:.75}.amlabel text{fill:var(--muted);font-size:11px}
/* declutter: dense views hide labels until you hover a box (or toggle them all on) */
.amlabel{transition:opacity .12s}
.view.dense .amlabel{opacity:0}
.amlabel.vis{opacity:1}
.amlabel.dim{opacity:0}
body.show-labels .view.dense .amlabel{opacity:1}
.amedge{transition:stroke .12s,opacity .12s}
.amedge.hot{stroke:var(--accent);stroke-width:2}
.amedge.dim{opacity:.15}
.ambox.dim{opacity:.3}
.lblbtn{margin-left:8px;background:var(--box);color:var(--ink);border:1px solid var(--stroke);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
.lblbtn.active{background:var(--accent);border-color:var(--accent);color:#fff}
#panel .rel{margin:3px 0}#panel .rel .dir{color:var(--muted);margin-right:5px}
#panel{width:480px;background:var(--panel);border-left:1px solid var(--stroke);padding:16px;overflow:auto;display:none}
#panel.open{display:block}
#panel h2{font-size:15px;margin:0 0 4px}
#panel .kindline{color:var(--muted);font-size:12px;margin-bottom:10px}
#panel section{margin:12px 0;font-size:13px}
#panel h3{font-size:11px;text-transform:uppercase;color:var(--muted);margin:0 0 4px;letter-spacing:.04em}
#panel code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:12px}
#panel a{color:var(--accent)}
#panel .close{float:right;cursor:pointer;color:var(--muted);background:none;border:0;font-size:16px}
`;

const SCRIPT = `
const D = window.__ARCHMAP__;
function show(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===id));
  buildCrumbs(id);
}
function rootId(axis){return '__root_'+axis;}
function buildCrumbs(id){
  const c=document.getElementById('crumbs');c.innerHTML='';
  const axis=document.querySelector('.view[data-view="'+id+'"]').dataset.axis;
  const chain=[rootId(axis)];
  if(id!==rootId(axis)){
    const anc=(D.panel[id]&&D.panel[id].breadcrumb)?D.panel[id].breadcrumb.slice():[];
    chain.push(...anc.filter(a=>document.querySelector('.view[data-view="'+a+'"]')));
    chain.push(id);
  }
  chain.forEach((cid,i)=>{
    const b=document.createElement('button');
    b.textContent = cid===rootId(axis) ? (axis==='deploy'?'Deploy':'Context') : (D.panel[cid]?D.panel[cid].name:cid);
    b.onclick=()=>show(cid); c.appendChild(b);
    if(i<chain.length-1){const s=document.createElement('span');s.textContent='›';c.appendChild(s);}
  });
}
function openPanel(id){
  const d=D.panel[id];if(!d)return;
  const p=document.getElementById('panel');p.classList.add('open');
  let h='<button class="close" onclick="document.getElementById(\\'panel\\').classList.remove(\\'open\\')">×</button>';
  h+='<h2>'+esc(d.name)+'</h2><div class="kindline">'+esc(d.kind)+(d.tech?' · '+esc(d.tech):'')+'</div>';
  if(d.blurb)h+='<section>'+esc(d.blurb)+'</section>';
  if(d.grounding){const g=d.grounding;h+='<section><h3>Grounding</h3>';
    h+='<div><code>'+esc(g.repo||'')+'</code></div><div><code>'+esc(g.path||'')+'</code></div>';
    if(g.symbol)h+='<div>symbol: <code>'+esc(g.symbol.fqn)+'</code> ('+esc(g.symbol.kind)+')</div>';
    if(g.iac)h+='<div>iac: <code>'+esc(g.iac)+'</code></div>';
    if(g.region)h+='<div>region: '+g.region.anchors.map(esc).join(', ')+'<br><em>'+esc(g.region.note)+'</em></div>';
    if(g.lines)h+='<div>lines: <code>'+esc(g.lines)+'</code></div>';
    h+='</section>';}
  if(d.mappings&&d.mappings.length){h+='<section><h3>Runs on</h3>';
    d.mappings.forEach(m=>{h+='<div>'+esc(m.label)+' → <a href="#" data-go="'+esc(m.to)+'">'+esc(m.name)+'</a></div>';});h+='</section>';}
  if(d.links&&d.links.length){h+='<section><h3>Links</h3>';
    d.links.forEach(l=>{h+='<div><a href="'+esc(l.url)+'" target="_blank" rel="noopener">'+esc(l.label)+'</a></div>';});h+='</section>';}
  if(d.edges&&d.edges.length){h+='<section><h3>Relationships</h3>';
    d.edges.forEach(r=>{h+='<div class="rel"><span class="dir">'+(r.dir==='out'?'→':'←')+'</span>'+(r.label?esc(r.label)+' ':'')+'<a href="#" data-go="'+esc(r.to)+'">'+esc(r.name)+'</a></div>';});h+='</section>';}
  p.innerHTML=h;
  p.querySelectorAll('[data-go]').forEach(a=>a.onclick=(e)=>{e.preventDefault();const t=a.getAttribute('data-go');
    const v=document.querySelector('.view[data-view="'+t+'"]');if(v)show(t);openPanel(t);});
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
document.querySelectorAll('.ambox').forEach(g=>{
  g.addEventListener('click',()=>{const id=g.dataset.id;
    if(g.classList.contains('drillable')&&document.querySelector('.view[data-view="'+id+'"]'))show(id);
    openPanel(id);});
});
document.querySelectorAll('.axis-toggle button').forEach(b=>{
  b.onclick=()=>{document.querySelectorAll('.axis-toggle button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');show(rootId(b.dataset.axis));};
});
// Hover a box to reveal its relationships and dim the rest; toggle to pin all labels.
document.querySelectorAll('.ambox').forEach(g=>{
  g.addEventListener('mouseenter',()=>{
    const view=g.closest('.view');if(!view)return;const id=g.dataset.id;const nb=new Set([id]);
    view.querySelectorAll('.amedge').forEach(e=>{const on=e.dataset.from===id||e.dataset.to===id;
      if(on){nb.add(e.dataset.from);nb.add(e.dataset.to);}e.classList.toggle('hot',on);e.classList.toggle('dim',!on);});
    view.querySelectorAll('.amlabel').forEach(l=>{const on=l.dataset.from===id||l.dataset.to===id;
      l.classList.toggle('vis',on);l.classList.toggle('dim',!on);});
    view.querySelectorAll('.ambox').forEach(b=>b.classList.toggle('dim',!nb.has(b.dataset.id)));
  });
  g.addEventListener('mouseleave',()=>{const view=g.closest('.view');if(!view)return;
    view.querySelectorAll('.hot,.dim,.vis').forEach(el=>el.classList.remove('hot','dim','vis'));});
});
const lt=document.getElementById('lbltoggle');
if(lt)lt.onclick=()=>{document.body.classList.toggle('show-labels');lt.classList.toggle('active');};
// Theme: a stored choice wins via [data-theme]; otherwise the OS preference governs
// through the CSS media query. When unset we read the rendered theme from matchMedia
// so the first click flips what the user actually sees, then we persist it.
const themeMql=matchMedia('(prefers-color-scheme: light)');
function effTheme(){const a=document.documentElement.dataset.theme;return a==='light'||a==='dark'?a:(themeMql.matches?'light':'dark');}
const tt=document.getElementById('themetoggle');
function paintThemeBtn(){if(tt)tt.textContent=effTheme()==='light'?'☾\\uFE0E':'☀\\uFE0E';}
paintThemeBtn();
themeMql.addEventListener&&themeMql.addEventListener('change',paintThemeBtn);
if(tt)tt.onclick=()=>{const next=effTheme()==='light'?'dark':'light';document.documentElement.dataset.theme=next;
  try{localStorage.setItem('archmap-theme',next)}catch(e){}paintThemeBtn();};
show(D.rootDeploy && location.hash==='#deploy' ? D.rootDeploy : D.rootLogical);
`;

export function render(model) {
  const views = collectViews(model);
  const svgs = views.map((v) => {
    const layout = layoutView(model, v.focusId, v.axis);
    // Dense views (many labelled edges) start clean and reveal on hover; sparse
    // views keep their few labels on. The header toggle overrides either way.
    const dense = layout.edges.filter((e) => e.label).length > 6 ? " dense" : "";
    return `<div class="view${dense}" data-view="${esc(viewId(v.focusId, v.axis))}" data-axis="${v.axis}">${renderViewSvg(layout)}</div>`;
  }).join("\n");

  const panel = {};
  for (const n of model.nodes) {
    panel[n.id] = {
      name: n.name, kind: n.kind, tech: n.tech ?? null, blurb: n.blurb ?? null,
      links: n.links ?? [], grounding: n.grounding ?? null,
      breadcrumb: ancestorsOf(model, n.id).slice().reverse(),
      mappings: model.mappings.filter((m) => m.logical === n.id)
        .map((m) => ({ to: m.deploy, label: m.label, name: getNode(model, m.deploy)?.name ?? m.deploy })),
      edges: model.edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => {
        const out = e.from === n.id, other = out ? e.to : e.from;
        return { dir: out ? "out" : "in", to: other, name: getNode(model, other)?.name ?? other, label: e.label };
      }),
    };
  }
  const hasDeploy = model.nodes.some((n) => (n.axis ?? "logical") === "deploy");
  const data = { meta: model.meta, panel, rootLogical: "__root_logical", rootDeploy: hasDeploy ? "__root_deploy" : null };
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");

  const axisButtons = `<button class="active" data-axis="logical">Logical</button>` +
    (hasDeploy ? `<button data-axis="deploy">Deploy</button>` : ``);

  // Legend: the distinct kinds actually present, in canonical order. Dots colour
  // themselves from the kind vars, so they follow the active theme.
  const present = KINDS.filter((k) => model.nodes.some((n) => n.kind === k));
  const legend = present.map((k) =>
    `<span class="lg kind-${k}"><span class="dot" style="background:var(--k-${k})"></span>${esc(k)}</span>`
  ).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(model.meta.name)} — archmap</title>
<style>${STYLE}</style>
<script>try{var t=localStorage.getItem('archmap-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}</script></head>
<body>
<div id="main">
<header><h1>${esc(model.meta.name)}</h1><span class="snapshot">v${esc(model.meta.version)} · ${esc(model.meta.snapshot)}</span>
<span class="axis-toggle">${axisButtons}</span><button id="lbltoggle" class="lblbtn" title="Show all edge labels">Labels</button><button id="themetoggle" class="lblbtn" title="Toggle light / dark theme">◐</button></header>
<div id="crumbs"></div>
<div id="legend">${legend}</div>
<div id="canvas">
${svgs}
</div>
</div>
<aside id="panel"></aside>
<script>window.__ARCHMAP__=${dataJson};</script>
<script>${SCRIPT}</script>
</body></html>
`;
}
