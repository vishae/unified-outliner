import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { resolveParagraphAtCursor } from "../src/resolver/resolveParagraphAtCursor";
import {
  applyParagraphEdit,
  paragraphEditTextContainsBlankLine,
  ParagraphEditAnchor,
} from "../src/edit/paragraphPartialEdit";

/** Loads an anchor exactly the way PartialEditView.loadParagraphInternal would, from a fresh parse + resolve. */
function anchorAt(text: string, cursorLine: number): ParagraphEditAnchor {
  const doc = parseDocument(text);
  const resolved = resolveParagraphAtCursor(doc, cursorLine);
  if (!resolved.paragraph) throw new Error("expected a paragraph to resolve for this test fixture");
  return {
    complexBlockId: resolved.paragraph.complexBlockId,
    parentId: resolved.paragraph.parentId,
    depth: resolved.paragraph.depth,
    originalText: resolved.paragraph.text,
  };
}

describe("applyParagraphEdit: successful apply", () => {
  it("replaces only the target paragraph's own range, leaving everything else byte-identical", () => {
    const text = ["# H", "Before.", "", "Target paragraph.", "", "After."].join("\n");
    const anchor = anchorAt(text, 3);
    const doc = parseDocument(text);
    const outcome = applyParagraphEdit(doc, anchor, "Edited target paragraph.");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "Before.", "", "Edited target paragraph.", "", "After."]);
    expect(outcome.newStartLine).toBe(3);
  });

  it("works for a list-item-child paragraph, touching only its own line(s)", () => {
    const text = ["- item1", "  Child paragraph of item1.", "- item2"].join("\n");
    const anchor = anchorAt(text, 1);
    const doc = parseDocument(text);
    const outcome = applyParagraphEdit(doc, anchor, "  Edited child paragraph.");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- item1", "  Edited child paragraph.", "- item2"]);
  });

  it("a multi-line paragraph can grow or shrink in line count on Apply", () => {
    const text = ["# H", "One line paragraph."].join("\n");
    const anchor = anchorAt(text, 1);
    const doc = parseDocument(text);
    const outcome = applyParagraphEdit(doc, anchor, "Now it is\ntwo lines.");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "Now it is", "two lines."]);
  });
});

describe("applyParagraphEdit: safe no-op rejections", () => {
  it("rejects when the paragraph was deleted entirely", () => {
    const original = ["# H", "Before.", "", "Target paragraph.", "", "After."].join("\n");
    const anchor = anchorAt(original, 3);
    // Simulate the user deleting the target paragraph in the body editor
    // before Apply. Deleting it shifts the scan-local id every LATER
    // paragraph gets assigned (see parser/complexBlocks.ts's scanParagraphBlocks
    // — ids are a per-call sequence number, not persistent) — "After." now
    // coincidentally lands on the SAME id "Target paragraph." originally
    // had, which is exactly the scenario this module's own doc comment
    // describes as the reason a content-equality check (not the id lookup
    // alone) is required: the id-based lookup succeeds and finds a real,
    // "supported", same-parent/depth paragraph, but its CONTENT
    // ("After.") does not match the anchor's original snapshot ("Target
    // paragraph."), so it is still safely rejected — just via
    // "content-changed" rather than "resolve-failed".
    const changedText = ["# H", "Before.", "", "", "After."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    expect(["resolve-failed", "content-changed"]).toContain(outcome.reason);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (resolve-failed or content-changed) when the paragraph was split by a blank line", () => {
    const original = ["# H", "Target paragraph line one.", "line two."].join("\n");
    const anchor = anchorAt(original, 1);
    const changedText = ["# H", "Target paragraph line one.", "", "line two."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    expect(["resolve-failed", "content-changed"]).toContain(outcome.reason);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (content-changed) when the paragraph was merged with an adjacent paragraph", () => {
    const original = ["# H", "First.", "", "Second."].join("\n");
    const anchor = anchorAt(original, 1); // "First."
    const changedText = ["# H", "First.", "Second."].join("\n"); // blank line removed, now merged
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    expect(["resolve-failed", "content-changed"]).toContain(outcome.reason);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (identity-changed) when the paragraph moved from a list item's child to section-direct, with its own text unchanged", () => {
    const original = ["- item1", "  Stable text.", "- item2"].join("\n");
    const anchor = anchorAt(original, 1);
    expect(anchor.depth).toBeGreaterThan(0);
    // The list marker above it is removed, so the SAME text is now a
    // section-direct (top-level) paragraph instead of item1's child —
    // structural position changed without the paragraph's own text
    // changing at all.
    const changedText = ["item1 (no longer a list marker)", "  Stable text.", "item2 either"].join(
      "\n"
    );
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (content-changed) when the target paragraph's own content changed since load", () => {
    const original = ["# H", "Original text."].join("\n");
    const anchor = anchorAt(original, 1);
    const changedText = ["# H", "Someone else edited this line."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("content-changed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (resolve-failed) when the target became a callout instead of a paragraph", () => {
    const original = ["# H", "Plain text here."].join("\n");
    const anchor = anchorAt(original, 1);
    const changedText = ["# H", "> [!note] Plain text here."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (resolve-failed) when the paragraph's boundary became ambiguous", () => {
    const original = ["- item1", "  Child paragraph of item1.", "- item2"].join("\n");
    const anchor = anchorAt(original, 1);
    // Now craft a doc where, at the SAME complexBlockId slot ("paragraph-0"),
    // the candidate is ambiguous instead of supported: a cross-boundary
    // merge (list-child line immediately followed by an unindented line,
    // no blank separator).
    const changedText = ["- item1", "  Child paragraph of item1.", "Not indented."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
    expect(outcome.reason).not.toBeUndefined();
  });

  it("never writes outside the target paragraph's range even when neighboring content is complex", () => {
    const text = [
      "# H",
      "> [!note]",
      "> callout body",
      "",
      "Target paragraph.",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    const anchor = anchorAt(text, 4);
    const doc = parseDocument(text);
    const outcome = applyParagraphEdit(doc, anchor, "Edited target.");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "> [!note]",
      "> callout body",
      "",
      "Edited target.",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ]);
  });
});

/**
 * Phase 5T-4A ("Tree paragraph → 既存 Partial Edit の最小実装",
 * docs/phase5t4_tree_paragraph_partial_edit_design.md §5-3/§7): the new
 * blank-line-input validation, tested as a standalone pure function first
 * (per the ticket's own "可能なら…paragraphバリデーション単体テストを分離
 * すること" instruction) and then through applyParagraphEdit's own
 * rejection path.
 */
describe("paragraphEditTextContainsBlankLine (Phase 5T-4A)", () => {
  it("returns false for a single-line paragraph", () => {
    expect(paragraphEditTextContainsBlankLine("Just one line.")).toBe(false);
  });

  it("returns false for a multi-line paragraph with no blank line between the lines (soft-wrapped, pre-existing 5P-2 behavior)", () => {
    expect(paragraphEditTextContainsBlankLine("Line one.\nLine two.\nLine three.")).toBe(false);
  });

  it("returns true when a blank line sits strictly between two non-blank lines", () => {
    expect(paragraphEditTextContainsBlankLine("Line one.\n\nLine two.")).toBe(true);
  });

  it("returns true for a whitespace-only line (spaces or tabs only), not just a fully empty one", () => {
    expect(paragraphEditTextContainsBlankLine("Line one.\n   \nLine two.")).toBe(true);
    expect(paragraphEditTextContainsBlankLine("Line one.\n\t\nLine two.")).toBe(true);
  });

  it("returns true for a single trailing newline (an empty final line), even with no other blank line — the trailing-newline convention documented on the function itself", () => {
    expect(paragraphEditTextContainsBlankLine("Just one line.\n")).toBe(true);
  });

  it("returns true for a leading blank line", () => {
    expect(paragraphEditTextContainsBlankLine("\nLine one.")).toBe(true);
  });

  it("returns true for a fully empty string (an emptied-out paragraph)", () => {
    expect(paragraphEditTextContainsBlankLine("")).toBe(true);
  });

  it("returns false for a line with meaningful trailing/leading whitespace around real content (not itself a blank line)", () => {
    expect(paragraphEditTextContainsBlankLine("  Indented child paragraph text.")).toBe(false);
    expect(paragraphEditTextContainsBlankLine("Trailing space at end.   ")).toBe(false);
  });
});

describe("applyParagraphEdit: blank-line input rejection (Phase 5T-4A)", () => {
  it("rejects (blank-line-not-allowed) when newText contains a blank line in the middle, and leaves the note byte-identical", () => {
    const text = ["# H", "Target paragraph."].join("\n");
    const anchor = anchorAt(text, 1);
    const doc = parseDocument(text);
    const outcome = applyParagraphEdit(doc, anchor, "First half.\n\nSecond half.");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("blank-line-not-allowed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (blank-line-not-allowed) for a whitespace-only line", () => {
    const text = ["# H", "Target paragraph."].join("\n");
    const anchor = anchorAt(text, 1);
    const doc = parseDocument(text);
    const outcome = applyParagraphEdit(doc, anchor, "First half.\n   \nSecond half.");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("blank-line-not-allowed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (blank-line-not-allowed) for a trailing newline, even though the rest of the text is otherwise a valid single-line paragraph", () => {
    const text = ["# H", "Target paragraph."].join("\n");
    const anchor = anchorAt(text, 1);
    const doc = parseDocument(text);
    const outcome = applyParagraphEdit(doc, anchor, "Edited target paragraph.\n");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("blank-line-not-allowed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("this check runs BEFORE re-resolution — a blank-line input is rejected even when the target paragraph itself can no longer be resolved (id/content/structure all irrelevant once the input itself is invalid)", () => {
    const original = ["# H", "Target paragraph."].join("\n");
    const anchor = anchorAt(original, 1);
    // The paragraph was deleted entirely — resolution would otherwise fail
    // with "resolve-failed"/"content-changed"; the blank-line check must
    // still be the reason reported, since it is checked first.
    const changedText = ["# H"].join("\n");
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "First half.\n\nSecond half.");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("blank-line-not-allowed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("still accepts a valid multi-line (no blank line) replacement — the pre-existing 5P-2 'grow or shrink in line count' contract is unaffected by this new check", () => {
    const text = ["# H", "One line paragraph."].join("\n");
    const anchor = anchorAt(text, 1);
    const doc = parseDocument(text);
    const outcome = applyParagraphEdit(doc, anchor, "Now it is\ntwo lines.");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "Now it is", "two lines."]);
  });
});
