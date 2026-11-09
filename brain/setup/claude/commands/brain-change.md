---
description: Run the change-lane protocol for a requested change before touching code
argument-hint: <what should change>
---
Change request: "$ARGUMENTS". Follow the protocol in CLAUDE.md section 2 exactly.

1. Validate: `node brain/neurolane.mjs ignite --text "$ARGUMENTS" --dry`, then `impact <id>` for the strongest neurons. Summarise for the user in a few lines: what it touches, feasibility, bottlenecks, migration, open questions. Stop and ask if something blocks.
2. `node brain/neurolane.mjs lane open --ask "$ARGUMENTS"`.
3. Update the brain first: provisional neurons (`add`), temporary synapses (`link`), removals (`lane remove <id> --reason ... --superseded-by ...`), changed facts (`update <id> ... --note`).
4. Show `lane status`, then implement the code change.
5. Afterwards refresh `on_fire` notes and `--paths` so the brain describes the new state, and run `check`.
