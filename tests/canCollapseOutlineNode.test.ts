import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { buildOutlineTree, OutlineTreeNode } from "../src/tree/buildOutlineTree";
import { canCollapseOutlineNode } from "../src/tree/canCollapseOutlineNode";

function labelOf(node: OutlineTreeNode): string {
  if (node.kind === "section") return node.headingText;
  if (node.kind === "list") return node.text;
  return node.label;
}

function findByLabel(nodes: OutlineTreeNode[], label: string): OutlineTreeNode {
  const hit = tryFind(nodes, label);
  if (!hit) throw new Error(`no node labelled ${label}`);
  return hit;
}

function tryFind(nodes: OutlineTreeNode[], label: string): OutlineTreeNode | null {
  for (const node of nodes) {
    if (labelOf(node) === label) return node;
    const deeper = tryFind(node.children, label);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * The affordance question: which rows get a fold toggle. Before this
 * predicate it was "does the row have child rows", which left a heading
 * whose body is prose, a table or a code block unfoldable from the pane
 * even though the fold itself (syncFoldToBodyEditor) works purely off the
 * document range and would have folded it happily.
 */
describe("canCollapseOutlineNode", () => {
  it("a heading with a sub-heading is collapsible, as it always was", () => {
    const doc = parseDocument("# Parent\n## Child\nbody\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Parent"), doc)).toBe(true);
  });

  it("a heading whose body is only prose is collapsible", () => {
    const doc = parseDocument("# Summary\nSome prose about the project.\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Summary"), doc)).toBe(true);
  });

  it("a heading whose body is only a fenced code block is collapsible — the case that motivated this", () => {
    const doc = parseDocument("## Technical Tasks\n```dataviewjs\ndv.table([])\n```\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Technical Tasks"), doc)).toBe(true);
  });

  it("a heading whose body is only a table is collapsible", () => {
    const doc = parseDocument("## Data\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Data"), doc)).toBe(true);
  });

  it("a heading with a genuinely empty body is NOT collapsible", () => {
    const doc = parseDocument("# Empty\n# Next\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Empty"), doc)).toBe(false);
  });

  it("the last heading in a file with nothing under it is NOT collapsible", () => {
    const doc = parseDocument("# Only\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Only"), doc)).toBe(false);
  });

  it("a heading followed only by blank lines is NOT collapsible — there is nothing to hide", () => {
    const doc = parseDocument("# Blank\n\n\n# Next\nbody\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Blank"), doc)).toBe(false);
    expect(canCollapseOutlineNode(findByLabel(tree, "Next"), doc)).toBe(true);
  });

  it("a single-line list item is NOT collapsible; a multi-line one is", () => {
    const doc = parseDocument("- one liner\n- wrapped item\n  continuation line\n");
    const tree = buildOutlineTree(doc, { includeLists: true });
    expect(canCollapseOutlineNode(findByLabel(tree, "one liner"), doc)).toBe(false);
    expect(canCollapseOutlineNode(findByLabel(tree, "wrapped item"), doc)).toBe(true);
  });

  it("falls back to the children test when the document is unavailable, so nothing that folded before stops folding", () => {
    const doc = parseDocument("# Parent\n## Child\nbody\n");
    const tree = buildOutlineTree(doc, {});
    expect(canCollapseOutlineNode(findByLabel(tree, "Parent"), null)).toBe(true);
    expect(canCollapseOutlineNode(findByLabel(tree, "Child"), null)).toBe(false);
    expect(canCollapseOutlineNode(findByLabel(tree, "Parent"), undefined)).toBe(true);
  });

  it("a node id absent from the document resolves to false rather than throwing", () => {
    const doc = parseDocument("# Heading\nbody\n");
    const orphan = { ...findByLabel(buildOutlineTree(doc, {}), "Heading"), id: "no-such-node" };
    expect(canCollapseOutlineNode(orphan as OutlineTreeNode, doc)).toBe(false);
  });
});
