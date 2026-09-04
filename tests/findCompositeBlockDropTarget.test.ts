/**
 * Phase 5D-4C ("CompositeBlock Atomic Drag-and-Drop 最小実装"): unit tests
 * for the pure resolver —
 * move/findCompositeBlockDropTarget.ts#resolveCompositeBlockDropTarget.
 *
 * Scope reminder (mirrors tests/findStandaloneComplexBlockDropTarget.test.ts's
 * own scope note, and this ticket's own stage-1 instruction): NO drop is
 * actually EXECUTED here — only whether a given, already-resolved
 * (source, target-candidate, zone) triple WOULD be safe, and if so the
 * exact insertBeforeLine. Actually performing the drop (re-parsing,
 * re-resolving source/target from a snapshot/hint, calling insertBlockAt)
 * is edit/dropCompositeBlock.ts's job, tested in its own file
 * (tests/dropCompositeBlock.test.ts).
 *
 * ---- A note on what this resolver's OWN signature can and cannot express ----
 *
 * resolveCompositeBlockDropTarget takes a CompositeBlockDropTargetCandidate
 * — an ALREADY-RESOLVED range/parentId/depth/indentColumns, never a raw
 * Tree row or a "this line is blank" / "this is a section heading" / "this
 * is an unrelated complex block" input shape (see that module's own top
 * doc comment: "Drop TARGET candidates are restricted to whatever the
 * caller resolves into a CompositeBlockDropTargetCandidate"). So several
 * of this ticket's named rejection categories are NOT reachable through
 * THIS function's own signature at all — they are enforced upstream,
 * before a candidate is ever constructed:
 *
 *   - "空白行" / "section 行" / "無関係な complex block": never produce a
 *     CompositeBlockDropTargetCandidate in the first place —
 *     view/OutlineTreeView.ts#compositeDropTargetHint only ever returns a
 *     non-null hint for a plain list row or a CompositeBlock parent row
 *     (tested in tests/OutlineTreeView.compositeDrag.test.ts), and
 *     edit/dropCompositeBlock.ts#resolveTargetCandidate only ever matches
 *     a live ListBlockNode or a live CompositeBlockInfo (tested in
 *     tests/dropCompositeBlock.test.ts).
 *   - "target ambiguity" / "target 再解決不能": these are properties of
 *     the RE-RESOLUTION step against a possibly-stale hint (a snapshot of
 *     the past being matched against the current document) — this pure
 *     resolver is handed an already-unambiguous, already-current candidate
 *     by definition, so it has nothing to be ambiguous ABOUT. Covered by
 *     dropCompositeBlock's own "target-boundary-changed" tests instead.
 *
 * What IS this resolver's own responsibility, and so what this file
 * actually tests: self-drop, parentId/depth/indentColumns equality
 * (sameCompositeAnchorLevel), composite-internal-boundary (including the
 * "widened vs. narrow candidate" distinction — see the "widening" describe
 * block below), and the source-shape checks (nested-in-list, unsafe-indent)
 * this resolver re-runs independently of evaluateCompositeBlockMovability.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { isListNode } from "../src/model/block";
import {
  CompositeBlockDropTargetCandidate,
  resolveCompositeBlockDropTarget,
} from "../src/move/findCompositeBlockDropTarget";

function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

/** Finds the composite whose anchor (first member) line contains `needle`. */
function compositeOf(doc: ReturnType<typeof parseDocument>, composites: ReturnType<typeof matchCompositeBlocks>, needle: string) {
  const found = composites.find((c) => doc.lines[c.members[0].range.startLine].includes(needle));
  if (!found) throw new Error(`no composite matching "${needle}"`);
  return found;
}

/** Finds a plain (non-composite-anchor-specific) list node whose own line contains `needle`. */
function listNodeOf(doc: ReturnType<typeof parseDocument>, needle: string) {
  for (const node of doc.nodes.values()) {
    if (node.type === "list" && doc.lines[node.range.startLine].includes(needle)) return node;
  }
  throw new Error(`no list node matching "${needle}"`);
}

/** A composite's own anchor (members[0]) resolved as a typed ListBlockNode — every CompositeBlock anchor is always a "single-line-list" member, i.e. a real ListBlockNode, never a SectionBlockNode. */
function anchorListNodeOf(doc: ReturnType<typeof parseDocument>, composite: ReturnType<typeof matchCompositeBlocks>[number]) {
  const anchor = doc.nodes.get(composite.members[0].id);
  if (!anchor || !isListNode(anchor)) {
    throw new Error(`composite ${composite.id}'s own anchor member did not resolve to a ListBlockNode`);
  }
  return anchor;
}

/** A target candidate built from a plain list item node — mirrors what a caller resolves for a plain-list-row drop target. */
function candidateFromListNode(node: ReturnType<typeof listNodeOf>): CompositeBlockDropTargetCandidate {
  return {
    range: { startLine: node.range.startLine, endLine: node.range.endLine },
    parentId: node.parentId,
    depth: node.depth,
    indentColumns: node.indentColumns,
  };
}

/**
 * A target candidate built from another CompositeBlock's OWN FULL range —
 * mirrors what a caller resolves for a CompositeBlock-parent-row drop
 * target (i.e. already "widened" to the whole composite, exactly as
 * edit/dropCompositeBlock.ts#resolveTargetCandidate and
 * view/OutlineTreeView.ts#compositeDropTargetHint both do — see this
 * module's own top doc comment for why the resolver itself performs no
 * widening).
 */
function candidateFromCompositeFullRange(
  doc: ReturnType<typeof parseDocument>,
  composite: ReturnType<typeof matchCompositeBlocks>[number]
): CompositeBlockDropTargetCandidate {
  const anchor = anchorListNodeOf(doc, composite);
  return {
    range: { startLine: composite.range.startLine, endLine: composite.range.endLine },
    parentId: anchor.parentId,
    depth: anchor.depth,
    indentColumns: anchor.indentColumns,
  };
}

/**
 * A target candidate built from another CompositeBlock's own anchor member
 * row ALONE — deliberately NARROWER than the composite's own full range,
 * i.e. what a candidate would look like if a caller forgot to widen it.
 * Used only to demonstrate the resolver's own composite-internal-boundary
 * check, never as a real caller-produced shape (a real caller never hands
 * this resolver a bare anchor-row candidate for a composite target — see
 * this file's "widening" describe block).
 */
function candidateFromCompositeAnchorRowOnly(
  doc: ReturnType<typeof parseDocument>,
  composite: ReturnType<typeof matchCompositeBlocks>[number]
): CompositeBlockDropTargetCandidate {
  const anchor = anchorListNodeOf(doc, composite);
  return {
    range: { startLine: anchor.range.startLine, endLine: anchor.range.endLine },
    parentId: anchor.parentId,
    depth: anchor.depth,
    indentColumns: anchor.indentColumns,
  };
}

describe("resolveCompositeBlockDropTarget: positive cases — plain list item target, same section/parentId/depth/indentColumns, non-adjacent", () => {
  it("before: allowed, insertBeforeLine === target.range.startLine", () => {
    const text = ["- one", "> [!note]", "> body a", "- middle", "- target"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const target = listNodeOf(doc, "target");
    const resolution = resolveCompositeBlockDropTarget(doc, source, composites, candidateFromListNode(target), "before");
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: target.range.startLine });
  });

  it("after: allowed, insertBeforeLine === target.range.endLine + 1", () => {
    const text = ["- one", "> [!note]", "> body a", "- middle", "- target"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const target = listNodeOf(doc, "target");
    const resolution = resolveCompositeBlockDropTarget(doc, source, composites, candidateFromListNode(target), "after");
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: target.range.endLine + 1 });
  });
});

describe("resolveCompositeBlockDropTarget: positive cases — another CompositeBlock parent row as target (already widened to its own full range), same level, non-adjacent", () => {
  it("before: allowed, insertBeforeLine === target composite's own startLine (List+Callout source, List+Quote target)", () => {
    const text = [
      "- one",
      "> [!note]",
      "> body a",
      "- middle",
      "- two",
      "> plain quote",
    ].join("\n");
    const { doc, composites } = pipeline(text);
    expect(composites).toHaveLength(2);
    const source = compositeOf(doc, composites, "one");
    const targetComposite = compositeOf(doc, composites, "two");
    const resolution = resolveCompositeBlockDropTarget(
      doc,
      source,
      composites,
      candidateFromCompositeFullRange(doc, targetComposite),
      "before"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: targetComposite.range.startLine });
  });

  it("after: allowed, insertBeforeLine === target composite's own endLine + 1", () => {
    const text = [
      "- one",
      "> [!note]",
      "> body a",
      "- middle",
      "- two",
      "> plain quote",
    ].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const targetComposite = compositeOf(doc, composites, "two");
    const resolution = resolveCompositeBlockDropTarget(
      doc,
      source,
      composites,
      candidateFromCompositeFullRange(doc, targetComposite),
      "after"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: targetComposite.range.endLine + 1 });
  });
});

describe("resolveCompositeBlockDropTarget: widening — a composite-target candidate MUST be the composite's own full range, not just its anchor row", () => {
  it("dropping 'before' a third-party composite's own bare anchor-row range is allowed (equivalent to before the whole composite — that boundary sits outside it either way)", () => {
    const text = ["- one", "> [!note]", "> body a", "- middle", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const targetComposite = compositeOf(doc, composites, "two");
    const resolution = resolveCompositeBlockDropTarget(
      doc,
      source,
      composites,
      candidateFromCompositeAnchorRowOnly(doc, targetComposite),
      "before"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: targetComposite.range.startLine });
  });

  it("dropping 'after' a third-party composite's own bare anchor-row range (NOT widened to the full range) is rejected as composite-internal-boundary — proves the caller must widen to a composite's full range when the intent is 'after this whole composite', or the resolver correctly treats it as landing inside it", () => {
    const text = ["- one", "> [!note]", "> body a", "- middle", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const targetComposite = compositeOf(doc, composites, "two");
    const resolution = resolveCompositeBlockDropTarget(
      doc,
      source,
      composites,
      candidateFromCompositeAnchorRowOnly(doc, targetComposite),
      "after"
    );
    expect(resolution).toEqual({ allowed: false, reason: "composite-internal-boundary" });
  });

  it("contrast: dropping 'after' the SAME third-party composite's own FULL (properly widened) range is allowed — the only difference from the previous test is that the candidate now spans the whole composite", () => {
    const text = ["- one", "> [!note]", "> body a", "- middle", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const targetComposite = compositeOf(doc, composites, "two");
    const resolution = resolveCompositeBlockDropTarget(
      doc,
      source,
      composites,
      candidateFromCompositeFullRange(doc, targetComposite),
      "after"
    );
    expect(resolution).toEqual({ allowed: true, insertBeforeLine: targetComposite.range.endLine + 1 });
  });
});

describe("resolveCompositeBlockDropTarget: self-drop", () => {
  it("dropping a composite 'before' its own current range is rejected as self-drop", () => {
    const text = ["- one", "> [!note]", "> body a", "- two"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const anchor = anchorListNodeOf(doc, source);
    const selfCandidate: CompositeBlockDropTargetCandidate = {
      range: { startLine: source.range.startLine, endLine: source.range.endLine },
      parentId: anchor.parentId,
      depth: anchor.depth,
      indentColumns: anchor.indentColumns,
    };
    const resolution = resolveCompositeBlockDropTarget(doc, source, composites, selfCandidate, "before");
    expect(resolution).toEqual({ allowed: false, reason: "self-drop" });
  });

  it("dropping a composite 'after' its own current range is rejected as self-drop", () => {
    const text = ["- one", "> [!note]", "> body a", "- two"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const anchor = anchorListNodeOf(doc, source);
    const selfCandidate: CompositeBlockDropTargetCandidate = {
      range: { startLine: source.range.startLine, endLine: source.range.endLine },
      parentId: anchor.parentId,
      depth: anchor.depth,
      indentColumns: anchor.indentColumns,
    };
    const resolution = resolveCompositeBlockDropTarget(doc, source, composites, selfCandidate, "after");
    expect(resolution).toEqual({ allowed: false, reason: "self-drop" });
  });
});

describe("resolveCompositeBlockDropTarget: different-parent-or-depth (sameCompositeAnchorLevel)", () => {
  it("rejects when target has a different indentColumns but the same parentId/depth (root item restarts after the composite's own callout closes the list)", () => {
    const text = ["- one", "> [!note]", "> body a", "  - two"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const target = listNodeOf(doc, "two");
    const anchor = anchorListNodeOf(doc, source);
    expect(target.parentId).toBe(anchor.parentId);
    expect(target.depth).toBe(anchor.depth);
    expect(target.indentColumns).not.toBe(anchor.indentColumns);
    const resolution = resolveCompositeBlockDropTarget(doc, source, composites, candidateFromListNode(target), "after");
    expect(resolution).toEqual({ allowed: false, reason: "different-parent-or-depth" });
  });

  it("rejects when target has a different parentId (nested inside another list item's continuation)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "  - nested"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const target = listNodeOf(doc, "nested");
    const anchor = anchorListNodeOf(doc, source);
    expect(target.parentId).not.toBe(anchor.parentId);
    const resolution = resolveCompositeBlockDropTarget(doc, source, composites, candidateFromListNode(target), "after");
    expect(resolution).toEqual({ allowed: false, reason: "different-parent-or-depth" });
  });

  it("rejects when source and target sit under different section headings (section boundary is encoded as the root list item's own parentId)", () => {
    const text = ["# A", "- one", "> [!note]", "> body a", "# B", "- two"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const target = listNodeOf(doc, "two");
    const anchor = anchorListNodeOf(doc, source);
    expect(target.parentId).not.toBe(anchor.parentId);
    const resolution = resolveCompositeBlockDropTarget(doc, source, composites, candidateFromListNode(target), "after");
    expect(resolution).toEqual({ allowed: false, reason: "different-parent-or-depth" });
  });

  it("rejects when target has the same parentId but an inconsistent depth (synthetic doc — structurally unreachable via the real parser, mirrors tests/compositeBlockMovability.test.ts's own defense-in-depth-only case)", () => {
    const text = ["- one", "> [!note]", "> body a", "- two"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const target = listNodeOf(doc, "two");
    const candidate: CompositeBlockDropTargetCandidate = {
      range: { startLine: target.range.startLine, endLine: target.range.endLine },
      parentId: target.parentId,
      depth: target.depth + 1,
      indentColumns: target.indentColumns,
    };
    const resolution = resolveCompositeBlockDropTarget(doc, source, composites, candidate, "after");
    expect(resolution).toEqual({ allowed: false, reason: "different-parent-or-depth" });
  });
});

describe("resolveCompositeBlockDropTarget: source shape eligibility (re-run independently of evaluateCompositeBlockMovability)", () => {
  it("rejects (nested-in-list) when the source's own anchor single-line-list member is itself nested inside another list item's continuation", () => {
    const text = ["- outer", "  - inner", "> [!note]", "> body", "- two"].join("\n");
    const { doc, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const source = composites[0];
    const target = listNodeOf(doc, "two");
    const resolution = resolveCompositeBlockDropTarget(doc, source, composites, candidateFromListNode(target), "after");
    expect(resolution).toEqual({ allowed: false, reason: "nested-in-list" });
  });

  it("rejects (unsafe-indent) when the source's own anchor list item mixes tab/space leading whitespace", () => {
    const text = [" \t- flagged", "> [!note]", "> body", "- two"].join("\n");
    const { doc, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const source = composites[0];
    const target = listNodeOf(doc, "two");
    const resolution = resolveCompositeBlockDropTarget(doc, source, composites, candidateFromListNode(target), "after");
    expect(resolution).toEqual({ allowed: false, reason: "unsafe-indent" });
  });
});

describe("resolveCompositeBlockDropTarget: composite-internal-boundary (member/anchor row of a THIRD-PARTY composite)", () => {
  it("rejects a drop that would land strictly inside a third-party composite's own aggregate range (target = that composite's own anchor member row, zone 'after')", () => {
    const text = ["- one", "> [!note]", "> body a", "- middle", "- two", "> [!tip]", "> body b"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const targetComposite = compositeOf(doc, composites, "two");
    const resolution = resolveCompositeBlockDropTarget(
      doc,
      source,
      composites,
      candidateFromCompositeAnchorRowOnly(doc, targetComposite),
      "after"
    );
    expect(resolution).toEqual({ allowed: false, reason: "composite-internal-boundary" });
  });
});

describe("resolveCompositeBlockDropTarget: purity", () => {
  it("does not mutate doc.nodes or the allComposites array", () => {
    const text = ["- one", "> [!note]", "> body a", "- middle", "- target"].join("\n");
    const { doc, composites } = pipeline(text);
    const source = compositeOf(doc, composites, "one");
    const target = listNodeOf(doc, "target");
    const nodesBefore = doc.nodes.size;
    const compositesBefore = composites.length;
    resolveCompositeBlockDropTarget(doc, source, composites, candidateFromListNode(target), "before");
    expect(doc.nodes.size).toBe(nodesBefore);
    expect(composites.length).toBe(compositesBefore);
  });
});
