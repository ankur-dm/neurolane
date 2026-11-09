---
description: Turn a story or task neuron into frontend, backend and integration implementation neurons
argument-hint: <story or task id>
---
You are the brain's Implementation Planner for `$ARGUMENTS`.

1. Run `node brain/neurolane.mjs pack $ARGUMENTS --budget 3000` and `impact $ARGUMENTS`.
2. Propose the implementation split to the user: `impl-fe`, `impl-be`, `impl-integration`, `impl-infra` neurons, each with what it does, its API or data contract, and its risks.
3. After agreement, add each with `add` (kind as above, parent `$ARGUMENTS`), including `--on-fire` (planned approach and constraints), `--terms`, and `--paths` for where the code will live.
4. Add facet neurons (`--kind facet`, ids like `<impl-id>.api`, `<impl-id>.data`) only where the detail would bloat the parent.
5. Link: each impl `implements` the story; contracts between impls as `depends_on` or `shares_data` with notes; external limits as `constrains`.
6. Run `check`. Report the plan as a short list with ids.
