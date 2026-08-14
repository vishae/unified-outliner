import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import {
  CompositeSelectionQuery,
  resolveCompositeSelectionTarget,
} from "../src/move/resolveCompositeSelectionTarget";
import { compositeMoveReasonText } from "../src/edit/moveCompositeBlock";
import { createTranslator } from "../src/i18n";

/**
 * Phase 5C-1 ticket 4-5 (2026-08-14): unit tests for
 * move/resolveCompositeSelectionTarget.ts's resolveCompositeSelectionTarget
 * — the pure function that decides whether the body editor's current
 * cursor/selection names exactly one CompositeBlock, per this ticket's own
 * approved scope note: "選択範囲そのものを移動する機能ではない。常に移動対象は
 * 1個の、既に一意に確定したCompositeBlock全体である。selectionはその
 * CompositeBlockを指していることを確認するための制約としてのみ使う。"
 */
function composites(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  return matchCompositeBlocks(doc, complexScan, rules);
}

function query(overrides: Partial<CompositeSelectionQuery> & { cursorLine: number }): CompositeSelectionQuery {
  return {
    selectionCount: 1,
    anchorLine: overrides.cursorLine,
    headLine: overrides.cursorLine,
    ...overrides,
  };
}

describe("resolveCompositeSelectionTarget: allowed cases", () => {
  it("1. cursor inside a callout, no real selection (collapsed) -> resolves the callout composite", () => {
    const text = ["- item", "> [!note] title", "> body"].join("\n");
    const all = composites(text);
    expect(all).toHaveLength(1);

    const result = resolveCompositeSelectionTarget(all, query({ cursorLine: 2 }));
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.composite.id).toBe(all[0].id);
  });

  it("2. cursor inside a blockquote, no real selection -> resolves the blockquote composite", () => {
    const text = ["- item", "> quoted text"].join("\n");
    const all = composites(text);
    expect(all).toHaveLength(1);

    const result = resolveCompositeSelectionTarget(all, query({ cursorLine: 1 }));
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.composite.id).toBe(all[0].id);
  });

  it("3. a selection fully inside the composite's own range is allowed", () => {
    const text = ["- item", "> [!note] title", "> body"].join("\n");
    const all = composites(text);

    const result = resolveCompositeSelectionTarget(
      all,
      { selectionCount: 1, anchorLine: 1, headLine: 2, cursorLine: 2 }
    );
    expect(result.allowed).toBe(true);
  });

  it("4. anchor/head reversed still resolves the same envelope and is allowed", () => {
    const text = ["- item", "> [!note] title", "> body"].join("\n");
    const all = composites(text);

    const result = resolveCompositeSelectionTarget(
      all,
      { selectionCount: 1, anchorLine: 2, headLine: 1, cursorLine: 1 }
    );
    expect(result.allowed).toBe(true);
  });

  it("5. a multi-line selection fully contained in a multi-line composite is allowed", () => {
    const text = ["- item", "> [!note] title", "> body line 1", "> body line 2"].join("\n");
    const all = composites(text);
    expect(all[0].range).toEqual({ startLine: 0, endLine: 3 });

    const result = resolveCompositeSelectionTarget(
      all,
      { selectionCount: 1, anchorLine: 1, headLine: 3, cursorLine: 2 }
    );
    expect(result.allowed).toBe(true);
  });
});

describe("resolveCompositeSelectionTarget: rejected cases", () => {
  it("6. selectionCount !== 1 (multi-cursor / discontiguous selection) is rejected regardless of line values", () => {
    const text = ["- item", "> [!note] title", "> body"].join("\n");
    const all = composites(text);

    const result = resolveCompositeSelectionTarget(
      all,
      { selectionCount: 2, anchorLine: 1, headLine: 1, cursorLine: 1 }
    );
    expect(result).toEqual({ allowed: false, reason: "multiple-selections" });
  });

  it("6b. zero selections is also rejected as multiple-selections (never treated as 'no selection, allow')", () => {
    const text = ["- item", "> [!note] title", "> body"].join("\n");
    const all = composites(text);

    const result = resolveCompositeSelectionTarget(
      all,
      { selectionCount: 0, anchorLine: 1, headLine: 1, cursorLine: 1 }
    );
    expect(result).toEqual({ allowed: false, reason: "multiple-selections" });
  });

  it("7. selection extends one line past the composite's own end -> rejected, not widened", () => {
    const text = ["- item", "> [!note] title", "> body", "- plain next item"].join("\n");
    const all = composites(text);
    expect(all[0].range).toEqual({ startLine: 0, endLine: 2 });

    const result = resolveCompositeSelectionTarget(
      all,
      { selectionCount: 1, anchorLine: 1, headLine: 3, cursorLine: 1 }
    );
    expect(result).toEqual({ allowed: false, reason: "selection-outside-composite" });
  });

  it("8. selection spans into an adjacent composite -> rejected, never treated as a two-block target", () => {
    const text = ["- one", "> [!note] a", "> body a", "- two", "> [!tip] b", "> body b"].join("\n");
    const all = composites(text);
    expect(all).toHaveLength(2);

    const result = resolveCompositeSelectionTarget(
      all,
      { selectionCount: 1, anchorLine: 1, headLine: 4, cursorLine: 1 }
    );
    expect(result).toEqual({ allowed: false, reason: "selection-outside-composite" });
  });

  it("9. selection spans from the composite into a plain paragraph -> rejected", () => {
    const text = ["- item", "> [!note] title", "> body", "plain paragraph"].join("\n");
    const all = composites(text);
    expect(all[0].range).toEqual({ startLine: 0, endLine: 2 });

    const result = resolveCompositeSelectionTarget(
      all,
      { selectionCount: 1, anchorLine: 1, headLine: 3, cursorLine: 1 }
    );
    expect(result).toEqual({ allowed: false, reason: "selection-outside-composite" });
  });

  it("10. cursor is not inside any CompositeBlock -> rejected as no-composite-at-cursor", () => {
    const text = ["plain text", "- item", "> [!note] title", "> body"].join("\n");
    const all = composites(text);
    expect(all).toHaveLength(1);

    const result = resolveCompositeSelectionTarget(all, query({ cursorLine: 0 }));
    expect(result).toEqual({ allowed: false, reason: "no-composite-at-cursor" });
  });

  it("10b. an empty composites list always rejects as no-composite-at-cursor", () => {
    const result = resolveCompositeSelectionTarget([], query({ cursorLine: 0 }));
    expect(result).toEqual({ allowed: false, reason: "no-composite-at-cursor" });
  });

  it("12. rejection never mutates the caller's allComposites array", () => {
    const text = ["- item", "> [!note] title", "> body"].join("\n");
    const all = composites(text);
    const snapshot = JSON.parse(JSON.stringify(all));

    resolveCompositeSelectionTarget(all, { selectionCount: 3, anchorLine: 0, headLine: 0, cursorLine: 0 });
    resolveCompositeSelectionTarget(all, query({ cursorLine: 999 }));

    expect(JSON.parse(JSON.stringify(all))).toEqual(snapshot);
  });
});

describe("compositeMoveReasonText: the two new ticket-4-5 reasons, plus multiple-selections reuse", () => {
  it("no-composite-at-cursor / selection-outside-composite map to their own dedicated keys", () => {
    const en = createTranslator("en");
    expect(compositeMoveReasonText(en, "no-composite-at-cursor")).toBe(
      en("reason.compositeMoveNoTargetAtCursor")
    );
    expect(compositeMoveReasonText(en, "selection-outside-composite")).toBe(
      en("reason.compositeMoveSelectionOutOfBounds")
    );
  });

  it("multiple-selections reuses the existing notice.multipleCursors text verbatim (no new key)", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(compositeMoveReasonText(en, "multiple-selections")).toBe(en("notice.multipleCursors"));
    expect(compositeMoveReasonText(ja, "multiple-selections")).toBe(ja("notice.multipleCursors"));
  });

  it("both new reason keys are non-empty, distinct per locale, and never mention delete/deletion in English", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    for (const key of ["reason.compositeMoveNoTargetAtCursor", "reason.compositeMoveSelectionOutOfBounds"] as const) {
      expect(en(key).length).toBeGreaterThan(0);
      expect(ja(key).length).toBeGreaterThan(0);
      expect(en(key)).not.toBe(ja(key));
      expect(en(key).toLowerCase()).not.toContain("delet");
    }
  });

  it("undefined reason resolves to undefined (no Notice)", () => {
    const en = createTranslator("en");
    expect(compositeMoveReasonText(en, undefined)).toBeUndefined();
  });
});
