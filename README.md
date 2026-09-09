# Unified Outliner — personal fork

This is a personal fork of **[kazdonkai/unified-outliner](https://github.com/kazdonkai/unified-outliner)**, an Obsidian plugin for structural editing inside a single Markdown note.

All credit for the plugin belongs upstream. For what it does, how to install the real thing, screenshots and the full documentation, go to the [upstream repository](https://github.com/kazdonkai/unified-outliner) or its [Community Plugins listing](https://community.obsidian.md/plugins/unified-outliner). Nothing here replaces that; this fork is not published anywhere, and is built and deployed straight into one vault.

The fork exists because a few behaviours needed changing for one specific way of working: folding a note's actual sections from the outline pane, on project pages whose sections hold Dataview blocks rather than sub-headings. Each change is offered upstream where it makes sense as a general fix — see the status column.

## What's different?

| Change | Upstream status |
| --- | --- |
| Fold headings that have no sub-headings | Offered — [issue #3](https://github.com/kazdonkai/unified-outliner/issues/3) |
| Configurable scroll offset when jumping to a heading | Offered — [issue #2](https://github.com/kazdonkai/unified-outliner/issues/2) |
| Heading-level bulk collapse/expand buttons | Not offered yet |
| Separate plugin id, so the fork installs alongside the community build | Fork-only, never for upstream |

### Fold headings that have no sub-headings

Upstream gives a tree row a fold chevron only when it has child rows (`children.length > 0`). That is the right question for a tree widget, but folding a row here does not only hide tree rows — it also folds the matching section in the editor, using the document's own line range. So a heading whose body is prose, a table or a fenced code block, with no sub-heading under it, has real foldable content in the document and no way to fold it from the pane, even though Obsidian's own fold gutter folds it happily.

The chevron gate and both keyboard paths now ask "is there anything to fold?" instead, answered from the same place the fold itself reads — a `canCollapseOutlineNode` predicate over the node's document range. Everything that folded before still folds; the new cases are strictly additional. "Something to fold" means at least one non-blank line below the heading's own line, so a heading followed only by a blank line at the end of a file doesn't get a chevron that appears to do nothing.

### Configurable scroll offset when jumping to a heading

Upstream scrolls a jumped-to line flush with the top of the editor. Anything pinned over the top of that same scroller — a sticky toolbar from another plugin, or a theme's sticky header — then covers the very line just jumped to.

A **Jump scroll offset (pixels)** setting (0–1000, default 0, which is upstream's behaviour) is threaded into CodeMirror's existing `scrollIntoView` `yMargin`, rather than reimplementing the scroll.

### Heading-level bulk collapse/expand buttons

An optional row of buttons above the outline tree — `H1`, `H2`, `H3` … — one per heading level the current note actually uses. Clicking a level collapses every heading at that level, or expands them all if none is currently expanded, with a chevron on each button showing which way the next click goes. Off by default (**Show heading level fold buttons**).

Only levels present in the note get a button, and a level with nothing foldable is disabled rather than hidden, so the row doesn't reshuffle while the note is edited.

The buttons are the small half of this change. The larger half is a batched fold write path. Upstream's `setNodeCollapsed` updates the collapsed set, persists it, refreshes every other open tree view, and dispatches a CodeMirror fold transaction — once per node; looping that over twenty headings would work and would feel sluggish. It is now a one-entry delegate to a `setNodesCollapsed` that keeps the per-node collapsed-set and persistence writes (the fold state manager already debounces the actual save) but fires **one** cross-view refresh and **one** CodeMirror transaction carrying every fold effect for the whole batch — still annotated as tree-originated, so the reverse-sync listener ignores the batch instead of round-tripping every fold in it.

Composes with the fold-childless change above: a project page's `## Features` section, holding only a Dataview block, is foldable at all because of that fix, and folds along with its siblings because of this one.

### Separate plugin id

`manifest.json` uses the id `unified-outliner-serena` and the name **Unified Outliner (Serena)**, so this build installs beside the community build instead of overwriting it, and `scripts/deploy-dev.mjs` reads its destination folder from the manifest rather than hardcoding upstream's id. Fork bookkeeping, deliberately never offered upstream.

## Building it

Unchanged from upstream, plus a vault path for the deploy script:

```bash
npm install
npm test
OBSIDIAN_VAULT="$HOME/path/to/vault" npm run deploy:dev
```

Every change above ships with tests in the upstream suite's own style, and the suite is expected to stay green.

## Branches

- `main` — tracks upstream, unmodified.
- `serena/local-build` — what actually gets deployed: every change above, merged.
- `feat/*` — one branch per change, so each can be offered upstream on its own.

## Licence

MIT, as upstream — see [LICENSE](LICENSE). Copyright © 2026 Kazdon Kai.
