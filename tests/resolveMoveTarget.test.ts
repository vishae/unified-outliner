import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { complexBlockDepth, scanComplexBlocks } from "../src/parser/complexBlocks";
import {
  describeMoveUnit,
  findComplexSiblingTarget,
  findEnclosingSectionId,
  moveComplexBlock,
  resolveEnclosingSectionId,
  resolveMoveUnit,
} from "../src/move/resolveMoveTarget";

describe("resolveMoveUnit: cursor -> minimal safe block", () => {
  it("resolves the heading LINE to the section (rule 1)", () => {
    const doc = parseDocument(["# H", "body"].join("\n"));
    const r = resolveMoveUnit(doc, 0);
    expect(r.unit?.kind).toBe("section");
  });

  it("resolves an ordinary body paragraph to 'paragraph', NOT the enclosing section (the bug this ticket fixes)", () => {
    const doc = parseDocument(
      ["# H", "a plain paragraph", "more of the same paragraph"].join("\n")
    );
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("paragraph");
    expect(r.unit?.range).toEqual({ startLine: 1, endLine: 2 });
  });

  it("resolves a list item's marker line to 'list' (rule 2)", () => {
    const doc = parseDocument(["# H", "- item"].join("\n"));
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("list");
  });

  it("resolves a list item's continuation (body) line to 'list' when it is indented LESS than the item's own content-start column — never recognized as a scanParagraphBlocks candidate at all (rule 2, unaffected by Phase 5P-4)", () => {
    // "- item"'s own content-start column is 2 (marker "- " is 2 columns
    // wide); one leading space does not reach it, so this line stays
    // "invisible" continuation text exactly as it always has been.
    const doc = parseDocument(["# H", "- item", " continuation text"].join("\n"));
    const r = resolveMoveUnit(doc, 2);
    expect(r.unit?.kind).toBe("list");
  });

  it("Phase 5P-4 update: a continuation line that reaches the item's own content-start column now resolves to 'paragraph', NOT 'list' — see the dedicated 'Phase 5P-4: list-item-child paragraph adjacent swap' describe blocks below for the full new contract this enables. This is a deliberate, documented behavior change from this module's original rule-2-always-wins design (this exact fixture used to assert 'list' here before this phase).", () => {
    const doc = parseDocument(["- item", "  continuation text"].join("\n"));
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("paragraph");
  });

  it("resolves inside a callout to 'callout' (rule 3)", () => {
    const doc = parseDocument(
      ["# H", "> [!note] Title", "> body line"].join("\n")
    );
    const r = resolveMoveUnit(doc, 2);
    expect(r.unit?.kind).toBe("callout");
  });

  it("resolves inside an ordinary blockquote to 'blockquote' (rule 3)", () => {
    const doc = parseDocument(["# H", "> quoted line 1", "> quoted line 2"].join("\n"));
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("blockquote");
  });

  it("resolves inside a fenced code block (including on the fence lines) to 'fenced-code' (rule 3) — bypassing resolveCurrentBlock's blanket code-block rejection", () => {
    const doc = parseDocument(["# H", "```ts", "const x = 1;", "```"].join("\n"));
    expect(resolveMoveUnit(doc, 1).unit?.kind).toBe("fenced-code"); // opening fence
    expect(resolveMoveUnit(doc, 2).unit?.kind).toBe("fenced-code"); // content
    expect(resolveMoveUnit(doc, 3).unit?.kind).toBe("fenced-code"); // closing fence
  });

  it("resolves inside a table to 'table' (rule 3)", () => {
    const doc = parseDocument(
      ["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n")
    );
    const r = resolveMoveUnit(doc, 3);
    expect(r.unit?.kind).toBe("table");
  });

  it("rejects an unsupported nested callout (unmodeled inner structure) as boundary-unknown (rule 5)", () => {
    const doc = parseDocument(
      ["> [!note]", "> > [!tip]", "> > nested body", "> back to outer"].join("\n")
    );
    const r = resolveMoveUnit(doc, 0);
    expect(r.unit).toBeNull();
    expect(r.reason).toBe("boundary-unknown");
  });

  it("rejects frontmatter", () => {
    const doc = parseDocument(["---", "key: value", "---", "# H"].join("\n"));
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit).toBeNull();
    expect(r.reason).toBe("frontmatter");
  });

  it("rejects an out-of-range line", () => {
    const doc = parseDocument("# H");
    const r = resolveMoveUnit(doc, 99);
    expect(r.unit).toBeNull();
    expect(r.reason).toBe("out-of-range");
  });
});

describe("resolveMoveUnit: list continuation never digs into a nested complex block", () => {
  it("a blockquote inside a list item's continuation still resolves to 'list' at the cursor (rule 2 takes priority)", () => {
    const doc = parseDocument(["- item", "  > quoted continuation"].join("\n"));
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("list");
  });
});

describe("findComplexSiblingTarget / moveComplexBlock: paragraph & complex-block moves", () => {
  it("swaps two adjacent paragraphs under the same section", () => {
    const doc = parseDocument(["# H", "paragraph A", "", "paragraph B"].join("\n"));
    const a = resolveMoveUnit(doc, 1).unit!;
    const target = findComplexSiblingTarget(doc, a, "down");
    expect(target.kind).toBe("swap");
    const outcome = moveComplexBlock(doc, a, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "paragraph B", "", "paragraph A"]);
  });

  it("rejects with no-sibling when there is nothing in that direction", () => {
    const doc = parseDocument(["# H", "only paragraph"].join("\n"));
    const unit = resolveMoveUnit(doc, 1).unit!;
    const target = findComplexSiblingTarget(doc, unit, "up");
    expect(target).toEqual({ kind: "none", reason: "no-sibling" });
    const outcome = moveComplexBlock(doc, unit, "up");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("no-sibling");
  });

  it("rejects with boundary-unknown when a list item sits between two same-parent paragraphs (never hops across it)", () => {
    const doc = parseDocument(
      ["# H", "paragraph A", "- list item", "paragraph B"].join("\n")
    );
    const b = resolveMoveUnit(doc, 3).unit!;
    expect(b.kind).toBe("paragraph");
    const target = findComplexSiblingTarget(doc, b, "up");
    expect(target).toEqual({ kind: "none", reason: "boundary-unknown" });
  });

  it("swaps a paragraph with an adjacent supported complex block of a DIFFERENT kind", () => {
    const doc = parseDocument(
      ["# H", "> quoted line", "", "a trailing paragraph"].join("\n")
    );
    const paragraph = resolveMoveUnit(doc, 3).unit!;
    expect(paragraph.kind).toBe("paragraph");
    const outcome = moveComplexBlock(doc, paragraph, "up");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "a trailing paragraph",
      "",
      "> quoted line",
    ]);
  });

  it("never picks an unsupported/ambiguous block as a sibling partner", () => {
    const doc = parseDocument(
      [
        "# H",
        "> [!note]",
        "> > [!tip]",
        "> > nested body",
        "> back to outer",
        "",
        "trailing paragraph",
      ].join("\n")
    );
    const paragraph = resolveMoveUnit(doc, 6).unit!;
    expect(paragraph.kind).toBe("paragraph");
    const target = findComplexSiblingTarget(doc, paragraph, "up");
    expect(target).toEqual({ kind: "none", reason: "no-sibling" });
  });
});

describe("Phase 5P-1R (historical, partially superseded by Phase 5P-4 below): list-item-child paragraph Move block scope", () => {
  // Phase 5P-1 made parser/complexBlocks.ts's scanParagraphBlocks newly
  // recognize a list item's own child paragraph (a continuation line
  // indented to the item's content-start column) as a ComplexBlockInfo with
  // parentId set to that list item's id — before 5P-1 such a line was
  // entirely invisible to the complex-block scanner. Because this module's
  // ORIGINAL safety gate (isSafeToMoveComplexBlock) keyed only on
  // editability, that recognition change would have silently WIDENED Move
  // block's existing surface to include list-item-child paragraphs. Phase
  // 5P-1R pinned list-item-child paragraphs as excluded from Move block
  // (both as a move UNIT and as a sibling swap TARGET) until Phase 5P-4
  // explicitly designed that capability.
  //
  // Phase 5P-4 has now shipped that capability — see the "Phase 5P-4:
  // list-item-child paragraph adjacent swap" describe block below for the
  // superseding, positive-case coverage (the two 5P-1R tests that asserted
  // the OLD exclusion behavior — "cursor on a child paragraph resolves to
  // the list subtree" and "a list-item blockquote never swaps with that
  // item's own child paragraph" — have been removed from here for that
  // reason; their replacements, asserting the new 5P-4 behavior for the
  // exact same fixtures, live in that describe block). The two tests below
  // remain valid and unchanged: they pin structural boundaries (different
  // parentId — section vs. list item, or two DIFFERENT list items) that
  // Phase 5P-4 was never meant to, and does not, relax.

  it("a section-level paragraph never picks an adjacent list-item-child paragraph as a sibling target (different parentId — section vs. list item)", () => {
    // A blank line separates the two paragraphs so they scan as two
    // distinct candidates (see the blockquote/paragraph test above for why
    // a zero-gap contiguous run would otherwise merge them into one
    // cross-boundary, ambiguous range instead of exercising the different-
    // parentId rejection this test targets).
    const text = [
      "# H",
      "- item1",
      "  Child paragraph of item1.",
      "",
      "Trailing section-level paragraph.",
    ].join("\n");
    const doc = parseDocument(text);
    const trailing = resolveMoveUnit(doc, 4).unit!;
    expect(trailing.kind).toBe("paragraph");
    const target = findComplexSiblingTarget(doc, trailing, "up");
    expect(target).toEqual({ kind: "none", reason: "no-sibling" });
    const outcome = moveComplexBlock(doc, trailing, "up");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("two sibling list items' own child paragraphs are never offered as swap targets for each other (cross-list-item, different parentId)", () => {
    const text = [
      "- item1",
      "  Child paragraph of item1.",
      "- item2",
      "  Child paragraph of item2.",
    ].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const child1 = scan.blocks.find((b) => doc.lines[b.range.startLine].includes("item1."))!;
    const child2 = scan.blocks.find((b) => doc.lines[b.range.startLine].includes("item2."))!;
    expect(child1.parentId).not.toBe(child2.parentId);

    const unit = {
      kind: "paragraph" as const,
      range: child1.range,
      parentId: child1.parentId,
      complexBlockId: child1.id,
    };
    const target = findComplexSiblingTarget(doc, unit, "down", scan);
    expect(target).toEqual({ kind: "none", reason: "no-sibling" });
    const outcome = moveComplexBlock(doc, unit, "down", scan);
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("section-level paragraph Move block (the pre-5P-1 approved case) is unaffected — still swaps normally", () => {
    // Regression pin for "section-level paragraph Move block scope is not
    // expanded beyond previously-approved cases" — same shape as the
    // pre-existing 'swaps two adjacent paragraphs under the same section'
    // test above, kept here as an explicit 5P-1R checkpoint.
    const doc = parseDocument(["# H", "paragraph A", "", "paragraph B"].join("\n"));
    const a = resolveMoveUnit(doc, 1).unit!;
    expect(a.kind).toBe("paragraph");
    const outcome = moveComplexBlock(doc, a, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "paragraph B", "", "paragraph A"]);
  });
});

describe("Phase 5P-4: list-item-child paragraph adjacent swap (cursor resolution)", () => {
  it("a cursor on a list item's own recognized child paragraph now resolves to 'paragraph' — the exact fixture the 5P-1R exclusion test used to pin the OPPOSITE result for", () => {
    const text = ["- item1", "  Child paragraph of item1.", "- item2"].join("\n");
    const doc = parseDocument(text);
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("paragraph");
    expect(r.unit?.range).toEqual({ startLine: 1, endLine: 1 });
    expect(r.unit?.parentId).toBe(doc.lineToOwningNodeId[1]);
  });

  it("a cursor on the list item's own MARKER line still resolves to 'list' — the marker line is never part of any paragraph candidate", () => {
    const text = ["- item1", "  Child paragraph of item1."].join("\n");
    const doc = parseDocument(text);
    const r = resolveMoveUnit(doc, 0);
    expect(r.unit?.kind).toBe("list");
  });

  it("a cursor on 'invisible' continuation text indented LESS than the item's content-start column still resolves to 'list' (never recognized as a paragraph candidate at all)", () => {
    // One space of indent — item1's own content column is 2 (see
    // listItemContentColumn) — so this line is genuinely invisible to
    // scanParagraphBlocks, not merely a paragraph the new code declines to
    // prioritize.
    const text = ["- item1", " under-threshold continuation"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    expect(scan.blocks.some((b) => b.kind === "paragraph")).toBe(false);
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("list");
  });

  it("a cursor on a callout/blockquote nested in a list item's continuation still resolves to 'list' — this phase is paragraph-only, that priority is unchanged", () => {
    const text = ["- item", "  > quoted continuation"].join("\n");
    const doc = parseDocument(text);
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("list");
  });

  it("resolution succeeds for a lone child paragraph with no eligible sibling (does not silently fall back to the list subtree just because there is nothing to swap with)", () => {
    const text = ["- item1", "  Only child paragraph."].join("\n");
    const doc = parseDocument(text);
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("paragraph");
    const outcome = moveComplexBlock(doc, r.unit!, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("no-sibling");
    expect(outcome.lines).toEqual(doc.lines);
  });
});

describe("Phase 5P-4: list-item-child paragraph adjacent swap (per-kind partner allow-list)", () => {
  // Every pairing below shares one shape: a list item with two children,
  // separated by exactly one blank line (scanParagraphBlocks groups
  // contiguous non-blank owned lines into ONE candidate, so the blank line
  // is what keeps the paragraph and its partner independently addressable
  // — see the historical describe block above for the same point). Each
  // test resolves the paragraph via the real cursor path (resolveMoveUnit)
  // and swaps via the real moveComplexBlock apply step, exactly as
  // moveCurrentBlock (main.ts) does — not the pure functions in isolation
  // — so these also stand in as the closest unit-level proxy for the
  // command's actual end-to-end behavior.

  it("paragraph <-> paragraph (same list item)", () => {
    const text = ["- item1", "  paragraph A", "", "  paragraph B"].join("\n");
    const doc = parseDocument(text);
    const unit = resolveMoveUnit(doc, 1).unit!;
    expect(unit.kind).toBe("paragraph");
    const outcome = moveComplexBlock(doc, unit, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- item1", "  paragraph B", "", "  paragraph A"]);
  });

  it("paragraph <-> blockquote (same list item) — the exact fixture the 5P-1R exclusion test used to pin a no-op for, now a real swap", () => {
    const text = [
      "- item1",
      "  > quoted continuation",
      "",
      "  Child paragraph of item1.",
      "- item2",
    ].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const blockquote = scan.blocks.find((b) => b.kind === "blockquote")!;
    const childParagraph = scan.blocks.find(
      (b) => b.kind === "paragraph" && doc.lines[b.range.startLine].includes("Child paragraph")
    )!;
    expect(childParagraph.parentId).toBe(blockquote.parentId);

    const unit = resolveMoveUnit(doc, 3).unit!;
    expect(unit.kind).toBe("paragraph");
    expect(unit.complexBlockId).toBe(childParagraph.id);
    const outcome = moveComplexBlock(doc, unit, "up", scan);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- item1",
      "  Child paragraph of item1.",
      "",
      "  > quoted continuation",
      "- item2",
    ]);
  });

  it("paragraph <-> callout (same list item)", () => {
    const text = [
      "- item1",
      "  child paragraph",
      "",
      "  > [!note] child callout",
      "  > body",
    ].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const callout = scan.blocks.find((b) => b.kind === "callout")!;
    const childParagraph = scan.blocks.find((b) => b.kind === "paragraph")!;
    expect(callout.parentId).toBe(childParagraph.parentId);

    const unit = resolveMoveUnit(doc, 1).unit!;
    expect(unit.kind).toBe("paragraph");
    const outcome = moveComplexBlock(doc, unit, "down", scan);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- item1",
      "  > [!note] child callout",
      "  > body",
      "",
      "  child paragraph",
    ]);
  });

  it("paragraph <-> fenced-code (same list item)", () => {
    const text = [
      "- item1",
      "  child paragraph",
      "",
      "  ```",
      "  code",
      "  ```",
    ].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const fenced = scan.blocks.find((b) => b.kind === "fenced-code")!;
    const childParagraph = scan.blocks.find((b) => b.kind === "paragraph")!;
    expect(fenced.editability).toBe("supported");
    expect(fenced.parentId).toBe(childParagraph.parentId);

    const unit = resolveMoveUnit(doc, 1).unit!;
    expect(unit.kind).toBe("paragraph");
    const outcome = moveComplexBlock(doc, unit, "down", scan);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- item1",
      "  ```",
      "  code",
      "  ```",
      "",
      "  child paragraph",
    ]);
  });

  it("paragraph <-> table (same list item)", () => {
    const text = [
      "- item1",
      "  child paragraph",
      "",
      "  | a | b |",
      "  |---|---|",
      "  | 1 | 2 |",
    ].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const table = scan.blocks.find((b) => b.kind === "table")!;
    const childParagraph = scan.blocks.find((b) => b.kind === "paragraph")!;
    expect(table.editability).toBe("supported");
    expect(table.parentId).toBe(childParagraph.parentId);

    const unit = resolveMoveUnit(doc, 1).unit!;
    expect(unit.kind).toBe("paragraph");
    const outcome = moveComplexBlock(doc, unit, "down", scan);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- item1",
      "  | a | b |",
      "  |---|---|",
      "  | 1 | 2 |",
      "",
      "  child paragraph",
    ]);
  });

  it("paragraph <-> thematic-break (same list item)", () => {
    const text = ["- item1", "  child paragraph", "", "  ***"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const thematicBreak = scan.blocks.find((b) => b.kind === "thematic-break")!;
    const childParagraph = scan.blocks.find((b) => b.kind === "paragraph")!;
    expect(thematicBreak.editability).toBe("supported");
    expect(thematicBreak.parentId).toBe(childParagraph.parentId);

    const unit = resolveMoveUnit(doc, 1).unit!;
    expect(unit.kind).toBe("paragraph");
    const outcome = moveComplexBlock(doc, unit, "down", scan);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- item1", "  ***", "", "  child paragraph"]);
  });

  it("paragraph <-> list (an actual list item/subtree) is NOT a supported pairing — out of scope for this phase, deliberately", () => {
    // findComplexSiblingTarget's candidate pool is drawn exclusively from
    // ComplexBlockInfo (scanComplexBlocks' own output) — it has never
    // searched section/list BlockNodes, and this phase does not change
    // that (see resolveMoveTarget.ts's own top doc comment). A paragraph
    // directly followed by an unrelated sibling list item therefore always
    // rejects with "no-sibling", never silently reinterpreting the list
    // item as some kind of complex-block partner.
    const text = ["# H", "a section-level paragraph", "- an unrelated list item"].join("\n");
    const doc = parseDocument(text);
    const unit = resolveMoveUnit(doc, 1).unit!;
    expect(unit.kind).toBe("paragraph");
    const target = findComplexSiblingTarget(doc, unit, "down");
    expect(target).toEqual({ kind: "none", reason: "no-sibling" });
    const outcome = moveComplexBlock(doc, unit, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
  });
});

describe("Phase 5P-4: list-item-child paragraph adjacent swap (structural rejections)", () => {
  it("rejects when a nested list item sits between two child paragraphs of the same outer item (non-blank gap, never hopped across)", () => {
    const text = [
      "- item1",
      "  paragraph A",
      "",
      "  - nested sub item",
      "",
      "  paragraph B",
    ].join("\n");
    const doc = parseDocument(text);
    const unit = resolveMoveUnit(doc, 1).unit!;
    expect(unit.kind).toBe("paragraph");
    const target = findComplexSiblingTarget(doc, unit, "down");
    expect(target).toEqual({ kind: "none", reason: "boundary-unknown" });
    const outcome = moveComplexBlock(doc, unit, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects crossing a list-item boundary — a child paragraph never swaps with a DIFFERENT list item's own child paragraph", () => {
    const text = [
      "- item1",
      "  Child paragraph of item1.",
      "- item2",
      "  Child paragraph of item2.",
    ].join("\n");
    const doc = parseDocument(text);
    const unit = resolveMoveUnit(doc, 1).unit!;
    expect(unit.kind).toBe("paragraph");
    const target = findComplexSiblingTarget(doc, unit, "down");
    expect(target).toEqual({ kind: "none", reason: "no-sibling" });
  });

  it("rejects a list-item-child paragraph swapping with content outside any list (different parentId — list item vs. section)", () => {
    const text = [
      "# H",
      "- item1",
      "  Child paragraph of item1.",
      "",
      "Trailing section-level paragraph.",
    ].join("\n");
    const doc = parseDocument(text);
    const unit = resolveMoveUnit(doc, 2).unit!;
    expect(unit.kind).toBe("paragraph");
    const target = findComplexSiblingTarget(doc, unit, "down");
    expect(target).toEqual({ kind: "none", reason: "no-sibling" });
  });

  it("never crosses a section boundary via a list-item-child paragraph either (heading directly follows the list item)", () => {
    const text = ["# H1", "- item1", "  Child paragraph of item1.", "# H2"].join("\n");
    const doc = parseDocument(text);
    const unit = resolveMoveUnit(doc, 2).unit!;
    expect(unit.kind).toBe("paragraph");
    const target = findComplexSiblingTarget(doc, unit, "down");
    expect(target).toEqual({ kind: "none", reason: "no-sibling" });
    const outcome = moveComplexBlock(doc, unit, "down");
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("rejects when the only same-parentId candidate is unsupported/ambiguous (an unterminated fence in the same list item)", () => {
    const text = [
      "- item1",
      "  child paragraph",
      "",
      "  ```",
      "  unterminated fence, no closing marker",
    ].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const fenced = scan.blocks.find((b) => b.kind === "fenced-code")!;
    expect(fenced.editability).toBe("ambiguous");
    const unit = resolveMoveUnit(doc, 1).unit!;
    expect(unit.kind).toBe("paragraph");
    const target = findComplexSiblingTarget(doc, unit, "down", scan);
    expect(target).toEqual({ kind: "none", reason: "no-sibling" });
  });

  it("same parentId always implies same depth (findComplexSiblingTarget's defense-in-depth complexBlockDepth recheck never rejects a real, parentId-matched candidate)", () => {
    const text = ["- item1", "  paragraph A", "", "  paragraph B"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const [a, b] = scan.blocks.filter((x) => x.kind === "paragraph");
    expect(complexBlockDepth(doc, a.parentId)).toBe(complexBlockDepth(doc, b.parentId));
    const unit = resolveMoveUnit(doc, 1).unit!;
    const target = findComplexSiblingTarget(doc, unit, "down", scan);
    expect(target.kind).toBe("swap");
  });
});

describe("resolveEnclosingSectionId / findEnclosingSectionId: 'Move section' resolution", () => {
  it("resolves to the section itself when the cursor is on the heading line", () => {
    const doc = parseDocument(["# H", "body"].join("\n"));
    const r = resolveEnclosingSectionId(doc, 0);
    expect(r.sectionId).toBe(doc.nodes.get(doc.lineToOwningNodeId[0]!)?.id);
  });

  it("resolves to the enclosing section from a plain body paragraph", () => {
    const doc = parseDocument(["# H", "a paragraph"].join("\n"));
    const sectionId = doc.lineToOwningNodeId[0];
    const r = resolveEnclosingSectionId(doc, 1);
    expect(r.sectionId).toBe(sectionId);
  });

  it("resolves to the enclosing section from a deeply nested list item", () => {
    const doc = parseDocument(
      ["# H", "- a", "  - b", "    - c"].join("\n")
    );
    const sectionId = doc.lineToOwningNodeId[0];
    const r = resolveEnclosingSectionId(doc, 3);
    expect(r.sectionId).toBe(sectionId);
  });

  it("rejects with not-in-section for a root list item before any heading", () => {
    const doc = parseDocument(["- top level item, no heading yet"].join("\n"));
    const r = resolveEnclosingSectionId(doc, 0);
    expect(r.sectionId).toBeNull();
    expect(r.reason).toBe("not-in-section");
  });

  it("findEnclosingSectionId walks up through nested sections to the nearest one, not the outermost", () => {
    const doc = parseDocument(["# Outer", "## Inner", "body"].join("\n"));
    const innerId = doc.lineToOwningNodeId[2];
    const innerNode = doc.nodes.get(innerId!)!;
    expect(findEnclosingSectionId(doc, innerNode)).toBe(innerId);
  });
});

describe("describeMoveUnit: move-result toast labels (English — see resolveMoveTarget.ts's doc comment on this plugin's English-by-default language policy)", () => {
  it("labels a section with its heading text", () => {
    const doc = parseDocument(["# Case Overview", "body"].join("\n"));
    const unit = resolveMoveUnit(doc, 0).unit!;
    expect(describeMoveUnit(doc, unit)).toBe('section "Case Overview"');
  });

  it("labels an untitled heading with the fallback text", () => {
    const doc = parseDocument(["# ", "body"].join("\n"));
    const unit = resolveMoveUnit(doc, 0).unit!;
    expect(describeMoveUnit(doc, unit)).toBe('section "(untitled heading)"');
  });

  it("labels a leaf list item with no descendant count", () => {
    const doc = parseDocument(["- leaf item"].join("\n"));
    const unit = resolveMoveUnit(doc, 0).unit!;
    expect(describeMoveUnit(doc, unit)).toBe("list item");
  });

  it("labels a list item with its descendant count (plural)", () => {
    const doc = parseDocument(["- a", "  - b", "    - c", "  - d"].join("\n"));
    const unit = resolveMoveUnit(doc, 0).unit!;
    expect(describeMoveUnit(doc, unit)).toBe("list item (with 3 nested items)");
  });

  it("uses the singular 'item' for exactly one descendant", () => {
    const doc = parseDocument(["- a", "  - b"].join("\n"));
    const unit = resolveMoveUnit(doc, 0).unit!;
    expect(describeMoveUnit(doc, unit)).toBe("list item (with 1 nested item)");
  });

  it("labels a paragraph as 'paragraph'", () => {
    const doc = parseDocument(["# H", "a paragraph"].join("\n"));
    const unit = resolveMoveUnit(doc, 1).unit!;
    expect(describeMoveUnit(doc, unit)).toBe("paragraph");
  });

  it("labels a callout/blockquote/fenced-code/table with their English kind names", () => {
    const calloutDoc = parseDocument(["> [!note] t", "> body"].join("\n"));
    expect(describeMoveUnit(calloutDoc, resolveMoveUnit(calloutDoc, 0).unit!)).toBe(
      "callout"
    );

    const bqDoc = parseDocument(["> quoted"].join("\n"));
    expect(describeMoveUnit(bqDoc, resolveMoveUnit(bqDoc, 0).unit!)).toBe("blockquote");

    const codeDoc = parseDocument(["```ts", "x", "```"].join("\n"));
    expect(describeMoveUnit(codeDoc, resolveMoveUnit(codeDoc, 1).unit!)).toBe(
      "code block"
    );

    const tableDoc = parseDocument(["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    expect(describeMoveUnit(tableDoc, resolveMoveUnit(tableDoc, 0).unit!)).toBe(
      "table"
    );
  });
});

describe("Phase 5P-4 supplementary: successive Move block invocations keep tracking the same logical paragraph", () => {
  // This block exists because this session's own investigation into the
  // 5P-4 formalization ticket found that scanComplexBlocks assigns each
  // paragraph candidate a scan-local id (`paragraph-${seq++}`, in document
  // scan order — parser/complexBlocks.ts) that is NOT stable across a
  // paragraph<->paragraph swap: swapping two paragraphs re-orders them in
  // the document, so their scan-local ids swap too. A test asserting
  // successive-move identity by comparing `unit.complexBlockId` (or any
  // ComplexBlockInfo.id) across moves would therefore be silently wrong —
  // it could pass even while tracking the wrong paragraph, or fail even
  // when the right one is still being tracked. Every test below instead
  // verifies identity the way a human eye would: by the paragraph's own
  // TEXT CONTENT, re-extracted fresh from `doc.lines` after each move —
  // exactly the signal a real "keep pressing Move block down" session has
  // available, since scan-local ids are never surfaced to the user.
  //
  // Each walk below also mirrors the real command loop
  // (main.ts#moveCurrentBlock -> commands/applyLineEditOutcome.ts) exactly:
  // resolve fresh from the CURRENT cursor line, move, then advance the
  // cursor to `outcome.newStartLine` for the next iteration — never by
  // holding on to a node/complexBlockId across iterations.

  it("section-level: 3 successive Move-down invocations keep resolving 'paragraph A' as the target, and the body matches the expected order after each step", () => {
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
    let cursorLine = 1;
    const expectedAfter = [
      ["paragraph B", "paragraph A", "paragraph C", "paragraph D", "paragraph E"],
      ["paragraph B", "paragraph C", "paragraph A", "paragraph D", "paragraph E"],
      ["paragraph B", "paragraph C", "paragraph D", "paragraph A", "paragraph E"],
    ];

    for (let step = 0; step < 3; step++) {
      const doc = parseDocument(text);
      const resolved = resolveMoveUnit(doc, cursorLine);
      expect(resolved.unit, `step ${step + 1}: resolution`).not.toBeNull();
      const content = doc.lines
        .slice(resolved.unit!.range.startLine, resolved.unit!.range.endLine + 1)
        .join("\n");
      expect(content, `step ${step + 1}: target identity by content`).toBe("paragraph A");

      const outcome = moveComplexBlock(doc, resolved.unit!, "down");
      expect(outcome.changed, `step ${step + 1}: move applied`).toBe(true);
      text = outcome.lines.join("\n");
      cursorLine = outcome.newStartLine;

      const paragraphsInOrder = text.split("\n").filter((l) => l.startsWith("paragraph "));
      expect(paragraphsInOrder, `step ${step + 1}: order`).toEqual(expectedAfter[step]);
    }

    // A 4th successive Move-down: A is not yet at the tail (paragraph E
    // still follows it), so this must be a real, successful move, not a
    // premature no-op.
    let doc = parseDocument(text);
    let resolved = resolveMoveUnit(doc, cursorLine);
    let content = doc.lines
      .slice(resolved.unit!.range.startLine, resolved.unit!.range.endLine + 1)
      .join("\n");
    expect(content, "step 4: still resolves to paragraph A").toBe("paragraph A");
    let outcome = moveComplexBlock(doc, resolved.unit!, "down");
    expect(outcome.changed, "step 4: A swaps past E").toBe(true);
    text = outcome.lines.join("\n");
    cursorLine = outcome.newStartLine;
    expect(
      text.split("\n").filter((l) => l.startsWith("paragraph ")),
      "step 4: order"
    ).toEqual(["paragraph B", "paragraph C", "paragraph D", "paragraph E", "paragraph A"]);

    // A 5th successive Move-down: A is now the LAST paragraph, so this
    // must be a safe no-op — body untouched, and the target still
    // resolves to paragraph A (never silently re-targeting a neighbor).
    doc = parseDocument(text);
    resolved = resolveMoveUnit(doc, cursorLine);
    content = doc.lines
      .slice(resolved.unit!.range.startLine, resolved.unit!.range.endLine + 1)
      .join("\n");
    expect(content, "step 5: target is still paragraph A after the no-op boundary").toBe(
      "paragraph A"
    );
    outcome = moveComplexBlock(doc, resolved.unit!, "down");
    expect(outcome.changed, "step 5: tail no-op").toBe(false);
    expect(outcome.reason).toBe("no-sibling");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("section-level: 3 successive Move-up invocations (tracking paragraph E from the tail) keep resolving the same target, reaching the head, then a further Move-up is a safe no-op", () => {
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
    let cursorLine = 9;
    const expectedAfter = [
      ["paragraph A", "paragraph B", "paragraph C", "paragraph E", "paragraph D"],
      ["paragraph A", "paragraph B", "paragraph E", "paragraph C", "paragraph D"],
      ["paragraph A", "paragraph E", "paragraph B", "paragraph C", "paragraph D"],
    ];

    for (let step = 0; step < 3; step++) {
      const doc = parseDocument(text);
      const resolved = resolveMoveUnit(doc, cursorLine);
      const content = doc.lines
        .slice(resolved.unit!.range.startLine, resolved.unit!.range.endLine + 1)
        .join("\n");
      expect(content, `step ${step + 1}: target identity by content`).toBe("paragraph E");

      const outcome = moveComplexBlock(doc, resolved.unit!, "up");
      expect(outcome.changed, `step ${step + 1}: move applied`).toBe(true);
      text = outcome.lines.join("\n");
      cursorLine = outcome.newStartLine;

      expect(
        text.split("\n").filter((l) => l.startsWith("paragraph ")),
        `step ${step + 1}: order`
      ).toEqual(expectedAfter[step]);
    }

    // 4th Move-up: E is not yet at the head (paragraph A still precedes
    // it), so this is a real move.
    let doc = parseDocument(text);
    let resolved = resolveMoveUnit(doc, cursorLine);
    let outcome = moveComplexBlock(doc, resolved.unit!, "up");
    expect(outcome.changed, "step 4: E swaps past A").toBe(true);
    text = outcome.lines.join("\n");
    cursorLine = outcome.newStartLine;
    expect(
      text.split("\n").filter((l) => l.startsWith("paragraph ")),
      "step 4: order"
    ).toEqual(["paragraph E", "paragraph A", "paragraph B", "paragraph C", "paragraph D"]);

    // 5th Move-up: E is now first — safe no-op, target still resolves to E.
    doc = parseDocument(text);
    resolved = resolveMoveUnit(doc, cursorLine);
    const content = doc.lines
      .slice(resolved.unit!.range.startLine, resolved.unit!.range.endLine + 1)
      .join("\n");
    expect(content, "step 5: target is still paragraph E after the no-op boundary").toBe(
      "paragraph E"
    );
    outcome = moveComplexBlock(doc, resolved.unit!, "up");
    expect(outcome.changed, "step 5: head no-op").toBe(false);
    expect(outcome.reason).toBe("no-sibling");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("list-item-child: 3 successive Move-down invocations keep resolving 'paragraph A' as the target under the same list item, reaching the tail after a 4th, then a further Move-down is a safe no-op", () => {
    let text = [
      "- item1",
      "  paragraph A",
      "",
      "  paragraph B",
      "",
      "  paragraph C",
      "",
      "  paragraph D",
      "",
      "  paragraph E",
    ].join("\n");
    let cursorLine = 1;

    for (let step = 0; step < 4; step++) {
      const doc = parseDocument(text);
      const resolved = resolveMoveUnit(doc, cursorLine);
      expect(resolved.unit, `step ${step + 1}: resolution`).not.toBeNull();
      const content = doc.lines
        .slice(resolved.unit!.range.startLine, resolved.unit!.range.endLine + 1)
        .join("\n");
      expect(content, `step ${step + 1}: target identity by content`).toBe("  paragraph A");

      const outcome = moveComplexBlock(doc, resolved.unit!, "down");
      expect(outcome.changed, `step ${step + 1}: move applied`).toBe(true);
      text = outcome.lines.join("\n");
      cursorLine = outcome.newStartLine;
    }

    expect(
      text.split("\n").filter((l) => l.trim().startsWith("paragraph ")),
      "final order after 4 successive Move-downs"
    ).toEqual([
      "  paragraph B",
      "  paragraph C",
      "  paragraph D",
      "  paragraph E",
      "  paragraph A",
    ]);

    // 5th: A is now last within item1 — safe no-op, target still A.
    const doc = parseDocument(text);
    const resolved = resolveMoveUnit(doc, cursorLine);
    const content = doc.lines
      .slice(resolved.unit!.range.startLine, resolved.unit!.range.endLine + 1)
      .join("\n");
    expect(content, "step 5: target is still paragraph A after the no-op boundary").toBe(
      "  paragraph A"
    );
    const outcome = moveComplexBlock(doc, resolved.unit!, "down");
    expect(outcome.changed, "step 5: tail-of-list-item no-op").toBe(false);
    expect(outcome.reason).toBe("no-sibling");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("list-item-child: 3 successive Move-up invocations (tracking paragraph E from the tail) keep resolving the same target under the same list item, reaching the head after a 4th, then a further Move-up is a safe no-op", () => {
    let text = [
      "- item1",
      "  paragraph A",
      "",
      "  paragraph B",
      "",
      "  paragraph C",
      "",
      "  paragraph D",
      "",
      "  paragraph E",
    ].join("\n");
    let cursorLine = 9;

    for (let step = 0; step < 4; step++) {
      const doc = parseDocument(text);
      const resolved = resolveMoveUnit(doc, cursorLine);
      expect(resolved.unit, `step ${step + 1}: resolution`).not.toBeNull();
      const content = doc.lines
        .slice(resolved.unit!.range.startLine, resolved.unit!.range.endLine + 1)
        .join("\n");
      expect(content, `step ${step + 1}: target identity by content`).toBe("  paragraph E");

      const outcome = moveComplexBlock(doc, resolved.unit!, "up");
      expect(outcome.changed, `step ${step + 1}: move applied`).toBe(true);
      text = outcome.lines.join("\n");
      cursorLine = outcome.newStartLine;
    }

    expect(
      text.split("\n").filter((l) => l.trim().startsWith("paragraph ")),
      "final order after 4 successive Move-ups"
    ).toEqual([
      "  paragraph E",
      "  paragraph A",
      "  paragraph B",
      "  paragraph C",
      "  paragraph D",
    ]);

    // 5th: E is now first within item1 — safe no-op, target still E.
    const doc = parseDocument(text);
    const resolved = resolveMoveUnit(doc, cursorLine);
    const content = doc.lines
      .slice(resolved.unit!.range.startLine, resolved.unit!.range.endLine + 1)
      .join("\n");
    expect(content, "step 5: target is still paragraph E after the no-op boundary").toBe(
      "  paragraph E"
    );
    const outcome = moveComplexBlock(doc, resolved.unit!, "up");
    expect(outcome.changed, "step 5: head-of-list-item no-op").toBe(false);
    expect(outcome.reason).toBe("no-sibling");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("a structural boundary (an unrelated list item) encountered mid-sequence rejects the second successive Move-down, leaving the body untouched and the target still resolving to paragraph A", () => {
    const afterFirstMove = [
      "# H",
      "paragraph B",
      "",
      "paragraph A",
      "",
      "- some list item",
      "",
      "paragraph C",
    ].join("\n");
    let text = [
      "# H",
      "paragraph A",
      "",
      "paragraph B",
      "",
      "- some list item",
      "",
      "paragraph C",
    ].join("\n");
    let cursorLine = 1;

    // Step 1: A <-> B succeeds normally.
    let doc = parseDocument(text);
    let resolved = resolveMoveUnit(doc, cursorLine);
    let outcome = moveComplexBlock(doc, resolved.unit!, "down");
    expect(outcome.changed, "step 1").toBe(true);
    text = outcome.lines.join("\n");
    cursorLine = outcome.newStartLine;
    expect(text).toBe(afterFirstMove);

    // Step 2: the next candidate below A is an unrelated list item, not a
    // ComplexBlockInfo — findComplexSiblingTarget never treats a list
    // item as a partner (see "paragraph <-> list ... is NOT a supported
    // pairing" above), so this rejects rather than hopping across it.
    doc = parseDocument(text);
    resolved = resolveMoveUnit(doc, cursorLine);
    const content = doc.lines
      .slice(resolved.unit!.range.startLine, resolved.unit!.range.endLine + 1)
      .join("\n");
    expect(content, "step 2: target is still paragraph A before the rejected move").toBe(
      "paragraph A"
    );
    outcome = moveComplexBlock(doc, resolved.unit!, "down");
    expect(outcome.changed, "step 2: rejected").toBe(false);
    // A blank-line-separated list item sitting between two same-parent
    // paragraphs is the exact shape the pre-existing "rejects with
    // boundary-unknown when a list item sits between two same-parent
    // paragraphs" test (near the top of this file) pins to
    // "boundary-unknown", not "no-sibling" — that reason is reserved for
    // "nothing exists in that direction at all" or "the only candidate is
    // a non-ComplexBlockInfo kind directly adjacent" (e.g. the "paragraph
    // <-> list ... is NOT a supported pairing" test above, which has no
    // blank-line gap in between). This test's fixture has that gap, so it
    // takes the boundary-unknown path instead.
    expect(outcome.reason).toBe("boundary-unknown");
    expect(outcome.lines).toEqual(doc.lines);
    expect(text).toBe(afterFirstMove);
  });

  it("an ambiguous/unsupported block (an unterminated fence) encountered mid-sequence rejects the second successive Move-down, leaving the body untouched and the target still resolving to paragraph A", () => {
    let text = [
      "- item1",
      "  paragraph A",
      "",
      "  paragraph B",
      "",
      "  ```",
      "  unterminated fence, no closing marker",
    ].join("\n");
    let cursorLine = 1;

    // Step 1: A <-> B succeeds normally.
    let doc = parseDocument(text);
    let resolved = resolveMoveUnit(doc, cursorLine);
    let outcome = moveComplexBlock(doc, resolved.unit!, "down");
    expect(outcome.changed, "step 1").toBe(true);
    text = outcome.lines.join("\n");
    cursorLine = outcome.newStartLine;
    const afterFirstMove = text;

    // Step 2: the next candidate below A is the unterminated fence, whose
    // editability is "ambiguous" — never offered as a sibling partner.
    doc = parseDocument(text);
    resolved = resolveMoveUnit(doc, cursorLine);
    const content = doc.lines
      .slice(resolved.unit!.range.startLine, resolved.unit!.range.endLine + 1)
      .join("\n");
    expect(content, "step 2: target is still paragraph A before the rejected move").toBe(
      "  paragraph A"
    );
    outcome = moveComplexBlock(doc, resolved.unit!, "down");
    expect(outcome.changed, "step 2: rejected").toBe(false);
    expect(outcome.reason).toBe("no-sibling");
    expect(outcome.lines).toEqual(doc.lines);
    expect(text).toBe(afterFirstMove);
  });
});
