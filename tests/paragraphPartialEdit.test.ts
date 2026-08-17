import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { resolveParagraphAtCursor } from "../src/resolver/resolveParagraphAtCursor";
import { applyParagraphEdit, ParagraphEditAnchor } from "../src/edit/paragraphPartialEdit";

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
