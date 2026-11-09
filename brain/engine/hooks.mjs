// Claude Code hook handlers. Wired in .claude/settings.json; they read the hook
// JSON on stdin and never need a server.
import path from 'node:path';
import { globMatch } from './store.mjs';
import { ignite, formatIgnition } from './ignite.mjs';
import { currentLane } from './lanes.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return {};
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

const emit = (event, context) => {
  if (!context) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
};

function relPath(brain, p) {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.resolve(brain.root, p);
  return path.relative(brain.root, abs).replace(/\\/g, '/');
}

const isExempt = (brain, rel) => rel.startsWith('..') || (brain.schema.lanes.exempt_paths || []).some((g) => globMatch(g, rel));

// UserPromptSubmit: fire neurons for the prompt and remind about the lane protocol.
export async function onPrompt(brain) {
  const input = await readStdin();
  if (!brain.exists()) return;
  const prompt = input.prompt || '';
  const res = ignite(brain, { text: prompt });
  const parts = [];
  const fired = formatIgnition(res);
  if (fired) parts.push(fired);
  if (brain.schema.lanes.required_for_code_edits && !currentLane(brain)) {
    parts.push(`[brain] No change lane is open on branch ${brain.branch()}. If this request changes code: validate it against the neurons above, then run \`node brain/neurolane.mjs lane open --ask "<the ask>"\`, add provisional neurons/links for what changes, and mark replaced neurons with \`lane remove <id>\`. Code edits are blocked until the lane exists.`);
  }
  emit('UserPromptSubmit', parts.join('\n\n'));
}

// PreToolUse (Edit/Write/MultiEdit/NotebookEdit): block code edits until a lane is open.
export async function onPreEdit(brain) {
  const input = await readStdin();
  if (!brain.exists() || process.env.NEUROLANE_GATE === 'off') return 0;
  if (!brain.schema.lanes.required_for_code_edits) return 0;
  const rel = relPath(brain, input.tool_input?.file_path || input.tool_input?.notebook_path);
  if (!rel || isExempt(brain, rel)) return 0;
  if (currentLane(brain)) return 0;
  process.stderr.write(`Blocked by the brain's change-lane protocol: no open lane on branch ${brain.branch()}.\n`
    + `Before editing ${rel}: 1) validate the ask: node brain/neurolane.mjs ignite --text "<ask>" 2) node brain/neurolane.mjs lane open --ask "<ask>" `
    + `3) add provisional neurons/synapses for what changes (neurolane add / neurolane link) and mark replaced ones (neurolane lane remove <id>). Then retry the edit.\n`);
  return 2;
}

// PostToolUse: fire neurons that own the edited file and record it in the lane.
export async function onPostEdit(brain) {
  const input = await readStdin();
  if (!brain.exists()) return;
  const rel = relPath(brain, input.tool_input?.file_path || input.tool_input?.notebook_path);
  if (!rel || rel.startsWith('..') || rel.startsWith('brain/')) return;
  const lane = currentLane(brain);
  if (lane && !lane.files.includes(rel)) { lane.files.push(rel); brain.saveLane(lane); }
  const res = ignite(brain, { files: [rel], signal: 'code-change' });
  emit('PostToolUse', formatIgnition(res));
}
