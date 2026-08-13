/**
 * Phase 5C-1 ticket 2 (2026-08-13): unit tests for
 * src/edit/deleteCompositeBlock.ts — the pure function that safely deletes
 * a CompositeBlock as one unit.
 *
 * Scope reminder: nothing here touches an Editor, view/OutlineTreeView.ts,
 * or any UI. Every test operates on plain strings in and out.
 * tests/complexBlocks.test.ts, tests/compositeBlocks.test.ts, and
 * tests/compositeBlockDeletability.test.ts (ticket 1) are unchanged by this
 * file; this file is additive only.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import {
  buildCompositeBlockSnapshot,
  CompositeBlockDeleteRequest,
  CompositeBlockSnapshot,
  deleteCompositeBlock,
} from "../src/edit/deleteCompositeBlock";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";

const FENCED_CODE_RULE: CompositeBlockRule[] = [
  { id: "caption-fenced-code", kindSequence: ["single-line-list", "fenced-code"], prefix: "" },
];
const TABLE_RULE: CompositeBlockRule[] = [
  { id: "caption-table", kindSequence: ["single-line-list", "table"], prefix: "" },
];

/** Real pipeline: parse -> scan -> match -> snapshot the Nth recognized composite (0-based). */
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

/** Convenience: snapshot the Nth composite in `text` and immediately try to delete it FROM THAT SAME `text`. */
function deleteOwn(
  text: string,
  rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES,
  index = 0
) {
  const snapshot = snapshotOf(text, rules, index);
  const request: CompositeBlockDeleteRequest = { snapshot };
  return deleteCompositeBlock(text, request, rules);
}

describe("deleteCompositeBlock: positive cases (deletable composites)", () => {
  it("deletes a top-level callout composite spanning the whole document", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const outcome = deleteOwn(text);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([]);
  });

  it("deletes a top-level blockquote composite", () => {
    const text = ["- source", "> plain quote"].join("\n");
    const outcome = deleteOwn(text);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([]);
  });

  it("deletes a top-level closed fenced-code composite", () => {
    const text = ["- snippet", "```", "console.log(1)", "```"].join("\n");
    const outcome = deleteOwn(text, FENCED_CODE_RULE);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([]);
  });

  it("deletes a top-level Mermaid fenced-code composite", () => {
    const text = ["- diagram", "```mermaid", "graph TD; A-->B", "```"].join("\n");
    const outcome = deleteOwn(text, FENCED_CODE_RULE);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([]);
  });

  it("deletes a top-level well-formed table composite", () => {
    const text = ["- data", "| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");
    const outcome = deleteOwn(text, TABLE_RULE);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([]);
  });

  it("the deleted result re-parses cleanly with no dangling structure", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const outcome = deleteOwn(text);
    expect(outcome.changed).toBe(true);
    const reparsed = parseDocument(outcome.lines.join("\n"));
    expect(reparsed.nodes.size).toBe(0);
    expect(reparsed.topLevelIds).toEqual([]);
  });
});

describe("deleteCompositeBlock: exact line-range behavior (no cleanup, no merging)", () => {
  it("at the very start of the document: leaves the following blank line and paragraph exactly as they were", () => {
    const text = ["- one", "> [!note]", "> body", "", "after paragraph"].join("\n");
    const outcome = deleteOwn(text);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["", "after paragraph"]);
  });

  it("at the very end of the document: leaves the preceding paragraph and blank line exactly as they were", () => {
    const text = ["before paragraph", "", "- one", "> [!note]", "> body"].join("\n");
    const outcome = deleteOwn(text);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["before paragraph", ""]);
  });

  it("immediately after a section heading: leaves the heading and following content untouched, no blank line inserted", () => {
    const text = ["# H", "- one", "> [!note]", "> body", "next line in section"].join("\n");
    const outcome = deleteOwn(text);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "next line in section"]);
  });

  it("immediately before the next section heading: leaves the enclosing section's other content and the next heading untouched", () => {
    const text = ["# H", "intro text", "- one", "> [!note]", "> body", "# H2", "other"].join("\n");
    const outcome = deleteOwn(text);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "intro text", "# H2", "other"]);
    // Re-parse to confirm both sections and the surviving text are intact —
    // not just that the raw line array happens to look right.
    const reparsed = parseDocument(outcome.lines.join("\n"));
    expect(reparsed.topLevelIds.length).toBe(2);
  });

  it("with NO blank line on either side: the two adjacent lines are left as two separate lines, never merged into one", () => {
    const text = ["para1", "- one", "> [!note]", "> body", "para2"].join("\n");
    const outcome = deleteOwn(text);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["para1", "para2"]);
  });
});

describe("deleteCompositeBlock: rejections reachable through a genuinely re-matched composite", () => {
  it("rejects (nested-in-list) a composite whose anchor list item is nested inside another list item", () => {
    const text = ["- outer", "  - inner", "> [!note]", "> body"].join("\n");
    const outcome = deleteOwn(text);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("nested-in-list");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("rejects (member-unsafe-indent) a composite whose anchor list item mixes tab/space indentation", () => {
    const text = [" \t- flagged", "> [!note]", "> body"].join("\n");
    const outcome = deleteOwn(text);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("member-unsafe-indent");
    expect(outcome.lines.join("\n")).toBe(text);
  });
});

describe("deleteCompositeBlock: rejections when the note changed between selection and delete", () => {
  // matchCompositeBlocks only ever assembles a CompositeBlockInfo from
  // members that are ALREADY editability:"supported" — nested callout /
  // unterminated fence / malformed table / diagnostics-downgraded blocks
  // never qualify as candidates in the first place (see
  // parser/compositeBlocks.ts's collectCandidates). So once the note has
  // been edited such that a previously-selected composite's member becomes
  // one of these, a fresh matchCompositeBlocks() run simply no longer
  // produces ANY composite matching the old snapshot — this function
  // correctly reports "composite-boundary-changed" (not
  // "member-not-supported" etc.), which is the semantically right reason
  // ("what you selected is no longer recognizable"), not a gap. See
  // deleteCompositeBlock.ts's NoCompositeDeleteReason doc comment and this
  // ticket's completion report for the full analysis.

  it("rejects (composite-boundary-changed) when the callout was edited to contain a nested callout after selection", () => {
    const originalText = ["- one", "> [!note]", "> body"].join("\n");
    const snapshot = snapshotOf(originalText);
    const editedText = ["- one", "> [!note]", "> > [!tip] nested", "> body"].join("\n");

    const outcome = deleteCompositeBlock(editedText, { snapshot }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines.join("\n")).toBe(editedText);
  });

  it("rejects (composite-boundary-changed) when the fenced-code member's closing fence was removed after selection", () => {
    const originalText = ["- snippet", "```", "console.log(1)", "```"].join("\n");
    const snapshot = snapshotOf(originalText, FENCED_CODE_RULE);
    const editedText = ["- snippet", "```", "console.log(1)", "no closing fence"].join("\n");

    const outcome = deleteCompositeBlock(editedText, { snapshot }, FENCED_CODE_RULE);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines.join("\n")).toBe(editedText);
  });

  it("rejects (composite-boundary-changed) when the table member's delimiter row was edited into a column mismatch after selection", () => {
    const originalText = ["- data", "| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");
    const snapshot = snapshotOf(originalText, TABLE_RULE);
    const editedText = ["- data", "| a | b |", "| - |", "| 1 | 2 |"].join("\n");

    const outcome = deleteCompositeBlock(editedText, { snapshot }, TABLE_RULE);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines.join("\n")).toBe(editedText);
  });

  it("rejects (composite-boundary-changed) when the anchor list item was replaced by plain text after selection (member disappeared, line count unchanged)", () => {
    // Deliberately keeps the same line count as originalText so this test
    // exercises "no matching composite is found" rather than the separate
    // "range-invalid" (out-of-current-bounds) path exercised elsewhere.
    const originalText = ["- one", "> [!note]", "> body"].join("\n");
    const snapshot = snapshotOf(originalText);
    const editedText = ["plain first line", "> [!note]", "> body"].join("\n");

    const outcome = deleteCompositeBlock(editedText, { snapshot }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines.join("\n")).toBe(editedText);
  });

  it("rejects (composite-boundary-changed) when an unrelated CompositeBlock now reuses the exact same id but is a different composite (different ruleId/range/members)", () => {
    // Both texts are 3 lines (so the snapshot's range stays within bounds
    // and this exercises content-mismatch detection, not range-invalid).
    const snapshot = snapshotOf(["- one", "> [!note]", "> body"].join("\n")); // id "composite-0", ruleId "image-ocr", range 0-2
    const currentText = ["- two", "> plain quote", "trailing paragraph"].join("\n"); // also produces id "composite-0", but ruleId "image-quote", range 0-1

    const outcome = deleteCompositeBlock(currentText, { snapshot }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines.join("\n")).toBe(currentText);
  });

  it("rejects (composite-boundary-changed) when the composite shifted to a different line range (e.g. content inserted earlier in the document)", () => {
    const originalText = ["- one", "> [!note]", "> body"].join("\n");
    const snapshot = snapshotOf(originalText);
    const currentText = ["unrelated new line", ...originalText.split("\n")].join("\n");

    const outcome = deleteCompositeBlock(currentText, { snapshot }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines.join("\n")).toBe(currentText);
  });
});

describe("deleteCompositeBlock: snapshot field-by-field mismatch rejections", () => {
  const text = ["- one", "> [!note]", "> body"].join("\n");

  it("rejects when the snapshot's ruleId does not match the current composite's ruleId", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = { ...snapshot, ruleId: "some-other-rule" };
    const outcome = deleteCompositeBlock(text, { snapshot: tampered }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
  });

  it("rejects when the snapshot's sectionId does not match", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = { ...snapshot, sectionId: "sec-99" };
    const outcome = deleteCompositeBlock(text, { snapshot: tampered }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
  });

  it("rejects when a member's kind does not match", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = {
      ...snapshot,
      members: [{ ...snapshot.members[0], kind: "blockquote" }, snapshot.members[1]],
    };
    const outcome = deleteCompositeBlock(text, { snapshot: tampered }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
  });

  it("rejects when a member's id does not match (a different underlying node id)", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = {
      ...snapshot,
      members: [{ ...snapshot.members[0], id: "li-does-not-exist" }, snapshot.members[1]],
    };
    const outcome = deleteCompositeBlock(text, { snapshot: tampered }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
  });

  it("rejects when member order is reversed (same members, wrong order)", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = {
      ...snapshot,
      members: [...snapshot.members].reverse(),
    };
    const outcome = deleteCompositeBlock(text, { snapshot: tampered }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    // Reversed members also fail findRangeInvalidReason's contiguity check
    // (member[0] here is the callout, whose range does not start the
    // aggregate range) — either "range-invalid" or "composite-boundary-changed"
    // is an acceptable, equally safe outcome; what matters is that it is
    // rejected and the note is untouched.
    expect(["range-invalid", "composite-boundary-changed"]).toContain(outcome.reason);
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("rejects when a member's range does not match", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = {
      ...snapshot,
      members: [snapshot.members[0], { ...snapshot.members[1], range: { startLine: 1, endLine: 5 } }],
    };
    const outcome = deleteCompositeBlock(text, { snapshot: tampered }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(["range-invalid", "composite-boundary-changed"]).toContain(outcome.reason);
    expect(outcome.lines.join("\n")).toBe(text);
  });
});

describe("deleteCompositeBlock: range-invalid (structurally broken snapshot)", () => {
  const text = ["- one", "> [!note]", "> body"].join("\n");

  it("rejects a snapshot whose aggregate range is reversed (startLine > endLine)", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = { ...snapshot, range: { startLine: 2, endLine: 0 } };
    const outcome = deleteCompositeBlock(text, { snapshot: tampered }, DEFAULT_COMPOSITE_BLOCK_RULES);
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
    const outcome = deleteCompositeBlock(text, { snapshot: tampered }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("rejects a snapshot whose members have a gap between them (non-contiguous)", () => {
    const gapText = ["- one", "", "> [!note]", "> body"].join("\n"); // blank line between — not a real composite, built by hand below
    const snapshot: CompositeBlockSnapshot = {
      id: "composite-0",
      ruleId: "image-ocr",
      sectionId: null,
      range: { startLine: 0, endLine: 3 },
      members: [
        { kind: "single-line-list", id: "li-0", range: { startLine: 0, endLine: 0 } },
        { kind: "callout", id: "callout-0", range: { startLine: 2, endLine: 3 } },
      ],
    };
    const outcome = deleteCompositeBlock(gapText, { snapshot }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines.join("\n")).toBe(gapText);
  });

  it("rejects an empty-members snapshot", () => {
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = { ...snapshot, members: [] };
    const outcome = deleteCompositeBlock(text, { snapshot: tampered }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines.join("\n")).toBe(text);
  });
});

describe("deleteCompositeBlock: purity / non-mutation", () => {
  it("does not mutate the request's snapshot object", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const snapshot = snapshotOf(text);
    const snapshotCopy = JSON.parse(JSON.stringify(snapshot));
    deleteCompositeBlock(text, { snapshot }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(snapshot).toEqual(snapshotCopy);
  });

  it("does not mutate the rules array passed in", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const snapshot = snapshotOf(text);
    const rules = [...DEFAULT_COMPOSITE_BLOCK_RULES];
    const rulesCopy = JSON.parse(JSON.stringify(rules));
    deleteCompositeBlock(text, { snapshot }, rules);
    expect(rules).toEqual(rulesCopy);
  });

  it("a rejected call leaves `text` itself unrepresented in any mutated shared state (repeated calls are idempotent)", () => {
    const text = [" \t- flagged", "> [!note]", "> body"].join("\n");
    const snapshot = snapshotOf(text);
    const first = deleteCompositeBlock(text, { snapshot }, DEFAULT_COMPOSITE_BLOCK_RULES);
    const second = deleteCompositeBlock(text, { snapshot }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(first).toEqual(second);
  });
});
