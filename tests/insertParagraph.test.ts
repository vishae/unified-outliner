/**
 * Phase 5T-10A ("Outline Tree paragraph insert を最小スコープで実装する"):
 * unit tests for src/edit/insertParagraph.ts — the pure function that
 * safely inserts a placeholder paragraph immediately before/after a
 * top-level or section-direct paragraph.
 *
 * Modeled directly on tests/deleteParagraph.test.ts's own fixture style
 * (anchor-by-line helpers, real parse -> scan -> resolve pipeline, no
 * mocking). Nothing here touches an Editor, view/OutlineTreeView.ts, the
 * inline rename state machine, or Editor#undo() — see
 * tests/paragraphOutlineTreeUiWiring.test.ts's "Phase 5T-10A" describe
 * block for the menu-gate/dispatch/rename/rollback UI wiring split,
 * mirroring tests/paragraphDeleteUiWiring.test.ts's own boundary for
 * delete.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { complexBlockDepth, scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { listItemContentColumn } from "../src/parser/listContentColumn";
import { ListBlockNode } from "../src/model/block";
import {
  buildParagraphMoveAnchor,
  ParagraphMoveAnchor,
} from "../src/edit/paragraphTreeMove";
import { isInScopeParagraphParent } from "../src/edit/deleteParagraph";
import {
  canSafelyRollbackParagraphInsert,
  insertParagraph,
  NoParagraphInsertReason,
  PARAGRAPH_INSERT_PLACEHOLDER_TEXT,
  ParagraphInsertPosition,
  paragraphInsertReasonText,
} from "../src/edit/insertParagraph";
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

function ins(
  text: string,
  line: number,
  position: ParagraphInsertPosition,
  rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES
) {
  return insertParagraph(text, anchorAtLine(text, line), position, rules);
}

describe("insertParagraph: success cases", () => {
  it("inserts before a top-level paragraph at the very start of the document — no separator on the far side (document edge), one on the near side (touching the target)", () => {
    const text = "A";
    const outcome = ins(text, 0, "before");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([PARAGRAPH_INSERT_PLACEHOLDER_TEXT, "", "A"]);
    expect(outcome.newStartLine).toBe(0);
    expect(outcome.newCursorCh).toBe(PARAGRAPH_INSERT_PLACEHOLDER_TEXT.length);
  });

  it("inserts after a top-level paragraph at the very end of the document — same near/far pattern, mirrored", () => {
    const text = "A";
    const outcome = ins(text, 0, "after");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["A", "", PARAGRAPH_INSERT_PLACEHOLDER_TEXT]);
    expect(outcome.newStartLine).toBe(2);
    expect(outcome.newCursorCh).toBe(PARAGRAPH_INSERT_PLACEHOLDER_TEXT.length);
  });

  it("inserts before a section-direct paragraph directly under its heading — the heading is not a paragraph-candidate line, so no separator is added on that (far) side, only on the near side touching the target", () => {
    const text = ["# H", "A"].join("\n");
    const outcome = ins(text, 1, "before");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", PARAGRAPH_INSERT_PLACEHOLDER_TEXT, "", "A"]);
    expect(outcome.newStartLine).toBe(1);
  });

  it("inserts after a section-direct paragraph that already has trailing content separated by a blank line — the existing blank line is reused as the far-side separator, never duplicated", () => {
    const text = ["# H", "A", "", "B"].join("\n");
    const outcome = ins(text, 1, "after");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "A", "", PARAGRAPH_INSERT_PLACEHOLDER_TEXT, "", "B"]);
    expect(outcome.newStartLine).toBe(3);
  });

  it("inserts between two section-direct paragraphs already separated by blank lines on both sides — no extra blank lines beyond the two already required (one per side)", () => {
    const text = ["# H", "A", "", "B", "", "C"].join("\n");
    const outcome = ins(text, 3, "before"); // insert before "B"
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "A",
      "",
      PARAGRAPH_INSERT_PLACEHOLDER_TEXT,
      "",
      "B",
      "",
      "C",
    ]);
  });

  it("inserting before a paragraph that is itself preceded by a blank line does not add a second blank line on the far side", () => {
    const text = ["# H", "", "A"].join("\n");
    const outcome = ins(text, 2, "before");
    expect(outcome.changed).toBe(true);
    // Far side ("" before "A") is already blank, so needsBefore is false;
    // only the near side (touching "A") gets a fresh separator.
    expect(outcome.lines).toEqual(["# H", "", PARAGRAPH_INSERT_PLACEHOLDER_TEXT, "", "A"]);
  });

  it("is a single edit (one final lines[] from one call); the placeholder is immediately recognized as its own independent, supported paragraph on re-parse", () => {
    const text = ["# H", "A"].join("\n");
    const outcome = ins(text, 1, "before");
    expect(outcome.changed).toBe(true);
    const reparsed = parseDocument(outcome.lines.join("\n"));
    const reScan = scanComplexBlocks(reparsed);
    const placeholderBlock = reScan.blocks.find(
      (b) =>
        b.kind === "paragraph" &&
        reparsed.lines.slice(b.range.startLine, b.range.endLine + 1).join("\n") ===
          PARAGRAPH_INSERT_PLACEHOLDER_TEXT
    );
    expect(placeholderBlock).toBeDefined();
    expect(placeholderBlock!.editability).toBe("supported");
  });

  it("newStartLine always points at the placeholder's own line, in-bounds", () => {
    const text = ["# H", "A", "", "B"].join("\n");
    for (const position of ["before", "after"] as const) {
      const outcome = ins(text, 1, position);
      expect(outcome.changed).toBe(true);
      expect(outcome.lines[outcome.newStartLine]).toBe(PARAGRAPH_INSERT_PLACEHOLDER_TEXT);
    }
  });
});

describe("insertParagraph: list-item-child paragraph (Phase 5P-5, 'list item 子 paragraph の Tree insert/delete 解禁')", () => {
  it("insertBefore a list item's own single child paragraph: the new paragraph is indented to the item's own content column, not column 0", () => {
    const text = ["- item", "  continuation paragraph"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const info = scan.blocks.find((b) => b.kind === "paragraph")!;
    const listItemId = info.parentId!;
    const targetColumns = listItemContentColumn(doc, doc.nodes.get(listItemId) as ListBlockNode);
    const anchor = buildParagraphMoveAnchor(doc, info)!;
    const outcome = insertParagraph(text, anchor, "before", DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    const placeholderLineText = outcome.lines[outcome.newStartLine];
    // Explicit "never at column 0" check (ticket's own required assertion).
    expect(placeholderLineText.match(/^[ \t]*/)![0].length).toBeGreaterThan(0);
    expect(placeholderLineText).toBe(" ".repeat(targetColumns) + PARAGRAPH_INSERT_PLACEHOLDER_TEXT);

    const reparsed = parseDocument(outcome.lines.join("\n"));
    const reScan = scanComplexBlocks(reparsed);
    const placeholder = reScan.blocks.find(
      (b) => b.kind === "paragraph" && reparsed.lines[b.range.startLine] === placeholderLineText
    );
    expect(placeholder).toBeDefined();
    expect(placeholder!.parentId).toBe(listItemId);
    expect(placeholder!.editability).toBe("supported");
  });

  it("insertAfter a list item's own child paragraph: the new paragraph is re-parsed as the SAME list item's child, at the SAME depth", () => {
    const text = ["- item", "  continuation paragraph"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const info = scan.blocks.find((b) => b.kind === "paragraph")!;
    const listItemId = info.parentId!;
    const originalDepth = complexBlockDepth(doc, listItemId);
    const anchor = buildParagraphMoveAnchor(doc, info)!;
    const outcome = insertParagraph(text, anchor, "after", DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);

    const reparsed = parseDocument(outcome.lines.join("\n"));
    const reScan = scanComplexBlocks(reparsed);
    const placeholder = reScan.blocks.find(
      (b) =>
        b.kind === "paragraph" &&
        reparsed.lines
          .slice(b.range.startLine, b.range.endLine + 1)
          .join("\n")
          .includes(PARAGRAPH_INSERT_PLACEHOLDER_TEXT)
    );
    expect(placeholder).toBeDefined();
    expect(placeholder!.parentId).toBe(listItemId);
    expect(complexBlockDepth(reparsed, placeholder!.parentId)).toBe(originalDepth);
  });

  it("nested list: insertBefore/insertAfter into the inner item's own child paragraph preserves both the inner and outer list markers and hierarchy", () => {
    const text = ["- outer", "  - inner", "    inner child paragraph"].join("\n");
    for (const position of ["before", "after"] as const) {
      const doc = parseDocument(text);
      const scan = scanComplexBlocks(doc);
      const info = scan.blocks.find((b) => b.kind === "paragraph")!;
      const innerItemId = info.parentId!;
      const anchor = buildParagraphMoveAnchor(doc, info)!;
      const outcome = insertParagraph(text, anchor, position, DEFAULT_COMPOSITE_BLOCK_RULES);
      expect(outcome.changed).toBe(true);

      const reparsed = parseDocument(outcome.lines.join("\n"));
      const listItems = [...reparsed.nodes.values()].filter((n) => n.type === "list");
      // Both original markers ("- outer", "  - inner") survive byte-for-byte,
      // and no third list item was accidentally introduced by the insert.
      expect(outcome.lines).toContain("- outer");
      expect(outcome.lines).toContain("  - inner");
      expect(listItems).toHaveLength(2);

      const reScan = scanComplexBlocks(reparsed);
      const placeholder = reScan.blocks.find(
        (b) =>
          b.kind === "paragraph" &&
          reparsed.lines
            .slice(b.range.startLine, b.range.endLine + 1)
            .join("\n")
            .includes(PARAGRAPH_INSERT_PLACEHOLDER_TEXT)
      );
      expect(placeholder).toBeDefined();
      expect(placeholder!.parentId).toBe(innerItemId);
    }
  });

  it("unsafeIndent: a list item whose leading whitespace mixes tabs and spaces rejects insert with a dedicated reason, leaving the note byte-for-byte unchanged", () => {
    // The nested item's own MARKER indentation ("\t " — a tab then a space,
    // before the "-") mixes tabs and spaces — parser/parseDocument.ts's own
    // isMixedIndent(markerIndentWs) flags exactly this as unsafeIndent (not
    // the separator between the marker and its text, which is unrelated).
    const text = ["- outer", "\t - item", "\t   continuation paragraph"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const info = scan.blocks.find((b) => b.kind === "paragraph")!;
    expect(info).toBeDefined();
    const listItem = doc.nodes.get(info.parentId!) as ListBlockNode;
    expect(listItem.unsafeIndent).toBe(true);
    const anchor = buildParagraphMoveAnchor(doc, info)!;
    const outcome = insertParagraph(text, anchor, "before", DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("unsafe-indent");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("existing top-level/section-direct paragraph insert does not regress: no indentation prefix is applied when the parent is not a list item", () => {
    const text = ["# H", "A"].join("\n");
    const outcome = ins(text, 1, "before");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", PARAGRAPH_INSERT_PLACEHOLDER_TEXT, "", "A"]);
  });
});

describe("insertParagraph: no-op / rejection cases", () => {
  it("composite-member check: structurally unreachable via the real matchCompositeBlocks pipeline today (same root cause as edit/deleteParagraph.ts's own identically-named check — parser/compositeBlocks.ts#collectCandidates excludes every kind===\"paragraph\" block from composite-candidate collection), and does not falsely reject an ordinary paragraph", () => {
    const rule: CompositeBlockRule[] = [
      { id: "caption-paragraph", kindSequence: ["single-line-list", "paragraph"], prefix: "" },
    ];
    const text = ["- caption", "A paragraph body."].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const composites = matchCompositeBlocks(doc, scan, rule);
    expect(composites.some((c) => c.members.some((m) => m.kind === "paragraph"))).toBe(false);

    const info = scan.blocks.find((b) => b.kind === "paragraph")!;
    expect(isInScopeParagraphParent(doc, info.parentId)).toBe(true);
    const anchor = buildParagraphMoveAnchor(doc, info)!;
    const outcome = insertParagraph(text, anchor, "after", rule);
    expect(outcome.changed).toBe(true);
    expect(outcome.reason).toBeUndefined();
  });

  it("resolve-failed ('readOnly' paragraph): a paragraph inside an unterminated fence has editability !== supported and cannot be resolved", () => {
    const text = ["```", "not really closed"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const candidate = scan.blocks.find((b) => b.kind === "paragraph");
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
    const outcome = insertParagraph(text, staleAnchor, "before", DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("resolve-failed: the anchored paragraph's scan-local id no longer exists after the note shrank", () => {
    const text = ["# H", "A", "", "B"].join("\n");
    const anchor = anchorAtLine(text, 3); // "B" — the SECOND paragraph (scan-local id "paragraph-1")
    const changedText = ["# H", "A"].join("\n");
    const outcome = insertParagraph(changedText, anchor, "after", DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
    expect(outcome.lines.join("\n")).toBe(changedText);
  });

  it("identity-changed: the paragraph's parent changed since the anchor was captured", () => {
    const text = ["# H1", "A", "", "# H2", "A"].join("\n");
    const anchor = anchorAtLine(text, 1); // "A" under H1 (scan-local id "paragraph-0")
    const changedText = ["A", "", "# H2", "A"].join("\n");
    const outcome = insertParagraph(changedText, anchor, "before", DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("identity-changed");
    expect(outcome.lines.join("\n")).toBe(changedText);
  });

  it("content-changed: the paragraph's own text changed since the anchor was captured", () => {
    const text = ["# H", "A"].join("\n");
    const anchor = anchorAtLine(text, 1);
    const changedText = ["# H", "A (edited)"].join("\n");
    const outcome = insertParagraph(changedText, anchor, "after", DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("content-changed");
    expect(outcome.lines.join("\n")).toBe(changedText);
  });

  it("ambiguous-match: two structurally-identical paragraphs share the same parentId/depth/content", () => {
    const text = ["# H", "SAME"].join("\n");
    const anchor = anchorAtLine(text, 1);
    const ambiguousText = ["# H", "SAME", "", "SAME"].join("\n");
    const outcome = insertParagraph(ambiguousText, anchor, "before", DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("ambiguous-match");
    expect(outcome.lines.join("\n")).toBe(ambiguousText);
  });

  it("no-op cases leave the body byte-for-byte unchanged", () => {
    const text = ["# H", "A", "", "B"].join("\n");
    const anchor = anchorAtLine(text, 1);
    const changedText = ["# H", "", "B"].join("\n");
    const outcome = insertParagraph(changedText, anchor, "before", DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(changedText.split("\n"));
  });
});

describe("canSafelyRollbackParagraphInsert", () => {
  it("returns true immediately after a successful insert, against the anchor built for the fresh placeholder — the exact sequence view/OutlineTreeView.ts's rollbackPendingParagraphInsert performs before calling Editor#undo()", () => {
    const text = ["# H", "A"].join("\n");
    const outcome = ins(text, 1, "before");
    expect(outcome.changed).toBe(true);
    const newText = outcome.lines.join("\n");
    const doc = parseDocument(newText);
    const scan = scanComplexBlocks(doc);
    const placeholderInfo = scan.blocks.find(
      (b) =>
        b.kind === "paragraph" &&
        doc.lines.slice(b.range.startLine, b.range.endLine + 1).join("\n") ===
          PARAGRAPH_INSERT_PLACEHOLDER_TEXT
    )!;
    const placeholderAnchor = buildParagraphMoveAnchor(doc, placeholderInfo)!;
    expect(canSafelyRollbackParagraphInsert(newText, placeholderAnchor)).toBe(true);
  });

  it("returns false once the placeholder has been edited (renamed) — the exact case that must fall back to a safe no-op rather than calling undo()", () => {
    const text = ["# H", "A"].join("\n");
    const outcome = ins(text, 1, "before");
    const newText = outcome.lines.join("\n");
    const doc = parseDocument(newText);
    const scan = scanComplexBlocks(doc);
    const placeholderInfo = scan.blocks.find(
      (b) =>
        b.kind === "paragraph" &&
        doc.lines.slice(b.range.startLine, b.range.endLine + 1).join("\n") ===
          PARAGRAPH_INSERT_PLACEHOLDER_TEXT
    )!;
    const placeholderAnchor = buildParagraphMoveAnchor(doc, placeholderInfo)!;
    const editedText = newText.replace(PARAGRAPH_INSERT_PLACEHOLDER_TEXT, "User typed this instead");
    expect(canSafelyRollbackParagraphInsert(editedText, placeholderAnchor)).toBe(false);
  });
});

describe("paragraphInsertReasonText / i18n", () => {
  const allReasons: NoParagraphInsertReason[] = [
    "resolve-failed",
    "identity-changed",
    "content-changed",
    "ambiguous-match",
    "list-item-parent",
    "composite-member",
    "unsafe-indent",
  ];

  it("every reason resolves to a non-empty, distinct-per-locale string in both en and ja", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    for (const reason of allReasons) {
      const enText = paragraphInsertReasonText(en, reason);
      const jaText = paragraphInsertReasonText(ja, reason);
      expect(enText).toBeDefined();
      expect(jaText).toBeDefined();
      expect(enText!.length).toBeGreaterThan(0);
      expect(jaText!.length).toBeGreaterThan(0);
      expect(enText).not.toBe(jaText);
    }
  });

  it("returns undefined for an undefined reason (success case has no reason)", () => {
    const en = createTranslator("en");
    expect(paragraphInsertReasonText(en, undefined)).toBeUndefined();
  });

  it("wording never says 'move' or 'delete' — an insert-specific rejection must not reuse move/delete-flow phrasing", () => {
    const en = createTranslator("en");
    for (const reason of allReasons) {
      const text = paragraphInsertReasonText(en, reason);
      expect(text?.toLowerCase()).not.toContain("move");
      expect(text?.toLowerCase()).not.toContain("delete");
    }
  });
});
