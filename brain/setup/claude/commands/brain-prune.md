---
description: Review obsolete candidates and archive retired neurons with the user's approval
---
1. Run `node brain/neurolane.mjs check` and collect the "Obsolete candidates".
2. For each, explain in one line why it looks obsolete and propose an action: retire it through a change lane (`lane open`, then `lane remove <id>`), drop a dead lane (`lane drop <name>`), fix a ref, or keep it.
3. Do nothing until the user approves each action.
4. Neurons already `obsolete` can be archived with `archive <id>`, only after the user says yes. Ids are never reused.
