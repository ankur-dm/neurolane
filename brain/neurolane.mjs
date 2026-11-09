#!/usr/bin/env node
// neurolane: the neural knowledge graph CLI. Zero dependencies, Node 18+.
// Run from anywhere inside the repo: node brain/neurolane.mjs <command> [args]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain, UserError, DEFAULT_SCHEMA, today, findBrain } from './engine/store.mjs';
import { stringifyYaml } from './engine/yaml.mjs';
import { buildIndex, loadIndex, overview, expand, pathTo, readNode, links, search, impact, pack } from './engine/graph.mjs';
import { ignite, formatIgnition } from './engine/ignite.mjs';
import { openLane, currentLane, markRemoval, mergeLane, syncMain, promoteLane, promoteMerged, dropLane, laneStatus } from './engine/lanes.mjs';
import { check, rollup } from './engine/maintenance.mjs';
import { onPrompt, onPreEdit, onPostEdit } from './engine/hooks.mjs';
import { writeViewer } from './engine/viewer.mjs';

const HELP = `neurolane: neural knowledge graph for AI agents (no server, files in brain/)

Explore (pull)
  overview [--all]                      vision and top branches, summaries only
  expand <id> [--depth N] [--all]       branches and facets of a neuron
  read <id> [--tier summary|digest|full]
  path <id>                             breadcrumb from the vision down
  links <id> [--type T]                 synapses with their notes
  search <words>                        find neurons
  impact <id> [--threshold 0.2] [--signal product-change]
  pack <id> [--budget 4000]             minimal context for a job, within a token budget

Self-ignition (push)
  ignite --text "..." | --files a,b [--signal S] [--dry]

Write
  init [--vision "..."]                 create brain/ with schema and a vision neuron
  add <id> --kind K --parent P --title T --summary S [--on-fire N] [--terms a,b:0.8]
      [--symbols X,Y] [--paths "src/**"] [--status S] [--refs r1,r2] [--tags t] [--fires-on s1,s2]
      [--threshold 0.3] [--permanent]   (inside an open lane, new neurons are provisional)
  update <id> --field value ... [--note "changelog line"]
  link <from> <to> --type T [--weight 0.8] [--note "..."] [--direction both|forward] [--conducts a,b]
  unlink <from> <to> --type T

Change lanes (every code change goes through one)
  lane open --ask "..."                 validate the ask and open a lane for this branch
  lane status [name] | lane list
  lane remove <id> [--reason R] [--superseded-by a,b]   mark a neuron for removal
  lane merge [name]                     on merge to main: removals become obsolete
  lane sync                             on main: merge every lane that arrived via a merge
  lane promote [name|--merged]          on production deploy: provisional becomes permanent
  lane drop [name]                      closed branch, revert or rollback: undo the lane

Lifecycle and health
  check                                 validate; list stale summaries and obsolete candidates
  rollup [--mark <id>]                  list parents whose summaries need rewriting
  archive <id>                          move an obsolete neuron to brain/_archive (ask first)
  build                                 rebuild index.json and receptors.json
  view                                  write brain/viewer.html (open it in a browser)

Setup
  install                               copy hooks and /brain-* commands into .claude/ (run once)

Hooks (called by .claude/settings.json)
  hook prompt | hook pre-edit | hook post-edit`;

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const eq = k.indexOf('=');
      if (eq >= 0) flags[k.slice(0, eq)] = k.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}
const list = (v) => (v === undefined || v === true ? undefined : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const num = (v, d) => (v === undefined || v === true ? d : Number(v));

function init(brain, flags) {
  fs.mkdirSync(brain.nodesDir, { recursive: true });
  fs.mkdirSync(brain.lanesDir, { recursive: true });
  const sp = path.join(brain.dir, 'schema.yaml');
  if (!fs.existsSync(sp)) {
    fs.writeFileSync(sp, `# Registry for the brain. Add kinds, facets, synapse types or signals here; no code changes needed.\n${stringifyYaml(DEFAULT_SCHEMA)}`);
  }
  if (!fs.existsSync(brain.synFile())) fs.writeFileSync(brain.synFile(), 'synapses: []\n');
  const gi = path.join(brain.dir, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '.state/\nviewer.html\n');
  brain.invalidate();
  brain._schema = null;
  if (flags.vision && !brain.get('vision')) {
    brain.saveNode({ id: 'vision', kind: 'vision', title: flags.title || 'Vision', lifecycle: 'active', version: 1, created: today(), updated: today(),
      summary: String(flags.vision), receptors: { terms: [], symbols: [], paths: [] }, body: `## Digest\n\n${flags.vision}\n` });
  }
  buildIndex(brain);
  return `Brain ready at ${path.relative(process.cwd(), brain.dir) || '.'}. Next: /brain-map to grow it, or neurolane add ...`;
}

// Copy the Claude Code hooks and slash commands from brain/setup/claude into .claude/,
// merging hooks into an existing settings.json instead of overwriting it.
function install(brain) {
  const src = path.join(brain.dir, 'setup', 'claude');
  const dst = path.join(brain.root, '.claude');
  fs.mkdirSync(path.join(dst, 'commands'), { recursive: true });
  const cmds = fs.readdirSync(path.join(src, 'commands'));
  for (const f of cmds) fs.copyFileSync(path.join(src, 'commands', f), path.join(dst, 'commands', f));
  const ours = JSON.parse(fs.readFileSync(path.join(src, 'settings.json'), 'utf8'));
  const sp = path.join(dst, 'settings.json');
  const cur = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : {};
  cur.hooks ||= {};
  for (const [event, entries] of Object.entries(ours.hooks)) {
    const list = (cur.hooks[event] ||= []);
    for (const e of entries) {
      const sig = JSON.stringify(e);
      const i = list.findIndex((x) => JSON.stringify(x).includes('brain/neurolane.mjs'));
      if (i >= 0) list[i] = e; else if (!list.some((x) => JSON.stringify(x) === sig)) list.push(e);
    }
  }
  fs.writeFileSync(sp, `${JSON.stringify(cur, null, 2)}\n`);
  return `Installed ${cmds.length} slash commands into .claude/commands and the brain hooks into .claude/settings.json. Restart Claude Code to load them.`;
}

function addNode(brain, id, f) {
  if (!id) throw new UserError('Usage: neurolane add <id> --kind K --parent P --title T --summary S');
  if (brain.get(id)) throw new UserError(`${id} already exists. Use: neurolane update ${id} --field value`);
  const kind = f.kind || 'task';
  if (!brain.schema.kinds.includes(kind)) throw new UserError(`Unknown kind "${kind}". Known: ${brain.schema.kinds.join(', ')}. Add new kinds in brain/schema.yaml.`);
  if (f.parent && !brain.get(f.parent)) throw new UserError(`Parent "${f.parent}" does not exist.`);
  if (!f.parent && kind !== 'vision') throw new UserError('Every neuron except the vision needs --parent.');
  const lane = f.permanent ? null : currentLane(brain);
  const n = {
    id, kind, title: f.title || id, parent: f.parent, lifecycle: lane ? 'provisional' : 'active', status: f.status,
    lane: lane?.name, version: 1, created: today(), updated: today(), summary: f.summary || '', on_fire: f['on-fire'],
    receptors: { terms: list(f.terms) || [], symbols: list(f.symbols) || [], paths: list(f.paths) || [] },
    fires_on: list(f['fires-on']), threshold: f.threshold !== undefined ? Number(f.threshold) : undefined,
    refs: list(f.refs) || [], tags: list(f.tags) || [], owner: f.owner,
    body: `## Digest\n\n${f.digest || ''}\n\n## Body\n\n${f.body || ''}\n`,
  };
  brain.saveNode(n);
  if (lane) { lane.nodes.push(id); brain.saveLane(lane); }
  const words = (n.summary.match(/\S+/g) || []).length;
  return `Added ${id} (${kind}, ${n.lifecycle}${lane ? ` in lane ${lane.name}` : ''}).${words > brain.schema.summary_words.summary ? ` Warning: summary is ${words} words.` : ''}`;
}

const SCALAR_FIELDS = ['title', 'parent', 'kind', 'status', 'summary', 'on-fire', 'owner', 'threshold', 'lifecycle'];
function updateNode(brain, id, f) {
  const n = brain.require(id);
  const changed = [];
  for (const k of SCALAR_FIELDS) if (f[k] !== undefined) {
    const key = k.replace('-', '_');
    n[key] = key === 'threshold' ? Number(f[k]) : f[k];
    changed.push(key);
  }
  for (const k of ['terms', 'symbols', 'paths']) if (f[k] !== undefined) { n.receptors[k] = list(f[k]); changed.push(k); }
  for (const k of ['refs', 'tags', 'fires-on', 'superseded-by']) if (f[k] !== undefined) { n[k.replace('-', '_')] = list(f[k]); changed.push(k); }
  if (f.digest !== undefined) {
    n.body = /^##\s+Digest/m.test(n.body) ? n.body.replace(/(^##\s+Digest\s*\n)([\s\S]*?)(?=^##\s|$(?![\s\S]))/m, `$1\n${f.digest}\n\n`) : `## Digest\n\n${f.digest}\n\n${n.body}`;
    changed.push('digest');
  }
  if (!changed.length) throw new UserError('Nothing to update. Pass fields such as --summary, --on-fire, --terms, --status.');
  if (f.lifecycle && !brain.schema.lifecycle.includes(f.lifecycle)) throw new UserError(`Unknown lifecycle ${f.lifecycle}.`);
  n.version = (n.version || 1) + 1;
  n.updated = today();
  n.changelog = [...(n.changelog || []), `${today()} v${n.version}: ${f.note || `updated ${changed.join(', ')}`}`];
  brain.saveNode(n);
  return `Updated ${id} to v${n.version} (${changed.join(', ')}).`;
}

function link(brain, from, to, f) {
  if (!from || !to || !f.type) throw new UserError('Usage: neurolane link <from> <to> --type T [--weight W] [--note "..."]');
  brain.require(from); brain.require(to);
  if (!brain.schema.synapse_types[f.type]) throw new UserError(`Unknown synapse type "${f.type}". Known: ${Object.keys(brain.schema.synapse_types).join(', ')}. Add new types in brain/schema.yaml.`);
  const syn = brain.loadSynapses();
  const lane = f.permanent ? null : currentLane(brain);
  const s = { from, to, type: f.type, weight: num(f.weight, brain.schema.synapse_types[f.type].weight), note: f.note || undefined,
    direction: f.direction, conducts: list(f.conducts) };
  if (lane) { s.provisional = true; s.lane = lane.name; }
  const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
  const i = syn.findIndex((x) => brain.synKey(x) === brain.synKey(clean));
  if (i >= 0) syn[i] = { ...syn[i], ...clean }; else syn.push(clean);
  brain.saveSynapses();
  if (lane && !lane.links.includes(brain.synKey(clean))) { lane.links.push(brain.synKey(clean)); brain.saveLane(lane); }
  return `${i >= 0 ? 'Updated' : 'Linked'} ${from} -${f.type}-> ${to}${lane ? ` (temporary, lane ${lane.name})` : ''}.`;
}

function unlink(brain, from, to, f) {
  const syn = brain.loadSynapses();
  const before = syn.length;
  const keep = syn.filter((s) => !(s.from === from && s.to === to && (!f.type || s.type === f.type)));
  syn.length = 0; syn.push(...keep);
  brain.saveSynapses();
  return `Removed ${before - keep.length} synapse(s).`;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  const brain = new Brain(flags.brain ? path.resolve(flags.brain) : findBrain());
  if (!cmd || cmd === 'help' || flags.help) return console.log(HELP);
  if (cmd === 'hook') {
    if (pos[0] === 'prompt') return onPrompt(brain);
    if (pos[0] === 'pre-edit') { process.exitCode = await onPreEdit(brain); return; }
    if (pos[0] === 'post-edit') return onPostEdit(brain);
    throw new UserError('hook prompt | pre-edit | post-edit');
  }
  if (cmd === 'init') return console.log(init(brain, flags));
  if (cmd === 'install') return console.log(install(brain));
  if (!brain.exists()) throw new UserError('No brain here yet. Run: node brain/neurolane.mjs init --vision "..."');
  const idx = () => loadIndex(brain);
  const all = !!flags.all;
  switch (cmd) {
    case 'build': { const i = buildIndex(brain); return console.log(`Indexed ${Object.keys(i.nodes).length} neurons, ${i.synapses.length} synapses.`); }
    case 'overview': return console.log(overview(brain, idx(), { all }));
    case 'expand': return console.log(expand(brain, idx(), pos[0], { depth: num(flags.depth, 1), all }));
    case 'read': return console.log(readNode(brain, pos[0], flags.tier || 'summary'));
    case 'path': return console.log(pathTo(idx(), pos[0]).map((n, i) => `${'  '.repeat(i)}- ${n.id}: ${n.summary || n.title}`).join('\n'));
    case 'links': return console.log(links(brain, idx(), pos[0], { type: flags.type }));
    case 'search': {
      const r = search(idx(), pos.join(' '), { all });
      return console.log(r.length ? r.map((n) => `- ${n.id} (${n.kind}, ${n.lifecycle}): ${n.summary || n.title}`).join('\n') : 'No matches.');
    }
    case 'impact': return console.log(impact(brain, idx(), pos[0], { threshold: num(flags.threshold, 0.2), signal: flags.signal }));
    case 'pack': return console.log(pack(brain, idx(), pos[0], { budget: num(flags.budget, 4000) }));
    case 'ignite': {
      let text = flags.text === true ? '' : flags.text || pos.join(' ');
      if (!text && !flags.files && !process.stdin.isTTY) { for await (const c of process.stdin) text += c; }
      const res = ignite(brain, { text, files: list(flags.files) || [], signal: flags.signal, remember: !flags.dry });
      return console.log(formatIgnition(res) || 'Nothing fired. Add receptors (--terms, --symbols, --paths) to the neurons that should own this.');
    }
    case 'add': return console.log(addNode(brain, pos[0], flags));
    case 'update': return console.log(updateNode(brain, pos[0], flags));
    case 'link': return console.log(link(brain, pos[0], pos[1], flags));
    case 'unlink': return console.log(unlink(brain, pos[0], pos[1], flags));
    case 'lane': {
      const [sub, arg] = pos;
      if (sub === 'open') {
        const { lane, reused, res } = openLane(brain, { ask: flags.ask === true ? '' : flags.ask || pos.slice(1).join(' ') });
        const fired = formatIgnition(res, { header: false });
        return console.log(`${reused ? 'Added the ask to open' : 'Opened'} lane ${lane.name} on branch ${lane.branch}.\n${fired ? `Validated against these neurons:\n${fired}` : 'No existing neuron fired: this ask adds new ground, so add neurons for it.'}\nNext: add provisional neurons (neurolane add), temporary synapses (neurolane link), and mark replaced neurons (neurolane lane remove <id>). Then edit code.`);
      }
      if (sub === 'status' || !sub) return console.log(laneStatus(brain, arg));
      if (sub === 'list') return console.log(brain.listLanes().filter(Boolean).map((l) => `- ${l.name} (${l.branch}): ${l.status}, opened ${l.opened}: ${l.ask}`).join('\n') || 'No lanes.');
      if (sub === 'remove') { const l = markRemoval(brain, arg, { reason: flags.reason, supersededBy: flags['superseded-by'] }); return console.log(`${arg} marked for removal in lane ${l.name}. It leaves the graph when the branch merges to main.`); }
      if (sub === 'merge') { const l = mergeLane(brain, arg); return console.log(`Lane ${l.name}: ${l.status}. ${l.removals.length} neuron(s) now obsolete.`); }
      if (sub === 'sync') { const ls = syncMain(brain); return console.log(ls.length ? `Merged lanes: ${ls.map((l) => l.name).join(', ')}` : 'No open lanes arrived via merge.'); }
      if (sub === 'promote') {
        const ls = flags.merged ? promoteMerged(brain) : [promoteLane(brain, arg)];
        return console.log(ls.length ? `Promoted: ${ls.map((l) => `${l.name} (${l.nodes.length} neurons, ${l.links.length} synapses)`).join(', ')}` : 'No merged lanes waiting for deploy.');
      }
      if (sub === 'drop') { const l = dropLane(brain, arg); return console.log(`Lane ${l.name} dropped: removed ${l.nodes.length} provisional neuron(s) and ${l.links.length} temporary synapse(s); restored ${l.removals.length}.`); }
      throw new UserError('lane open|status|list|remove|merge|sync|promote|drop');
    }
    case 'check': {
      const r = check(brain);
      const out = [];
      if (r.errors.length) out.push('Errors:', ...r.errors.map((e) => `  - ${e}`));
      if (r.warnings.length) out.push('Warnings:', ...r.warnings.map((e) => `  - ${e}`));
      if (r.candidates.length) out.push('Obsolete candidates (review with /brain-prune):', ...r.candidates.map((e) => `  - ${e}`));
      console.log(out.join('\n') || 'Brain is healthy.');
      if (r.errors.length) process.exitCode = 1;
      return;
    }
    case 'rollup': return console.log(rollup(brain, { mark: flags.mark }));
    case 'archive': {
      const n = brain.require(pos[0]);
      if (n.lifecycle !== 'obsolete') throw new UserError(`${pos[0]} is ${n.lifecycle}; only obsolete neurons can be archived.`);
      brain.archiveNode(pos[0]);
      buildIndex(brain);
      return console.log(`Archived ${pos[0]} to brain/_archive/. Its id stays reserved.`);
    }
    case 'view': { const f = writeViewer(brain, buildIndex(brain)); return console.log(`Wrote ${path.relative(process.cwd(), f)}. Open it in a browser.`); }
    default: throw new UserError(`Unknown command "${cmd}".\n\n${HELP}`);
  }
}

main().catch((e) => {
  if (e instanceof UserError) { console.error(e.message); process.exitCode = 1; }
  else { console.error(e.stack || e); process.exitCode = 1; }
});

export const __file = fileURLToPath(import.meta.url);
