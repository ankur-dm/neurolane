---
description: Assess what a proposed change touches, using spreading activation
argument-hint: <neuron id or description of the change>
---
1. If "$ARGUMENTS" is not a neuron id, run `node brain/neurolane.mjs ignite --text "$ARGUMENTS" --dry` and take the strongest neurons.
2. Run `impact <id>` for each and `read <id> --tier digest` only for the top hits.
3. Report to the user: affected neurons grouped by product, frontend, backend, integration; feasibility; bottlenecks; time-to-change drivers; migration items (deprecated neurons are flagged); open questions. Keep it short and cite neuron ids.
