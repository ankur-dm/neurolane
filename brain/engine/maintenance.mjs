// Graph health: validation, stale summaries (rollup) and obsolete candidates (prune).
import fs from 'node:fs';
import path from 'node:path';
import { isLive, today } from './store.mjs';
import { buildIndex, childrenHash } from './graph.mjs';

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const daysSince = (d) => (Date.now() - Date.parse(d)) / 864e5;

export function check(brain) {
  const idx = buildIndex(brain);
  const sc = brain.schema;
  const errors = [], warnings = [], candidates = [];
  const kinds = new Set(sc.kinds), types = new Set(Object.keys(sc.synapse_types || {}));
  const lanes = new Map(brain.listLanes().filter(Boolean).map((l) => [l.name, l]));
  const branches = brain.git(['branch', '--list', '--format=%(refname:short)']);
  const branchSet = branches == null ? null : new Set(branches.split('\n').filter(Boolean));
  const degree = {};
  for (const s of idx.synapses) {
    for (const end of [s.from, s.to]) if (!idx.nodes[end]) errors.push(`synapse ${s.from} -${s.type}-> ${s.to}: missing neuron ${end}`);
    if (!types.has(s.type)) warnings.push(`synapse type "${s.type}" is not in schema.yaml synapse_types`);
    degree[s.from] = (degree[s.from] || 0) + 1;
    degree[s.to] = (degree[s.to] || 0) + 1;
  }
  for (const n of Object.values(idx.nodes)) {
    const live = isLive(n);
    if (!kinds.has(n.kind)) warnings.push(`${n.id}: kind "${n.kind}" is not in schema.yaml kinds`);
    if (n.parent && !idx.nodes[n.parent]) errors.push(`${n.id}: parent "${n.parent}" does not exist`);
    if (live && n.parent && idx.nodes[n.parent] && !isLive(idx.nodes[n.parent])) warnings.push(`${n.id}: live neuron under ${n.lifecycle === 'obsolete' ? 'an obsolete' : 'a retired'} parent ${n.parent}`);
    if (live && !n.summary) warnings.push(`${n.id}: no summary (the AI sees nothing at the cheap tier)`);
    if (words(n.summary) > sc.summary_words.summary * 1.5) warnings.push(`${n.id}: summary is ${words(n.summary)} words (aim for ${sc.summary_words.summary})`);
    if (words(n.on_fire) > sc.summary_words.on_fire * 1.5) warnings.push(`${n.id}: on_fire note is ${words(n.on_fire)} words (aim for ${sc.summary_words.on_fire})`);
    if (n.lifecycle === 'provisional') {
      const lane = lanes.get(n.lane);
      if (!lane) errors.push(`${n.id}: provisional but lane "${n.lane}" does not exist`);
      else if (lane.status !== 'open' && lane.status !== 'merged') errors.push(`${n.id}: provisional in a ${lane.status} lane ${n.lane}`);
      if (lane && branchSet && lane.status === 'open' && !branchSet.has(lane.branch)) candidates.push(`${n.id}: provisional, but branch ${lane.branch} no longer exists (drop the lane?)`);
    }
    if (live) {
      for (const r of n.refs || []) {
        if (/^[a-z]+:\/\//i.test(r)) continue;
        const p = String(r).split('#')[0];
        if (p && !p.includes('*') && !fs.existsSync(path.join(brain.root, p))) candidates.push(`${n.id}: ref ${p} no longer exists`);
      }
      const kids = (idx.children[n.id] || []).map((c) => idx.nodes[c]);
      if (kids.length && kids.every((k) => !isLive(k))) candidates.push(`${n.id}: every branch under it is obsolete`);
      if (n.parent && !degree[n.id] && !kids.length && n.kind !== 'facet') warnings.push(`${n.id}: no synapses and no branches (isolated neuron)`);
    }
  }
  for (const l of lanes.values()) {
    if (l.status === 'open' && daysSince(l.opened) > (sc.lanes.stale_after_days || 30)) candidates.push(`lane ${l.name}: open since ${l.opened}`);
  }
  const stale = staleSummaries(brain, idx);
  for (const s of stale) warnings.push(`${s}: summary is stale (children changed); run /brain-rollup`);
  return { errors, warnings, candidates, stale };
}

export function staleSummaries(brain, idx) {
  return Object.values(idx.nodes).filter((n) => isLive(n) && (idx.children[n.id] || []).length && brain.get(n.id).children_hash !== childrenHash(idx, n.id)).map((n) => n.id);
}

// Show what a parent must summarise; --mark records that its summary was rewritten.
export function rollup(brain, { mark } = {}) {
  const idx = buildIndex(brain);
  if (mark) {
    const n = brain.require(mark);
    n.children_hash = childrenHash(idx, mark);
    n.updated = today();
    brain.saveNode(n);
    return `${mark}: rollup recorded.`;
  }
  const stale = staleSummaries(brain, idx);
  if (!stale.length) return 'All parent summaries are current.';
  // Deepest first, so parents roll up from fresh child summaries.
  const depth = (id) => { let d = 0, c = idx.nodes[id]; while (c?.parent) { d++; c = idx.nodes[c.parent]; } return d; };
  stale.sort((a, b) => depth(b) - depth(a));
  const out = ['Stale summaries, deepest first. For each: rewrite summary (and on_fire if needed) from its branches, then run rollup --mark <id>.'];
  for (const id of stale) {
    const n = idx.nodes[id];
    out.push('', `${id}: ${n.summary || '(no summary)'}`);
    for (const c of idx.children[id] || []) { const k = idx.nodes[c]; if (isLive(k)) out.push(`  - ${c}: ${k.summary || k.title}`); }
  }
  return out.join('\n');
}
