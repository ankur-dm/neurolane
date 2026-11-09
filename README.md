# neurolane

neurolane gives AI coding agents a neural knowledge graph of your product. The graph runs from the vision through epics, stories and tasks down to the frontend, backend and integration code. The agent works from compact summaries and opens a node only when it needs the detail, so its context stays small.

- **Neurons, not documents.** Each node carries a short summary for AI readers, a digest and a full body, and expands into branches and facets such as git, CI/CD and code.
- **Self-igniting.** Every prompt and file edit fires the neurons whose receptors match. The charge spreads along weighted synapses, and the agent is told which neurons lit up, why, and what exists there today.
- **Change lanes.** Every change goes through the brain before it touches the code. The agent checks the ask, opens a lane for the branch, and adds temporary nodes and links. A production deploy makes them permanent. A revert or rollback removes them. A node marked for removal leaves the graph only when the branch merges to main.
- **Nothing to deploy.** Everything is plain files in git, run by a zero-dependency Node script (Node 18 or later). Claude Code hooks connect it to the agent.

## Quick start

From the root of the repo you want to map:

```sh
cp -r path/to/neurolane/brain ./brain   # or add neurolane as a git subtree
cp path/to/neurolane/CLAUDE.md .        # the agent protocol (merge with yours if you have one)
node brain/neurolane.mjs init --vision "One or two sentences about the product"
node brain/neurolane.mjs install        # hooks + /brain-* commands into .claude/
cp brain/git-hooks/post-merge .git/hooks/
```

Restart Claude Code, then run `/brain-map` to grow the graph. `node brain/neurolane.mjs help` lists every command, and `node brain/neurolane.mjs view` writes a browsable map you can open in a browser.

In your deploy pipeline, after a successful production deploy, run:

```sh
node brain/neurolane.mjs lane promote --merged
```

Then commit the `brain/` changes.

## Docs

- [`CLAUDE.md`](CLAUDE.md): the protocol every agent session follows.
- [`brain/README.md`](brain/README.md): file layout, neuron fields, how ignition and lanes work.
- Tests: `npm test` (Node 18 or later, no install step).

## License

[MIT](LICENSE)
