// Run: node --test brain/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml, stringifyYaml } from '../engine/yaml.mjs';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurolane-'));
  fs.cpSync(SRC, path.join(dir, 'brain'), { recursive: true, filter: (p) => !/[/\\](nodes|lanes|_archive|\.state|test)([/\\]|$)/.test(p.slice(SRC.length)) && !/(schema\.yaml|synapses\.yaml|index\.json|receptors\.json|viewer\.html)$/.test(p) });
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' }).toString().trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  const neurolane = (...a) => execFileSync('node', ['brain/neurolane.mjs', ...a], { cwd: dir, encoding: 'utf8' });
  const hook = (name, input) => spawnSync('node', ['brain/neurolane.mjs', 'hook', name], { cwd: dir, input: JSON.stringify(input), encoding: 'utf8' });
  const read = (id) => fs.readFileSync(path.join(dir, 'brain', 'nodes', `${id}.md`), 'utf8');
  return { dir, git, neurolane, hook, read };
}

function seed(s) {
  s.neurolane('init', '--vision', 'A product where users sign up and manage accounts');
  s.neurolane('add', 'domain.accounts', '--kind', 'domain', '--parent', 'vision', '--title', 'Accounts', '--summary', 'Signup and login');
  s.neurolane('add', 'concept.validation', '--kind', 'concept', '--parent', 'vision', '--title', 'Validation', '--summary', 'Input rules', '--terms', 'validation,validate:0.9');
  s.neurolane('add', 'story.signup', '--kind', 'story', '--parent', 'domain.accounts', '--title', 'User signup', '--summary', 'Create an account', '--terms', 'signup,sign up');
  s.neurolane('add', 'be.signup-validator', '--kind', 'impl-be', '--parent', 'story.signup', '--title', 'Signup validator', '--summary', 'Server checks',
    '--on-fire', 'Rules in src/server/validators/signup.ts', '--symbols', 'validateSignup', '--paths', 'src/server/validators/**');
  s.neurolane('link', 'concept.validation', 'be.signup-validator', '--type', 'about', '--note', 'server rules live here');
  s.neurolane('link', 'be.signup-validator', 'story.signup', '--type', 'implements');
}

test('yaml round-trips what neurolane writes', () => {
  const o = { a: 'x: y', b: [1, 'two', 'c d'], c: { d: [], e: {} }, f: 'l1\nl2', g: [{ from: 'a', to: 'b', note: 'n # x' }], h: null, i: true };
  assert.deepEqual(parseYaml(stringifyYaml(o)), o);
});

test('a prompt fires the code neuron that owns the concept', () => {
  const s = sandbox(); seed(s);
  const out = s.neurolane('ignite', '--text', 'Change the validation on signup', '--dry');
  assert.match(out, /concept\.validation .*matched "validation"/);
  assert.match(out, /be\.signup-validator \(impl-be\) [\d.]+ about from concept\.validation: server rules live here/);
  assert.match(out, /now: Rules in src\/server\/validators\/signup\.ts/);
  assert.doesNotMatch(out, /- vision \(/, 'weak upward spread stays under threshold');
  assert.match(s.neurolane('ignite', '--text', 'why does validateSignup throw', '--dry'), /be\.signup-validator .*symbol validateSignup/);
  assert.match(s.neurolane('ignite', '--files', 'src/server/validators/signup.ts', '--dry'), /be\.signup-validator/);
});

test('short-term memory suppresses repeats', () => {
  const s = sandbox(); seed(s);
  s.neurolane('ignite', '--text', 'signup validation');
  assert.match(s.neurolane('ignite', '--text', 'signup validation'), /Still active from earlier turns/);
});

test('pre-edit hook blocks code edits until a lane is open', () => {
  const s = sandbox(); seed(s);
  const blocked = s.hook('pre-edit', { tool_input: { file_path: path.join(s.dir, 'src/server/validators/signup.ts') } });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /no open lane/);
  assert.equal(s.hook('pre-edit', { tool_input: { file_path: path.join(s.dir, 'brain/nodes/x.md') } }).status, 0, 'brain edits are exempt');
  const prompt = s.hook('prompt', { prompt: 'make signup validation stricter' });
  const ctx = JSON.parse(prompt.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /be\.signup-validator/);
  assert.match(ctx, /No change lane is open/);
  s.git('checkout', '-q', '-b', 'feat/strict-pw');
  s.neurolane('lane', 'open', '--ask', 'Passwords need 12 characters');
  assert.equal(s.hook('pre-edit', { tool_input: { file_path: 'src/server/validators/signup.ts' } }).status, 0);
  const post = s.hook('post-edit', { tool_input: { file_path: path.join(s.dir, 'src/server/validators/signup.ts') } });
  assert.match(JSON.parse(post.stdout).hookSpecificOutput.additionalContext, /be\.signup-validator/);
  assert.match(s.neurolane('lane', 'status'), /Code files touched: src\/server\/validators\/signup\.ts/);
});

test('lane: provisional work becomes permanent on deploy, removals only on merge', () => {
  const s = sandbox(); seed(s);
  s.git('add', '-A'); s.git('commit', '-qm', 'brain');
  s.git('checkout', '-q', '-b', 'feat/otp');
  const open = s.neurolane('lane', 'open', '--ask', 'Replace password signup validation with OTP');
  assert.match(open, /Validated against these neurons/);
  s.neurolane('add', 'be.otp-verifier', '--kind', 'impl-be', '--parent', 'story.signup', '--title', 'OTP verifier', '--summary', 'Checks one-time codes');
  assert.match(s.read('be.otp-verifier'), /lifecycle: provisional/);
  assert.match(s.read('be.otp-verifier'), /lane: feat-otp/);
  assert.match(s.neurolane('link', 'be.otp-verifier', 'story.signup', '--type', 'implements'), /temporary, lane feat-otp/);
  s.neurolane('lane', 'remove', 'be.signup-validator', '--reason', 'passwords removed', '--superseded-by', 'be.otp-verifier');
  assert.match(s.read('be.signup-validator'), /lifecycle: deprecated/);
  assert.match(s.neurolane('ignite', '--text', 'signup validation', '--dry'), /removal pending in lane feat-otp/);
  // Merge to main: the lane arrives on main, sync marks removals obsolete.
  s.git('add', '-A'); s.git('commit', '-qm', 'otp'); s.git('checkout', '-q', 'main'); s.git('merge', '-q', 'feat/otp');
  assert.match(s.neurolane('lane', 'sync'), /feat-otp/);
  assert.match(s.read('be.signup-validator'), /lifecycle: obsolete/);
  assert.match(s.read('be.otp-verifier'), /lifecycle: provisional/, 'still provisional until deploy');
  assert.match(s.neurolane('lane', 'promote', '--merged'), /feat-otp \(1 neurons, 1 synapses\)/);
  assert.match(s.read('be.otp-verifier'), /lifecycle: active/);
  assert.doesNotMatch(fs.readFileSync(path.join(s.dir, 'brain/synapses.yaml'), 'utf8'), /provisional/);
  assert.doesNotMatch(s.neurolane('overview'), /signup-validator/);
  assert.match(s.neurolane('check'), /healthy|Warnings/);
  s.neurolane('archive', 'be.signup-validator');
  assert.ok(fs.existsSync(path.join(s.dir, 'brain/_archive/be.signup-validator.md')));
});

test('lane: dropping undoes additions and restores removals', () => {
  const s = sandbox(); seed(s);
  s.git('checkout', '-q', '-b', 'spike');
  s.neurolane('lane', 'open', '--ask', 'try magic links');
  s.neurolane('add', 'be.magic-link', '--kind', 'impl-be', '--parent', 'story.signup', '--summary', 'Magic link login');
  s.neurolane('link', 'be.magic-link', 'story.signup', '--type', 'implements');
  s.neurolane('lane', 'remove', 'be.signup-validator');
  assert.match(s.neurolane('lane', 'drop'), /removed 1 provisional neuron\(s\) and 1 temporary synapse\(s\); restored 1/);
  assert.ok(!fs.existsSync(path.join(s.dir, 'brain/nodes/be.magic-link.md')));
  assert.match(s.read('be.signup-validator'), /lifecycle: active/);
  assert.doesNotMatch(fs.readFileSync(path.join(s.dir, 'brain/synapses.yaml'), 'utf8'), /magic/);
});

test('check flags missing refs and rollup tracks stale parents', () => {
  const s = sandbox(); seed(s);
  s.neurolane('update', 'be.signup-validator', '--refs', 'src/gone.ts', '--note', 'add ref');
  assert.match(s.neurolane('check'), /ref src\/gone\.ts no longer exists/);
  assert.match(s.neurolane('rollup'), /story\.signup/);
  s.neurolane('rollup', '--mark', 'story.signup');
  assert.doesNotMatch(s.neurolane('rollup'), /^story\.signup:/m);
  assert.match(s.read('be.signup-validator'), /v2: add ref/);
});

test('queries stay small and the viewer renders', () => {
  const s = sandbox(); seed(s);
  assert.match(s.neurolane('expand', 'domain.accounts', '--depth', '2'), /be\.signup-validator/);
  assert.match(s.neurolane('impact', 'story.signup'), /be\.signup-validator .*charge/);
  const p = s.neurolane('pack', 'be.signup-validator', '--budget', '400');
  assert.ok(p.length / 4 <= 420, 'pack respects the budget');
  assert.match(s.neurolane('path', 'be.signup-validator'), /vision[\s\S]*story\.signup/);
  s.neurolane('view');
  assert.match(fs.readFileSync(path.join(s.dir, 'brain/viewer.html'), 'utf8'), /be\.signup-validator/);
});
