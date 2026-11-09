// Writes brain/viewer.html: a single static page with the index embedded.
// Double-click a neuron to expand it; click to see its summary, state and synapses.
import fs from 'node:fs';
import path from 'node:path';

export function writeViewer(brain, idx) {
  const data = { nodes: idx.nodes, children: idx.children, synapses: idx.synapses, receptors: idx.receptors, cfg: brain.schema.ignition, types: brain.schema.synapse_types };
  const html = PAGE.replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c'));
  const file = path.join(brain.dir, 'viewer.html');
  fs.writeFileSync(file, html);
  return file;
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brain Viewer</title>
<style>
:root{--bg:#fbfaf8;--panel:#fff;--ink:#1d1d1b;--quiet:#6b6a66;--line:#e4e2dc;--accent:#2f6fde;--fire:#e8590c;--prov:#7c3aed;--dep:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--panel:#1f1f1d;--ink:#ecebe7;--quiet:#a3a19b;--line:#33322f;--accent:#6ea0ff;--fire:#ff8a4c;--prov:#a78bfa;--dep:#f59e0b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,system-ui,Segoe UI,sans-serif}
header{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
header h1{font-size:16px;margin:0 12px 0 0}input,button{font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
input{flex:1;min-width:180px}button{cursor:pointer}label{color:var(--quiet);font-size:13px}
main{display:grid;grid-template-columns:minmax(260px,1fr) minmax(280px,1.2fr);height:calc(100vh - 58px)}
@media (max-width:760px){main{grid-template-columns:1fr;height:auto}}
#tree{overflow:auto;padding:8px 8px 40px;border-right:1px solid var(--line)}#detail{overflow:auto;padding:16px 20px}
.n{padding:3px 6px;border-radius:6px;cursor:pointer;user-select:none;white-space:nowrap}.n:hover{background:var(--line)}
.n.sel{outline:2px solid var(--accent)}.caret{display:inline-block;width:14px;color:var(--quiet)}
.k{font-size:11px;color:var(--quiet);margin-left:6px}.lc{font-size:11px;margin-left:6px;padding:0 5px;border-radius:4px;border:1px solid currentColor}
.lc.provisional{color:var(--prov)}.lc.deprecated{color:var(--dep)}.lc.obsolete,.lc.archived{color:var(--quiet)}
.fired{background:color-mix(in srgb,var(--fire) calc(var(--c)*45%),transparent)}.ch{font-size:11px;color:var(--fire);margin-left:6px}
.kids{margin-left:16px}h2{margin:0 0 4px;font-size:18px}.meta{color:var(--quiet);font-size:13px;margin-bottom:12px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:10px 0}
.box b{display:block;font-size:12px;color:var(--quiet);font-weight:600;margin-bottom:4px}
.syn{padding:4px 0;border-top:1px solid var(--line)}.syn:first-of-type{border-top:0}a{color:var(--accent);cursor:pointer}
.hint{color:var(--quiet)}
</style></head><body>
<header><h1>Brain</h1><input id="q" placeholder="Type a request to see which neurons fire, e.g. change signup validation"><button id="go">Ignite</button><button id="clr">Clear</button><label><input type="checkbox" id="all" style="min-width:0;flex:none"> show retired</label></header>
<main><div id="tree"></div><div id="detail"><p class="hint">Double-click a neuron to expand its branches. Click to read it.</p></div></main>
<script>
const D=__DATA__;const open=new Set();let sel=null,fire=new Map();
const live=n=>n&&!['obsolete','archived'].includes(n.lifecycle);
const SUF=['ations','ation','ating','ated','ates','ions','ion','ings','ing','ers','er','ed','es','ate','s','e'];
const stem=w=>{if(w.length<=4)return w;for(const s of SUF)if(w.endsWith(s)&&w.length-s.length>=4)return w.slice(0,-s.length);return w};
const sline=s=>' '+String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem).join(' ')+' ';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function ignite(text){const seeds=new Map(),line=sline(text);
 for(const[k,l]of Object.entries(D.receptors.terms))if(line.includes(' '+k+' '))for(const[id,w,o]of l){const p=seeds.get(id);if(!p||w>p.c)seeds.set(id,{c:Math.min(1,w),why:'matched "'+(o||k)+'"'})}
 for(const[s,l]of Object.entries(D.receptors.symbols))if(text.includes(s))for(const[id,w]of l)seeds.set(id,{c:w,why:'symbol '+s});
 const adj=new Map(),push=(a,e)=>{(adj.get(a)||adj.set(a,[]).get(a)).push(e)},cfg=D.cfg;
 for(const s of D.synapses){if(!live(D.nodes[s.from])||!live(D.nodes[s.to]))continue;const t=D.types[s.type]||{},w=+(s.weight??t.weight??.5);push(s.from,{to:s.to,w,l:s.type});if((s.direction||t.direction||'both')==='both')push(s.to,{to:s.from,w,l:s.type})}
 for(const n of Object.values(D.nodes))if(n.parent&&live(n)&&live(D.nodes[n.parent])){push(n.parent,{to:n.id,w:cfg.tree_weight,l:'child'});push(n.id,{to:n.parent,w:cfg.tree_up_weight??cfg.tree_weight,l:'parent'})}
 const out=new Map(),q=[];for(const[id,s]of seeds)if(live(D.nodes[id])){out.set(id,{c:s.c,why:s.why,h:0});q.push(id)}
 while(q.length){q.sort((a,b)=>out.get(b).c-out.get(a).c);const cur=q.shift(),st=out.get(cur);if(st.h>=cfg.max_hops)continue;
  for(const e of adj.get(cur)||[]){const c=st.c*e.w*cfg.decay_per_hop;if(c<.05)continue;const p=out.get(e.to);if(p&&p.c>=c)continue;out.set(e.to,{c,h:st.h+1,why:e.l+' from '+cur});q.push(e.to)}}
 return new Map([...out].filter(([id,v])=>v.c>=(D.nodes[id].threshold??cfg.threshold)))}
function reveal(id){let n=D.nodes[id];while(n&&n.parent){open.add(n.parent);n=D.nodes[n.parent]}}
function row(n){const kids=(D.children[n.id]||[]).filter(c=>all.checked||live(D.nodes[c]));const f=fire.get(n.id);
 const el=document.createElement('div');el.innerHTML='<div class="n'+(sel===n.id?' sel':'')+(f?' fired':'')+'" style="--c:'+(f?f.c:0)+'"><span class="caret">'+(kids.length?(open.has(n.id)?'▾':'▸'):'')+'</span>'+esc(n.title)+'<span class="k">'+esc(n.kind)+'</span>'+(n.lifecycle!=='active'?'<span class="lc '+n.lifecycle+'">'+n.lifecycle+'</span>':'')+(f?'<span class="ch">'+f.c.toFixed(2)+'</span>':'')+'</div>';
 const h=el.firstChild;h.onclick=e=>{if(e.target.className==='caret'){toggle(n.id)}else{sel=n.id;render()}};h.ondblclick=()=>toggle(n.id);
 if(open.has(n.id)&&kids.length){const k=document.createElement('div');k.className='kids';for(const c of kids)k.appendChild(row(D.nodes[c]));el.appendChild(k)}return el}
function toggle(id){open.has(id)?open.delete(id):open.add(id);sel=id;render()}
function render(){const t=document.getElementById('tree');t.innerHTML='';const roots=Object.values(D.nodes).filter(n=>!n.parent&&(all.checked||live(n)));
 if(!roots.length)t.innerHTML='<p class="hint">The brain is empty.</p>';for(const r of roots)t.appendChild(row(r));detail()}
function detail(){const el=document.getElementById('detail');if(!sel){return}const n=D.nodes[sel];const f=fire.get(sel);
 const syn=D.synapses.filter(s=>s.from===sel||s.to===sel).map(s=>{const o=s.from===sel?s.to:s.from;return '<div class="syn">'+(s.from===sel?'→ ':'← ')+esc(s.type)+' <a data-id="'+esc(o)+'">'+esc(D.nodes[o]?.title||o)+'</a> <span class="k">w '+(s.weight??'-')+(s.provisional?', temporary in lane '+esc(s.lane):'')+'</span>'+(s.note?'<div class="hint">'+esc(s.note)+'</div>':'')+'</div>'}).join('');
 const kids=(D.children[sel]||[]).map(c=>'<a data-id="'+esc(c)+'">'+esc(D.nodes[c].title)+'</a> <span class="k">'+esc(D.nodes[c].kind)+'</span>').join('<br>');
 el.innerHTML='<h2>'+esc(n.title)+'</h2><div class="meta">'+esc(n.id)+' · '+esc(n.kind)+' · '+esc(n.lifecycle)+(n.status?' · '+esc(n.status):'')+(n.lane?' · lane '+esc(n.lane):'')+'</div>'
 +(f?'<div class="box"><b>Fired '+f.c.toFixed(2)+'</b>'+esc(f.why)+'</div>':'')
 +'<div class="box"><b>Summary</b>'+(esc(n.summary)||'<span class="hint">none</span>')+'</div>'
 +(n.on_fire?'<div class="box"><b>Current state (sent to the agent when it fires)</b>'+esc(n.on_fire)+'</div>':'')
 +(kids?'<div class="box"><b>Branches</b>'+kids+'</div>':'')
 +'<div class="box"><b>Synapses</b>'+(syn||'<span class="hint">none</span>')+'</div>'
 +'<div class="box"><b>Receptors</b>'+esc([...(n.receptors?.terms||[]),...(n.receptors?.symbols||[]),...(n.receptors?.paths||[])].join(', ')||'title only')+'</div>'
 +(n.refs?.length?'<div class="box"><b>Refs</b>'+esc(n.refs.join(', '))+'</div>':'')
 +'<p class="hint">Deeper: node brain/neurolane.mjs read '+esc(n.id)+' --tier full</p>';
 el.querySelectorAll('a[data-id]').forEach(a=>a.onclick=()=>{sel=a.dataset.id;reveal(sel);render()})}
const all=document.getElementById('all');all.onchange=render;
document.getElementById('go').onclick=()=>{fire=ignite(document.getElementById('q').value);for(const id of fire.keys())reveal(id);const top=[...fire].sort((a,b)=>b[1].c-a[1].c)[0];sel=top?top[0]:sel;render()};
document.getElementById('q').onkeydown=e=>{if(e.key==='Enter')document.getElementById('go').click()};
document.getElementById('clr').onclick=()=>{fire=new Map();render()};
for(const r of Object.values(D.nodes))if(!r.parent)open.add(r.id);render();
</script></body></html>`;
