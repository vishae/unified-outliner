import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { moveComplexBlock } from "../src/move/resolveMoveTarget";
import {
  buildParagraphMoveAnchor,
  moveParagraphFromAnchor,
  ParagraphMoveAnchor,
} from "../src/edit/paragraphTreeMove";

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
