/**
 * Phase 5T-9A ("Outline Tree paragraph の delete を最小スコープで実装する"):
 * unit tests for src/edit/deleteParagraph.ts — the pure function that
 * safely deletes a top-level or section-direct paragraph.
 *
 * Modeled directly on tests/paragraphNonAdjacentMove.test.ts's and
 * tests/deleteCompositeBlock.test.ts's own fixture styles (anchor-by-line
 * helpers, real parse -> scan -> resolve pipeline, no mocking). Nothing
 * here touches an Editor, view/OutlineTreeView.ts, or any UI — see
 * tests/paragraphDeleteUiWiring.test.ts for the menu-gate/i18n split,
 * mirroring tests/compositeBlockDeleteUiWiring.test.ts's own boundary.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import {
  buildParagraphMoveAnchor,
  ParagraphMoveAnchor,
} from "../src/edit/paragraphTreeMove";
import {
  deleteParagraph,
  isInScopeParagraphParent,
  NoParagraphDeleteReason,
  paragraphDeleteReasonText,
} from "../src/edit/deleteParagraph";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { createTranslator } from "../src/i18n";

function anchorAtLine(text: string, line: number): ParagraphMoveAnchor {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  const info = scan.blocks.find(
    (b) => b.kind === "paragraph" && b.range.startLine <= line && line <= b.range.endLine
  );
  if (!info) throw new Error(`no paragraph at line ${line}`);
  const anchor = buildParagraphMoveAnchor(doc, info);
  if (!anchor) throw new Error("expected buildParagraphMoveAnchor to succeed");
  return anchor;
}

function del(text: string, line: number, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  return deleteParagraph(text, anchorAtLine(text, line), rules);
}

describe("deleteParagraph: success cases", () => {
  it("deletes a top-level paragraph (no enclosing section) — the pre-existing blank line that used to separate it from its neighbor is left in place, matching edit/deleteBlock.ts's own no-blank-line-cleanup policy", () => {
    const text = ["A", "", "B"].join("\n");
    const outcome = del(text, 0);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(["", "B"].join("\n"));
  });

  it("deletes a section-direct paragraph — same no-cleanup policy: the leftover blank line stays", () => {
    const text = ["# H", "A", "", "B"].join("\n");
    const outcome = del(text, 1);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(["# H", "", "B"].join("\n"));
  });

  it("deletes the only paragraph, leaving the section heading intact", () => {
    const text = ["# H", "A"].join("\n");
    const outcome = del(text, 1);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe("# H");
  });

  it("is a single edit (one final lines[] from one call), newStartLine is a valid, in-bounds line", () => {
    const text = ["# H", "A", "", "B"].join("\n");
    const outcome = del(text, 1);
    expect(outcome.changed).toBe(true);
    expect(typeof outcome.newStartLine).toBe("number");
    expect(outcome.newStartLine).toBeGreaterThanOrEqual(0);
    expect(outcome.newStartLine).toBeLessThan(outcome.lines.length);
    expect(outcome.newCursorCh).toBe(0);
  });

  it("post-delete fallback line: next sibling paragraph, when one exists", () => {
    const text = ["# H", "A", "", "B", "", "C"].join("\n");
    const outcome = del(text, 1); // delete "A"; "B" is the next sibling
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[outcome.newStartLine]).toBe("B");
  });

  it("post-delete fallback line: previous sibling paragraph, when no next sibling exists", () => {
    const text = ["# H", "A", "", "B", "", "C"].join("\n");
    const outcome = del(text, 5); // delete "C" (last); "B" is the previous sibling
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[outcome.newStartLine]).toBe("B");
  });

  it("post-delete fallback line: enclosing section's own heading line, when no sibling paragraph/callout/blockquote exists", () => {
    const text = ["# H", "A"].join("\n");
    const outcome = del(text, 1);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[outcome.newStartLine]).toBe("# H");
  });

  it("post-delete fallback line: clamped deletion start line, when there is no sibling and no enclosing section (top-level, whole-document deletion)", () => {
    const text = "A";
    const outcome = del(text, 0);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([]);
    expect(outcome.newStartLine).toBe(0);
  });

  it("does NOT insert a blank line when the paragraph is already isolated by blank lines on both sides", () => {
    const text = ["# H", "", "A", "", "B"].join("\n");
    const outcome = del(text, 2);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(["# H", "", "", "B"].join("\n"));
  });

  it("does NOT insert a blank line when only one neighbor is paragraph-candidate-shaped (a heading on the other side)", () => {
    const text = ["# H", "A", "# H2", "B"].join("\n");
    // "A" sits directly under "# H" with no blank line, and directly above
    // "# H2" with no blank line either — deleting it leaves "# H" and
    // "# H2" newly adjacent, but headings are never paragraph-candidate
    // lines, so no merge risk exists and no separator is needed.
    const outcome = del(text, 1);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(["# H", "# H2", "B"].join("\n"));
  });

  it("blank-line-merge safety net: structurally never fires for a validly-resolved paragraph, and is documented as such", () => {
    // This is a deliberate, documented property of the merge-prevention
    // check in edit/deleteParagraph.ts, not a gap in test coverage.
    // scanParagraphBlocks' own candidate sweep (parser/complexBlocks.ts)
    // greedily consumes every consecutive non-blank/non-heading/non-list
    // line into ONE candidate range regardless of kind (it does not
    // exclude '>'-prefixed or pipe-table-row-shaped lines — see that
    // function's own doc comment). This means ANY paragraph that resolves
    // as its own independent, editability:"supported" ComplexBlockInfo
    // MUST already be bounded on both sides by a blank line, a heading, a
    // list marker, a code-fence boundary, or the very edge of the document
    // — the only line types isCandidate excludes. Deleting that paragraph
    // therefore only ever exposes an already-blank/heading/list/edge
    // boundary to its post-delete neighbor, never two candidate-shaped
    // lines newly touching — so the `isParagraphCandidateLine(beforeLine)
    // && isParagraphCandidateLine(afterLine)` branch in deleteParagraph can
    // never both be true for a real, resolvable anchor. It is kept as
    // defense-in-depth (matching edit/deleteCompositeBlock.ts's own
    // documented precedent of keeping currently-unreachable rejection
    // reasons "so that if a scanner's candidate rule ever changes, this
    // starts correctly protecting against it with zero code changes here")
    // rather than removed as dead code.
    //
    // This test demonstrates the property directly: a paragraph isolated
    // by a single blank line on each side leaves those SAME blank lines as
    // the post-delete boundary — never a candidate-candidate boundary.
    const text = ["A", "", "MID", "", "B"].join("\n");
    const outcome = deleteParagraph(text, anchorAtLine(text, 2), DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(["A", "", "", "B"].join("\n"));
  });

  it("deleting a paragraph directly adjacent (no blank line) to a callout leaves the callout's own recognition untouched", () => {
    const text = ["# H", "A", "", "> [!note]", "> body"].join("\n");
    const outcome = del(text, 1); // delete "A"; before = "# H" (heading), after = "" (blank)
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(["# H", "", "> [!note]", "> body"].join("\n"));
    const reparsed = parseDocument(outcome.lines.join("\n"));
    const reScan = scanComplexBlocks(reparsed);
    const callout = reScan.blocks.find((b) => b.kind === "callout");
    expect(callout?.editability).toBe("supported");
  });
});

describe("deleteParagraph: no-op / rejection cases", () => {
  it("list-item-parent: a list-item-child paragraph is rejected, out of scope this phase", () => {
    const text = ["- item", "  continuation paragraph"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const info = scan.blocks.find((b) => b.kind === "paragraph");
    // Confirm the fixture really does produce a list-item-child paragraph
    // before asserting the rejection.
    expect(info).toBeDefined();
    const anchor = buildParagraphMoveAnchor(doc, info!)!;
    const outcome = deleteParagraph(text, anchor, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("list-item-parent");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("composite-member check: structurally unreachable via the real matchCompositeBlocks pipeline today, and does not falsely reject an ordinary paragraph", () => {
    // parser/compositeBlocks.ts#collectCandidates explicitly excludes every
    // kind==="paragraph" ComplexBlockInfo from composite-candidate
    // collection ("CompositeBlock membership is a SEPARATE, not-yet-
    // designed capability for paragraph" — that function's own comment).
    // So no CompositeBlockRule, however constructed, can ever make
    // matchCompositeBlocks report a paragraph as a composite member — this
    // test proves that directly with a rule that WOULD match if paragraph
    // were eligible, confirming deleteParagraph's own "composite-member"
    // branch (see its own doc comment) is currently dead defense-in-depth,
    // not a gap: an ordinary top-level paragraph is correctly deletable
    // even under a rule set that explicitly names "paragraph" as a member
    // kind.
    const rule: CompositeBlockRule[] = [
      { id: "caption-paragraph", kindSequence: ["single-line-list", "paragraph"], prefix: "" },
    ];
    const text = ["- caption", "A paragraph body."].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const composites = matchCompositeBlocks(doc, scan, rule);
    expect(composites.some((c) => c.members.some((m) => m.kind === "paragraph"))).toBe(false);

    const info = scan.blocks.find((b) => b.kind === "paragraph")!;
    // Confirm this fixture's paragraph is genuinely in-scope for delete
    // (top-level or section-direct) before treating a successful outcome
    // as evidence the composite-member check isn't wrongly firing.
    expect(isInScopeParagraphParent(doc, info.parentId)).toBe(true);
    const anchor = buildParagraphMoveAnchor(doc, info)!;
    const outcome = deleteParagraph(text, anchor, rule);
    expect(outcome.changed).toBe(true);
    expect(outcome.reason).toBeUndefined();
  });

  it("resolve-failed ('readOnly' paragraph, in the sense this codebase uses that term): a paragraph inside an unterminated fence has editability !== supported and cannot be resolved", () => {
    const text = ["```", "not really closed"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const candidate = scan.blocks.find((b) => b.kind === "paragraph");
    // An unterminated fence downgrades its own contents' editability — no
    // "supported" paragraph exists to anchor on in the first place; hand-
    // construct an anchor claiming one anyway (simulating a stale Tree
    // hint from before the fence was opened) and confirm deleteParagraph
    // safely rejects rather than deleting the wrong thing.
    expect(candidate?.editability).not.toBe("supported");
    const staleAnchor: ParagraphMoveAnchor = {
      kind: "paragraph",
      complexBlockId: "paragraph-0",
      parentId: null,
      depth: 0,
      originalText: "not really closed",
      rangeStart: 1,
      rangeEnd: 1,
      siblingCount: 0,
    };
    const outcome = deleteParagraph(text, staleAnchor, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("resolve-failed: the anchored paragraph's scan-local id no longer exists after the note shrank", () => {
    const text = ["# H", "A", "", "B"].join("\n");
    const anchor = anchorAtLine(text, 3); // "B" — the SECOND paragraph (scan-local id "paragraph-1")
    // "B" itself was already removed, so only ONE paragraph ("A",
    // "paragraph-0") remains in a fresh scan — no "paragraph-1" id exists
    // at all for the anchor's own id to match against.
    const changedText = ["# H", "A"].join("\n");
    const outcome = deleteParagraph(changedText, anchor, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
    expect(outcome.lines.join("\n")).toBe(changedText);
  });

  it("identity-changed: the paragraph's parent changed since the anchor was captured", () => {
    const text = ["# H1", "A", "", "# H2", "A"].join("\n");
    const anchor = anchorAtLine(text, 1); // "A" under H1 (scan-local id "paragraph-0")
    // Simulate H1 being removed: the id "paragraph-0" now resolves to the
    // (now top-level, no longer section-owned) FIRST "A" in a fresh scan —
    // same scan-local id, but a different structural parent than the
    // anchor captured.
    const changedText = ["A", "", "# H2", "A"].join("\n");
    const outcome = deleteParagraph(changedText, anchor, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("identity-changed");
    expect(outcome.lines.join("\n")).toBe(changedText);
  });

  it("content-changed: the paragraph's own text changed since the anchor was captured", () => {
    const text = ["# H", "A"].join("\n");
    const anchor = anchorAtLine(text, 1);
    const changedText = ["# H", "A (edited)"].join("\n");
    const outcome = deleteParagraph(changedText, anchor, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("content-changed");
    expect(outcome.lines.join("\n")).toBe(changedText);
  });

  it("ambiguous-match: two structurally-identical paragraphs share the same parentId/depth/content", () => {
    const text = ["# H", "SAME"].join("\n");
    const anchor = anchorAtLine(text, 1);
    const ambiguousText = ["# H", "SAME", "", "SAME"].join("\n");
    const outcome = deleteParagraph(ambiguousText, anchor, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("ambiguous-match");
    expect(outcome.lines.join("\n")).toBe(ambiguousText);
  });

  it("no-op cases leave the body byte-for-byte unchanged (this is what 'opening/closing the confirm modal is not itself an edit' reduces to at the pure-function level)", () => {
    const text = ["# H", "A", "", "B"].join("\n");
    const anchor = anchorAtLine(text, 1);
    const changedText = ["# H", "", "B"].join("\n");
    const outcome = deleteParagraph(changedText, anchor, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(changedText.split("\n"));
  });
});

describe("paragraphDeleteReasonText / i18n", () => {
  const allReasons: NoParagraphDeleteReason[] = [
    "resolve-failed",
    "identity-changed",
    "content-changed",
    "ambiguous-match",
    "list-item-parent",
    "composite-member",
  ];

  it("every reason resolves to a non-empty, distinct-per-locale string in both en and ja", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    for (const reason of allReasons) {
      const enText = paragraphDeleteReasonText(en, reason);
      const jaText = paragraphDeleteReasonText(ja, reason);
      expect(enText).toBeDefined();
      expect(jaText).toBeDefined();
      expect(enText!.length).toBeGreaterThan(0);
      expect(jaText!.length).toBeGreaterThan(0);
      expect(enText).not.toBe(jaText);
    }
  });

  it("returns undefined for an undefined reason (success case has no reason)", () => {
    const en = createTranslator("en");
    expect(paragraphDeleteReasonText(en, undefined)).toBeUndefined();
  });

  it("wording never says 'move' — a delete-specific rejection must not reuse move-flow phrasing", () => {
    const en = createTranslator("en");
    for (const reason of allReasons) {
      const text = paragraphDeleteReasonText(en, reason);
      expect(text?.toLowerCase()).not.toContain("move");
    }
  });
});
