/**
 * Phase 5C-1 ticket 4-1 (2026-08-14, revised): unit tests for the
 * CompositeBlock move-eligibility evaluator — model/compositeBlock.ts's
 * CompositeBlockMovability/CompositeBlockMoveRejectionReason and
 * parser/compositeBlocks.ts's evaluateCompositeBlockMovability.
 *
 * Scope reminder (see this ticket's completion report): NO move is
 * implemented or tested here — only whether a given, already-recognized
 * CompositeBlockInfo WOULD be safe to swap with whatever sits adjacent to
 * it in a given direction. Nothing in this file touches doc.lines, the
 * editor, or the Outline Tree. Which exact RANGE gets swapped with which
 * (including the composite-widening resolution for an adjacent
 * CompositeBlock) is move/findCompositeMoveTarget.ts's job (ticket 4-2) and
 * is tested in its own test file, not here.
 *
 * IMPORTANT: this file supersedes an earlier draft of the same tests that
 * assumed evaluateCompositeBlockMovability would consult
 * ListBlockNode.prevSiblingId/nextSiblingId directly. That assumption was
 * proven wrong by a real parseDocument() run (see
 * parser/compositeBlocks.ts's design-memo comment above
 * evaluateCompositeBlockMovability): a composite's own trailing callout/
 * blockquote member severs the anchor's own sibling chain, so two
 * composites sitting back-to-back could never be found eligible under that
 * design. Test "eligible: true ... two composites sitting directly
 * adjacent" below is the regression case that caught this and is REQUIRED
 * to keep passing.
 *
 * Mirrors tests/compositeBlockDeletability.test.ts's own conventions
 * (pipeline() helper, real-pipeline positive/negative cases, hand-built
 * ParsedDocument for conditions unreachable via the real pipeline).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { evaluateCompositeBlockMovability, matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { isListNode, ParsedDocument } from "../src/model/block";

/** Real pipeline: parse -> scan -> match, mirroring tests/compositeBlockDeletability.test.ts's own pipeline() helper. */
function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

describe("evaluateCompositeBlockMovability: positive cases (real matchCompositeBlocks pipeline)", () => {
  it("eligible: true, direction 'down', when two composites sit directly adjacent (regression: composite's own callout must not sever adjacency to the NEXT composite)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(2);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "down", composites)).toEqual({
      eligible: true,
    });
  });

  it("eligible: true, direction 'up', when two composites sit directly adjacent (regression: the PRECEDING composite's own callout must not sever adjacency)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(2);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[1], "up", composites)).toEqual({
      eligible: true,
    });
  });

  it("eligible: true, direction 'up', when a plain (non-composite) list item sits directly before the composite", () => {
    const text = ["- zero", "- one", "> [!note]", "> body a"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "up", composites)).toEqual({
      eligible: true,
    });
  });

  it("eligible: true, direction 'down', when a plain (non-composite) list item sits directly after the composite", () => {
    const text = ["- one", "> [!note]", "> body a", "- two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "down", composites)).toEqual({
      eligible: true,
    });
  });

  it("eligible: true when multiple blank lines separate the composite from its adjacent sibling (gap is only skipped for detection, never consumed)", () => {
    const text = ["- one", "> [!note]", "> body a", "", "", "- two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "down", composites)).toEqual({
      eligible: true,
    });
  });

  it("eligible: true, direction 'up', across a multi-line (3+ line) callout body preceding the composite", () => {
    const text = [
      "- one",
      "> [!note]",
      "> line 1",
      "> line 2",
      "> line 3",
      "- two",
      "> [!tip]",
      "> body b",
    ].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(2);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[1], "up", composites)).toEqual({
      eligible: true,
    });
  });
});

describe("evaluateCompositeBlockMovability: negative cases reachable via the real pipeline", () => {
  it("rejects (nested-in-list) when the anchor single-line-list member is itself nested inside another list item", () => {
    const text = ["- outer", "  - inner", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "up", composites)).toEqual({
      eligible: false,
      reason: "nested-in-list",
    });
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "down", composites)).toEqual({
      eligible: false,
      reason: "nested-in-list",
    });
  });

  it("rejects (unsafe-indent) when the anchor list item mixes tab/space leading whitespace", () => {
    const text = [" \t- flagged", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "up", composites)).toEqual({
      eligible: false,
      reason: "unsafe-indent",
    });
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "down", composites)).toEqual({
      eligible: false,
      reason: "unsafe-indent",
    });
  });

  it("rejects (no-adjacent-compatible-unit) direction 'up' when the composite is the first block in the document", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "up", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });

  it("rejects (no-adjacent-compatible-unit) direction 'down' when the composite is the last block in the document", () => {
    const text = ["- zero", "- one", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "down", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });

  it("rejects (no-adjacent-compatible-unit) direction 'down' when the very next block is a section heading (no cross-section hop supported)", () => {
    const text = ["# A", "- one", "> [!note]", "> body", "# B"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "down", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });

  it("rejects (no-adjacent-compatible-unit) direction 'up' when the preceding content is a composite-less standalone complex block (no anchoring list item)", () => {
    const text = ["> [!note]", "> standalone, not part of any composite", "- one", "> [!tip]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "up", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });

  it("rejects (no-adjacent-compatible-unit) direction 'up' when the preceding block's own boundary is uncertain (malformed table, never a match candidate)", () => {
    const text = ["| a | b |", "| - |", "- one", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const table = complexScan.blocks.find((b) => b.kind === "table");
    expect(table?.editability).toBe("ambiguous");
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "up", composites)).toEqual({
      eligible: false,
      reason: "no-adjacent-compatible-unit",
    });
  });

  it("rejects (different-parent-or-depth) when the adjacent root list item shares the composite's parent but has a different indentColumns (a real, reachable shape — see this function's own doc comment)", () => {
    // After "one"'s own callout closes the list (parser pass-2's
    // lastRootItem reset), "  - two" restarts as a NEW root item (parentId =
    // the same null/top-level section as "one") but at indentColumns 2,
    // not 0 — both share parentId/depth, but not indentColumns.
    const text = ["- one", "> [!note]", "> body a", "  - two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const anchor = doc.nodes.get(composites[0].members[0].id);
    expect(anchor && isListNode(anchor) && anchor.indentColumns).toBe(0);
    const twoNode = [...doc.nodes.values()].find((n) => n.type === "list" && n.id !== composites[0].members[0].id);
    expect(twoNode?.parentId).toBe(anchor?.parentId);
    expect(twoNode && isListNode(twoNode) && twoNode.indentColumns).toBe(2);

    expect(evaluateCompositeBlockMovability(doc, complexScan, composites[0], "down", composites)).toEqual({
      eligible: false,
      reason: "different-parent-or-depth",
    });
  });
});

describe("evaluateCompositeBlockMovability: negative cases requiring a hand-built ParsedDocument", () => {
  // "different-parent-or-depth" via a depth mismatch ALONE (same parentId,
  // different depth) is structurally unreachable through the real parser:
  // depth is always fully determined by parentId during parsing
  // (depth = parent.depth + 1), so two real nodes sharing one parentId
  // always share the same depth too. This test exercises the defensive
  // depth check documented on evaluateCompositeBlockMovability's own
  // condition 4, mirroring compositeBlockDeletability.test.ts's own
  // "negative cases requiring a hand-built CompositeBlockInfo" section for
  // an analogous defense-in-depth-only branch.
  it("rejects (different-parent-or-depth) when the resolved adjacent node has the same parentId but an inconsistent depth (synthetic doc)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const composites = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(composites).toHaveLength(1);

    const twoId = [...doc.nodes.values()].find((n) => n.type === "list" && n.id !== composites[0].members[0].id)!.id;
    const twoNode = doc.nodes.get(twoId)!;
    const patchedNodes = new Map(doc.nodes);
    patchedNodes.set(twoId, { ...twoNode, depth: (twoNode as { depth: number }).depth + 1 });
    const patchedDoc: ParsedDocument = { ...doc, nodes: patchedNodes };

    expect(evaluateCompositeBlockMovability(patchedDoc, complexScan, composites[0], "down", composites)).toEqual({
      eligible: false,
      reason: "different-parent-or-depth",
    });
  });

  it("does not mutate the input ParsedDocument or ComplexBlockScanResult", () => {
    const text = ["- zero", "- one", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const nodesBefore = doc.nodes.size;
    const blocksBefore = complexScan.blocks.length;
    evaluateCompositeBlockMovability(doc, complexScan, composites[0], "up", composites);
    expect(doc.nodes.size).toBe(nodesBefore);
    expect(complexScan.blocks.length).toBe(blocksBefore);
  });
});
