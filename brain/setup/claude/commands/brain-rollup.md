---
description: Refresh stale parent summaries bottom-up
---
1. Run `node brain/neurolane.mjs rollup`. It lists stale parents deepest first, with their children's summaries.
2. For each, write a new summary of at most 40 words that compresses its live children (and update `on_fire` if the current state changed): `update <id> --summary "..." --note "rollup"`.
3. Then `rollup --mark <id>`. Repeat until `rollup` reports all summaries current.
