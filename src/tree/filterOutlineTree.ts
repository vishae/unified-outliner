/**
 * 26048-FEAT-002: heading search in the Outline Tree.
 *
 * Pure: narrows an outline tree to the rows whose text contains the
 * query (case-insensitive), keeping each match's parents so its place in
 * the note stays visible. Headings and list items are searched; list
 * items are only in the tree when settings.showListItemsInOutline is on,
 * so with it off the search covers headings alone (Serena, 2026-11-23).
 * Composite and complex-member rows are never matched themselves but are
 * kept as the parent of a matching list item inside them; paragraphs and
 * mirrors are dropped. A match's own non-matching descendants are hidden.
 *
 * Returns copies; the input tree is never mutated, so fold state and the
 * tree the rest of the view works on are untouched while searching.
 */
import type { OutlineTreeNode } from "./buildOutlineTree";

export interface OutlineTreeFilterResult {
  tree: OutlineTreeNode[];
  /** Ids of the rows that matched the query themselves. */
  matchIds: Set<string>;
}

/** Pure: the trimmed, lower-cased query, or "" when there is nothing to search for. */
export function normalizeOutlineSearchQuery(raw: string): string {
  return raw.trim().toLocaleLowerCase();
}

export function filterOutlineTree(
  tree: ReadonlyArray<OutlineTreeNode>,
  rawQuery: string
): OutlineTreeFilterResult {
  const query = normalizeOutlineSearchQuery(rawQuery);
  const matchIds = new Set<string>();
  if (query === "") return { tree: [], matchIds };

  const searchableText = (node: OutlineTreeNode): string | null =>
    node.kind === "section" ? node.headingText : node.kind === "list" ? node.text : null;

  const visit = (nodes: ReadonlyArray<OutlineTreeNode>): OutlineTreeNode[] => {
    const out: OutlineTreeNode[] = [];
    for (const node of nodes) {
      if (node.kind === "paragraph" || node.kind === "mirror") continue;
      const children = visit(node.children);
      const text = searchableText(node);
      const matches = text !== null && text.toLocaleLowerCase().includes(query);
      if (matches) matchIds.add(node.id);
      if (matches || children.length > 0) out.push({ ...node, children } as OutlineTreeNode);
    }
    return out;
  };
  return { tree: visit(tree), matchIds };
}
