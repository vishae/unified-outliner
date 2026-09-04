/**
 * Phase 5D-4C ("CompositeBlock Atomic Drag-and-Drop 最小実装"): unit tests
 * for the pure EXECUTOR — edit/dropCompositeBlock.ts#dropCompositeBlock.
 *
 * Mirrors tests/dropStandaloneComplexBlock.test.ts's own scope/structure:
 * given the CURRENT Markdown text plus a source CompositeBlockSnapshot and
 * a target hint (both possibly captured at an earlier, now-stale moment),
 * re-parse/re-scan/re-match/re-resolve and perform (or safely no-op) the
 * drop via move/moveBlock.ts's existing insertBlockAt primitive.
 *
 * tests/findCompositeBlockDropTarget.test.ts already covers the pure
 * resolver's own decision logic (self-drop / different-parent-or-depth /
 * composite-internal-boundary / widening) against an already-resolved
 * (source, target-candidate, zone) triple. This file does NOT re-duplicate
 * that matrix exhaustively — it focuses on the executor's own concerns:
 * re-resolution against fresh text, snapshot/target staleness, raw-range
 * (byte-exact) preservation, and post-move re-match safety — while still
 * including one representative case of each resolver-level rejection
 * reason, end-to-end through the executor, per this ticket's own explicit
 * requirement.
 *
 * ---- A note on "target ambiguity" (this ticket's stage-2 instruction) ----
 *
 * edit/dropCompositeBlock.ts#resolveTargetCandidate resolves a target hint
 * deterministically: it scans doc.nodes.values() for the first live
 * ListBlockNode whose (range, parentId) exactly matches the hint, then
 * (only if none found) scans `composites` for the first CompositeBlockInfo
 * whose own range matches. In a well-formed ParsedDocument, no two nodes
 * ever share an identical range (ranges are disjoint by construction), and
 * a CompositeBlockInfo's own range always spans >= 2 members (>= 2 lines)
 * so it can never collide with a single list node's range either. There is
 * therefore no reachable input that makes this resolution genuinely
 * AMBIGUOUS (as opposed to simply unresolvable, which IS reachable and is
 * covered below as "target-boundary-changed") — this is a deliberate,
 * verified architectural property of resolveTargetCandidate, not a gap in
 * this test file's coverage. No fabricated "ambiguity" test is added here.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { buildCompositeBlockSnapshot, CompositeBlockSnapshot } from "../src/edit/deleteCompositeBlock";
import { dropCompositeBlock } from "../src/edit/dropCompositeBlock";
import { extractCompositeBlockText } from "../src/edit/compositeBlockPartialEdit";
import { CompositeBlockDropTargetHint } from "../src/move/findCompositeBlockDropTarget";

function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

/** Real pipeline: parse -> scan -> match -> snapshot the composite whose anchor line contains `needle`. */
function snapshotOf(text: string, needle: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES): CompositeBlockSnapshot {
  const { doc, composites } = pipeline(text, rules);
  const found = composites.find((c) => doc.lines[c.members[0].range.startLine].includes(needle));
  if (!found) throw new Error(`no composite matching "${needle}"`);
  return buildCompositeBlockSnapshot(found);
}

/** Finds a plain list node whose own line contains `needle`. */
function listNodeOf(doc: ReturnType<typeof parseDocument>, needle: string) {
  for (const node of doc.nodes.values()) {
    if (node.type === "list" && doc.lines[node.range.startLine].includes(needle)) return node;
  }
  throw new Error(`no list node matching "${needle}"`);
}

function targetHintOf(range: { startLine: number; endLine: number }, parentId: string | null): CompositeBlockDropTargetHint {
  return { range: { startLine: range.startLine, endLine: range.endLine }, parentId };
}

describe("dropCompositeBlock: successful non-adjacent drops — List+Callout, same section/parentId/depth/indentColumns", () => {
  const text = [
    "- one",
    "> [!note]+ Folded title",
    "> body a",
    "> - nested item 1",
    "> - nested item 2",
    "- middle",
    "- target",
  ].join("\n");

  it("after: moves the whole composite verbatim (list marker, callout type, fold marker, title, body, internal nested list all preserved byte-for-byte)", () => {
    const { doc } = pipeline(text);
    const snapshot = snapshotOf(text, "one");
    const target = listNodeOf(doc, "target");

    const outcome = dropCompositeBlock(
      text,
      { snapshot, target: targetHintOf(target.range, target.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- middle",
      "- target",
      "- one",
      "> [!note]+ Folded title",
      "> body a",
      "> - nested item 1",
      "> - nested item 2",
    ]);
    expect(outcome.newStartLine).toBe(2);
    expect(outcome.lines[outcome.newStartLine]).toBe("- one");
  });

  it("before: moves the whole composite verbatim to the other side of the non-adjacent target", () => {
    const { doc } = pipeline(text);
    const snapshot = snapshotOf(text, "one");
    const target = listNodeOf(doc, "target");

    const outcome = dropCompositeBlock(
      text,
      { snapshot, target: targetHintOf(target.range, target.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- middle",
      "- one",
      "> [!note]+ Folded title",
      "> body a",
      "> - nested item 1",
      "> - nested item 2",
      "- target",
    ]);
    expect(outcome.newStartLine).toBe(1);
  });
});

describe("dropCompositeBlock: successful non-adjacent drops — List+Quote, same section/parentId/depth/indentColumns", () => {
  const text = ["- two", "> quoted body", "> - nested x", "> - nested y", "- filler", "- spot"].join("\n");

  it("after: moves the whole composite verbatim (list marker, blockquote prefix, body, internal nested list all preserved byte-for-byte)", () => {
    const { doc } = pipeline(text);
    const snapshot = snapshotOf(text, "two");
    const target = listNodeOf(doc, "spot");

    const outcome = dropCompositeBlock(
      text,
      { snapshot, target: targetHintOf(target.range, target.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- filler",
      "- spot",
      "- two",
      "> quoted body",
      "> - nested x",
      "> - nested y",
    ]);
    expect(outcome.newStartLine).toBe(2);
  });

  it("before: moves the whole composite verbatim to the other side of the non-adjacent target", () => {
    const { doc } = pipeline(text);
    const snapshot = snapshotOf(text, "two");
    const target = listNodeOf(doc, "spot");

    const outcome = dropCompositeBlock(
      text,
      { snapshot, target: targetHintOf(target.range, target.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- filler",
      "- two",
      "> quoted body",
      "> - nested x",
      "> - nested y",
      "- spot",
    ]);
    expect(outcome.newStartLine).toBe(1);
  });
});

describe("dropCompositeBlock: post-move re-match safety — the moved composite and any pre-existing neighbor composite are not unintentionally merged/absorbed", () => {
  it("List+Callout: dropping 'one' immediately before an already-composite-forming 'target'+'neighbor' pair disturbs neither — both remain independently recognized, 2 members each", () => {
    const text = [
      "- one",
      "> [!note]+ Folded title",
      "> body a",
      "> - nested item 1",
      "> - nested item 2",
      "- middle",
      "- target",
      "> [!tip] neighbor",
    ].join("\n");
    const { doc, composites: originalComposites } = pipeline(text);
    expect(originalComposites).toHaveLength(2);
    const snapshot = snapshotOf(text, "one");
    const target = listNodeOf(doc, "target");

    const outcome = dropCompositeBlock(
      text,
      { snapshot, target: targetHintOf(target.range, target.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- middle",
      "- one",
      "> [!note]+ Folded title",
      "> body a",
      "> - nested item 1",
      "> - nested item 2",
      "- target",
      "> [!tip] neighbor",
    ]);

    const { doc: reDoc, composites: reprojected } = pipeline(outcome.lines.join("\n"));
    expect(reprojected).toHaveLength(2);
    const moved = reprojected.find((c) => reDoc.lines[c.members[0].range.startLine].includes("one"))!;
    const untouched = reprojected.find((c) => reDoc.lines[c.members[0].range.startLine].includes("target"))!;
    expect(moved.range).toEqual({ startLine: 1, endLine: 5 });
    expect(moved.members).toHaveLength(2);
    expect(untouched.range).toEqual({ startLine: 6, endLine: 7 });
    expect(untouched.members).toHaveLength(2);
  });

  it("List+Quote: dropping 'two' immediately before an already-composite-forming 'spot'+quote pair disturbs neither — both remain independently recognized, 2 members each", () => {
    const text = [
      "- two",
      "> quoted body",
      "> - nested x",
      "> - nested y",
      "- filler",
      "- spot",
      "> spot's own quote",
    ].join("\n");
    const { doc, composites: originalComposites } = pipeline(text);
    expect(originalComposites).toHaveLength(2);
    const snapshot = snapshotOf(text, "two");
    const target = listNodeOf(doc, "spot");

    const outcome = dropCompositeBlock(
      text,
      { snapshot, target: targetHintOf(target.range, target.parentId), zone: "before" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- filler",
      "- two",
      "> quoted body",
      "> - nested x",
      "> - nested y",
      "- spot",
      "> spot's own quote",
    ]);

    const { doc: reDoc, composites: reprojected } = pipeline(outcome.lines.join("\n"));
    expect(reprojected).toHaveLength(2);
    const moved = reprojected.find((c) => reDoc.lines[c.members[0].range.startLine].includes("two"))!;
    const untouched = reprojected.find((c) => reDoc.lines[c.members[0].range.startLine].includes("spot"))!;
    expect(moved.range).toEqual({ startLine: 1, endLine: 4 });
    expect(moved.members).toHaveLength(2);
    expect(untouched.range).toEqual({ startLine: 5, endLine: 6 });
    expect(untouched.members).toHaveLength(2);
  });
});

describe("dropCompositeBlock: rejections leave text byte-identical — range-invalid (checked before any parse/target work)", () => {
  it("rejects a structurally invalid snapshot (empty members) before touching the document", () => {
    const text = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const snapshot: CompositeBlockSnapshot = {
      id: "composite-x",
      ruleId: "image-ocr",
      sectionId: null,
      range: { startLine: 0, endLine: 2 },
      members: [],
    };
    const target = targetHintOf({ startLine: 3, endLine: 3 }, null);

    const outcome = dropCompositeBlock(text, { snapshot, target, zone: "after" }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("rejects a snapshot whose aggregate range is reversed (startLine > endLine)", () => {
    const text = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const snapshot = snapshotOf(text, "one");
    const tampered: CompositeBlockSnapshot = { ...snapshot, range: { startLine: 2, endLine: 0 } };
    const target = targetHintOf({ startLine: 3, endLine: 3 }, null);

    const outcome = dropCompositeBlock(text, { snapshot: tampered, target, zone: "after" }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines).toEqual(text.split("\n"));
  });
});

describe("dropCompositeBlock: rejections leave text byte-identical — source snapshot mismatch / source re-resolution failure (composite-boundary-changed)", () => {
  it("rejects when an unrelated edit shifted the composite's own line range since the snapshot was taken", () => {
    const originalText = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const snapshot = snapshotOf(originalText, "one");
    const target = targetHintOf({ startLine: 3, endLine: 3 }, null);
    const editedText = ["unrelated new line", ...originalText.split("\n")].join("\n");

    const outcome = dropCompositeBlock(editedText, { snapshot, target, zone: "after" }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines).toEqual(editedText.split("\n"));
  });

  it("rejects when the composite no longer re-matches at all (a nested callout was inserted inside it, breaking the match)", () => {
    const originalText = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const snapshot = snapshotOf(originalText, "one");
    const target = targetHintOf({ startLine: 3, endLine: 3 }, null);
    const editedText = ["- one", "> [!note]", "> > [!tip] nested", "> body", "- two"].join("\n");

    const outcome = dropCompositeBlock(editedText, { snapshot, target, zone: "after" }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines).toEqual(editedText.split("\n"));
  });
});

describe("dropCompositeBlock: rejections leave text byte-identical — target re-resolution failure (target-boundary-changed)", () => {
  it("rejects when the target hint's range no longer matches any current node (an unrelated block was inserted between source and target, shifting the target's own lines)", () => {
    const originalText = ["- one", "> [!note]", "> body", "- middle", "- two"].join("\n");
    const { doc: origDoc } = pipeline(originalText);
    const origTarget = listNodeOf(origDoc, "two");
    const staleTarget = targetHintOf(origTarget.range, origTarget.parentId);

    // An unrelated block inserted between "one" and "two" leaves "one"'s
    // own position untouched (so a FRESH source snapshot built against the
    // later text is valid) but shifts "two" down — the stale target hint,
    // captured before this edit, no longer matches anything.
    const laterText = ["- one", "> [!note]", "> body", "- middle", "extra line", "- two"].join("\n");
    const freshSourceSnapshot = snapshotOf(laterText, "one");

    const outcome = dropCompositeBlock(
      laterText,
      { snapshot: freshSourceSnapshot, target: staleTarget, zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("target-boundary-changed");
    expect(outcome.lines).toEqual(laterText.split("\n"));
  });

  it("rejects when the target hint's range is out of bounds for the current document (checked before any parse/scan/match attempt)", () => {
    const text = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const snapshot = snapshotOf(text, "one");
    const target = targetHintOf({ startLine: 99, endLine: 99 }, null);

    const outcome = dropCompositeBlock(text, { snapshot, target, zone: "after" }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("target-boundary-changed");
    expect(outcome.lines).toEqual(text.split("\n"));
  });
});

describe("dropCompositeBlock: rejections leave text byte-identical — self-drop", () => {
  it("rejects dropping a composite relative to its own current position (target = the composite's own full range)", () => {
    const text = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = composites[0];
    const anchor = doc.nodes.get(source.members[0].id)!;
    const snapshot = buildCompositeBlockSnapshot(source);
    const target = targetHintOf(source.range, anchor.parentId);

    const outcome = dropCompositeBlock(text, { snapshot, target, zone: "before" }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("self-drop");
    expect(outcome.lines).toEqual(text.split("\n"));
  });
});

describe("dropCompositeBlock: rejections leave text byte-identical — different-parent-or-depth (sameCompositeAnchorLevel, end-to-end through re-resolution)", () => {
  it("rejects when target has a different indentColumns but the same parentId/depth", () => {
    const text = ["- one", "> [!note]", "> body a", "  - two"].join("\n");
    const { doc } = pipeline(text);
    const snapshot = snapshotOf(text, "one");
    const target = listNodeOf(doc, "two");

    const outcome = dropCompositeBlock(
      text,
      { snapshot, target: targetHintOf(target.range, target.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("different-parent-or-depth");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("rejects when target has a different parentId (nested inside another list item's continuation)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "  - nested"].join("\n");
    const { doc } = pipeline(text);
    const snapshot = snapshotOf(text, "one");
    const target = listNodeOf(doc, "nested");

    const outcome = dropCompositeBlock(
      text,
      { snapshot, target: targetHintOf(target.range, target.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("different-parent-or-depth");
    expect(outcome.lines).toEqual(text.split("\n"));
  });

  it("rejects when source and target sit under different section headings", () => {
    const text = ["# A", "- one", "> [!note]", "> body a", "# B", "- two"].join("\n");
    const { doc } = pipeline(text);
    const snapshot = snapshotOf(text, "one");
    const target = listNodeOf(doc, "two");

    const outcome = dropCompositeBlock(
      text,
      { snapshot, target: targetHintOf(target.range, target.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("different-parent-or-depth");
    expect(outcome.lines).toEqual(text.split("\n"));
  });
});

describe("dropCompositeBlock: rejections leave text byte-identical — composite-internal-boundary", () => {
  it("rejects a drop that would land strictly inside a third-party composite's own aggregate range (target = that composite's own anchor row, zone 'after')", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc } = pipeline(text);
    const snapshot = snapshotOf(text, "one");
    const target = listNodeOf(doc, "two");

    const outcome = dropCompositeBlock(
      text,
      { snapshot, target: targetHintOf(target.range, target.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-internal-boundary");
    expect(outcome.lines).toEqual(text.split("\n"));
  });
});

describe("dropCompositeBlock: Partial Edit stale-Apply rejection after a successful D&D (Phase 5D-4B design §8 — no D&D-specific code needed)", () => {
  it("a Partial Edit snapshot captured BEFORE a successful drop is rejected (snapshot-mismatch) by extractCompositeBlockText's own existing re-match contract when applied to the text AFTER the drop", () => {
    const text = ["- one", "> [!note]", "> body", "- middle", "- target"].join("\n");
    const { doc } = pipeline(text);
    const staleSnapshot = snapshotOf(text, "one"); // captured before the drop, as a Partial Edit pane would
    const target = listNodeOf(doc, "target");

    const outcome = dropCompositeBlock(
      text,
      { snapshot: staleSnapshot, target: targetHintOf(target.range, target.parentId), zone: "after" },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(true);

    const newDoc = parseDocument(outcome.lines.join("\n"));
    const applyResult = extractCompositeBlockText(newDoc, staleSnapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(applyResult.ok).toBe(false);
    if (!applyResult.ok) {
      expect(applyResult.reason).toBe("snapshot-mismatch");
    }
  });
});

describe("dropCompositeBlock: purity / idempotency", () => {
  it("does not mutate the request's snapshot object", () => {
    const text = ["- one", "> [!note]", "> body", "- middle", "- target"].join("\n");
    const { doc } = pipeline(text);
    const snapshot = snapshotOf(text, "one");
    const snapshotCopy = JSON.parse(JSON.stringify(snapshot));
    const target = listNodeOf(doc, "target");
    dropCompositeBlock(text, { snapshot, target: targetHintOf(target.range, target.parentId), zone: "after" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(snapshot).toEqual(snapshotCopy);
  });

  it("does not mutate the rules array passed in", () => {
    const text = ["- one", "> [!note]", "> body", "- middle", "- target"].join("\n");
    const { doc } = pipeline(text);
    const snapshot = snapshotOf(text, "one");
    const target = listNodeOf(doc, "target");
    const rules = [...DEFAULT_COMPOSITE_BLOCK_RULES];
    const rulesCopy = JSON.parse(JSON.stringify(rules));
    dropCompositeBlock(text, { snapshot, target: targetHintOf(target.range, target.parentId), zone: "after" }, rules);
    expect(rules).toEqual(rulesCopy);
  });

  it("a rejected call is idempotent (repeated calls produce the identical outcome)", () => {
    const text = ["- one", "> [!note]", "> body", "- two"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = composites[0];
    const anchor = doc.nodes.get(source.members[0].id)!;
    const snapshot = buildCompositeBlockSnapshot(source);
    const target = targetHintOf(source.range, anchor.parentId);
    const first = dropCompositeBlock(text, { snapshot, target, zone: "before" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    const second = dropCompositeBlock(text, { snapshot, target, zone: "before" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(first).toEqual(second);
  });
});
