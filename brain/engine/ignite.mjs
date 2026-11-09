// Self-ignition: signals (prompt text, edited files) fire neurons whose receptors
// match, charge spreads along synapses, and the agent gets a compact notice.
import path from 'node:path';
import { isLive, globMatch, approxTokens } from './store.mjs';
import { loadIndex, spread, stemmedLine } from './graph.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function matchSeeds(brain, idx, { text = '', files = [], signal }) {
  const seeds = new Map();
  const bump = (id, w, why) => {
    const n = idx.nodes[id];
    if (!n || !isLive(n)) return;
    if (Array.isArray(n.fires_on) && n.fires_on.length && signal && !n.fires_on.includes(signal)) return;
    const prev = seeds.get(id);
    if (!prev) seeds.set(id, { charge: Math.min(1, w), why, hits: 1 });
    else {
      prev.hits += 1;
      const charge = Math.min(1, Math.max(prev.charge, w) + 0.1);
      if (w > prev.charge) prev.why = why;
      prev.charge = charge;
    }
  };
  if (text) {
    const line = stemmedLine(text);
    for (const [key, list] of Object.entries(idx.receptors.terms)) {
      if (!line.includes(` ${key} `)) continue;
      for (const [id, w, orig] of list) bump(id, w, `matched "${orig || key}"`);
    }
    for (const [sym, list] of Object.entries(idx.receptors.symbols)) {
      if (!new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(sym)}([^A-Za-z0-9_]|$)`).test(text)) continue;
      for (const [id, w] of list) bump(id, w, `mentions symbol ${sym}`);
    }
  }
  for (const f of files) {
    const rel = path.isAbsolute(f) ? path.relative(brain.root, f) : f;
    for (const [glob, id, w] of idx.receptors.paths) if (globMatch(glob, rel)) bump(id, w, `file ${rel} matches ${glob}`);
  }
  return seeds;
}

export function ignite(brain, { text = '', files = [], signal, remember = true, idx } = {}) {
  idx ||= loadIndex(brain);
  const cfg = brain.schema.ignition;
  signal ||= files.length && !text ? 'code-change' : 'product-change';
  const seeds = matchSeeds(brain, idx, { text, files, signal });
  const fresh = seeds.size ? spread(brain, idx, seeds, { signal }) : new Map();

  const st = remember ? brain.loadState() : { turn: 0, nodes: {} };
  st.turn += 1;
  // Residual charge from earlier turns boosts related follow-ups (short-term memory).
  for (const [id, m] of Object.entries(st.nodes)) {
    m.charge *= cfg.memory_decay;
    if (m.charge < 0.03 && st.turn - (m.injected ?? -99) > cfg.refractory_turns) delete st.nodes[id];
  }
  const cands = [];
  for (const [id, v] of fresh) {
    const n = idx.nodes[id];
    const residual = st.nodes[id]?.charge || 0;
    const charge = Math.min(1, v.charge + residual * 0.5);
    const th = n.threshold ?? cfg.threshold;
    if (charge >= th) cands.push({ id, n, charge, why: v.why, seed: seeds.has(id) });
  }
  cands.sort((a, b) => b.charge - a.charge || (b.seed - a.seed));

  const fired = [];
  const still = [];
  let used = 0;
  for (const c of cands) {
    if (fired.length >= cfg.top_k) break;
    const mem = st.nodes[c.id];
    const recent = mem && mem.injected != null && st.turn - mem.injected <= cfg.refractory_turns && c.charge <= (mem.peak ?? 0) + 0.1;
    if (recent) { still.push(c.id); continue; }
    const text1 = fmt(c);
    if (used + approxTokens(text1) > cfg.token_budget) break;
    used += approxTokens(text1);
    fired.push({ ...c, text: text1 });
  }
  for (const c of cands) {
    const m = (st.nodes[c.id] ||= { charge: 0 });
    m.charge = Math.max(m.charge, c.charge);
    if (fired.some((f) => f.id === c.id)) { m.injected = st.turn; m.peak = c.charge; }
  }
  if (remember) brain.saveState(st);
  return { signal, fired, still, seeds: seeds.size };
}

function fmt(c) {
  const n = c.n;
  const flight = n.lifecycle === 'provisional' ? `\n    IN FLIGHT on lane ${n.lane} (not live yet)` : '';
  const dep = n.lifecycle === 'deprecated' ? `\n    DEPRECATED${n.pending_removal ? `, removal pending in lane ${n.pending_removal}` : ''}: plan migration` : '';
  return `- ${n.id} (${n.kind}) ${c.charge.toFixed(2)} ${c.why}\n    ${n.summary || n.title}${n.on_fire ? `\n    now: ${n.on_fire}` : ''}${flight}${dep}`;
}

export function formatIgnition(res, { header = true } = {}) {
  if (!res.fired.length && !res.still.length) return '';
  const out = [];
  if (header) out.push(`[brain] Neurons fired (signal: ${res.signal}). Look here before searching the codebase; deep dive with \`node brain/neurolane.mjs read <id> --tier digest|full\` or \`pack <id>\`.`);
  for (const f of res.fired) out.push(f.text);
  if (res.still.length) out.push(`Still active from earlier turns: ${res.still.join(', ')}`);
  return out.join('\n');
}
