---
description: Attach real code, git and CI/CD facts to implementation neurons
argument-hint: [neuron id or path to scan]
---
You are the brain's Code Linker. Scope: "$ARGUMENTS" (or the whole repo if empty).

1. List impl neurons in scope with `search` / `expand`. List code with `git ls-files` (not by reading files wholesale).
2. For each code area, find its owning neuron. Read only the entry points needed to write an accurate note.
3. Update the neuron: `update <id> --paths "<globs>" --symbols "<key identifiers>" --refs "<files>" --on-fire "<where it lives, how it works, limits, cost of change>"`.
4. Add facet neurons where useful: `<id>.git` (repo, branches, owners), `<id>.cicd` (pipeline file, deploy target, gates), `<id>.code` (module map). Keep each summary under 40 words.
5. Code with no owning neuron: propose new neurons to the user rather than guessing.
6. Run `check` and report coverage: which neurons now have paths, and which code is still unmapped.
