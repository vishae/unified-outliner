/**
 * Phase 5C-1 ticket 4-3 (2026-08-14): unit tests for
 * src/edit/moveCompositeBlock.ts — the pure function that safely swaps a
 * CompositeBlock with an adjacent block (plain list item, or another
 * CompositeBlock widened to its own full range) as one unit.
 *
 * Scope reminder: nothing here touches an Editor, view/OutlineTreeView.ts,
 * or any UI. Every test operates on plain strings in and out. Mirrors
 * tests/deleteCompositeBlock.test.ts's own conventions (snapshotOf/…Own
 * helpers, real-pipeline positive/negative cases, hand-built
 * CompositeBlockSnapshot tampering for field-by-field mismatch coverage).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { buildCompositeBlockSnapshot, CompositeBlockSnapshot } from "../src/edit/deleteCompositeBlock";
import { CompositeMoveRequest, moveCompositeBlock } from "../src/edit/moveCompositeBlock";
import { CompositeMoveDirection } from "../src/move/findCompositeMoveTarget";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";

/** Real pipeline: parse -> scan -> match -> snapshot the Nth recognized composite (0-based). Mirrors tests/deleteCompositeBlock.test.ts's own snapshotOf. */
function snapshotOf(
  text: string,
  rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES,
  index = 0
): CompositeBlockSnapshot {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return buildCompositeBlockSnapshot(composites[index]);
}

/** Convenience: snapshot the Nth composite in `text` and immediately try to move it, in `direction`, FROM THAT SAME `text`. */
function moveOwn(
  text: string,
  direction: CompositeMoveDirection,
  rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES,
  index = 0
) {
  const snapshot = snapshotOf(text, rules, index);
  const request: CompositeMoveRequest = { snapshot, direction };
  return moveCompositeBlock(text, request, rules);
}

describe("moveCompositeBlock: positive cases — plain (non-composite) adjacent list item", () => {
  it("direction 'down': swaps with the following plain list item, preserving exact line content", () => {
    const text = ["- one", "> [!note]", "> body a", "- two"].join("\n");
    const outcome = moveOwn(text, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- two", "- one", "> [!note]", "> body a"]);
    expect(outcome.newStartLine).toBe(1);
  });

  it("direction 'up': swaps with the preceding plain list item, preserving exact line content", () => {
    const text = ["- zero", "- one", "> [!note]", "> body a"].join("\n");
    const outcome = moveOwn(text, "up");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- one", "> [!note]", "> body a", "- zero"]);
    expect(outcome.newStartLine).toBe(0);
  });

  it("preserves a multi-blank-line gap between the composite and the plain list item across the swap", () => {
    const text = ["- one", "> [!note]", "> body a", "", "", "- two"].join("\n");
    const outcome = moveOwn(text, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- two", "", "", "- one", "> [!note]", "> body a"]);
  });

  it("the result re-parses cleanly with the swapped composite still recognized at its new position", () => {
    const text = ["- one", "> [!note]", "> body a", "- two"].join("\n");
    const outcome = moveOwn(text, "down");
    expect(outcome.changed).toBe(true);
    const reparsedText = outcome.lines.join("\n");
    const doc = parseDocument(reparsedText);
    const complexScan = scanComplexBlocks(doc);
    const composites = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(composites).toHaveLength(1);
    expect(composites[0].range).toEqual({ startLine: 1, endLine: 3 });
  });
});

describe("moveCompositeBlock: positive cases — composite-widening (adjacent block is itself a CompositeBlock)", () => {
  it("direction 'down': the ENTIRE adjacent composite moves as one unit, never just its anchor list item's own line", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const outcome = moveOwn(text, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- two", "> [!tip]", "> body b", "- one", "> [!note]", "> body a"]);
    expect(outcome.newStartLine).toBe(3);
  });

  it("direction 'up': the ENTIRE preceding composite moves as one unit", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const outcome = moveOwn(text, "up", DEFAULT_COMPOSITE_BLOCK_RULES, 1);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- two", "> [!tip]", "> body b", "- one", "> [!note]", "> body a"]);
    expect(outcome.newStartLine).toBe(0);
  });

  it("widening also applies when the adjacent composite's second member is a blockquote (mixed member kinds)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> plain quote"].join("\n");
    const outcome = moveOwn(text, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- two", "> plain quote", "- one", "> [!note]", "> body a"]);
  });

  it("the result re-parses cleanly with BOTH composites still recognized, at their swapped positions", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const outcome = moveOwn(text, "down");
    const doc = parseDocument(outcome.lines.join("\n"));
    const complexScan = scanComplexBlocks(doc);
    const composites = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(composites).toHaveLength(2);
    expect(composites[0].range).toEqual({ startLine: 0, endLine: 2 }); // formerly "two"+tip, now first
    expect(composites[1].range).toEqual({ startLine: 3, endLine: 5 }); // formerly "one"+note, now second
  });
});

describe("moveCompositeBlock: rejections reachable through a genuinely re-matched composite", () => {
  it("rejects (nested-in-list) a composite whose anchor list item is nested inside another list item", () => {
    const text = ["- outer", "  - inner", "> [!note]", "> body"].join("\n");
    const outcome = moveOwn(text, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("nested-in-list");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("rejects (unsafe-indent) a composite whose anchor list item mixes tab/space indentation", () => {
    const text = [" \t- flagged", "> [!note]", "> body"].join("\n");
    const outcome = moveOwn(text, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("unsafe-indent");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("rejects (no-adjacent-compatible-unit) direction 'up' at the start of the document", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const outcome = moveOwn(text, "up");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("no-adjacent-compatible-unit");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("rejects (no-adjacent-compatible-unit) direction 'down' at the end of the document", () => {
    const text = ["- zero", "- one", "> [!note]", "> body"].join("\n");
    const outcome = moveOwn(text, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("no-adjacent-compatible-unit");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("rejects (different-parent-or-depth) when the adjacent root item has a different indentColumns", () => {
    const text = ["- one", "> [!note]", "> body a", "  - two"].join("\n");
    const outcome = moveOwn(text, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("different-parent-or-depth");
    expect(outcome.lines.join("\n")).toBe(text);
  });
});

describe("moveCompositeBlock: rejections when the note changed between selection and move", () => {
  it("rejects (composite-boundary-changed) when the callout was edited to contain a nested callout after selection", () => {
    const originalText = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const snapshot = snapshotOf(originalText);
    const editedText = ["- one", "> [!note]", "> > [!tip] nested", "> body", "- two"].join("\n");

    const outcome = moveCompositeBlock(editedText, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines.join("\n")).toBe(editedText);
  });

  it("rejects (composite-boundary-changed) when the anchor list item was replaced by plain text after selection", () => {
    const originalText = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const snapshot = snapshotOf(originalText);
    const editedText = ["plain first line", "> [!note]", "> body", "- two"].join("\n");

    const outcome = moveCompositeBlock(editedText, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines.join("\n")).toBe(editedText);
  });

  it("rejects (composite-boundary-changed) when the composite shifted to a different line range (content inserted earlier)", () => {
    const originalText = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const snapshot = snapshotOf(originalText);
    const currentText = ["unrelated new line", ...originalText.split("\n")].join("\n");

    const outcome = moveCompositeBlock(currentText, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines.join("\n")).toBe(currentText);
  });

  it("rejects (composite-boundary-changed) when the previously-valid adjacent target disappeared after selection (now no-adjacent-compatible-unit at re-check time, but boundary-changed wins since the composite itself no longer matches at the SAME range)", () => {
    // Selected against a doc where "one"+callout has a following sibling
    // ("two"); by the time move executes, "two" is gone AND an unrelated
    // line was inserted before the composite, shifting its own range too —
    // so the snapshot no longer matches ANY current composite at all.
    const originalText = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const snapshot = snapshotOf(originalText);
    const editedText = ["extra line", "- one", "> [!note]", "> body"].join("\n");

    const outcome = moveCompositeBlock(editedText, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines.join("\n")).toBe(editedText);
  });
});

describe("moveCompositeBlock: snapshot field-by-field mismatch rejections", () => {
  const text = ["- one", "> [!note]", "> body", "- two"].join("\n");

  it("rejects when the snapshot's ruleId does not match the current composite's ruleId", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = { ...snapshot, ruleId: "some-other-rule" };
    const outcome = moveCompositeBlock(text, { snapshot: tampered, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
  });

  it("rejects when a member's id does not match (a different underlying node id)", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = {
      ...snapshot,
      members: [{ ...snapshot.members[0], id: "li-does-not-exist" }, snapshot.members[1]],
    };
    const outcome = moveCompositeBlock(text, { snapshot: tampered, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
  });

  it("rejects when member order is reversed (same members, wrong order)", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = { ...snapshot, members: [...snapshot.members].reverse() };
    const outcome = moveCompositeBlock(text, { snapshot: tampered, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(["range-invalid", "composite-boundary-changed"]).toContain(outcome.reason);
    expect(outcome.lines.join("\n")).toBe(text);
  });
});

describe("moveCompositeBlock: range-invalid (structurally broken snapshot)", () => {
  const text = ["- one", "> [!note]", "> body", "- two"].join("\n");

  it("rejects a snapshot whose aggregate range is reversed (startLine > endLine)", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = { ...snapshot, range: { startLine: 2, endLine: 0 } };
    const outcome = moveCompositeBlock(text, { snapshot: tampered, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("rejects a snapshot whose range falls outside the current document's line count", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = {
      ...snapshot,
      range: { startLine: 0, endLine: 999 },
      members: [snapshot.members[0], { ...snapshot.members[1], range: { startLine: 1, endLine: 999 } }],
    };
    const outcome = moveCompositeBlock(text, { snapshot: tampered, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("rejects an empty-members snapshot", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = { ...snapshot, members: [] };
    const outcome = moveCompositeBlock(text, { snapshot: tampered, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines.join("\n")).toBe(text);
  });
});

describe("moveCompositeBlock: purity / non-mutation", () => {
  it("does not mutate the request's snapshot object", () => {
    const text = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const snapshot = snapshotOf(text);
    const snapshotCopy = JSON.parse(JSON.stringify(snapshot));
    moveCompositeBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(snapshot).toEqual(snapshotCopy);
  });

  it("does not mutate the rules array passed in", () => {
    const text = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const snapshot = snapshotOf(text);
    const rules = [...DEFAULT_COMPOSITE_BLOCK_RULES];
    const rulesCopy = JSON.parse(JSON.stringify(rules));
    moveCompositeBlock(text, { snapshot, direction: "down" }, rules);
    expect(rules).toEqual(rulesCopy);
  });

  it("a rejected call is idempotent (repeated calls produce the identical outcome)", () => {
    const text = [" \t- flagged", "> [!note]", "> body"].join("\n");
    const snapshot = snapshotOf(text);
    const first = moveCompositeBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    const second = moveCompositeBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(first).toEqual(second);
  });
});
