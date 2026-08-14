import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { buildCompositeBlockSnapshot } from "../src/edit/deleteCompositeBlock";
import { CompositeMoveOutcome, moveCompositeBlock } from "../src/edit/moveCompositeBlock";
import { CompositeMoveDirection } from "../src/move/findCompositeMoveTarget";
import { resolveCompositeSelectionTarget } from "../src/move/resolveCompositeSelectionTarget";

/**
 * Phase 5C-1 ticket 4-5 (2026-08-14): end-to-end tests for main.ts's new
 * move-composite-block-up/down commands (private moveCurrentCompositeBlock).
 * "obsidian" is a types-only package in this project (see every other UI-
 * wiring test file's own top doc comment), so UnifiedOutlinerPlugin cannot
 * be instantiated here. This file instead reproduces
 * moveCurrentCompositeBlock's exact call sequence — parseDocument ->
 * scanComplexBlocks -> matchCompositeBlocks -> resolveCompositeSelectionTarget
 * -> (iff allowed) buildCompositeBlockSnapshot -> moveCompositeBlock — against
 * plain strings, with no Editor/Notice/refresh involved. Real Notice text,
 * editor.scrollIntoView, and Obsidian's own Undo require manual desktop/iPad
 * verification instead (see this ticket's completion report).
 */
function dispatch(
  text: string,
  selection: { selectionCount: number; anchorLine: number; headLine: number; cursorLine: number },
  direction: CompositeMoveDirection,
  rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES
): CompositeMoveOutcome | { changed: false; reason: string; lines: string[] } {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);

  const resolution = resolveCompositeSelectionTarget(composites, selection);
  if (!resolution.allowed) {
    return { changed: false, reason: resolution.reason, lines: text.split("\n") };
  }

  const snapshot = buildCompositeBlockSnapshot(resolution.composite);
  return moveCompositeBlock(text, { snapshot, direction }, rules);
}

function collapsed(cursorLine: number) {
  return { selectionCount: 1, anchorLine: cursorLine, headLine: cursorLine, cursorLine };
}

describe("13/14. cursor-driven move: a single callout/blockquote composite moves as one atomic unit", () => {
  it("callout composite, cursor inside it, moves down: whole block relocates, > prefix and blank line intact", () => {
    const text = ["# Section", "", "- one", "> [!note] title", "> body", "- two", "", "trailing"].join("\n");
    const outcome = dispatch(text, collapsed(4), "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# Section",
      "",
      "- two",
      "- one",
      "> [!note] title",
      "> body",
      "",
      "trailing",
    ]);
  });

  it("blockquote composite, cursor inside it, moves up: whole block relocates, > prefix intact", () => {
    const text = ["# Section", "- zero", "- one", "> quoted", "- two"].join("\n");
    const outcome = dispatch(text, collapsed(3), "up");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# Section", "- one", "> quoted", "- zero", "- two"]);
  });

  it("a non-collapsed selection fully inside the composite behaves identically to a collapsed cursor", () => {
    const text = ["# Section", "", "- one", "> [!note] title", "> body", "- two", "", "trailing"].join("\n");
    const outcome = dispatch(
      text,
      { selectionCount: 1, anchorLine: 3, headLine: 4, cursorLine: 4 },
      "down"
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# Section",
      "",
      "- two",
      "- one",
      "> [!note] title",
      "> body",
      "",
      "trailing",
    ]);
  });
});

describe("boundary/eligibility rejections reached through the new cursor entry point: text always stays byte-identical", () => {
  it("first composite in a section has no move-up target: resolveCompositeSelectionTarget allows, moveCompositeBlock itself rejects (no-adjacent-compatible-unit), text unchanged", () => {
    const text = ["# Section", "- one", "> [!note] title", "> body"].join("\n");
    const outcome = dispatch(text, collapsed(2), "up");
    expect(outcome.changed).toBe(false);
    expect((outcome as CompositeMoveOutcome).reason).toBe("no-adjacent-compatible-unit");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("a composite nested inside another list item is resolved by cursor but rejected by moveCompositeBlock (nested-in-list), text unchanged", () => {
    const text = ["- outer", "  - inner", "> [!note] title", "> body"].join("\n");
    const outcome = dispatch(text, collapsed(3), "down");
    expect(outcome.changed).toBe(false);
    expect((outcome as CompositeMoveOutcome).reason).toBe("nested-in-list");
    expect(outcome.lines).toEqual(text.split("\n"));
  });
});

describe("selection-resolution rejections reached through the new cursor entry point: text always stays byte-identical", () => {
  it("multiple selections (multi-cursor) never reaches moveCompositeBlock at all; text unchanged", () => {
    const text = ["- one", "> [!note] title", "> body"].join("\n");
    const outcome = dispatch(
      text,
      { selectionCount: 2, anchorLine: 1, headLine: 1, cursorLine: 1 },
      "down"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("multiple-selections");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("cursor on a plain, non-composite line never reaches moveCompositeBlock at all; text unchanged", () => {
    const text = ["plain text", "- one", "> [!note] title", "> body"].join("\n");
    const outcome = dispatch(text, collapsed(0), "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("no-composite-at-cursor");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("a selection reaching outside the resolved composite never reaches moveCompositeBlock at all; text unchanged", () => {
    const text = ["- one", "> [!note] title", "> body", "- two"].join("\n");
    const outcome = dispatch(
      text,
      { selectionCount: 1, anchorLine: 1, headLine: 3, cursorLine: 1 },
      "down"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("selection-outside-composite");
    expect(outcome.lines).toEqual(text.split("\n"));
  });
});
