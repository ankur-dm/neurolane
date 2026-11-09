// Indexes, tree queries, spreading activation and context packs.
import fs from 'node:fs';
import path from 'node:path';
import { isLive, section, approxTokens, hash } from './store.mjs';

// ---------- text matching ----------
const SUFFIXES = ['ations', 'ation', 'ating', 'ated', 'ates', 'ions', 'ion', 'ings', 'ing', 'ers', 'er', 'ed', 'es', 'ate', 's', 'e'];
export function stem(w) {
  if (w.length <= 4) return w;
  for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 4) return w.slice(0, -s.length);
  return w;
}
export const tokens = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export const stemmedLine = (s) => ` ${tokens(s).map(stem).join(' ')} `;

// "validation:0.9" -> { term: 'validation', weight: 0.9 }
export function parseWeighted(raw, dflt = 1) {
  const m = String(raw).match(/^(.*?):(\d*\.?\d+)$/);
  return m ? { term: m[1].trim(), weight: Number(m[2]) } : { term: String(raw).trim(), weight: dflt };
}

// ---------- index ----------
function lite(n) {
  return {
    id: n.id, kind: n.kind, title: n.title || n.id, parent: n.parent || null, lifecycle: n.lifecycle,
    status: n.status || null, lane: n.lane || null, pending_removal: n.pending_removal || null,
    summary: n.summary || '', on_fire: n.on_fire || '', threshold: n.threshold ?? null,
    fires_on: n.fires_on || null, receptors: n.receptors, facets: n.facets, refs: n.refs,
  };
}

export function buildIndex(brain) {
  brain.invalidate();
  const nodes = brain.loadNodes();
  const idx = { generated: new Date().toISOString(), nodes: {}, children: {}, synapses: brain.loadSynapses(), receptors: { terms: {}, symbols: {}, paths: [] } };
  for (const n of nodes.values()) {
    idx.nodes[n.id] = lite(n);
    if (n.parent) (idx.children[n.parent] ||= []).push(n.id);
    if (!isLive(n)) continue;
    const add = (t, w) => {
      const key = stemmedLine(t).trim();
      if (!key) return;
      const list = (idx.receptors.terms[key] ||= []);
      const prev = list.find((e) => e[0] === n.id);
      if (prev) { if (w > prev[1]) { prev[1] = w; prev[2] = t; } } else list.push([n.id, w, t]);
    };
    if (n.title) add(n.title, 0.6);
    for (const raw of n.receptors.terms) { const { term, weight } = parseWeighted(raw); add(term, weight); }
    for (const raw of n.receptors.symbols) { const { term, weight } = parseWeighted(raw, 1); (idx.receptors.symbols[term] ||= []).push([n.id, weight]); }
    for (const raw of n.receptors.paths) { const { term, weight } = parseWeighted(raw, 1); idx.receptors.paths.push([term, n.id, weight]); }
  }
  fs.mkdirSync(brain.dir, { recursive: true });
  const nodesOut = { generated: idx.generated, nodes: idx.nodes, children: idx.children };
  fs.writeFileSync(path.join(brain.dir, 'index.json'), JSON.stringify(nodesOut, null, 1));
  fs.writeFileSync(path.join(brain.dir, 'receptors.json'), JSON.stringify(idx.receptors, null, 1));
  return idx;
}

function newestMtime(brain) {
  let max = 0;
  for (const d of [brain.nodesDir, brain.archiveDir]) {
    if (!fs.existsSync(d)) continue;
    max = Math.max(max, fs.statSync(d).mtimeMs);
    for (const f of fs.readdirSync(d)) max = Math.max(max, fs.statSync(path.join(d, f)).mtimeMs);
  }
  for (const f of ['synapses.yaml', 'schema.yaml']) {
    const p = path.join(brain.dir, f);
    if (fs.existsSync(p)) max = Math.max(max, fs.statSync(p).mtimeMs);
  }
  return max;
}

// Load the index, rebuilding it when any neuron or synapse file is newer.
export function loadIndex(brain) {
  const ip = path.join(brain.dir, 'index.json');
  const rp = path.join(brain.dir, 'receptors.json');
  try {
    const t = Math.min(fs.statSync(ip).mtimeMs, fs.statSync(rp).mtimeMs);
    if (t >= newestMtime(brain)) {
      const base = JSON.parse(fs.readFileSync(ip, 'utf8'));
      return { ...base, receptors: JSON.parse(fs.readFileSync(rp, 'utf8')), synapses: brain.loadSynapses() };
    }
  } catch { /* rebuild */ }
  return buildIndex(brain);
}

// ---------- spreading activation ----------
// seeds: Map id -> { charge, why }. Returns Map id -> { charge, why, hops, via }.
export function spread(brain, idx, seeds, opts = {}) {
  const cfg = { ...brain.schema.ignition, ...opts };
  const types = brain.schema.synapse_types || {};
  const signal = opts.signal || null;
  const live = (id) => idx.nodes[id] && isLive(idx.nodes[id]);
  const adj = new Map();
  const push = (a, e) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(e); };
  for (const s of idx.synapses) {
    if (!live(s.from) || !live(s.to)) continue;
    if (signal && Array.isArray(s.conducts) && s.conducts.length && !s.conducts.includes(signal)) continue;
    const t = types[s.type] || {};
    const w = Number(s.weight ?? t.weight ?? 0.5);
    const dir = s.direction || t.direction || 'both';
    push(s.from, { to: s.to, w, label: s.type, note: s.note });
    if (dir === 'both') push(s.to, { to: s.from, w, label: `${s.type} (reverse)`, note: s.note });
  }
  for (const [id, n] of Object.entries(idx.nodes)) {
    if (!n.parent || !live(id) || !live(n.parent)) continue;
    push(n.parent, { to: id, w: cfg.tree_weight, label: 'child' });
    push(id, { to: n.parent, w: cfg.tree_up_weight ?? cfg.tree_weight, label: 'parent' });
  }
  const out = new Map();
  const queue = [];
  for (const [id, s] of seeds) {
    if (!live(id)) continue;
    out.set(id, { charge: s.charge, why: s.why, hops: 0, via: null });
    queue.push(id);
  }
  const floor = opts.floor ?? 0.05;
  while (queue.length) {
    queue.sort((a, b) => out.get(b).charge - out.get(a).charge);
    const cur = queue.shift();
    const st = out.get(cur);
    if (st.hops >= cfg.max_hops) continue;
    for (const e of adj.get(cur) || []) {
      const c = st.charge * e.w * cfg.decay_per_hop;
      if (c < floor) continue;
      const prev = out.get(e.to);
      if (prev && prev.charge >= c) continue;
      out.set(e.to, { charge: c, hops: st.hops + 1, via: cur, why: `${e.label} from ${cur}${e.note ? `: ${e.note}` : ''}` });
      queue.push(e.to);
    }
  }
  return out;
}

// ---------- tree / lookup queries ----------
const line = (n, extra = '') => {
  const tag = n.lifecycle !== 'active' ? ` [${n.lifecycle}${n.lane ? ` in lane ${n.lane}` : ''}]` : '';
  return `- ${n.id} (${n.kind}${n.status ? `, ${n.status}` : ''})${tag}: ${n.title}${n.summary ? ` | ${n.summary}` : ''}${extra}`;
};

export function overview(brain, idx, { all = false } = {}) {
  const ok = (n) => all || isLive(n);
  const roots = Object.values(idx.nodes).filter((n) => !n.parent && ok(n));
  if (!roots.length) return 'The brain is empty. Start with: node brain/neurolane.mjs init --vision "..." or /brain-map';
  const out = [];
  for (const r of roots) {
    out.push(line(r));
    for (const cid of idx.children[r.id] || []) {
      const c = idx.nodes[cid];
      if (!ok(c)) continue;
      const k = (idx.children[cid] || []).filter((x) => ok(idx.nodes[x])).length;
      out.push(`  ${line(c, k ? ` (${k} branches)` : '')}`);
    }
  }
  const counts = {};
  for (const n of Object.values(idx.nodes)) counts[n.lifecycle] = (counts[n.lifecycle] || 0) + 1;
  out.push('', `Neurons: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}. Synapses: ${idx.synapses.length}.`);
  out.push('Next: expand <id> for branches, read <id> --tier digest for depth.');
  return out.join('\n');
}

export function expand(brain, idx, id, { depth = 1, all = false } = {}) {
  const root = idx.nodes[id];
  if (!root) return `No neuron "${id}".`;
  const out = [line(root)];
  const walk = (pid, d, pad) => {
    if (d > depth) return;
    const kids = (idx.children[pid] || []).map((c) => idx.nodes[c]).filter((n) => all || isLive(n));
    const facets = kids.filter((n) => n.kind === 'facet');
    const rest = kids.filter((n) => n.kind !== 'facet');
    for (const n of [...facets, ...rest]) {
      const k = (idx.children[n.id] || []).length;
      out.push(`${pad}${line(n, k && d === depth ? ` (+${k} more)` : '')}`);
      walk(n.id, d + 1, `${pad}  `);
    }
  };
  walk(id, 1, '  ');
  if (out.length === 1) out.push('  (no branches yet)');
  return out.join('\n');
}

export function pathTo(idx, id) {
  const chain = [];
  let cur = idx.nodes[id];
  const seen = new Set();
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); chain.unshift(cur); cur = cur.parent ? idx.nodes[cur.parent] : null; }
  return chain;
}

export function readNode(brain, id, tier = 'summary') {
  const n = brain.require(id);
  if (tier === 'full') {
    return [`# ${n.title || n.id}  (${n.id}, ${n.kind}, ${n.lifecycle})`, n.summary && `Summary: ${n.summary}`, n.on_fire && `Current state: ${n.on_fire}`, '', n.body.trim()].filter((x) => x !== undefined && x !== '').join('\n');
  }
  const out = [`${n.title || n.id}  (${n.id}, ${n.kind}, ${n.lifecycle}${n.status ? `, ${n.status}` : ''}${n.lane ? `, lane ${n.lane}` : ''})`];
  if (n.summary) out.push(`Summary: ${n.summary}`);
  if (n.on_fire) out.push(`Current state: ${n.on_fire}`);
  if (tier === 'digest') {
    const dg = section(n.body, 'Digest');
    if (dg) out.push('', dg);
    const kids = brain.children(id);
    if (kids.length) out.push('', `Branches: ${kids.map((k) => `${k.id} (${k.kind})`).join(', ')}`);
    if (n.refs.length) out.push(`Refs: ${n.refs.join(', ')}`);
  }
  return out.join('\n');
}

export function links(brain, idx, id, { type } = {}) {
  const rows = idx.synapses.filter((s) => (s.from === id || s.to === id) && (!type || s.type === type));
  if (!rows.length) return `${id} has no synapses yet.`;
  return rows.map((s) => {
    const other = s.from === id ? s.to : s.from;
    const arrow = s.from === id ? '->' : '<-';
    const o = idx.nodes[other];
    return `- ${arrow} ${s.type} ${other}${o ? ` (${o.lifecycle})` : ' (missing!)'} w=${s.weight ?? '-'}${s.provisional ? ` [temp, lane ${s.lane}]` : ''}${s.note ? `: ${s.note}` : ''}`;
  }).join('\n');
}

export function search(idx, text, { all = false, limit = 10 } = {}) {
  const q = tokens(text).map(stem);
  if (!q.length) return [];
  const scored = [];
  for (const n of Object.values(idx.nodes)) {
    if (!all && !isLive(n)) continue;
    const hay = stemmedLine(`${n.id} ${n.title} ${n.summary} ${(n.receptors?.terms || []).join(' ')}`);
    const titleHay = stemmedLine(`${n.id} ${n.title}`);
    let s = 0;
    for (const t of q) { if (hay.includes(` ${t} `)) s += 1; if (titleHay.includes(` ${t} `)) s += 1; }
    if (s) scored.push([s, n]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, n]) => n);
}

export function impact(brain, idx, id, opts = {}) {
  if (!idx.nodes[id]) return `No neuron "${id}".`;
  const res = spread(brain, idx, new Map([[id, { charge: 1, why: 'origin of the change' }]]), { signal: opts.signal || 'product-change', ...opts });
  const th = opts.threshold ?? 0.2;
  const rows = [...res.entries()].filter(([k, v]) => k !== id && v.charge >= th).sort((a, b) => b[1].charge - a[1].charge);
  const out = [`Impact of changing ${id} (threshold ${th}):`];
  if (!rows.length) out.push('  Nothing above threshold. Add synapses with: neurolane link <from> <to> --type <type> --note "..."');
  for (const [k, v] of rows) {
    const n = idx.nodes[k];
    const mig = n.lifecycle === 'deprecated' ? ' MIGRATION ITEM (deprecated)' : '';
    out.push(`- ${k} (${n.kind}) charge ${v.charge.toFixed(2)}${mig}: ${n.summary || n.title}`);
    out.push(`    why: ${v.why}`);
    if (n.on_fire) out.push(`    now: ${n.on_fire}`);
  }
  return out.join('\n');
}

// Minimal context for working on one neuron, cut to a token budget.
export function pack(brain, idx, id, { budget = 4000 } = {}) {
  const n = brain.require(id);
  const parts = [];
  let used = 0;
  const add = (text) => {
    const t = approxTokens(text);
    if (used + t > budget) return false;
    parts.push(text); used += t; return true;
  };
  add(`## Context pack for ${id} (budget ${budget} tokens)`);
  const chain = pathTo(idx, id).slice(0, -1);
  if (chain.length) add(`### Path\n${chain.map((c) => `- ${c.id}: ${c.summary || c.title}`).join('\n')}`);
  add(`### Node\n${readNode(brain, id, 'digest')}`);
  const lk = links(brain, idx, id);
  add(`### Direct synapses\n${lk}`);
  const res = spread(brain, idx, new Map([[id, { charge: 1, why: 'origin' }]]));
  const ranked = [...res.entries()].filter(([k]) => k !== id && !chain.some((c) => c.id === k)).sort((a, b) => b[1].charge - a[1].charge);
  const lines = [];
  for (const [k, v] of ranked) {
    const o = idx.nodes[k];
    const l = `- ${k} (${o.kind}, ${v.charge.toFixed(2)}): ${o.summary || o.title}${o.on_fire ? ` | now: ${o.on_fire}` : ''}`;
    if (used + approxTokens(lines.join('\n') + l) + 20 > budget) break;
    lines.push(l);
  }
  if (lines.length) add(`### Activated neighbours\n${lines.join('\n')}`);
  add(`(${used} tokens used. Deeper: neurolane read <id> --tier full)`);
  return parts.join('\n\n');
}

export const childrenHash = (idx, id) => hash((idx.children[id] || []).map((c) => idx.nodes[c]).filter(isLive).map((c) => `${c.id}:${c.summary}`).sort().join('\n'));
