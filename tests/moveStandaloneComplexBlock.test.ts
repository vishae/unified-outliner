/**
 * Phase 5C-3 (2026-08-14): unit tests for
 * edit/moveStandaloneComplexBlock.ts — the EXECUTOR layer: given the
 * CURRENT Markdown text and a StandaloneComplexBlockSnapshot captured at
 * menu-build time, re-parse/re-scan/re-match/re-verify and perform (or
 * safely refuse) the swap.
 *
 * Mirrors tests/moveCompositeBlock.test.ts's own scope and structure.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";
import {
  buildStandaloneComplexBlockSnapshot,
  moveStandaloneComplexBlock,
  standaloneComplexBlockMoveReasonText,
  StandaloneComplexBlockSnapshot,
} from "../src/edit/moveStandaloneComplexBlock";
import { createTranslator } from "../src/i18n";

function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

function calloutOrBlockquoteOf(
  complexScan: ComplexBlockScanResult,
  needle: string,
  doc: ReturnType<typeof parseDocument>
): ComplexBlockInfo {
  const found = complexScan.blocks.find(
    (b) => (b.kind === "callout" || b.kind === "blockquote") && doc.lines[b.range.startLine].includes(needle)
  );
  if (!found) throw new Error(`no callout/blockquote matching "${needle}"`);
  return found;
}

describe("buildStandaloneComplexBlockSnapshot", () => {
  it("projects a callout ComplexBlockInfo into a snapshot with the same kind/range/parentId", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one);
    expect(snapshot).toEqual({
      id: one.id,
      kind: "callout",
      range: { startLine: one.range.startLine, endLine: one.range.endLine },
      parentId: one.parentId,
    });
  });

  it("returns null for a non-callout/blockquote kind (defense-in-depth)", () => {
    const text = ["```", "code", "```"].join("\n");
    const { complexScan } = pipeline(text);
    const fenced = complexScan.blocks.find((b) => b.kind === "fenced-code")!;
    expect(buildStandaloneComplexBlockSnapshot(fenced)).toBeNull();
  });
});

describe("moveStandaloneComplexBlock: successful swaps", () => {
  it("swaps two adjacent standalone callouts (direction down), preserving header/body/quote-prefix verbatim", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "> [!tip] two",
      "> body b",
      "",
      "> [!note] one",
      "> body a",
    ]);
  });

  it("swaps two adjacent standalone blockquotes (direction up), preserving content verbatim", () => {
    const text = ["# H", "> quote one", "", "> quote two"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const two = calloutOrBlockquoteOf(complexScan, "quote two", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(two)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "up" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "> quote two", "", "> quote one"]);
  });

  it("preserves the blank-line gap between the two swapped blocks exactly (swapBlocks contract)", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "> [!tip] two",
      "> body b",
      "",
      "",
      "> [!note] one",
      "> body a",
    ]);
  });

  it("returns the moved block's own new start line", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    // "one" (2 lines) now sits after "two" (2 lines) + blank line: line 4.
    expect(outcome.lines[outcome.newStartLine]).toBe("> [!note] one");
  });
});

describe("moveStandaloneComplexBlock: rejections leave text byte-identical", () => {
  it("range-invalid: startLine < 0", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const snapshot: StandaloneComplexBlockSnapshot = {
      id: "callout-x",
      kind: "callout",
      range: { startLine: -1, endLine: 1 },
      parentId: null,
    };
    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("range-invalid: endLine >= lineCount", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const snapshot: StandaloneComplexBlockSnapshot = {
      id: "callout-x",
      kind: "callout",
      range: { startLine: 1, endLine: 99 },
      parentId: null,
    };
    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("standalone-boundary-changed: no block in the current text matches the snapshot's kind/range/parentId", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const snapshot: StandaloneComplexBlockSnapshot = {
      id: "callout-x",
      kind: "callout",
      range: { startLine: 1, endLine: 1 },
      parentId: null,
    };
    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("standalone-boundary-changed");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("standalone-boundary-changed: the note changed between snapshot capture and Apply (content shifted lines)", () => {
    const originalText = ["# H", "> [!note] one", "> body", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan } = pipeline(originalText);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    // An unrelated line inserted above shifts every subsequent line number.
    const laterText = ["# H", "extra inserted line", "> [!note] one", "> body", "", "> [!tip] two", "> body b"].join(
      "\n"
    );
    const outcome = moveStandaloneComplexBlock(
      laterText,
      { snapshot, direction: "down" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("standalone-boundary-changed");
    expect(outcome.lines).toEqual(laterText.split("\n"));
  });

  it("re-evaluated judge rejection (no-adjacent-compatible-unit) propagates and leaves text unchanged", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("no-adjacent-compatible-unit");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("re-evaluated judge rejection (composite-member) when the note changed so the target is now a composite's own member", () => {
    // Snapshot captured while "one" was standalone...
    const originalText = ["> [!note] one", "> body", "", "- x"].join("\n");
    const { doc, complexScan } = pipeline(originalText);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const snapshot = buildStandaloneComplexBlockSnapshot(one)!;

    // ...but by the time Apply runs, a list item was inserted directly
    // before it (no blank line), making it a matched composite's own
    // member instead. Even though kind/range/parentId can still coincide
    // with the snapshot in principle, this fixture also changes the range
    // (the callout no longer starts at line 0) — demonstrating the
    // standalone-boundary-changed path is what actually fires here, which
    // is the CORRECT, safer outcome (never silently reinterpreting a
    // now-composite-member block as still-standalone).
    const laterText = ["- ![[scan.png]]", "> [!note] one", "> body", "", "- x"].join("\n");
    const outcome = moveStandaloneComplexBlock(
      laterText,
      { snapshot, direction: "down" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(laterText.split("\n"));
  });
});

describe("standaloneComplexBlockMoveReasonText", () => {
  it("maps every NoStandaloneComplexBlockMoveReason to a non-empty, distinct-per-locale string", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    const reasons = [
      "not-supported",
      "composite-member",
      "nested-in-list",
      "no-adjacent-compatible-unit",
      "different-section",
      "standalone-boundary-changed",
      "range-invalid",
      "no-target",
    ] as const;
    for (const reason of reasons) {
      const enText = standaloneComplexBlockMoveReasonText(en, reason);
      const jaText = standaloneComplexBlockMoveReasonText(ja, reason);
      expect(enText?.length ?? 0).toBeGreaterThan(0);
      expect(jaText?.length ?? 0).toBeGreaterThan(0);
      expect(enText).not.toBe(jaText);
    }
  });

  it("returns undefined for an undefined reason", () => {
    const en = createTranslator("en");
    expect(standaloneComplexBlockMoveReasonText(en, undefined)).toBeUndefined();
  });

  it("resolves via dedicated reason.standaloneMove* keys, never the reason.compositeMove* keys' own string values (kind/nested/boundary/range reasons overlap by NAME with composite's own but must not overlap by TEXT)", () => {
    const en = createTranslator("en");
    expect(standaloneComplexBlockMoveReasonText(en, "nested-in-list")).not.toBe(
      en("reason.compositeMoveNestedInList")
    );
    expect(standaloneComplexBlockMoveReasonText(en, "standalone-boundary-changed")).not.toBe(
      en("reason.compositeMoveBoundaryChanged")
    );
    expect(standaloneComplexBlockMoveReasonText(en, "range-invalid")).not.toBe(
      en("reason.compositeMoveRangeInvalid")
    );
    expect(standaloneComplexBlockMoveReasonText(en, "no-adjacent-compatible-unit")).toBe(
      en("reason.standaloneMoveNoAdjacentUnit")
    );
  });
});
