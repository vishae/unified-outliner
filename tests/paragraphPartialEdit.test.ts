import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { resolveParagraphAtCursor } from "../src/resolver/resolveParagraphAtCursor";
import { resolveMoveUnit, moveComplexBlock } from "../src/move/resolveMoveTarget";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { buildParagraphMoveAnchor, moveParagraphFromAnchor } from "../src/edit/paragraphTreeMove";
import {
  applyParagraphEdit,
  buildParagraphEditAnchor,
  paragraphEditTextContainsBlankLine,
  ParagraphEditAnchor,
} from "../src/edit/paragraphPartialEdit";

/**
 * Loads an anchor exactly the way PartialEditView.loadParagraphInternal
 * would, from a fresh parse + resolve — via the one true builder
 * (`buildParagraphEditAnchor`), never a hand-built object literal, so
 * every test here exercises the real `siblingCount` computation too.
 */
function anchorAt(text: string, cursorLine: number): ParagraphEditAnchor {
  const doc = parseDocument(text);
  const resolved = resolveParagraphAtCursor(doc, cursorLine);
  if (!resolved.paragraph) throw new Error("expected a paragraph to resolve for this test fixture");
  return buildParagraphEditAnchor(doc, resolved.paragraph);
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
  it("rejects (anchor-unresolved) when the paragraph was deleted entirely", () => {
    const original = ["# H", "Before.", "", "Target paragraph.", "", "After."].join("\n");
    const anchor = anchorAt(original, 3);
    expect(anchor.siblingCount).toBe(3); // "Before.", "Target paragraph.", "After."
    // Simulate the user deleting the target paragraph in the body editor
    // before Apply. Deleting it shifts the scan-local id every LATER
    // paragraph gets assigned (parser/complexBlocks.ts's scanParagraphBlocks
    // — ids are a per-call sequence number, not persistent), so a stale
    // id-only lookup could coincidentally land on "After." instead —
    // exactly the scenario this module's Pass 2 structural re-search
    // exists for. Here, no paragraph anywhere under this section still has
    // the anchor's exact text ("Target paragraph."), AND the sibling count
    // dropped from 3 to 2 — a population change, not a mere content edit —
    // so this safely rejects as "anchor-unresolved" rather than guessing
    // which remaining paragraph to overwrite.
    const changedText = ["# H", "Before.", "", "", "After."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("anchor-unresolved");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (anchor-unresolved) when the paragraph was split by a blank line", () => {
    const original = ["# H", "Target paragraph line one.", "line two."].join("\n");
    const anchor = anchorAt(original, 1);
    expect(anchor.siblingCount).toBe(1);
    const changedText = ["# H", "Target paragraph line one.", "", "line two."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    // The split doubled the same-parent paragraph population (1 -> 2) —
    // a structural change, safely rejected rather than attributed to a
    // content edit.
    expect(outcome.reason).toBe("anchor-unresolved");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (anchor-unresolved) when the paragraph was merged with an adjacent paragraph", () => {
    const original = ["# H", "First.", "", "Second."].join("\n");
    const anchor = anchorAt(original, 1); // "First."
    expect(anchor.siblingCount).toBe(2);
    const changedText = ["# H", "First.", "Second."].join("\n"); // blank line removed, now merged
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    // The merge halved the same-parent paragraph population (2 -> 1) —
    // a structural change, safely rejected rather than attributed to a
    // content edit.
    expect(outcome.reason).toBe("anchor-unresolved");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (anchor-unresolved) when the paragraph moved from a list item's child to section-direct, with its own text unchanged", () => {
    const original = ["- item1", "  Stable text.", "- item2"].join("\n");
    const anchor = anchorAt(original, 1);
    expect(anchor.depth).toBeGreaterThan(0);
    // The list marker above it is removed, so the SAME text is now a
    // section-direct (top-level) paragraph instead of item1's child —
    // structural position changed without the paragraph's own text
    // changing at all. No candidate anywhere shares item1's old parentId
    // any more, so this safely rejects rather than reparenting silently.
    const changedText = ["item1 (no longer a list marker)", "  Stable text.", "item2 either"].join(
      "\n"
    );
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("anchor-unresolved");
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

  it("rejects (anchor-unresolved) when the target became a callout instead of a paragraph", () => {
    const original = ["# H", "Plain text here."].join("\n");
    const anchor = anchorAt(original, 1);
    const changedText = ["# H", "> [!note] Plain text here."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    // No "supported" paragraph remains under this section at all (the
    // callout wins the merge-priority conflict over the same lines —
    // parser/complexBlocks.ts's mergeBlockRangesSafely) — population 1 -> 0.
    expect(outcome.reason).toBe("anchor-unresolved");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects (anchor-unresolved) when the paragraph's boundary became ambiguous", () => {
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
    expect(outcome.reason).toBe("anchor-unresolved");
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

/**
 * Phase 5P-4 supplement ("Paragraph Partial Edit Pane の持続アンカー
 * 再解決"): the Partial Edit Pane holds a `ParagraphEditAnchor` for as
 * long as it stays open — unlike a Tree-triggered move, whose anchor is
 * built and consumed in one atomic step. These tests simulate exactly
 * that: an anchor built once, then some OTHER mechanism (the body-cursor
 * "Move block" command, or the Tree's own `moveParagraphFromAnchor`)
 * moves the underlying paragraph before Apply is ever clicked.
 */
describe("applyParagraphEdit: persistent-anchor re-resolution across an external paragraph<->paragraph swap (Phase 5P-4 supplement)", () => {
  it("body-cursor path: A swaps with sibling B elsewhere; A's own text is unchanged, so Apply still succeeds and edits exactly A's (new) position", () => {
    const text = ["# H", "paragraph A", "", "paragraph B"].join("\n");
    const anchor = anchorAt(text, 1); // "paragraph A", captured BEFORE the swap

    const doc = parseDocument(text);
    const unit = resolveMoveUnit(doc, 1).unit!;
    const moveOutcome = moveComplexBlock(doc, unit, "down");
    expect(moveOutcome.changed).toBe(true);
    const movedText = moveOutcome.lines.join("\n");
    expect(movedText).toBe(["# H", "paragraph B", "", "paragraph A"].join("\n"));

    // The pane, still holding the ORIGINAL anchor, is now told to Apply
    // (unedited — the textarea still shows "paragraph A" verbatim).
    const freshDoc = parseDocument(movedText);
    const outcome = applyParagraphEdit(freshDoc, anchor, "paragraph A");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "paragraph B", "", "paragraph A"]);
    expect(outcome.newStartLine).toBe(3);
  });

  it("Tree path: A swaps with sibling B via moveParagraphFromAnchor elsewhere; Apply still succeeds", () => {
    const text = ["# H", "paragraph A", "", "paragraph B"].join("\n");
    const anchor = anchorAt(text, 1);

    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const infoA = scan.blocks.find(
      (b) => b.kind === "paragraph" && doc.lines[b.range.startLine] === "paragraph A"
    )!;
    const treeAnchor = buildParagraphMoveAnchor(doc, infoA)!;
    const moveOutcome = moveParagraphFromAnchor(text, treeAnchor, "down");
    expect(moveOutcome.changed).toBe(true);
    const movedText = moveOutcome.lines.join("\n");

    const freshDoc = parseDocument(movedText);
    const outcome = applyParagraphEdit(freshDoc, anchor, "paragraph A");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "paragraph B", "", "paragraph A"]);
  });

  it("swap + an external edit to A's own (now relocated) text -> rejects (content-changed), not a false anchor-unresolved", () => {
    const text = ["# H", "paragraph A", "", "paragraph B"].join("\n");
    const anchor = anchorAt(text, 1);

    const doc = parseDocument(text);
    const unit = resolveMoveUnit(doc, 1).unit!;
    const moveOutcome = moveComplexBlock(doc, unit, "down");
    const movedLines = moveOutcome.lines.slice();
    // A's slot after the swap is line 3 ("paragraph A") — edit it directly,
    // simulating an edit made through some channel other than this pane.
    movedLines[3] = "paragraph A EDITED";
    const freshDoc = parseDocument(movedLines.join("\n"));

    const outcome = applyParagraphEdit(freshDoc, anchor, "paragraph A");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("content-changed");
    expect(outcome.lines).toEqual(freshDoc.lines);
  });

  it("an ambiguous duplicate (two byte-identical sibling paragraphs) after a disrupting change -> rejects (anchor-unresolved), never overwrites either candidate", () => {
    const text = ["# H", "Same text.", "", "Same text.", "", "Other."].join("\n");
    const anchor = anchorAt(text, 1); // the FIRST "Same text." paragraph
    expect(anchor.siblingCount).toBe(3);

    // Simulate an unrelated structural change elsewhere that disrupts the
    // scan-local id sequence without changing the total population: "Other."
    // and the anchored "Same text." trade places. Two byte-identical
    // "Same text." candidates now exist under the same parent, and neither
    // is distinguishable from the anchor by content alone.
    const changedText = ["# H", "Other.", "", "Same text.", "", "Same text."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("anchor-unresolved");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("3+ successive Move-down invocations relocate A elsewhere in the document; Apply against the anchor built BEFORE any of them still succeeds", () => {
    let text = [
      "# H",
      "paragraph A",
      "",
      "paragraph B",
      "",
      "paragraph C",
      "",
      "paragraph D",
      "",
      "paragraph E",
    ].join("\n");
    const anchor = anchorAt(text, 1); // captured once, before any moves

    let cursorLine = 1;
    for (let step = 0; step < 3; step++) {
      const doc = parseDocument(text);
      const unit = resolveMoveUnit(doc, cursorLine).unit!;
      const moveOutcome = moveComplexBlock(doc, unit, "down");
      expect(moveOutcome.changed, `step ${step + 1}`).toBe(true);
      text = moveOutcome.lines.join("\n");
      cursorLine = moveOutcome.newStartLine;
    }
    expect(text).toBe(
      ["# H", "paragraph B", "", "paragraph C", "", "paragraph D", "", "paragraph A", "", "paragraph E"].join(
        "\n"
      )
    );

    const freshDoc = parseDocument(text);
    const outcome = applyParagraphEdit(freshDoc, anchor, "paragraph A, edited");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "paragraph B",
      "",
      "paragraph C",
      "",
      "paragraph D",
      "",
      "paragraph A, edited",
      "",
      "paragraph E",
    ]);
  });
});
