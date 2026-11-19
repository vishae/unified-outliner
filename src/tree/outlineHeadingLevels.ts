import type { ParsedDocument } from "../model/block";
import type { OutlineTreeNode } from "./buildOutlineTree";
import { canCollapseOutlineNode } from "./hasFoldableContent";

/**
 * One heading level present in the current note, and everything the level
 * bar (view/OutlineTreeView.ts's renderHeadingLevelBar) needs to draw and
 * operate its button for that level.
 */
export interface OutlineHeadingLevelGroup {
  /** The heading level itself — 1 for H1, 2 for H2, and so on. */
  level: number;
  /**
   * Node ids at this level that actually have something to fold, in tree
   * order. Empty for a level whose headings are all empty-bodied, which is
   * exactly the case the bar renders as a disabled button rather than
   * hiding — see the module doc comment below.
   */
  foldableIds: string[];
  /**
   * Whether at least one of `foldableIds` is currently expanded, which is
   * what decides a click's direction: any expanded -> collapse them all,
   * otherwise expand them all.
   *
   * Computed over `foldableIds` ONLY, never over every node at the level.
   * A heading with nothing to fold is never in collapsedIds, so counting
   * it here would leave `anyExpanded` permanently true on any note holding
   * one empty-bodied heading, and the button would collapse forever and
   * never expand.
   */
  anyExpanded: boolean;
}

/**
 * Projects the current outline tree into one entry per heading level, for
 * the bulk collapse/expand buttons (26048-FEAT-001).
 *
 * Section nodes only. List, paragraph and composite projections carry
 * synthetic view ids that are not keys in `doc.nodes` and have no heading
 * level at all, so they contribute neither a level nor a foldable id —
 * "collapse every H2" is a statement about headings.
 *
 * A level appears here whenever the note has a heading at it, whether or
 * not anything at that level can be folded. That is what lets the bar keep
 * a stable set of buttons while a note is edited, disabling the ones with
 * nothing to do rather than having buttons appear and disappear under the
 * cursor: `foldableIds.length === 0` is the disabled case.
 *
 * Foldability is `canCollapseOutlineNode` — the same predicate that decides
 * whether an individual row gets a chevron — so a level's button can never
 * fold something the row itself refuses to, and vice versa.
 *
 * Pure: no Obsidian, no DOM, no view state beyond the collapsed set it is
 * handed. Same shape as canCollapseOutlineNode.ts, and for the same reason
 * — the level logic is the part worth unit-testing, and an ItemView
 * subclass cannot be constructed under vitest.
 */
export function collectOutlineHeadingLevels(
  tree: OutlineTreeNode[],
  doc: ParsedDocument | null | undefined,
  collapsedIds: ReadonlySet<string>
): OutlineHeadingLevelGroup[] {
  const byLevel = new Map<number, string[]>();

  const walk = (nodes: OutlineTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "section") {
        const existing = byLevel.get(node.headingLevel);
        const foldableIds = existing ?? [];
        if (!existing) byLevel.set(node.headingLevel, foldableIds);
        if (canCollapseOutlineNode(node, doc)) foldableIds.push(node.id);
      }
      walk(node.children);
    }
  };
  walk(tree);

  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, foldableIds]) => ({
      level,
      foldableIds,
      anyExpanded: foldableIds.some((id) => !collapsedIds.has(id)),
    }));
}

/**
 * The fold writes one click of `group`'s button should perform — collapse
 * every foldable heading at the level if any is currently expanded,
 * otherwise expand them all. Empty for a level with nothing to fold, so a
 * disabled button that is somehow activated anyway (keyboard, another
 * plugin) is a no-op rather than a malformed batch.
 *
 * Returned as an explicit list of writes, rather than a single boolean the
 * caller applies, so the batched write path (OutlineTreeView's
 * setNodesCollapsed) takes exactly the same entry shape from here as it
 * does from any other caller.
 */
export function planHeadingLevelFold(
  group: OutlineHeadingLevelGroup
): Array<{ nodeId: string; collapsed: boolean }> {
  const collapsed = group.anyExpanded;
  return group.foldableIds.map((nodeId) => ({ nodeId, collapsed }));
}
