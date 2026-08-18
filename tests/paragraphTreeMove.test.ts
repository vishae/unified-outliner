import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { moveComplexBlock } from "../src/move/resolveMoveTarget";
import {
  buildParagraphMoveAnchor,
  moveParagraphFromAnchor,
  ParagraphDropTargetHint,
  ParagraphMoveAnchor,
  ParagraphTreeNodeHint,
  resolveParagraphDropDirection,
  resolveParagraphFromTreeHint,
} from "../src/edit/paragraphTreeMove";
import {
  buildOutlineTree,
  flattenOutlineTree,
  isOutlineComplexMemberNode,
  isOutlineParagraphNode,
  OutlineTreeParagraphNode,
} from "../src/tree/buildOutlineTree";
import { createTranslator } from "../src/i18n";

/**
 * Phase 5T-1 §8-1 ("anchor と再解決を純粋関数テストで検証すること — 静的ソース
 * 確認だけに依存しない"): real, executable tests for `buildParagraphMoveAnchor`
 * / `moveParagraphFromAnchor`, modeled directly on
 * tests/paragraphPartialEdit.test.ts's own no-op-fixture style (same
 * three-layer identity model) and on tests/resolveMoveTarget.test.ts's own
 * paragraph-swap fixtures (§5's allow/reject lists, reused verbatim here so
 * a Tree-triggered move is pinned to produce byte-identical output to the
 * existing body-cursor move for every one of them).
 */

/** Builds an anchor exactly the way OutlineTreeView#showParagraphMoveMenu would: resolve a live ComplexBlockInfo, then project it. */
function anchorForNth(text: string, n: number): ParagraphMoveAnchor {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  const paragraphs = scan.blocks.filter((b) => b.kind === "paragraph");
  const info = paragraphs[n];
  if (!info) throw new Error(`expected at least ${n + 1} paragraph(s) in this fixture`);
  const anchor = buildParagraphMoveAnchor(doc, info);
  if (!anchor) throw new Error("expected buildParagraphMoveAnchor to succeed for this fixture");
  return anchor;
}

describe("buildParagraphMoveAnchor", () => {
  it("captures kind/complexBlockId/parentId/depth/originalText/range from a live ComplexBlockInfo", () => {
    const text = ["# H", "paragraph A", "", "paragraph B"].join("\n");
    const anchor = anchorForNth(text, 0);
    expect(anchor.kind).toBe("paragraph");
    expect(anchor.originalText).toBe("paragraph A");
    expect(anchor.rangeStart).toBe(1);
    expect(anchor.rangeEnd).toBe(1);
    // Owned by section "H" (depth 0), so the paragraph itself is depth 1 —
    // complexBlockDepth(doc, parentId) = parent.depth + 1 (parser/complexBlocks.ts).
    expect(anchor.depth).toBe(1);
  });

  it("returns null for a non-paragraph ComplexBlockInfo (defense in depth against a caller passing the wrong kind)", () => {
    const doc = parseDocument(["# H", "> quoted line"].join("\n"));
    const scan = scanComplexBlocks(doc);
    const blockquote = scan.blocks.find((b) => b.kind === "blockquote")!;
    expect(blockquote).toBeDefined();
    expect(buildParagraphMoveAnchor(doc, blockquote)).toBeNull();
  });

  it("returns null for a paragraph whose editability is not 'supported' (e.g. an ambiguous boundary)", () => {
    const text = ["- item1", "  Child paragraph of item1.", "Not indented."].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const ambiguous = scan.blocks.find((b) => b.kind === "paragraph" && b.editability !== "supported");
    if (ambiguous) {
      expect(buildParagraphMoveAnchor(doc, ambiguous)).toBeNull();
    }
  });

  it("depth reflects nesting under a list item, not just 0 for section-level paragraphs", () => {
    const text = ["- item1", "  Child paragraph of item1.", "- item2"].join("\n");
    const anchor = anchorForNth(text, 0);
    expect(anchor.depth).toBeGreaterThan(0);
  });
});

describe("moveParagraphFromAnchor: id alone is never sufficient", () => {
  it("scan-local complexBlockId alone does not permit a move when the structural/content checks fail — an anchor built from one document, replayed against a DIFFERENT document that happens to reuse the same scan-local id at another paragraph, is rejected rather than silently moving the wrong paragraph", () => {
    const original = ["# H", "Target paragraph.", "", "Other paragraph."].join("\n");
    const anchor = anchorForNth(original, 0); // "Target paragraph." — complexBlockId "paragraph-0"
    // A completely different document where "paragraph-0" (the first
    // paragraph scanned) is unrelated content.
    const unrelatedText = ["# Different", "Unrelated first paragraph.", "", "Second."].join("\n");
    const doc = parseDocument(unrelatedText);
    const outcome = moveParagraphFromAnchor(unrelatedText, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("content-changed");
    expect(outcome.lines).toEqual(doc.lines);
  });
});

describe("moveParagraphFromAnchor: safe no-op rejections", () => {
  it("no-ops (resolve-failed or content-changed) when the paragraph was deleted", () => {
    const original = ["# H", "Before.", "", "Target paragraph.", "", "After."].join("\n");
    const anchor = anchorForNth(original, 1); // "Target paragraph."
    const changedText = ["# H", "Before.", "", "", "After."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = moveParagraphFromAnchor(changedText, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(["resolve-failed", "content-changed"]).toContain(outcome.reason);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("no-ops (resolve-failed or content-changed) when the paragraph was split by a new blank line", () => {
    const original = ["# H", "Target paragraph line one.", "line two."].join("\n");
    const anchor = anchorForNth(original, 0);
    const changedText = ["# H", "Target paragraph line one.", "", "line two."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = moveParagraphFromAnchor(changedText, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(["resolve-failed", "content-changed"]).toContain(outcome.reason);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("no-ops (content-changed) when the paragraph was merged with an adjacent paragraph", () => {
    const original = ["# H", "First.", "", "Second."].join("\n");
    const anchor = anchorForNth(original, 0); // "First."
    const changedText = ["# H", "First.", "Second."].join("\n"); // blank line removed, now merged
    const doc = parseDocument(changedText);
    const outcome = moveParagraphFromAnchor(changedText, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(["resolve-failed", "content-changed"]).toContain(outcome.reason);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("no-ops (resolve-failed) when the target became a callout instead of a paragraph", () => {
    const original = ["# H", "Plain text here.", "", "Trailing."].join("\n");
    const anchor = anchorForNth(original, 0);
    const changedText = ["# H", "> [!note] Plain text here.", "", "Trailing."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = moveParagraphFromAnchor(changedText, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("no-ops (identity-changed) when parentId changed (moved from list-item-child to section-direct) though its own text is unchanged", () => {
    const original = ["- item1", "  Stable text.", "- item2"].join("\n");
    const anchor = anchorForNth(original, 0);
    expect(anchor.depth).toBeGreaterThan(0);
    const changedText = ["item1 (no longer a list marker)", "  Stable text.", "item2 either"].join(
      "\n"
    );
    const doc = parseDocument(changedText);
    const outcome = moveParagraphFromAnchor(changedText, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("no-ops (content-changed) when the target paragraph's own content changed since the anchor was built", () => {
    const original = ["# H", "Original text.", "", "Other."].join("\n");
    const anchor = anchorForNth(original, 0);
    const changedText = ["# H", "Someone else edited this line.", "", "Other."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = moveParagraphFromAnchor(changedText, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("content-changed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("no-ops (ambiguous-match) when two byte-identical sibling paragraphs exist under the same parent — the target cannot be uniquely determined", () => {
    const original = ["# H", "Unique text.", "", "Other."].join("\n");
    const anchor = anchorForNth(original, 0); // "Unique text."
    // A document where TWO paragraphs, both direct children of the same
    // (root) parent at the same depth, share the exact text the anchor
    // captured — nothing in a fresh scan can prove which one the user
    // originally right-clicked.
    const ambiguousText = ["# H", "Unique text.", "", "Unique text.", "", "Other."].join("\n");
    const doc = parseDocument(ambiguousText);
    const outcome = moveParagraphFromAnchor(ambiguousText, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("ambiguous-match");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("no-ops (no-sibling) when there is no adjacent partner in the requested direction (start of document, direction up)", () => {
    const text = ["# H", "Only paragraph."].join("\n");
    const anchor = anchorForNth(text, 0);
    const doc = parseDocument(text);
    const outcome = moveParagraphFromAnchor(text, anchor, "up");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("no-sibling");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("no-ops (boundary-unknown) when a list item sits between two same-parent paragraphs (never hops across it)", () => {
    const text = ["# H", "paragraph A", "- list item", "paragraph B"].join("\n");
    const anchor = anchorForNth(text, 0); // "paragraph A"
    const doc = parseDocument(text);
    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("boundary-unknown");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("no body text changes by even one character on any rejection path (lines identical to a fresh parse, not merely 'no lines returned')", () => {
    const text = ["# H", "Solo paragraph."].join("\n");
    const anchor = anchorForNth(text, 0);
    const outcomeUp = moveParagraphFromAnchor(text, anchor, "up");
    const outcomeDown = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcomeUp.lines.join("\n")).toBe(text);
    expect(outcomeDown.lines.join("\n")).toBe(text);
  });
});

describe("moveParagraphFromAnchor: successful moves match 5P-4's own moveComplexBlock output byte-for-byte", () => {
  it("paragraph <-> paragraph (section-level)", () => {
    const text = ["# H", "paragraph A", "", "paragraph B"].join("\n");
    const anchor = anchorForNth(text, 0);
    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "paragraph B", "", "paragraph A"]);

    // Cross-check against 5P-4's own moveComplexBlock, called directly.
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const info = scan.blocks.find((b) => b.kind === "paragraph" && doc.lines[b.range.startLine] === "paragraph A")!;
    const direct = moveComplexBlock(
      doc,
      { kind: "paragraph", range: info.range, parentId: info.parentId, complexBlockId: info.id },
      "down",
      scan
    );
    expect(outcome.lines).toEqual(direct.lines);
    expect(outcome.newStartLine).toBe(direct.newStartLine);
  });

  it("paragraph <-> blockquote (same list item) — the exact fixture tests/resolveMoveTarget.test.ts pins for 5P-4's own moveComplexBlock, reused here to confirm the Tree-triggered path produces the identical result", () => {
    const text = [
      "- item1",
      "  > quoted continuation",
      "",
      "  Child paragraph of item1.",
      "- item2",
    ].join("\n");
    const doc0 = parseDocument(text);
    const scan0 = scanComplexBlocks(doc0);
    const blockquote = scan0.blocks.find((b) => b.kind === "blockquote")!;
    const childParagraph = scan0.blocks.find(
      (b) => b.kind === "paragraph" && doc0.lines[b.range.startLine].includes("Child paragraph")
    )!;
    expect(childParagraph.parentId).toBe(blockquote.parentId);
    const anchor = buildParagraphMoveAnchor(doc0, childParagraph)!;
    const outcome = moveParagraphFromAnchor(text, anchor, "up");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- item1",
      "  Child paragraph of item1.",
      "",
      "  > quoted continuation",
      "- item2",
    ]);
  });

  it("paragraph <-> callout (same list item) — exact fixture reused from tests/resolveMoveTarget.test.ts", () => {
    const text = [
      "- item1",
      "  child paragraph",
      "",
      "  > [!note] child callout",
      "  > body",
    ].join("\n");
    const doc0 = parseDocument(text);
    const scan0 = scanComplexBlocks(doc0);
    const callout = scan0.blocks.find((b) => b.kind === "callout")!;
    const childParagraph = scan0.blocks.find((b) => b.kind === "paragraph")!;
    expect(callout.parentId).toBe(childParagraph.parentId);
    const anchor = buildParagraphMoveAnchor(doc0, childParagraph)!;
    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- item1",
      "  > [!note] child callout",
      "  > body",
      "",
      "  child paragraph",
    ]);
  });

  it("paragraph <-> fenced-code (same list item) — exact fixture reused from tests/resolveMoveTarget.test.ts", () => {
    const text = [
      "- item1",
      "  child paragraph",
      "",
      "  ```",
      "  code",
      "  ```",
    ].join("\n");
    const doc0 = parseDocument(text);
    const scan0 = scanComplexBlocks(doc0);
    const fenced = scan0.blocks.find((b) => b.kind === "fenced-code")!;
    const childParagraph = scan0.blocks.find((b) => b.kind === "paragraph")!;
    expect(fenced.parentId).toBe(childParagraph.parentId);
    const anchor = buildParagraphMoveAnchor(doc0, childParagraph)!;
    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- item1",
      "  ```",
      "  code",
      "  ```",
      "",
      "  child paragraph",
    ]);
  });

  it("paragraph <-> thematic-break", () => {
    const text = ["# H", "paragraph A", "", "---", "", "trailing"].join("\n");
    const doc0 = parseDocument(text);
    const scan0 = scanComplexBlocks(doc0);
    const paragraphA = scan0.blocks.find((b) => b.kind === "paragraph" && doc0.lines[b.range.startLine] === "paragraph A")!;
    const anchor = buildParagraphMoveAnchor(doc0, paragraphA)!;
    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[0]).toBe("# H");
    expect(outcome.lines).toContain("---");
    // "paragraph A" now sits after the thematic break, not before it.
    const breakIdx = outcome.lines.indexOf("---");
    const paragraphIdx = outcome.lines.indexOf("paragraph A");
    expect(paragraphIdx).toBeGreaterThan(breakIdx);
  });

  it("paragraph <-> table", () => {
    const text = ["# H", "paragraph A", "", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const anchor = anchorForNth(text, 0);
    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "paragraph A",
    ]);
  });

  it("same-list-item paragraph sibling swap preserves blank-line-as-gap semantics", () => {
    const text = ["- item1", "  paragraph A", "", "  paragraph B"].join("\n");
    const anchor = anchorForNth(text, 0);
    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- item1", "  paragraph B", "", "  paragraph A"]);
  });

  it("moving up then moving down (replaying against the fresh output) restores the original document, exactly mirroring 5P-4's own stability contract", () => {
    const text = ["# H", "paragraph A", "", "paragraph B"].join("\n");
    const anchorA = anchorForNth(text, 0);
    const down = moveParagraphFromAnchor(text, anchorA, "down");
    expect(down.changed).toBe(true);
    const movedText = down.lines.join("\n");
    const doc2 = parseDocument(movedText);
    const scan2 = scanComplexBlocks(doc2);
    const paragraphAAgain = scan2.blocks.find(
      (b) => b.kind === "paragraph" && doc2.lines[b.range.startLine] === "paragraph A"
    )!;
    const anchorAAgain = buildParagraphMoveAnchor(doc2, paragraphAAgain)!;
    const up = moveParagraphFromAnchor(movedText, anchorAAgain, "up");
    expect(up.changed).toBe(true);
    expect(up.lines.join("\n")).toBe(text);
  });
});

describe("moveParagraphFromAnchor: still-rejected pairs/boundaries (§5 reject-list, exactly matching 5P-4)", () => {
  it("rejects paragraph <-> section (no swap across a section boundary)", () => {
    const text = ["# A", "trailing paragraph", "# B", "body"].join("\n");
    const anchor = anchorForNth(text, 0);
    const doc = parseDocument(text);
    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects paragraph <-> a different list item's child paragraph (different parentId, never offered as a target)", () => {
    const text = [
      "- item1",
      "  Child paragraph of item1.",
      "- item2",
      "  Child paragraph of item2.",
    ].join("\n");
    const anchor = anchorForNth(text, 0);
    const doc = parseDocument(text);
    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects when the anchor's depth no longer matches after an indentation-changing edit (identity-changed, not silently re-targeted)", () => {
    const original = ["- item1", "  Stable text.", "- item2"].join("\n");
    const anchor = anchorForNth(original, 0);
    const reindented = ["- item1", "    Stable text.", "- item2"].join("\n"); // extra indent
    const doc = parseDocument(reindented);
    const outcome = moveParagraphFromAnchor(reindented, anchor, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
  });
});

describe("moveParagraphFromAnchor / buildParagraphMoveAnchor: independence from showParagraphsInOutline", () => {
  it("neither function references or is gated by the Tree-display setting — the setting only ever controls whether the Tree SHOWS paragraph rows in the first place, never move eligibility or outcome (re-affirms 5T-1 ticket §2/§7: this is not paragraph Tree-editability)", () => {
    // A pure behavioral check: the same anchor/move sequence succeeds
    // identically regardless of any Tree-display concern, since this
    // module never reads Obsidian settings at all (it takes only text/
    // anchor/direction as input).
    const text = ["# H", "paragraph A", "", "paragraph B"].join("\n");
    const anchor = anchorForNth(text, 0);
    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(true);
  });
});

/**
 * Phase 5T-1R §3 ("Tree node 解決テスト"): unlike every test above (which
 * exercises buildParagraphMoveAnchor/moveParagraphFromAnchor directly
 * against a hand-built ComplexBlockInfo, bypassing the Tree entirely -
 * exactly why the real-device id-space-confusion bug in
 * view/OutlineTreeView.ts#showParagraphMoveMenu went uncaught by every one
 * of them), these tests build a REAL Outline Tree via
 * tree/buildOutlineTree.ts#buildOutlineTree and combine its actual
 * OutlineTreeParagraphNode output with a REAL scanComplexBlocks() result,
 * then feed that into edit/paragraphTreeMove.ts#resolveParagraphFromTreeHint
 * - the exact extracted function view/OutlineTreeView.ts#showParagraphMoveMenu
 * itself calls (see tests/paragraphOutlineTreeUiWiring.test.ts's own
 * "REGRESSION" test for the static-source-side confirmation of that; THIS
 * describe block is the real, executable side of that same guarantee,
 * per the ticket's explicit instruction not to rely on a source-text grep
 * alone). No change to parseDocument.ts or ParsedDocument.nodes is
 * involved anywhere below.
 */
function realParagraphTreeNodes(text: string): {
  doc: ReturnType<typeof parseDocument>;
  scan: ReturnType<typeof scanComplexBlocks>;
  paragraphNodes: OutlineTreeParagraphNode[];
} {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  const tree = buildOutlineTree(doc, {
    paragraphs: { blocks: scan.blocks },
    t: createTranslator("en"),
  });
  const paragraphNodes = flattenOutlineTree(tree).filter(isOutlineParagraphNode);
  return { doc, scan, paragraphNodes };
}

function hintFromNode(node: OutlineTreeParagraphNode): ParagraphTreeNodeHint {
  return { rangeStart: node.rangeStart, rangeEnd: node.rangeEnd, parentId: node.parentId };
}

describe("resolveParagraphFromTreeHint (Phase 5T-1R §3: real Tree-build + real scan)", () => {
  it("a real paragraph Tree node's own `id` (view identity, tree-paragraph:N) is NEVER equal to the ComplexBlockInfo.id (scan-local, paragraph-N) it corresponds to - the exact id-space confusion that produced the original real-device bug", () => {
    const text = ["# H", "paragraph A", "", "paragraph B", "", "paragraph C"].join("\n");
    const { scan, paragraphNodes } = realParagraphTreeNodes(text);
    expect(paragraphNodes).toHaveLength(3);
    for (const node of paragraphNodes) {
      expect(node.id).toMatch(/^tree-paragraph:[0-9]+$/);
      const wouldMatchById = scan.blocks.find((b) => b.id === node.id);
      // The buggy pre-faadbac lookup: comparing complexScan.blocks[].id
      // against the Tree node's own id can never succeed, because the two
      // are different id spaces entirely.
      expect(wouldMatchById).toBeUndefined();
    }
  });

  it("resolves each real paragraph Tree node back to its own live ComplexBlockInfo purely via rangeStart/rangeEnd/parentId - never via id string comparison", () => {
    const text = ["# H", "paragraph A", "", "paragraph B", "", "paragraph C"].join("\n");
    const { doc, scan, paragraphNodes } = realParagraphTreeNodes(text);
    expect(paragraphNodes.map((n) => n.label)).toEqual(["paragraph A", "paragraph B", "paragraph C"]);
    for (const node of paragraphNodes) {
      const resolved = resolveParagraphFromTreeHint(hintFromNode(node), scan);
      expect(resolved).not.toBeNull();
      expect(resolved!.range.startLine).toBe(node.rangeStart);
      expect(resolved!.range.endLine).toBe(node.rangeEnd);
      expect(resolved!.parentId).toBe(node.parentId);
      const extracted = doc.lines.slice(resolved!.range.startLine, resolved!.range.endLine + 1).join("\n");
      // Confirms the resolved block is genuinely the SAME paragraph the
      // node displayed, by content - even though resolution itself never
      // looked at content or at either id string.
      expect(extracted).toBe(node.label);
    }
  });

  it("resolution is unaffected when an earlier paragraph's removal shifts every later paragraph's view-id ordinal - a fresh Tree build assigns new tree-paragraph:N ids, yet the SAME underlying paragraph (identified by content) still re-resolves correctly by its OWN fresh range/parentId, never by comparing old and new id strings", () => {
    const before = ["# H", "paragraph A", "", "paragraph B", "", "paragraph C"].join("\n");
    const { paragraphNodes: nodesBefore } = realParagraphTreeNodes(before);
    const paragraphCBefore = nodesBefore.find((n) => n.label === "paragraph C");
    expect(paragraphCBefore?.id).toBe("tree-paragraph:3");

    // Simulate an edit that removes the first paragraph - every later
    // paragraph's scan-local id AND view-id ordinal shifts down by one.
    const after = ["# H", "paragraph B", "", "paragraph C"].join("\n");
    const { scan: scanAfter, paragraphNodes: nodesAfter } = realParagraphTreeNodes(after);
    const paragraphCAfter = nodesAfter.find((n) => n.label === "paragraph C");
    expect(paragraphCAfter?.id).toBe("tree-paragraph:2"); // ordinal shifted; a NEW view id.
    expect(paragraphCAfter?.id).not.toBe(paragraphCBefore?.id);

    // Resolution against the fresh scan, using the fresh node's own hint,
    // still finds paragraph C correctly - it never compared the old and
    // new id strings against each other at all.
    const resolved = resolveParagraphFromTreeHint(hintFromNode(paragraphCAfter!), scanAfter);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).not.toBe(paragraphCAfter!.id); // still two different id spaces, post-shift.
  });

  it("disambiguates two paragraphs with IDENTICAL preview text correctly, via each node's own distinct rangeStart/rangeEnd (never by label/content, which resolveParagraphFromTreeHint does not even inspect)", () => {
    const text = ["# H", "same text", "", "same text"].join("\n");
    const { paragraphNodes, scan } = realParagraphTreeNodes(text);
    expect(paragraphNodes).toHaveLength(2);
    expect(paragraphNodes[0].label).toBe(paragraphNodes[1].label); // identical preview text, by construction.
    expect(paragraphNodes[0].rangeStart).not.toBe(paragraphNodes[1].rangeStart);

    const resolvedFirst = resolveParagraphFromTreeHint(hintFromNode(paragraphNodes[0]), scan);
    const resolvedSecond = resolveParagraphFromTreeHint(hintFromNode(paragraphNodes[1]), scan);
    expect(resolvedFirst).not.toBeNull();
    expect(resolvedSecond).not.toBeNull();
    expect(resolvedFirst!.range.startLine).toBe(paragraphNodes[0].rangeStart);
    expect(resolvedSecond!.range.startLine).toBe(paragraphNodes[1].rangeStart);
    // The two resolved blocks are genuinely distinct document positions,
    // never accidentally collapsed onto one another.
    expect(resolvedFirst!.range.startLine).not.toBe(resolvedSecond!.range.startLine);
  });

  it("returns null (safe no-op) when the body changed and the hinted structural position no longer holds any paragraph at all - resolution never guesses", () => {
    const before = ["# H", "paragraph A", "", "paragraph B"].join("\n");
    const { paragraphNodes } = realParagraphTreeNodes(before);
    const staleHint = hintFromNode(paragraphNodes[1]); // "paragraph B"'s hint, captured pre-edit.

    // The referenced paragraph is deleted entirely; the document shrinks
    // so nothing at all occupies that old range any more.
    const after = ["# H", "paragraph A"].join("\n");
    const docAfter = parseDocument(after);
    const scanAfter = scanComplexBlocks(docAfter);

    const resolved = resolveParagraphFromTreeHint(staleHint, scanAfter);
    expect(resolved).toBeNull();
  });

  it("full pipeline: a stale hint whose structural position (parentId/range) coincidentally still matches a DIFFERENT paragraph's CURRENT position still resolves structurally (by design - this function only answers 'what lives there now'), but the downstream buildParagraphMoveAnchor + moveParagraphFromAnchor content check safely rejects the move rather than silently touching the wrong text - this is why the 9-step contract requires BOTH steps, never resolveParagraphFromTreeHint alone", () => {
    const before = ["# H", "paragraph A", "", "paragraph B"].join("\n");
    const { doc: docBefore, scan: scanBefore, paragraphNodes } = realParagraphTreeNodes(before);
    const nodeA = paragraphNodes[0];
    const infoABefore = resolveParagraphFromTreeHint(hintFromNode(nodeA), scanBefore);
    expect(infoABefore).not.toBeNull();
    const anchor = buildParagraphMoveAnchor(docBefore, infoABefore!);
    expect(anchor).not.toBeNull();

    // The body changes: "paragraph A"'s own text is edited in place, but
    // its structural position (parentId/range/depth) stays identical.
    const after = ["# H", "paragraph A EDITED", "", "paragraph B"].join("\n");

    // resolveParagraphFromTreeHint against the same OLD hint still finds
    // *something* at that structural position (by design/contract).
    const scanAfter = scanComplexBlocks(parseDocument(after));
    const resolvedAfter = resolveParagraphFromTreeHint(hintFromNode(nodeA), scanAfter);
    expect(resolvedAfter).not.toBeNull();

    // But the full, mandated pipeline (anchor built pre-edit, then
    // re-verified against the CURRENT text) safely rejects the move -
    // the byte-for-byte content check in moveParagraphFromAnchor's own
    // stage 3 is what actually prevents a wrong-content write-back.
    const outcome = moveParagraphFromAnchor(after, anchor!, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("content-changed");
    expect(outcome.lines).toEqual(parseDocument(after).lines);
  });

  it("no regression: section/list/standalone-complex-member Tree node id resolution is UNCHANGED - those kinds legitimately use the scan-local ComplexBlockInfo.id directly AS their own Tree node id (buildStandaloneComplexNode), which is exactly why the id-equality lookup pattern (correctly) still works for them and must never be 'fixed' to match paragraph's different contract", () => {
    const text = ["# H", "> [!note] My Note", "> body"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const tree = buildOutlineTree(doc, {
      standaloneComplexBlocks: { blocks: scan.blocks },
      t: createTranslator("en"),
    });
    const memberNode = flattenOutlineTree(tree).find(isOutlineComplexMemberNode);
    expect(memberNode).toBeDefined();
    const matchedById = scan.blocks.find((b) => b.id === memberNode!.id);
    // Unlike paragraph, this IS the correct, still-working lookup for a
    // standalone complex-member row - its Tree node id IS the scan-local
    // ComplexBlockInfo.id, verbatim.
    expect(matchedById).toBeDefined();
    expect(matchedById!.kind).toBe("callout");
  });
});

/**
 * Phase 5T-2 ("paragraph D&D の最小実装、案A限定"): pure-function tests for
 * `resolveParagraphDropDirection` — the hover/pre-flight "is this drop
 * target really my current adjacent sibling, and in which direction"
 * check driving both dragover's indicator and drop's direction choice.
 * Modeled on this file's own `moveParagraphFromAnchor` describe blocks
 * above (same anchorForNth helper, same fixtures reused where possible so
 * the D&D path is pinned to agree with the already-tested context-menu
 * path rather than drifting into a second, independently-verified notion
 * of adjacency).
 */

function hintFromRange(startLine: number, endLine: number, parentId: string | null): ParagraphDropTargetHint {
  return { rangeStart: startLine, rangeEnd: endLine, parentId };
}

describe("resolveParagraphDropDirection: valid adjacent drops", () => {
  it("up-sibling target, zone 'after' -> allowed, direction 'up'", () => {
    const text = ["# H", "paragraph A", "", "paragraph B", "", "paragraph C"].join("\n");
    const anchor = anchorForNth(text, 1); // "paragraph B"
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const infoA = scan.blocks.find((b) => doc.lines[b.range.startLine] === "paragraph A")!;
    const target = hintFromRange(infoA.range.startLine, infoA.range.endLine, infoA.parentId);

    const resolution = resolveParagraphDropDirection(text, anchor, target, "after");
    expect(resolution).toEqual({ allowed: true, direction: "up" });

    // The resolved direction, handed to the SAME execution path a
    // successful drop delegates to, produces exactly the up-swap.
    const outcome = moveParagraphFromAnchor(text, anchor, "up");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "paragraph B", "", "paragraph A", "", "paragraph C"]);
  });

  it("down-sibling target, zone 'before' -> allowed, direction 'down'", () => {
    const text = ["# H", "paragraph A", "", "paragraph B", "", "paragraph C"].join("\n");
    const anchor = anchorForNth(text, 1); // "paragraph B"
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const infoC = scan.blocks.find((b) => doc.lines[b.range.startLine] === "paragraph C")!;
    const target = hintFromRange(infoC.range.startLine, infoC.range.endLine, infoC.parentId);

    const resolution = resolveParagraphDropDirection(text, anchor, target, "before");
    expect(resolution).toEqual({ allowed: true, direction: "down" });

    const outcome = moveParagraphFromAnchor(text, anchor, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "paragraph A", "", "paragraph C", "", "paragraph B"]);
  });

  it("allowed drop, when executed via moveParagraphFromAnchor, matches 5P-4's own moveComplexBlock byte-for-byte (D&D never invents a second swap primitive)", () => {
    const text = [
      "- item1",
      "  > quoted continuation",
      "",
      "  Child paragraph of item1.",
      "- item2",
    ].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const paragraphInfo = scan.blocks.find(
      (b) => b.kind === "paragraph" && doc.lines[b.range.startLine].includes("Child paragraph")
    )!;
    const quoteInfo = scan.blocks.find((b) => b.kind === "blockquote")!;
    const anchor = buildParagraphMoveAnchor(doc, paragraphInfo)!;
    const target = hintFromRange(quoteInfo.range.startLine, quoteInfo.range.endLine, quoteInfo.parentId);

    const resolution = resolveParagraphDropDirection(text, anchor, target, "after");
    expect(resolution.allowed).toBe(true);
    if (!resolution.allowed) throw new Error("expected allowed");

    const outcome = moveParagraphFromAnchor(text, anchor, resolution.direction);
    const direct = moveComplexBlock(
      doc,
      {
        kind: "paragraph",
        range: paragraphInfo.range,
        parentId: paragraphInfo.parentId,
        complexBlockId: paragraphInfo.id,
      },
      resolution.direction,
      scan
    );
    expect(outcome.lines).toEqual(direct.lines);
    expect(outcome.newStartLine).toBe(direct.newStartLine);
  });

  it("standalone callout target (both directions) -> allowed, matches moveComplexBlock byte-for-byte (Phase 5T-2R: promoted from an ad-hoc real-device debug investigation into a proper regression test, since a standalone callout target was the exact pairing the 5T-2 real-device pass found broken at the UI-wiring layer even though this pure function was already correct)", () => {
    const text = [
      "## Section",
      "",
      "paragraph B1.",
      "",
      "> [!note] Callout title",
      "> Callout body.",
      "",
      "paragraph B2.",
    ].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const b1Info = scan.blocks.find(
      (b) => b.kind === "paragraph" && doc.lines[b.range.startLine].includes("paragraph B1")
    )!;
    const b2Info = scan.blocks.find(
      (b) => b.kind === "paragraph" && doc.lines[b.range.startLine].includes("paragraph B2")
    )!;
    const calloutInfo = scan.blocks.find((b) => b.kind === "callout")!;
    const target = hintFromRange(calloutInfo.range.startLine, calloutInfo.range.endLine, calloutInfo.parentId);

    // paragraph B1 is the callout's up-sibling from the callout's own
    // perspective, i.e. the callout is B1's DOWN-sibling -> zone "before".
    const anchorB1 = buildParagraphMoveAnchor(doc, b1Info)!;
    const resB1Before = resolveParagraphDropDirection(text, anchorB1, target, "before");
    expect(resB1Before).toEqual({ allowed: true, direction: "down" });
    const resB1After = resolveParagraphDropDirection(text, anchorB1, target, "after");
    expect(resB1After).toEqual({ allowed: false, reason: "wrong-zone" });

    const outcomeB1 = moveParagraphFromAnchor(text, anchorB1, "down");
    const directB1 = moveComplexBlock(
      doc,
      { kind: "paragraph", range: b1Info.range, parentId: b1Info.parentId, complexBlockId: b1Info.id },
      "down",
      scan
    );
    expect(outcomeB1.lines).toEqual(directB1.lines);
    expect(outcomeB1.newStartLine).toBe(directB1.newStartLine);

    // paragraph B2 is the callout's down-sibling -> the callout is B2's
    // UP-sibling -> zone "after".
    const anchorB2 = buildParagraphMoveAnchor(doc, b2Info)!;
    const resB2After = resolveParagraphDropDirection(text, anchorB2, target, "after");
    expect(resB2After).toEqual({ allowed: true, direction: "up" });
    const resB2Before = resolveParagraphDropDirection(text, anchorB2, target, "before");
    expect(resB2Before).toEqual({ allowed: false, reason: "wrong-zone" });

    const outcomeB2 = moveParagraphFromAnchor(text, anchorB2, "up");
    const directB2 = moveComplexBlock(
      doc,
      { kind: "paragraph", range: b2Info.range, parentId: b2Info.parentId, complexBlockId: b2Info.id },
      "up",
      scan
    );
    expect(outcomeB2.lines).toEqual(directB2.lines);
    expect(outcomeB2.newStartLine).toBe(directB2.newStartLine);
  });
});

describe("resolveParagraphDropDirection: wrong-zone rejections (no arbitrary-insertion-looking indicator)", () => {
  it("up-sibling target, zone 'before' -> rejected wrong-zone (would visually suggest inserting BEFORE the up-sibling, not swapping with it)", () => {
    const text = ["# H", "paragraph A", "", "paragraph B", "", "paragraph C"].join("\n");
    const anchor = anchorForNth(text, 1); // "paragraph B"
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const infoA = scan.blocks.find((b) => doc.lines[b.range.startLine] === "paragraph A")!;
    const target = hintFromRange(infoA.range.startLine, infoA.range.endLine, infoA.parentId);

    const resolution = resolveParagraphDropDirection(text, anchor, target, "before");
    expect(resolution).toEqual({ allowed: false, reason: "wrong-zone" });
  });

  it("down-sibling target, zone 'after' -> rejected wrong-zone", () => {
    const text = ["# H", "paragraph A", "", "paragraph B", "", "paragraph C"].join("\n");
    const anchor = anchorForNth(text, 1); // "paragraph B"
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const infoC = scan.blocks.find((b) => doc.lines[b.range.startLine] === "paragraph C")!;
    const target = hintFromRange(infoC.range.startLine, infoC.range.endLine, infoC.parentId);

    const resolution = resolveParagraphDropDirection(text, anchor, target, "after");
    expect(resolution).toEqual({ allowed: false, reason: "wrong-zone" });
  });
});

describe("resolveParagraphDropDirection: self-drop / non-adjacent / boundary rejections", () => {
  it("dropping a paragraph onto itself is rejected (self-drop)", () => {
    const text = ["# H", "paragraph A", "", "paragraph B"].join("\n");
    const anchor = anchorForNth(text, 0); // "paragraph A"
    const target = hintFromRange(anchor.rangeStart, anchor.rangeEnd, anchor.parentId);

    const resolution = resolveParagraphDropDirection(text, anchor, target, "after");
    expect(resolution).toEqual({ allowed: false, reason: "self-drop" });
  });

  it("a non-adjacent target (one hop further than the true sibling) is rejected — arbitrary-position insertion is never allowed", () => {
    const text = ["# H", "paragraph A", "", "paragraph B", "", "paragraph C"].join("\n");
    const anchor = anchorForNth(text, 0); // "paragraph A"
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const infoC = scan.blocks.find((b) => doc.lines[b.range.startLine] === "paragraph C")!;
    const target = hintFromRange(infoC.range.startLine, infoC.range.endLine, infoC.parentId);

    const resolutionBefore = resolveParagraphDropDirection(text, anchor, target, "before");
    const resolutionAfter = resolveParagraphDropDirection(text, anchor, target, "after");
    expect(resolutionBefore).toEqual({ allowed: false, reason: "not-adjacent" });
    expect(resolutionAfter).toEqual({ allowed: false, reason: "not-adjacent" });
  });

  it("a target belonging to a DIFFERENT parentId (a sibling list item's own child paragraph) is rejected as not-adjacent, even when its raw line range is textually adjacent", () => {
    const text = ["- item1", "  Child of item1.", "- item2", "  Child of item2."].join("\n");
    const anchor = anchorForNth(text, 0); // "Child of item1."
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const otherChild = scan.blocks.find(
      (b) => b.kind === "paragraph" && doc.lines[b.range.startLine].includes("Child of item2.")
    )!;
    expect(otherChild.parentId).not.toBe(anchor.parentId);
    const target = hintFromRange(otherChild.range.startLine, otherChild.range.endLine, otherChild.parentId);

    const resolution = resolveParagraphDropDirection(text, anchor, target, "after");
    expect(resolution).toEqual({ allowed: false, reason: "not-adjacent" });
  });

  it("a list item sitting between two same-parent paragraphs blocks adjacency (boundary-unknown never silently hopped) — the far paragraph reads as not-adjacent from this function's point of view", () => {
    const text = ["# H", "paragraph A", "- list item", "paragraph B"].join("\n");
    const anchor = anchorForNth(text, 0); // "paragraph A"
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const infoB = scan.blocks.find((b) => doc.lines[b.range.startLine] === "paragraph B")!;
    const target = hintFromRange(infoB.range.startLine, infoB.range.endLine, infoB.parentId);

    const resolution = resolveParagraphDropDirection(text, anchor, target, "before");
    expect(resolution).toEqual({ allowed: false, reason: "not-adjacent" });
  });

  it("a section-boundary target (heading line itself, no matching ComplexBlockInfo) is rejected as not-adjacent", () => {
    const text = ["# H1", "paragraph A", "# H2", "paragraph B"].join("\n");
    const anchor = anchorForNth(text, 0); // "paragraph A", section H1
    // Hint pointing at the heading line itself — never a real
    // ComplexBlockInfo, so it can never match findComplexSiblingTarget's
    // own up/down results.
    const target = hintFromRange(2, 2, null);

    const resolution = resolveParagraphDropDirection(text, anchor, target, "after");
    expect(resolution).toEqual({ allowed: false, reason: "not-adjacent" });
  });
});

describe("resolveParagraphDropDirection: source anchor re-resolution failures propagate (shares resolveAnchorUnit with moveParagraphFromAnchor, not a second copy)", () => {
  it("resolve-failed when the source paragraph was deleted", () => {
    const original = ["# H", "Before.", "", "Target paragraph.", "", "After."].join("\n");
    const anchor = anchorForNth(original, 1); // "Target paragraph."
    const changedText = ["# H", "Before.", "", "", "After."].join("\n");
    const doc = parseDocument(changedText);
    const scan = scanComplexBlocks(doc);
    const infoAfter = scan.blocks.find((b) => doc.lines[b.range.startLine] === "After.")!;
    const target = hintFromRange(infoAfter.range.startLine, infoAfter.range.endLine, infoAfter.parentId);

    const resolution = resolveParagraphDropDirection(changedText, anchor, target, "before");
    expect(resolution.allowed).toBe(false);
    if (resolution.allowed) throw new Error("expected rejection");
    expect(["resolve-failed", "content-changed"]).toContain(resolution.reason);
  });

  it("content-changed when the source paragraph's own text changed since the anchor was built", () => {
    const original = ["# H", "Original text.", "", "Other."].join("\n");
    const anchor = anchorForNth(original, 0);
    const changedText = ["# H", "Someone else edited this line.", "", "Other."].join("\n");
    const doc = parseDocument(changedText);
    const scan = scanComplexBlocks(doc);
    const infoOther = scan.blocks.find((b) => doc.lines[b.range.startLine] === "Other.")!;
    const target = hintFromRange(infoOther.range.startLine, infoOther.range.endLine, infoOther.parentId);

    const resolution = resolveParagraphDropDirection(changedText, anchor, target, "before");
    expect(resolution).toEqual({ allowed: false, reason: "content-changed" });
  });

  it("ambiguous-match when two byte-identical sibling paragraphs exist under the same parent", () => {
    const original = ["# H", "Unique text.", "", "Other."].join("\n");
    const anchor = anchorForNth(original, 0); // "Unique text."
    const ambiguousText = ["# H", "Unique text.", "", "Unique text.", "", "Other."].join("\n");
    const doc = parseDocument(ambiguousText);
    const scan = scanComplexBlocks(doc);
    const infoOther = scan.blocks.find((b) => doc.lines[b.range.startLine] === "Other.")!;
    const target = hintFromRange(infoOther.range.startLine, infoOther.range.endLine, infoOther.parentId);

    const resolution = resolveParagraphDropDirection(ambiguousText, anchor, target, "before");
    expect(resolution).toEqual({ allowed: false, reason: "ambiguous-match" });
  });
});
