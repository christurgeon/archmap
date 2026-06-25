import { getNode, childrenOf, ancestorsOf } from "@archmap/schema";
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

const STYLE = `
:root{--bg:#0f1419;--panel:#171c24;--box:#1f2630;--ink:#e6edf3;--muted:#9aa7b4;--edge:#43505f;--accent:#4493f8;}
*{box-sizing:border-box}
body{margin:0;font:14px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--ink);display:flex;height:100vh}
#main{flex:1;display:flex;flex-direction:column;min-width:0}
header{padding:10px 16px;border-bottom:1px solid #222b36;display:flex;gap:12px;align-items:center}
header h1{font-size:15px;margin:0;font-weight:600}
.snapshot{color:var(--muted);font-size:12px}
.axis-toggle{margin-left:auto;display:flex;gap:6px}
.axis-toggle button,.crumb button{background:var(--box);color:var(--ink);border:1px solid #2a333f;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
.axis-toggle button.active{background:var(--accent);border-color:var(--accent);color:#fff}
#crumbs{padding:8px 16px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;color:var(--muted)}
#canvas{flex:1;overflow:auto;padding:24px}
.view{display:none}
.view.active{display:block}
svg.amview{max-width:100%;height:auto}
.amedge{stroke:var(--edge);stroke-width:1.5}
.ambox rect{fill:var(--box);stroke:#33414f;stroke-width:1.5}
.ambox .amname{fill:var(--ink);font-weight:600}
.ambox .amsub{fill:var(--muted);font-size:11px}
.ambox.drillable{cursor:pointer}.ambox.drillable rect{stroke:var(--accent)}
.ambox.leaf{cursor:pointer}
.ambox.external rect{fill:#20242b;stroke:#3a4350;stroke-dasharray:4 3}
.ambox.external .amname{fill:var(--muted)}
.amlabel rect{fill:#0f1419;opacity:.85}.amlabel text{fill:var(--muted);font-size:11px}
/* declutter: dense views hide labels until you hover a box (or toggle them all on) */
.amlabel{transition:opacity .12s}
.view.dense .amlabel{opacity:0}
.amlabel.vis{opacity:1}
.amlabel.dim{opacity:0}
body.show-labels .view.dense .amlabel{opacity:1}
.amedge{transition:stroke .12s,opacity .12s}
.amedge.hot{stroke:var(--accent);stroke-width:2}
.amedge.dim{opacity:.15}
.ambox{transition:opacity .12s}
.ambox.dim{opacity:.3}
.lblbtn{margin-left:8px;background:var(--box);color:var(--ink);border:1px solid #2a333f;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
.lblbtn.active{background:var(--accent);border-color:var(--accent);color:#fff}
#panel .rel{margin:3px 0}#panel .rel .dir{color:var(--muted);margin-right:5px}
#panel{width:480px;background:var(--panel);border-left:1px solid #222b36;padding:16px;overflow:auto;display:none}
#panel.open{display:block}
#panel h2{font-size:15px;margin:0 0 4px}
#panel .kindline{color:var(--muted);font-size:12px;margin-bottom:10px}
#panel section{margin:12px 0;font-size:13px}
#panel h3{font-size:11px;text-transform:uppercase;color:var(--muted);margin:0 0 4px;letter-spacing:.04em}
#panel code{background:#0f1419;padding:1px 5px;border-radius:4px;font-size:12px}
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

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(model.meta.name)} — archmap</title>
<style>${STYLE}</style></head>
<body>
<div id="main">
<header><h1>${esc(model.meta.name)}</h1><span class="snapshot">v${esc(model.meta.version)} · ${esc(model.meta.snapshot)}</span>
<span class="axis-toggle">${axisButtons}</span><button id="lbltoggle" class="lblbtn" title="Show all edge labels">Labels</button></header>
<div id="crumbs"></div>
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
