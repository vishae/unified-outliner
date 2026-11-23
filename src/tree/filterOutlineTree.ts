/**
 * 26048-FEAT-002: heading search in the Outline Tree.
 *
 * Pure: narrows an outline tree to the headings whose text contains the
 * query (case-insensitive), keeping each match's parent headings so its
 * place in the note stays visible. Only section (heading) nodes are
 * searched and kept -- list items, paragraphs and composite rows are
 * dropped while a search is active, since the search covers heading text
 * only. A match's own non-matching descendants are hidden.
 *
 * Returns copies; the input tree is never mutated, so fold state and the
 * tree the rest of the view works on are untouched while searching.
 */
import type { OutlineTreeNode, OutlineTreeSectionNode } from "./buildOutlineTree";

export interface OutlineTreeFilterResult {
  tree: OutlineTreeSectionNode[];
  /** Ids of the headings that matched the query themselves. */
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

  const visit = (nodes: ReadonlyArray<OutlineTreeNode>): OutlineTreeSectionNode[] => {
    const out: OutlineTreeSectionNode[] = [];
    for (const node of nodes) {
      if (node.kind !== "section") continue;
      const children = visit(node.children);
      const matches = node.headingText.toLocaleLowerCase().includes(query);
      if (matches) matchIds.add(node.id);
      if (matches || children.length > 0) out.push({ ...node, children });
    }
    return out;
  };
  return { tree: visit(tree), matchIds };
}
