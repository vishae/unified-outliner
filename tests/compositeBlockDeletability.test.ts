/**
 * Phase 5C-1 ticket 1 (2026-08-13): unit tests for the CompositeBlock
 * delete-eligibility model/evaluator introduced in this ticket —
 * model/compositeBlock.ts's CompositeBlockDeletability/
 * CompositeBlockDeleteRejectionReason/CompositeBlockRejection and
 * parser/compositeBlocks.ts's evaluateCompositeBlockDeletability/
 * describeCompositeBlockRejection.
 *
 * Scope reminder (see this ticket's completion report): NO deletion is
 * implemented or tested here — only whether a given, already-recognized
 * CompositeBlockInfo WOULD be safe to delete as one unit. Nothing in this
 * file touches doc.lines, the editor, or the Outline Tree.
 *
 * tests/complexBlocks.test.ts (56 cases) and tests/compositeBlocks.test.ts
 * (18 cases) are intentionally left untouched by this ticket; this file is
 * additive only.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import {
  describeCompositeBlockRejection,
  evaluateCompositeBlockDeletability,
  matchCompositeBlocks,
} from "../src/parser/compositeBlocks";
import {
  CompositeBlockInfo,
  CompositeBlockRule,
  DEFAULT_COMPOSITE_BLOCK_RULES,
} from "../src/model/compositeBlock";
import { ComplexBlockScanResult } from "../src/model/complexBlock";

/** Real pipeline: parse -> scan -> match, mirroring tests/compositeBlocks.test.ts's own `match()` helper. */
function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

const FENCED_CODE_RULE: CompositeBlockRule[] = [
  { id: "caption-fenced-code", kindSequence: ["single-line-list", "fenced-code"], prefix: "" },
];
const TABLE_RULE: CompositeBlockRule[] = [
  { id: "caption-table", kindSequence: ["single-line-list", "table"], prefix: "" },
];

describe("evaluateCompositeBlockDeletability: positive cases (real matchCompositeBlocks pipeline)", () => {
  it("a top-level single-line-list + callout composite (image-ocr) is deletable", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockDeletability(doc, complexScan, composites[0])).toEqual({
      deletable: true,
    });
  });

  it("a top-level single-line-list + blockquote composite (image-quote) is deletable", () => {
    const text = ["- source", "> plain quote"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockDeletability(doc, complexScan, composites[0])).toEqual({
      deletable: true,
    });
  });

  it("a top-level single-line-list + closed fenced-code composite is deletable", () => {
    const text = ["- snippet", "```", "console.log(1)", "```"].join("\n");
    const { doc, complexScan, composites } = pipeline(text, FENCED_CODE_RULE);
    expect(composites).toHaveLength(1);
    expect(composites[0].members.map((m) => m.kind)).toEqual(["single-line-list", "fenced-code"]);
    expect(evaluateCompositeBlockDeletability(doc, complexScan, composites[0])).toEqual({
      deletable: true,
    });
  });

  it("a top-level single-line-list + Mermaid fenced-code composite is deletable (Mermaid is still kind 'fenced-code')", () => {
    const text = ["- diagram", "```mermaid", "graph TD; A-->B", "```"].join("\n");
    const { doc, complexScan, composites } = pipeline(text, FENCED_CODE_RULE);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockDeletability(doc, complexScan, composites[0])).toEqual({
      deletable: true,
    });
  });

  it("a top-level single-line-list + well-formed table composite is deletable", () => {
    const text = ["- data", "| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");
    const { doc, complexScan, composites } = pipeline(text, TABLE_RULE);
    expect(composites).toHaveLength(1);
    expect(evaluateCompositeBlockDeletability(doc, complexScan, composites[0])).toEqual({
      deletable: true,
    });
  });
});

describe("evaluateCompositeBlockDeletability: negative cases reachable via the real pipeline", () => {
  it("rejects (nested-in-list) when the anchor single-line-list member is itself nested inside another list item", () => {
    // Mirrors tests/compositeBlocks.test.ts's own "OUTER does not qualify,
    // INNER independently does" recognition fixture — recognized as a
    // composite, but NOT deletable in this phase (member is not top-level).
    const text = ["- outer", "  - inner", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const result = evaluateCompositeBlockDeletability(doc, complexScan, composites[0]);
    expect(result.deletable).toBe(false);
    expect(result.reason).toBe("nested-in-list");
    expect(result.offendingMemberId).toBe(composites[0].members[0].id);
  });

  it("rejects (member-unsafe-indent) when the anchor list item mixes tab/space leading whitespace", () => {
    const text = [" \t- flagged", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const result = evaluateCompositeBlockDeletability(doc, complexScan, composites[0]);
    expect(result.deletable).toBe(false);
    expect(result.reason).toBe("member-unsafe-indent");
  });
});

describe("evaluateCompositeBlockDeletability: negative cases requiring a hand-built CompositeBlockInfo", () => {
  // matchCompositeBlocks only ever assembles composites out of members that
  // are ALREADY editability:"supported" (nested callout / unterminated
  // fence / malformed table / paragraph never qualify as candidates in the
  // first place — see parser/compositeBlocks.ts's collectCandidates). So a
  // real match() call can never itself produce a composite containing one
  // of these; the tests below construct the CompositeBlockInfo directly to
  // verify evaluateCompositeBlockDeletability's OWN independent gates,
  // exactly as documented in its doc comment ("does not simply trust that
  // composite was produced by matchCompositeBlocks").

  it("rejects (unsupported-member-kind) a hand-built composite containing a paragraph member", () => {
    const text = ["- item", "plain paragraph text"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const paragraph = complexScan.blocks.find((b) => b.kind === "paragraph");
    expect(paragraph).toBeDefined();
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;

    const fake: CompositeBlockInfo = {
      id: "composite-fake",
      ruleId: "fake-rule",
      range: { startLine: 0, endLine: 1 },
      members: [
        { kind: "single-line-list", id: listItemId, range: { startLine: 0, endLine: 0 } },
        { kind: "paragraph", id: paragraph!.id, range: paragraph!.range },
      ],
      sectionId: null,
    };

    const result = evaluateCompositeBlockDeletability(doc, complexScan, fake);
    expect(result).toEqual({
      deletable: false,
      reason: "unsupported-member-kind",
      offendingMemberId: paragraph!.id,
    });
  });

  it("rejects (member-not-supported) a hand-built composite whose callout member is a nested callout", () => {
    const text = ["- item", "> [!note]", "> > [!tip]", "> more"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const callout = complexScan.blocks.find((b) => b.kind === "callout");
    expect(callout?.editability).toBe("unsupported");
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;

    const fake: CompositeBlockInfo = {
      id: "composite-fake",
      ruleId: "fake-rule",
      range: { startLine: 0, endLine: callout!.range.endLine },
      members: [
        { kind: "single-line-list", id: listItemId, range: { startLine: 0, endLine: 0 } },
        { kind: "callout", id: callout!.id, range: callout!.range },
      ],
      sectionId: null,
    };

    const result = evaluateCompositeBlockDeletability(doc, complexScan, fake);
    expect(result.deletable).toBe(false);
    expect(result.reason).toBe("member-not-supported");
    expect(result.offendingMemberId).toBe(callout!.id);
  });

  it("rejects (member-not-supported) a hand-built composite whose fenced-code member is unterminated", () => {
    const text = ["- item", "```", "no closing fence"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const fenced = complexScan.blocks.find((b) => b.kind === "fenced-code");
    expect(fenced?.editability).toBe("ambiguous");
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;

    const fake: CompositeBlockInfo = {
      id: "composite-fake",
      ruleId: "fake-rule",
      range: { startLine: 0, endLine: fenced!.range.endLine },
      members: [
        { kind: "single-line-list", id: listItemId, range: { startLine: 0, endLine: 0 } },
        { kind: "fenced-code", id: fenced!.id, range: fenced!.range },
      ],
      sectionId: null,
    };

    const result = evaluateCompositeBlockDeletability(doc, complexScan, fake);
    expect(result.deletable).toBe(false);
    expect(result.reason).toBe("member-not-supported");
  });

  it("rejects (member-not-supported) a hand-built composite whose table member has a header/delimiter column mismatch", () => {
    const text = ["- item", "| a | b |", "| - |"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const table = complexScan.blocks.find((b) => b.kind === "table");
    expect(table?.editability).toBe("ambiguous");
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;

    const fake: CompositeBlockInfo = {
      id: "composite-fake",
      ruleId: "fake-rule",
      range: { startLine: 0, endLine: table!.range.endLine },
      members: [
        { kind: "single-line-list", id: listItemId, range: { startLine: 0, endLine: 0 } },
        { kind: "table", id: table!.id, range: table!.range },
      ],
      sectionId: null,
    };

    const result = evaluateCompositeBlockDeletability(doc, complexScan, fake);
    expect(result.deletable).toBe(false);
    expect(result.reason).toBe("member-not-supported");
  });

  it("rejects (member-has-diagnostic) a 'supported' block whose range overlaps a synthetic diagnostic (defense-in-depth)", () => {
    const text = ["- item", "> [!note]", "> body"].join("\n");
    const doc = parseDocument(text);
    const realScan = scanComplexBlocks(doc);
    const callout = realScan.blocks.find((b) => b.kind === "callout")!;
    expect(callout.editability).toBe("supported");

    // Synthetic scan result: same blocks, but with an extra diagnostic
    // overlapping the (still "supported") callout's own range — a
    // combination the real scanners never produce today (see this test
    // file's own top-of-describe-block comment), exercising the
    // independent re-check documented on hasOverlappingDiagnostic.
    const scanWithStrayDiagnostic: ComplexBlockScanResult = {
      blocks: realScan.blocks,
      diagnostics: [
        ...realScan.diagnostics,
        { kind: "ambiguous", fromLine: callout.range.startLine, toLine: callout.range.endLine, message: "synthetic" },
      ],
    };
    const listItemId = [...doc.nodes.values()].find((n) => n.type === "list")!.id;

    const fake: CompositeBlockInfo = {
      id: "composite-fake",
      ruleId: "fake-rule",
      range: { startLine: 0, endLine: callout.range.endLine },
      members: [
        { kind: "single-line-list", id: listItemId, range: { startLine: 0, endLine: 0 } },
        { kind: "callout", id: callout.id, range: callout.range },
      ],
      sectionId: null,
    };

    const result = evaluateCompositeBlockDeletability(doc, scanWithStrayDiagnostic, fake);
    expect(result.deletable).toBe(false);
    expect(result.reason).toBe("member-has-diagnostic");
    expect(result.offendingMemberId).toBe(callout.id);
  });

  it("rejects (member-resolve-failed) a composite member id that does not exist in the current doc/scan", () => {
    const text = ["- item", "> [!note]", "> body"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);

    const fake: CompositeBlockInfo = {
      id: "composite-fake",
      ruleId: "fake-rule",
      range: { startLine: 0, endLine: 2 },
      members: [
        { kind: "single-line-list", id: "li-does-not-exist", range: { startLine: 0, endLine: 0 } },
        { kind: "callout", id: "callout-does-not-exist", range: { startLine: 1, endLine: 2 } },
      ],
      sectionId: null,
    };

    const result = evaluateCompositeBlockDeletability(doc, complexScan, fake);
    expect(result.deletable).toBe(false);
    expect(result.reason).toBe("member-resolve-failed");
    expect(result.offendingMemberId).toBe("li-does-not-exist");
  });

  it("rejects (ambiguous-section) a hand-built composite whose members genuinely belong to different sections", () => {
    const text = ["# A", "> [!note]", "> body a", "# B", "> [!tip]", "> body b"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const [calloutA, calloutB] = complexScan.blocks.filter((b) => b.kind === "callout");
    expect(calloutA.editability).toBe("supported");
    expect(calloutB.editability).toBe("supported");
    expect(calloutA.parentId).not.toBe(calloutB.parentId);

    const fake: CompositeBlockInfo = {
      id: "composite-fake",
      ruleId: "fake-rule",
      range: { startLine: calloutA.range.startLine, endLine: calloutB.range.endLine },
      members: [
        { kind: "callout", id: calloutA.id, range: calloutA.range },
        { kind: "callout", id: calloutB.id, range: calloutB.range },
      ],
      sectionId: null,
    };

    const result = evaluateCompositeBlockDeletability(doc, complexScan, fake);
    expect(result).toEqual({ deletable: false, reason: "ambiguous-section" });
    expect(result.offendingMemberId).toBeUndefined();
  });

  it("does not mutate the input ParsedDocument or ComplexBlockScanResult", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const nodesBefore = doc.nodes.size;
    const blocksBefore = complexScan.blocks.length;
    const diagnosticsBefore = complexScan.diagnostics.length;
    evaluateCompositeBlockDeletability(doc, complexScan, composites[0]);
    expect(doc.nodes.size).toBe(nodesBefore);
    expect(complexScan.blocks.length).toBe(blocksBefore);
    expect(complexScan.diagnostics.length).toBe(diagnosticsBefore);
  });
});

describe("describeCompositeBlockRejection", () => {
  it("reports blocked: false for an id that is not a recognized CompositeBlock", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(describeCompositeBlockRejection(doc, complexScan, composites, "composite-does-not-exist")).toEqual({
      blocked: false,
    });
  });

  it("reports blocked: false for a recognized CompositeBlock that IS deletable", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(describeCompositeBlockRejection(doc, complexScan, composites, composites[0].id)).toEqual({
      blocked: false,
    });
  });

  it("reports blocked: true with the ruleId and a stable, informative reason string for a rejected CompositeBlock", () => {
    const text = ["- outer", "  - inner", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const rejection = describeCompositeBlockRejection(doc, complexScan, composites, composites[0].id);
    expect(rejection.blocked).toBe(true);
    if (rejection.blocked) {
      expect(rejection.ruleId).toBe(composites[0].ruleId);
      expect(rejection.reason).toContain("nested inside another list item");
    }
  });

  it("produces a distinct reason string per CompositeBlockDeleteRejectionReason (spot check: unsafe indent)", () => {
    const text = [" \t- flagged", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const rejection = describeCompositeBlockRejection(doc, complexScan, composites, composites[0].id);
    expect(rejection.blocked).toBe(true);
    if (rejection.blocked) {
      expect(rejection.reason).toContain("mixed tab/space indentation");
    }
  });
});
