// Change lanes: every change goes through the brain before the code.
// Provisional neurons and temporary synapses live in a lane tied to a branch.
// Merge to main makes removals final; production deploy makes additions permanent;
// a dropped lane (closed branch, revert, rollback) undoes everything it added.
import { today, UserError } from './store.mjs';
import { ignite } from './ignite.mjs';

export function currentLane(brain) {
  const lane = brain.loadLane(brain.laneName());
  return lane && lane.status === 'open' ? lane : null;
}

export function openLane(brain, { ask, branch = brain.branch() }) {
  if (!ask) throw new UserError('A lane needs the ask it validates: neurolane lane open --ask "what is changing and why"');
  const name = brain.laneName(branch);
  const existing = brain.loadLane(name);
  if (existing && existing.status === 'open') {
    existing.asks = [...(existing.asks || []), ask];
    brain.saveLane(existing);
    return { lane: existing, reused: true, res: ignite(brain, { text: ask, remember: false }) };
  }
  const res = ignite(brain, { text: ask, remember: false });
  const lane = {
    name, branch, status: 'open', opened: today(), ask,
    validation: { fired: res.fired.map((f) => ({ id: f.id, charge: Number(f.charge.toFixed(2)), why: f.why })) },
    nodes: [], links: [], removals: [], files: [],
  };
  brain.saveLane(lane);
  return { lane, reused: false, res };
}

function need(brain, name) {
  const lane = brain.loadLane(name || brain.laneName());
  if (!lane) throw new UserError(`No lane "${name || brain.laneName()}". Open one: neurolane lane open --ask "..."`);
  return lane;
}

export function markRemoval(brain, id, { reason, supersededBy, lane: laneName } = {}) {
  const lane = laneName ? need(brain, laneName) : currentLane(brain);
  if (!lane || lane.status !== 'open') throw new UserError('Open a lane first: neurolane lane open --ask "..."');
  const n = brain.require(id);
  if (lane.removals.some((r) => r.id === id)) return lane;
  lane.removals.push({ id, prev: n.lifecycle, reason: reason || '' });
  n.lifecycle = 'deprecated';
  n.pending_removal = lane.name;
  if (reason) n.deprecation_reason = reason;
  if (supersededBy) n.superseded_by = supersededBy.split(',').map((s) => s.trim());
  n.updated = today();
  brain.saveNode(n);
  brain.saveLane(lane);
  return lane;
}

// On merge to main: marked neurons become obsolete (leave the live graph).
export function mergeLane(brain, name) {
  const lane = need(brain, name);
  if (['merged', 'promoted', 'dropped'].includes(lane.status)) return lane;
  for (const r of lane.removals) {
    const n = brain.get(r.id);
    if (!n) continue;
    n.lifecycle = 'obsolete';
    delete n.pending_removal;
    n.updated = today();
    n.changelog = [...(n.changelog || []), `${today()} obsolete via lane ${lane.name}`];
    brain.saveNode(n);
  }
  lane.status = 'merged';
  lane.merged = today();
  brain.saveLane(lane);
  return lane;
}

// On main: any lane still "open" here arrived through a merge, so mark it merged.
export function syncMain(brain) {
  const b = brain.branch();
  const mains = brain.schema.lanes?.main_branches || ['main', 'master'];
  if (!mains.includes(b)) throw new UserError(`lane sync runs on the main branch (now on ${b}).`);
  return brain.listLanes().filter((l) => l && l.status === 'open' && l.branch !== b).map((l) => mergeLane(brain, l.name));
}

// On production deploy: provisional neurons and temporary links become permanent.
export function promoteLane(brain, name) {
  let lane = need(brain, name);
  if (lane.status === 'dropped') throw new UserError(`Lane ${lane.name} was dropped; nothing to promote.`);
  if (lane.status === 'promoted') return lane;
  if (lane.status === 'open') lane = mergeLane(brain, lane.name);
  for (const id of lane.nodes) {
    const n = brain.get(id);
    if (!n) continue;
    n.lifecycle = 'active';
    delete n.lane;
    delete n.provisional;
    n.updated = today();
    n.changelog = [...(n.changelog || []), `${today()} promoted from lane ${lane.name}`];
    brain.saveNode(n);
  }
  for (const s of brain.loadSynapses()) if (s.lane === lane.name) { delete s.lane; delete s.provisional; }
  brain.saveSynapses();
  lane.status = 'promoted';
  lane.promoted = today();
  brain.saveLane(lane);
  return lane;
}

export function promoteMerged(brain) {
  return brain.listLanes().filter((l) => l && l.status === 'merged').map((l) => promoteLane(brain, l.name));
}

// Closed branch, revert or rollback: remove what the lane added, restore removals.
export function dropLane(brain, name) {
  const lane = need(brain, name);
  if (lane.status === 'dropped') return lane;
  for (const n of [...brain.loadNodes().values()]) {
    if (n.lane === lane.name && n.lifecycle === 'provisional') brain.deleteNodeFile(n.id);
  }
  const syn = brain.loadSynapses();
  const keep = syn.filter((s) => s.lane !== lane.name);
  syn.length = 0; syn.push(...keep);
  brain.saveSynapses();
  for (const r of lane.removals) {
    const n = brain.get(r.id);
    if (!n) continue;
    n.lifecycle = r.prev === 'deprecated' || r.prev === 'obsolete' ? r.prev : 'active';
    delete n.pending_removal;
    delete n.deprecation_reason;
    delete n.superseded_by;
    n.updated = today();
    n.changelog = [...(n.changelog || []), `${today()} restored, lane ${lane.name} dropped`];
    brain.saveNode(n);
  }
  lane.status = 'dropped';
  lane.dropped = today();
  brain.saveLane(lane);
  return lane;
}

export function laneStatus(brain, name) {
  const lane = need(brain, name);
  const out = [`Lane ${lane.name} (branch ${lane.branch}): ${lane.status}, opened ${lane.opened}`, `Ask: ${lane.ask}`];
  if (lane.asks?.length) out.push(`Later asks: ${lane.asks.join(' | ')}`);
  if (lane.validation?.fired?.length) out.push(`Validated against: ${lane.validation.fired.map((f) => `${f.id} (${f.charge})`).join(', ')}`);
  out.push(`Provisional neurons: ${lane.nodes.join(', ') || 'none'}`);
  out.push(`Temporary synapses: ${lane.links.join(', ') || 'none'}`);
  out.push(`Marked for removal: ${lane.removals.map((r) => r.id).join(', ') || 'none'}`);
  if (lane.files?.length) out.push(`Code files touched: ${lane.files.join(', ')}`);
  return out.join('\n');
}
