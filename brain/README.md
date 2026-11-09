# neurolane: the brain/ folder

`brain/` is a hierarchical, self-igniting knowledge graph that keeps AI context small. It is plain files in git. There is no server, no database and no dependencies: you only need Node 18 or later.

First-time setup, from the repo root: `node brain/neurolane.mjs init`, then `node brain/neurolane.mjs install` (copies the hooks and `/brain-*` commands into `.claude/`), then restart Claude Code.

```
brain/
  setup/claude/      hooks + slash commands that `install` copies into .claude/
  neurolane.mjs            CLI (node brain/neurolane.mjs help)
  schema.yaml        registry: kinds, facets, lifecycle, synapse types, signals, tuning
  nodes/<id>.md      one neuron per file: YAML frontmatter + "## Digest" + "## Body"
  synapses.yaml      typed, weighted influence links with notes
  lanes/<branch>.yaml  change lanes (provisional work tied to a branch)
  _archive/          retired neurons (ids are never reused)
  index.json, receptors.json   generated indexes (rebuilt automatically)
  .state/            short-term activation memory (not committed)
  engine/            implementation
  test/              node --test brain/test/neurolane.test.mjs
  git-hooks/post-merge
```

## Neuron fields

`id`, `kind`, `title`, `parent`, `lifecycle` (provisional, active, deprecated, obsolete, archived), `status`, `lane`, `version`, `created`, `updated`, `summary` (about 40 words), `on_fire` (current-state note, about 60 words), `receptors` (`terms`, `symbols`, `paths`), `fires_on`, `threshold`, `facets`, `refs`, `tags`, `owner`, `superseded_by`, `replaces`, `deprecation_reason`, `children_hash`, `changelog`. Unknown fields are kept as they are.

## How self-ignition works

A Claude Code hook feeds every prompt (and every edited file) to `neurolane ignite`, which runs four steps:

1. Receptors (terms, after stemming; code symbols; path globs) give matching neurons their first charge.
2. The charge spreads along synapses and the parent/child tree. At each hop it is multiplied by the link weight and by `decay_per_hop`. A synapse's `conducts` field limits which signals it carries.
3. Neurons above `threshold` fire. Only the `top_k` strongest are kept, within `token_budget`. A neuron that fired in the last `refractory_turns` turns is reported as "still active" rather than repeated in full.
4. The fired neurons, each with why it fired and its `on_fire` note, are injected into the agent's context.

All tuning values live in `schema.yaml` under `ignition`.

## Change lanes

Every code change goes through a lane. See `CLAUDE.md` section 2 for the full protocol. In short:

- **Open and block:** `lane open --ask` opens the lane. Until a lane is open, the pre-edit hook blocks code edits.
- **Provisional work:** inside a lane, `add` and `link` create provisional neurons and temporary synapses, and `lane remove` marks neurons for removal.
- **Merge to main:** `lane sync` makes the marked removals obsolete. Install it once with `cp brain/git-hooks/post-merge .git/hooks/`, then commit the result.
- **Production deploy:** `lane promote --merged` makes the lane's work permanent. Add it as a step in your deploy pipeline and commit the result.
- **Closed branch, revert or rollback:** `lane drop <name>` undoes the lane.

## Escape hatch

`NEUROLANE_GATE=off` disables the pre-edit gate for one session. Use it for emergencies only.
