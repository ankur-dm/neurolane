# Working in this repo: the brain comes first

This repo keeps a neural knowledge graph in `brain/`: neurons (vision → domains → epics → stories → tasks → frontend/backend/integration code, plus facets such as git, CI/CD and code) joined by weighted synapses. Use it to keep your context small: read summaries first and open deeper only where you need to.

All commands below run with `node brain/neurolane.mjs <command>`. Run `help` to see them all. If the `[brain]` hook messages never appear, the hooks are not installed yet: ask the user to run `node brain/neurolane.mjs install` and restart Claude Code.

## 1. Start from the brain, not the codebase

- Hooks inject a `[brain] Neurons fired` block when your prompt or a file edit matches neurons. Read it before searching code. Each line says why the neuron fired and what exists today (`now:`).
- If nothing fired, run `overview`, `search <words>` or `expand <id>`. Use `pack <id> --budget 4000` to load the context for a job, and `read <id> --tier full` only for the neuron you're actually changing.
- Don't read whole directories to orient yourself. If the brain lacks something you needed, add it (step 3), so the next session finds it.

## 2. Every change goes through a change lane (mandatory)

This applies to every change request, whether or not anyone invoked the brain commands.

1. **Validate the ask.** Run `ignite --text "<the ask>" --dry` and `impact <id>` on the neurons it hits. Check feasibility, conflicts, bottlenecks and migration notes. Raise anything blocking with the user before you continue.
2. **Open the lane.** Run `lane open --ask "<the ask>"`. Only one lane is open per branch, and later asks are appended to it.
3. **Change the brain first.**
   - New neurons go in with `add <id> --kind ... --parent ... --summary ... --on-fire ... --terms/--symbols/--paths ...`. Inside a lane they're provisional.
   - New influences go in with `link <from> <to> --type ... --note "..."`. Inside a lane they're temporary.
   - Neurons this change replaces or retires get `lane remove <id> --reason "..." --superseded-by <ids>`.
   - Neurons whose facts change get `update <id> --summary/--on-fire ... --note "why"`.
4. **Then change the code.** A pre-edit hook blocks code edits until the branch has an open lane. Edit code with the Edit/Write tools, not shell redirects, so the gate and post-edit ignition see each edit.
5. **Before you finish:** check that every touched file is covered by some neuron's `--paths` or `refs`, refresh the `on_fire` notes so they describe the new state, and run `check`.

Lifecycle after the branch:

- **Merge to main:** run `lane sync` (the `brain/git-hooks/post-merge` hook does this). Neurons marked for removal become obsolete, and only a main merge removes a neuron.
- **Production deploy:** run `lane promote --merged` in the deploy step. Provisional neurons and temporary synapses become permanent.
- **Closed branch, revert or rollback:** run `lane drop <name>`. Everything the lane added is removed and its removals are restored.

Commit the `brain/` changes with the code they describe.

## 3. Writing good neurons

- `summary` is about 40 words, written for an AI reader: what it is and why it matters. No filler.
- `on_fire` is about 60 words describing the current state: where it lives, how it works today, known limits, and what a change costs (migration, coupling).
- Receptors decide self-ignition:
  - `--terms` for the words people use, with optional weights (`validation,validate:0.9`).
  - `--symbols` for code identifiers.
  - `--paths` for file globs.
- Put cross-cutting ideas such as validation, auth, payments or notifications in a `concept` neuron, linked with `about` to every neuron that implements them.
- `kind`, facet types, synapse types and signals are registered in `brain/schema.yaml`. Add a new one there instead of misusing an existing one.
- Never reuse an id. Never delete neuron files by hand: use lanes, then `archive` (only with the user's approval).

## 4. Housekeeping

- `check` validates the graph and lists obsolete candidates. Review those with the user via `/brain-prune`.
- `rollup` lists parents whose summaries went stale. Rewrite each one, then run `rollup --mark <id>`.
- `view` writes `brain/viewer.html`, a browsable map where double-clicking a neuron expands it.
