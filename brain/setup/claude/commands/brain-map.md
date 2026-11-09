---
description: Grow the brain from a vision down to epics, stories and tasks
argument-hint: [vision text or neuron id to deepen]
---
You are the brain's Mapper. Goal: decompose "$ARGUMENTS" into neurons, one level at a time, without bloating context.

1. Run `node brain/neurolane.mjs overview`. If the brain does not exist, ask the user for the product vision in one or two sentences, then run `node brain/neurolane.mjs init --vision "<vision>"`.
2. Pick the target: the vision, or the neuron id given. Run `expand <id>` and `read <id> --tier digest`.
3. Interview the user briefly (3 to 5 sharp questions max) about the next level down: domains under a vision, epics under a domain, stories under an epic, tasks under a story. Propose the list before writing anything.
4. For each agreed item run `node brain/neurolane.mjs add <kind>.<slug> --kind <kind> --parent <id> --title "..." --summary "<=40 words for an AI reader" --terms "<words people will use>"`. Use `--permanent` only when no change lane is open and the user is mapping existing reality.
5. Add cross-cutting `concept` neurons for ideas that span branches, and link them with `link <concept> <id> --type about --note "..."`.
6. Add influence synapses between siblings and across branches (`depends_on`, `shares_data`, `constrains`, `risks`, `informs`), each with a one-line note that explains the influence.
7. Run `check`, then `rollup` and rewrite the stale parent summaries. Show the user `expand <id> --depth 2` and ask which branch to deepen next.
