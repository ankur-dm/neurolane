// File-backed storage for the brain: neurons, synapses, schema, lanes, state.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseYaml, stringifyYaml, parseFrontmatter, stringifyFrontmatter } from './yaml.mjs';

export const today = () => new Date().toISOString().slice(0, 10);
export const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);

// Locate the brain folder: $NEUROLANE_BRAIN, else walk up from cwd looking for brain/schema.yaml.
export function findBrain(start = process.cwd()) {
  if (process.env.NEUROLANE_BRAIN) return path.resolve(process.env.NEUROLANE_BRAIN);
  let dir = path.resolve(start);
  while (true) {
    const cand = path.join(dir, 'brain');
    if (fs.existsSync(path.join(cand, 'schema.yaml'))) return cand;
    const up = path.dirname(dir);
    if (up === dir) return path.join(path.resolve(start), 'brain');
    dir = up;
  }
}

export const DEFAULT_SCHEMA = {
  version: 1,
  kinds: ['vision', 'domain', 'epic', 'story', 'task', 'impl-fe', 'impl-be', 'impl-integration', 'impl-infra', 'facet', 'concept'],
  facets: ['git', 'cicd', 'code', 'data', 'api', 'ux', 'compliance', 'ops'],
  lifecycle: ['provisional', 'active', 'deprecated', 'obsolete', 'archived'],
  status: ['planned', 'in-progress', 'shipped', 'blocked'],
  synapse_types: {
    depends_on: { direction: 'both', weight: 0.8 },
    implements: { direction: 'both', weight: 0.9 },
    constrains: { direction: 'both', weight: 0.7 },
    shares_data: { direction: 'both', weight: 0.6 },
    risks: { direction: 'both', weight: 0.7 },
    informs: { direction: 'forward', weight: 0.4 },
    about: { direction: 'both', weight: 0.9 },
  },
  signals: ['product-change', 'code-change', 'risk', 'info'],
  ignition: {
    threshold: 0.3,
    decay_per_hop: 0.75,
    max_hops: 3,
    top_k: 8,
    token_budget: 1200,
    tree_weight: 0.45,
    tree_up_weight: 0.3,
    memory_decay: 0.5,
    refractory_turns: 2,
  },
  lanes: {
    required_for_code_edits: true,
    exempt_paths: ['brain/**', '.claude/**', 'CLAUDE.md', '**/*.md', '.gitignore'],
    stale_after_days: 30,
  },
  summary_words: { summary: 40, digest: 250, on_fire: 60 },
};

export class Brain {
  constructor(dir = findBrain()) {
    this.dir = dir;
    this.root = path.dirname(dir);
    this.nodesDir = path.join(dir, 'nodes');
    this.archiveDir = path.join(dir, '_archive');
    this.lanesDir = path.join(dir, 'lanes');
    this.stateDir = path.join(dir, '.state');
    this._nodes = null;
    this._syn = null;
    this._schema = null;
  }

  exists() { return fs.existsSync(path.join(this.dir, 'schema.yaml')); }

  get schema() {
    if (!this._schema) {
      const p = path.join(this.dir, 'schema.yaml');
      const user = fs.existsSync(p) ? parseYaml(fs.readFileSync(p, 'utf8')) || {} : {};
      this._schema = deepMerge(structuredClone(DEFAULT_SCHEMA), user);
    }
    return this._schema;
  }

  // ---------- nodes ----------
  nodeFile(id, archived = false) { return path.join(archived ? this.archiveDir : this.nodesDir, `${id}.md`); }

  loadNodes(includeArchived = true) {
    if (this._nodes) return this._nodes;
    const map = new Map();
    for (const [dir, archived] of [[this.nodesDir, false], [this.archiveDir, true]]) {
      if (!fs.existsSync(dir)) continue;
      if (archived && !includeArchived) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.md')) continue;
        const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
        const id = data.id || f.slice(0, -3);
        map.set(id, normalizeNode({ ...data, id }, body, archived));
      }
    }
    this._nodes = map;
    return map;
  }

  get(id) { return this.loadNodes().get(id); }
  require(id) {
    const n = this.get(id);
    if (!n) throw new UserError(`No neuron with id "${id}". Try: neurolane search <words>`);
    return n;
  }

  saveNode(node) {
    const { body, _archived, ...data } = node;
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    const file = this.nodeFile(node.id, _archived);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, stringifyFrontmatter(orderNode(clean), body || ''));
    if (this._nodes) this._nodes.set(node.id, node);
  }

  deleteNodeFile(id) {
    for (const archived of [false, true]) {
      const f = this.nodeFile(id, archived);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    if (this._nodes) this._nodes.delete(id);
  }

  archiveNode(id) {
    const n = this.require(id);
    const from = this.nodeFile(id, false);
    n.lifecycle = 'archived';
    n._archived = true;
    this.saveNode(n);
    if (fs.existsSync(from)) fs.unlinkSync(from);
  }

  children(id, { all = false } = {}) {
    return [...this.loadNodes().values()].filter((n) => n.parent === id && (all || isLive(n)));
  }

  // ---------- synapses ----------
  synFile() { return path.join(this.dir, 'synapses.yaml'); }
  loadSynapses() {
    if (this._syn) return this._syn;
    const f = this.synFile();
    const data = fs.existsSync(f) ? parseYaml(fs.readFileSync(f, 'utf8')) || {} : {};
    this._syn = (data.synapses || []).map((s) => ({ ...s }));
    return this._syn;
  }
  saveSynapses() {
    const header = '# Influence links between neurons. Managed by `node brain/neurolane.mjs link`; safe to edit by hand.\n';
    fs.writeFileSync(this.synFile(), header + stringifyYaml({ synapses: this.loadSynapses() }));
  }
  synKey(s) { return `${s.from}|${s.type}|${s.to}`; }

  // ---------- lanes ----------
  laneFile(name) { return path.join(this.lanesDir, `${name}.yaml`); }
  loadLane(name) {
    const f = this.laneFile(name);
    return fs.existsSync(f) ? parseYaml(fs.readFileSync(f, 'utf8')) : null;
  }
  saveLane(lane) {
    fs.mkdirSync(this.lanesDir, { recursive: true });
    fs.writeFileSync(this.laneFile(lane.name), stringifyYaml(lane));
  }
  listLanes() {
    if (!fs.existsSync(this.lanesDir)) return [];
    return fs.readdirSync(this.lanesDir).filter((f) => f.endsWith('.yaml')).map((f) => this.loadLane(f.slice(0, -5)));
  }

  // ---------- state (short-term memory, not committed) ----------
  loadState() {
    const f = path.join(this.stateDir, 'activation.json');
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { turn: 0, nodes: {} }; }
  }
  saveState(st) {
    fs.mkdirSync(this.stateDir, { recursive: true });
    fs.writeFileSync(path.join(this.stateDir, 'activation.json'), JSON.stringify(st, null, 1));
  }

  // ---------- git ----------
  git(args) {
    try { return execFileSync('git', args, { cwd: this.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
  }
  branch() { return process.env.NEUROLANE_BRANCH || this.git(['symbolic-ref', '--short', 'HEAD']) || this.git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'local'; }
  laneName(branch = this.branch()) { return branch.replace(/[^A-Za-z0-9._-]+/g, '-'); }
  invalidate() { this._nodes = null; this._syn = null; }
}

export class UserError extends Error {}

export const isLive = (n) => !['obsolete', 'archived'].includes(n.lifecycle);

function normalizeNode(data, body, archived) {
  const n = { ...data, body: body || '' };
  n.kind ??= 'task';
  n.lifecycle ??= 'active';
  n.version ??= 1;
  n.summary ??= '';
  n.receptors = { terms: [], symbols: [], paths: [], ...(n.receptors || {}) };
  for (const k of ['terms', 'symbols', 'paths']) if (!Array.isArray(n.receptors[k])) n.receptors[k] = n.receptors[k] ? [n.receptors[k]] : [];
  n.facets ??= [];
  n.refs ??= [];
  n.tags ??= [];
  if (archived) n._archived = true;
  return n;
}

const ORDER = ['id', 'kind', 'title', 'parent', 'lifecycle', 'status', 'lane', 'provisional', 'pending_removal', 'version',
  'created', 'updated', 'summary', 'on_fire', 'receptors', 'fires_on', 'threshold', 'facets', 'refs', 'tags', 'owner',
  'metrics', 'superseded_by', 'replaces', 'deprecation_reason', 'children_hash', 'changelog'];
function orderNode(d) {
  const out = {};
  for (const k of ORDER) if (k in d) out[k] = d[k];
  for (const k of Object.keys(d)) if (!(k in out)) out[k] = d[k];
  return out;
}

function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], v);
    else a[k] = v;
  }
  return a;
}

// Section of a node body: "## Digest" etc.
export function section(body, name) {
  const re = new RegExp(`^##\\s+${name}\\s*$`, 'im');
  const m = body.match(re);
  if (!m) return '';
  const rest = body.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

// Glob matcher supporting **, *, ? (path separators normalised to /).
export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
export const globMatch = (glob, p) => globToRegex(glob).test(p.replace(/\\/g, '/'));

export const approxTokens = (s) => Math.ceil(String(s).length / 4);
