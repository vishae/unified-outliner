import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { buildOutlineTree, isOutlineComplexMemberNode, isOutlineParagraphNode } from "../src/tree/buildOutlineTree";
import { buildNodeByIdMap } from "../src/tree/outlineNavigation";
import { resolveCurrentPositionNodeId } from "../src/tree/resolveCurrentPositionNodeId";
import { resolveHighlightedNodeId } from "../src/tree/resolveHighlightedSectionId";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ownerAt } from "./fixtures";

/**
 * Phase 5T-5A: builds a tree with BOTH paragraph and standalone callout/
 * blockquote projection turned on — the same combination
 * view/OutlineTreeView.ts's refresh() builds when both
 * showParagraphsInOutline and any composite/standalone projection are on
 * — plus the nodeById map resolveCurrentPositionNodeId itself needs.
 */
function setup(text: string, includeLists = true) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const tree = buildOutlineTree(doc, {
    includeLists,
    standaloneComplexBlocks: { blocks: complexScan.blocks },
    paragraphs: { blocks: complexScan.blocks },
  });
  const nodeById = buildNodeByIdMap(tree);
  return { doc, complexScan, tree, nodeById };
}

describe("resolveCurrentPositionNodeId (Phase 5T-5A, design doc §3-3/§5-1)", () => {
  it("resolves a heading line to its own section, exactly like resolveHighlightedNodeId (no regression)", () => {
    const text = ["# A", "body a", "# B"].join("\n");
    const { doc, complexScan, nodeById } = setup(text, false);
    const secA = ownerAt(doc, 0);
    expect(resolveCurrentPositionNodeId(doc, 0, complexScan, nodeById, { includeLists: false })).toBe(
      secA.id
    );
  });

  it("resolves a cursor on a list item to the item itself when includeLists is true (no regression)", () => {
    const text = ["# A", "- one", "  - one-1"].join("\n");
    const { doc, complexScan, nodeById } = setup(text, true);
    const oneOne = ownerAt(doc, 2);
    expect(resolveCurrentPositionNodeId(doc, 2, complexScan, nodeById, { includeLists: true })).toBe(
      oneOne.id
    );
  });

  it("agrees with resolveHighlightedNodeId exactly for every section/list line across a mixed fixture (regression sweep)", () => {
    const text = ["# A", "body a", "", "- one", "  - one-1", "## B", "- two"].join("\n");
    const { doc, complexScan, nodeById } = setup(text, true);
    for (let line = 0; line < doc.lines.length; line++) {
      const expected = resolveHighlightedNodeId(doc, line, { includeLists: true });
      const actual = resolveCurrentPositionNodeId(doc, line, complexScan, nodeById, {
        includeLists: true,
      });
      // A complex-block candidate (paragraph "body a") is expected to win
      // over the coarse section fallback at that one line — everywhere
      // else the two must agree exactly.
      if (line === 1) continue;
      expect(actual).toBe(expected);
    }
  });

  it("resolves a cursor inside a standalone paragraph to the paragraph's own Tree row, not the enclosing section", () => {
    const text = ["# H", "a standalone paragraph", "with a second line"].join("\n");
    const { doc, complexScan, tree, nodeById } = setup(text);
    const section = tree[0];
    const [row] = section.children;
    if (!isOutlineParagraphNode(row)) throw new Error("expected paragraph row");
    expect(resolveCurrentPositionNodeId(doc, 1, complexScan, nodeById, { includeLists: true })).toBe(
      row.id
    );
    expect(resolveCurrentPositionNodeId(doc, 2, complexScan, nodeById, { includeLists: true })).toBe(
      row.id
    );
    expect(row.id).not.toBe(ownerAt(doc, 1).id);
  });

  it("resolves a cursor inside a standalone callout to the callout's own Tree row", () => {
    const text = ["# H", "> [!note] My Note", "> body"].join("\n");
    const { doc, complexScan, tree, nodeById } = setup(text, false);
    const section = tree[0];
    const [row] = section.children;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member row");
    expect(resolveCurrentPositionNodeId(doc, 1, complexScan, nodeById, { includeLists: false })).toBe(
      row.id
    );
    expect(resolveCurrentPositionNodeId(doc, 2, complexScan, nodeById, { includeLists: false })).toBe(
      row.id
    );
  });

  it("resolves a cursor inside a standalone blockquote to the blockquote's own Tree row", () => {
    const text = ["# H", "> quoted line", "> second quoted line"].join("\n");
    const { doc, complexScan, tree, nodeById } = setup(text, false);
    const section = tree[0];
    const [row] = section.children;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member row");
    expect(resolveCurrentPositionNodeId(doc, 1, complexScan, nodeById, { includeLists: false })).toBe(
      row.id
    );
  });

  it("prioritizes a list-item-body paragraph's OWN Tree row over the enclosing list item (most-specific-match wins)", () => {
    const text = ["- one", "  continuation paragraph under the item"].join("\n");
    const { doc, complexScan, tree, nodeById } = setup(text, true);
    const listItem = tree[0];
    const nestedParagraph = listItem.children.find(isOutlineParagraphNode);
    expect(nestedParagraph).toBeDefined();
    const result = resolveCurrentPositionNodeId(doc, 1, complexScan, nodeById, { includeLists: true });
    expect(result).toBe(nestedParagraph!.id);
    expect(result).not.toBe(listItem.id);
  });

  it("falls back to the enclosing section for a standalone paragraph when paragraph projection is OFF (no Tree row exists to prefer)", () => {
    const text = ["# H", "a standalone paragraph"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    // No `paragraphs` option -> no paragraph Tree row exists at all.
    const tree = buildOutlineTree(doc, { includeLists: false, t: undefined });
    const nodeById = buildNodeByIdMap(tree);
    const secH = ownerAt(doc, 0);
    expect(resolveCurrentPositionNodeId(doc, 1, complexScan, nodeById, { includeLists: false })).toBe(
      secH.id
    );
  });

  it("falls back to the enclosing section for a blank line between two paragraphs", () => {
    const text = ["# H", "first paragraph", "", "second paragraph"].join("\n");
    const { doc, complexScan, nodeById } = setup(text, false);
    const secH = ownerAt(doc, 0);
    expect(resolveCurrentPositionNodeId(doc, 2, complexScan, nodeById, { includeLists: false })).toBe(
      secH.id
    );
  });

  it("returns null for a line inside a fenced code block (unchanged from resolveHighlightedNodeId — fenced-code has no Tree row today)", () => {
    const text = ["# H", "```", "not code", "```"].join("\n");
    const { doc, complexScan, nodeById } = setup(text, false);
    expect(resolveCurrentPositionNodeId(doc, 2, complexScan, nodeById, { includeLists: false })).toBeNull();
  });

  it("falls back to the enclosing section for a table line (table has no Tree row of its own today)", () => {
    const text = ["# H", "| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");
    const { doc, complexScan, nodeById } = setup(text, false);
    const secH = ownerAt(doc, 0);
    expect(resolveCurrentPositionNodeId(doc, 2, complexScan, nodeById, { includeLists: false })).toBe(
      secH.id
    );
  });

  it("returns null for frontmatter / out-of-range (unchanged fallback)", () => {
    const fm = parseDocument(["---", "title: x", "---", "# A"].join("\n"));
    const fmScan = scanComplexBlocks(fm);
    const fmTree = buildOutlineTree(fm, { includeLists: false });
    expect(
      resolveCurrentPositionNodeId(fm, 1, fmScan, buildNodeByIdMap(fmTree), { includeLists: false })
    ).toBeNull();

    const oor = parseDocument("# A");
    const oorScan = scanComplexBlocks(oor);
    const oorTree = buildOutlineTree(oor, { includeLists: false });
    expect(
      resolveCurrentPositionNodeId(oor, 99, oorScan, buildNodeByIdMap(oorTree), { includeLists: false })
    ).toBeNull();
  });

  it("resolves a cursor inside a callout that IS a matched composite's own member (composite-member row, not standalone) to that member row's id", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> ocr text"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      standaloneComplexBlocks: { blocks: complexScan.blocks },
    });
    const nodeById = buildNodeByIdMap(tree);
    const ocrInfo = complexScan.blocks.find((b) => b.kind === "callout");
    expect(ocrInfo).toBeDefined();
    expect(nodeById.has(ocrInfo!.id)).toBe(true);
    const result = resolveCurrentPositionNodeId(doc, 1, complexScan, nodeById, { includeLists: true });
    expect(result).toBe(ocrInfo!.id);
  });
});
