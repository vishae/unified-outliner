/**
 * Phase 5C-1 ticket 4-2 (2026-08-14): unit tests for
 * move/findCompositeMoveTarget.ts — the swap-TARGET resolver that runs
 * AFTER ticket 4-1's evaluateCompositeBlockMovability has already confirmed
 * eligibility.
 *
 * Scope reminder: still no doc.lines mutation, no editor/command/UI
 * integration in this file — only whether findCompositeMoveTarget resolves
 * the correct LineRange/anchor/kind, or correctly returns null. Actually
 * performing the swap is ticket 4-3's job and its own test file.
 *
 * Mirrors tests/compositeBlockMovability.test.ts's own conventions
 * (pipeline() helper, real-pipeline positive/negative cases, hand-built
 * inputs for conditions unreachable via the real pipeline).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import {
  evaluateCompositeBlockMovability,
  findAdjacentAnchorNode,
  matchCompositeBlocks,
  skipBlankLines,
} from "../src/parser/compositeBlocks";
import { CompositeBlockInfo, CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { findCompositeMoveTarget } from "../src/move/findCompositeMoveTarget";

/** Real pipeline: parse -> scan -> match, mirroring tests/compositeBlockMovability.test.ts's own pipeline() helper. */
function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

describe("findCompositeMoveTarget: shares its adjacency resolution with evaluateCompositeBlockMovability (ticket 4-1)", () => {
  it("resolves the exact same adjacent anchor node evaluateCompositeBlockMovability's own scan would find (down direction)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(2);

    const movability = evaluateCompositeBlockMovability(doc, complexScan, composites[0], "down", composites);
    expect(movability).toEqual({ eligible: true });

    const k = skipBlankLines(doc, composites[0].range.endLine + 1, "down");
    expect(k).not.toBeNull();
    const expectedAnchor = findAdjacentAnchorNode(doc, composites, k!, "down");
    expect(expectedAnchor).not.toBeNull();

    const target = findCompositeMoveTarget(doc, complexScan, composites[0], "down", composites);
    expect(target?.anchorNodeId).toBe(expectedAnchor!.id);
  });

  it("resolves the exact same adjacent anchor node evaluateCompositeBlockMovability's own scan would find (up direction)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(2);

    const movability = evaluateCompositeBlockMovability(doc, complexScan, composites[1], "up", composites);
    expect(movability).toEqual({ eligible: true });

    const k = skipBlankLines(doc, composites[1].range.startLine - 1, "up");
    expect(k).not.toBeNull();
    const expectedAnchor = findAdjacentAnchorNode(doc, composites, k!, "up");
    expect(expectedAnchor).not.toBeNull();

    const target = findCompositeMoveTarget(doc, complexScan, composites[1], "up", composites);
    expect(target?.anchorNodeId).toBe(expectedAnchor!.id);
  });
});

describe("findCompositeMoveTarget: plain (non-composite) adjacent list item, both directions", () => {
  it("direction 'down': returns kind 'list-item' with the plain list item's own range", () => {
    const text = ["- one", "> [!note]", "> body a", "- two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const twoNode = [...doc.nodes.values()].find((n) => n.id !== composites[0].members[0].id)!;

    const target = findCompositeMoveTarget(doc, complexScan, composites[0], "down", composites);
    expect(target).toEqual({
      range: { startLine: twoNode.range.startLine, endLine: twoNode.range.endLine },
      anchorNodeId: twoNode.id,
      kind: "list-item",
    });
  });

  it("direction 'up': returns kind 'list-item' with the plain list item's own range", () => {
    const text = ["- zero", "- one", "> [!note]", "> body a"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const zeroNode = [...doc.nodes.values()].find((n) => n.id !== composites[0].members[0].id)!;

    const target = findCompositeMoveTarget(doc, complexScan, composites[0], "up", composites);
    expect(target).toEqual({
      range: { startLine: zeroNode.range.startLine, endLine: zeroNode.range.endLine },
      anchorNodeId: zeroNode.id,
      kind: "list-item",
    });
  });

  it("resolves correctly across multiple blank lines separating the composite from the plain list item", () => {
    const text = ["- one", "> [!note]", "> body a", "", "", "- two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const twoNode = [...doc.nodes.values()].find((n) => n.id !== composites[0].members[0].id)!;

    const target = findCompositeMoveTarget(doc, complexScan, composites[0], "down", composites);
    expect(target).toEqual({
      range: { startLine: twoNode.range.startLine, endLine: twoNode.range.endLine },
      anchorNodeId: twoNode.id,
      kind: "list-item",
    });
    expect(twoNode.range.startLine).toBe(5); // confirms the blank-line gap (lines 3-4) was skipped, not consumed
  });
});

describe("findCompositeMoveTarget: composite-widening, both directions", () => {
  it("direction 'down': widens to the WHOLE adjacent CompositeBlock's range, not just its anchor member's own line", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(2);

    const target = findCompositeMoveTarget(doc, complexScan, composites[0], "down", composites);
    expect(target).toEqual({
      range: { startLine: composites[1].range.startLine, endLine: composites[1].range.endLine },
      anchorNodeId: composites[1].members[0].id,
      kind: "composite",
      compositeId: composites[1].id,
    });
    // The widened range must extend PAST the anchor member's own single
    // line, through the whole callout — never just "two"'s own line.
    expect(target!.range.endLine).toBeGreaterThan(
      (doc.nodes.get(composites[1].members[0].id)?.range.endLine) ?? -1
    );
  });

  it("direction 'up': widens to the WHOLE preceding CompositeBlock's range, resolved via its trailing (last) member's boundary", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(2);

    const target = findCompositeMoveTarget(doc, complexScan, composites[1], "up", composites);
    expect(target).toEqual({
      range: { startLine: composites[0].range.startLine, endLine: composites[0].range.endLine },
      anchorNodeId: composites[0].members[0].id,
      kind: "composite",
      compositeId: composites[0].id,
    });
  });

  it("widening works when the adjacent composite's second member is a blockquote, not a callout (mixed member kinds)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> plain quote"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(2);
    expect(composites[1].members.map((m) => m.kind)).toEqual(["single-line-list", "blockquote"]);

    const target = findCompositeMoveTarget(doc, complexScan, composites[0], "down", composites);
    expect(target).toEqual({
      range: { startLine: composites[1].range.startLine, endLine: composites[1].range.endLine },
      anchorNodeId: composites[1].members[0].id,
      kind: "composite",
      compositeId: composites[1].id,
    });
  });
});

describe("findCompositeMoveTarget: eligibility gate — returns null for everything ticket 4-1 rejects", () => {
  it("returns null (nested-in-list)", () => {
    const text = ["- outer", "  - inner", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(findCompositeMoveTarget(doc, complexScan, composites[0], "up", composites)).toBeNull();
    expect(findCompositeMoveTarget(doc, complexScan, composites[0], "down", composites)).toBeNull();
  });

  it("returns null (unsafe-indent)", () => {
    const text = [" \t- flagged", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(findCompositeMoveTarget(doc, complexScan, composites[0], "up", composites)).toBeNull();
    expect(findCompositeMoveTarget(doc, complexScan, composites[0], "down", composites)).toBeNull();
  });

  it("returns null (no-adjacent-compatible-unit) at the start/end of the document", () => {
    const startText = ["- one", "> [!note]", "> body"].join("\n");
    const start = pipeline(startText);
    expect(findCompositeMoveTarget(start.doc, start.complexScan, start.composites[0], "up", start.composites)).toBeNull();

    const endText = ["- zero", "- one", "> [!note]", "> body"].join("\n");
    const end = pipeline(endText);
    expect(findCompositeMoveTarget(end.doc, end.complexScan, end.composites[0], "down", end.composites)).toBeNull();
  });

  it("returns null (different-parent-or-depth) when the adjacent root item has a different indentColumns", () => {
    const text = ["- one", "> [!note]", "> body a", "  - two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(findCompositeMoveTarget(doc, complexScan, composites[0], "down", composites)).toBeNull();
  });
});

describe("findCompositeMoveTarget: negative cases requiring a hand-built input", () => {
  it("never targets a member of the composite being moved (hand-built composite whose own members[] wrongly includes the adjacent list item)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const twoNode = [...doc.nodes.values()].find((n) => n.id !== composites[0].members[0].id)!;

    const poisoned: CompositeBlockInfo = {
      ...composites[0],
      members: [...composites[0].members, { kind: "single-line-list", id: twoNode.id, range: twoNode.range }],
    };

    expect(findCompositeMoveTarget(doc, complexScan, poisoned, "down", [poisoned])).toBeNull();
  });

  it("returns null when the adjacent anchor ambiguously resolves to more than one CompositeBlock (hand-built, never producible by matchCompositeBlocks itself)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(2);

    const duplicateOfSecond: CompositeBlockInfo = { ...composites[1], id: `${composites[1].id}-duplicate` };
    const poisonedAllComposites = [...composites, duplicateOfSecond];

    expect(findCompositeMoveTarget(doc, complexScan, composites[0], "down", poisonedAllComposites)).toBeNull();
  });

  it("returns null when the composite's own anchor member id does not resolve in doc.nodes (range/member inconsistency)", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);

    const inconsistent: CompositeBlockInfo = {
      ...composites[0],
      members: [
        { kind: "single-line-list", id: "li-does-not-exist", range: { startLine: 0, endLine: 0 } },
        composites[0].members[1],
      ],
    };

    expect(findCompositeMoveTarget(doc, complexScan, inconsistent, "down", [inconsistent])).toBeNull();
  });

  it("does not mutate the input ParsedDocument, ComplexBlockScanResult, or allComposites array", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const nodesBefore = doc.nodes.size;
    const blocksBefore = complexScan.blocks.length;
    const compositesBefore = composites.length;
    findCompositeMoveTarget(doc, complexScan, composites[0], "down", composites);
    expect(doc.nodes.size).toBe(nodesBefore);
    expect(complexScan.blocks.length).toBe(blocksBefore);
    expect(composites.length).toBe(compositesBefore);
  });
});
