import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { isListNode, isSectionNode, ParsedDocument } from "../src/model/block";
import { resolveParagraphAtCursor } from "../src/resolver/resolveParagraphAtCursor";

function sectionIdOf(doc: ParsedDocument, headingText: string): string {
  for (const n of doc.nodes.values()) {
    if (isSectionNode(n) && n.headingText === headingText) return n.id;
  }
  throw new Error(`no section named ${headingText}`);
}

function listIdOf(doc: ParsedDocument, needle: string): string {
  for (const n of doc.nodes.values()) {
    if (isListNode(n) && doc.lines[n.range.startLine].includes(needle)) return n.id;
  }
  throw new Error(`no list item matching "${needle}"`);
}

describe("resolveParagraphAtCursor: success cases", () => {
  it("resolves the first paragraph in a headingless note", () => {
    const text = ["First paragraph.", "still first.", "", "Second paragraph."].join("\n");
    const doc = parseDocument(text);
    const r = resolveParagraphAtCursor(doc, 0);
    expect(r.paragraph?.kind).toBe("paragraph");
    expect(r.paragraph?.rangeStart).toBe(0);
    expect(r.paragraph?.rangeEnd).toBe(1);
    expect(r.paragraph?.parentId).toBeNull();
    expect(r.paragraph?.text).toBe(["First paragraph.", "still first."].join("\n"));
  });

  it("resolves a middle paragraph in a headingless note (cursor on its second line)", () => {
    const text = ["First paragraph.", "", "Middle paragraph.", "still middle.", "", "Last."].join(
      "\n"
    );
    const doc = parseDocument(text);
    const r = resolveParagraphAtCursor(doc, 3);
    expect(r.paragraph?.rangeStart).toBe(2);
    expect(r.paragraph?.rangeEnd).toBe(3);
    expect(r.paragraph?.text).toBe(["Middle paragraph.", "still middle."].join("\n"));
  });

  it("resolves the last paragraph in a headingless note", () => {
    const text = ["First.", "", "Last paragraph."].join("\n");
    const doc = parseDocument(text);
    const r = resolveParagraphAtCursor(doc, 2);
    expect(r.paragraph?.rangeStart).toBe(2);
    expect(r.paragraph?.rangeEnd).toBe(2);
    expect(r.paragraph?.text).toBe("Last paragraph.");
  });

  it("resolves a section-direct paragraph, with parentId pointing at the enclosing section", () => {
    const text = ["# H", "Body under H.", "more body."].join("\n");
    const doc = parseDocument(text);
    const r = resolveParagraphAtCursor(doc, 2);
    expect(r.paragraph?.parentId).toBe(sectionIdOf(doc, "H"));
    expect(r.paragraph?.rangeStart).toBe(1);
    expect(r.paragraph?.rangeEnd).toBe(2);
  });

  it("resolves a list-item-child paragraph, with parentId pointing at the owning list item", () => {
    const text = ["- item1", "  Child paragraph of item1.", "- item2"].join("\n");
    const doc = parseDocument(text);
    const r = resolveParagraphAtCursor(doc, 1);
    expect(r.paragraph?.parentId).toBe(listIdOf(doc, "item1"));
    expect(r.paragraph?.rangeStart).toBe(1);
    expect(r.paragraph?.rangeEnd).toBe(1);
    expect(r.paragraph?.depth).toBeGreaterThan(0);
  });

  it("a non-indented paragraph right after a list is NOT misidentified as that list item's child — parentId is the section, not the list item", () => {
    const text = ["# H", "- item1", "Not indented."].join("\n");
    const doc = parseDocument(text);
    const r = resolveParagraphAtCursor(doc, 2);
    expect(r.paragraph?.parentId).toBe(sectionIdOf(doc, "H"));
    expect(r.paragraph?.parentId).not.toBe(listIdOf(doc, "item1"));
  });

  it("does not fold a preceding heading into the resolved range", () => {
    const text = ["# H", "Body paragraph."].join("\n");
    const doc = parseDocument(text);
    const r = resolveParagraphAtCursor(doc, 1);
    expect(r.paragraph?.rangeStart).toBe(1);
    expect(doc.lines[r.paragraph!.rangeStart]).toBe("Body paragraph.");
  });

  it("does not fold an adjacent complex block (callout/list/table) into the resolved range", () => {
    const text = [
      "> [!note]",
      "> callout body",
      "",
      "Standalone paragraph.",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    const doc = parseDocument(text);
    const r = resolveParagraphAtCursor(doc, 3);
    expect(r.paragraph?.rangeStart).toBe(3);
    expect(r.paragraph?.rangeEnd).toBe(3);
    expect(r.paragraph?.text).toBe("Standalone paragraph.");
  });

  it("parentId/depth match parser/complexBlocks.ts's own 5P-1R contract for the same document", () => {
    const text = ["- item1", "  - nested", "    Child of nested.", "- item2"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const scannerBlock = scan.blocks.find(
      (b) => b.kind === "paragraph" && doc.lines[b.range.startLine].includes("Child of nested")
    )!;
    const r = resolveParagraphAtCursor(doc, scannerBlock.range.startLine);
    expect(r.paragraph?.parentId).toBe(scannerBlock.parentId);
    expect(r.paragraph?.complexBlockId).toBe(scannerBlock.id);
  });

  it("accepts an already-computed ComplexBlockInfo[] passed explicitly, instead of re-scanning", () => {
    const text = ["Plain paragraph."].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const r = resolveParagraphAtCursor(doc, 0, scan.blocks);
    expect(r.paragraph?.text).toBe("Plain paragraph.");
  });
});

describe("resolveParagraphAtCursor: failure cases", () => {
  it("fails on a blank line", () => {
    const doc = parseDocument(["Paragraph.", "", "Another."].join("\n"));
    const r = resolveParagraphAtCursor(doc, 1);
    expect(r.paragraph).toBeNull();
    expect(r.reason).toBe("no-paragraph");
  });

  it("fails on an ATX heading line", () => {
    const doc = parseDocument(["# Heading", "body"].join("\n"));
    const r = resolveParagraphAtCursor(doc, 0);
    expect(r.paragraph).toBeNull();
    expect(r.reason).toBe("no-paragraph");
  });

  it("fails on a list-marker line", () => {
    const doc = parseDocument(["- item"].join("\n"));
    const r = resolveParagraphAtCursor(doc, 0);
    expect(r.paragraph).toBeNull();
    expect(r.reason).toBe("no-paragraph");
  });

  it("fails inside a blockquote", () => {
    const doc = parseDocument(["> quoted line"].join("\n"));
    const r = resolveParagraphAtCursor(doc, 0);
    expect(r.paragraph).toBeNull();
    expect(r.reason).toBe("no-paragraph");
  });

  it("fails inside a callout", () => {
    const doc = parseDocument(["> [!note] Title", "> body"].join("\n"));
    const r = resolveParagraphAtCursor(doc, 1);
    expect(r.paragraph).toBeNull();
    expect(r.reason).toBe("no-paragraph");
  });

  it("fails inside a closed fenced-code block, including the fence lines themselves", () => {
    const doc = parseDocument(["```ts", "const x = 1;", "```"].join("\n"));
    expect(resolveParagraphAtCursor(doc, 0).paragraph).toBeNull();
    expect(resolveParagraphAtCursor(doc, 1).paragraph).toBeNull();
    expect(resolveParagraphAtCursor(doc, 2).paragraph).toBeNull();
  });

  it("fails inside an unclosed (unterminated) fence", () => {
    const doc = parseDocument(["```ts", "const x = 1;"].join("\n"));
    const r = resolveParagraphAtCursor(doc, 1);
    expect(r.paragraph).toBeNull();
    expect(r.reason).toBe("no-paragraph");
  });

  it("fails inside a table", () => {
    const doc = parseDocument(["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    expect(resolveParagraphAtCursor(doc, 0).paragraph).toBeNull();
    expect(resolveParagraphAtCursor(doc, 2).paragraph).toBeNull();
  });

  it("fails on a thematic-break line", () => {
    const doc = parseDocument(["Some paragraph.", "", "***"].join("\n"));
    const r = resolveParagraphAtCursor(doc, 2);
    expect(r.paragraph).toBeNull();
    expect(r.reason).toBe("no-paragraph");
  });

  it("fails inside frontmatter", () => {
    const doc = parseDocument(["---", "title: x", "---", "# H"].join("\n"));
    const r = resolveParagraphAtCursor(doc, 1);
    expect(r.paragraph).toBeNull();
    expect(r.reason).toBe("no-paragraph");
  });

  it("fails on a boundary-ambiguous paragraph (crosses an existing section/list boundary)", () => {
    // Synthetic: a paragraph candidate spanning a list-owned line and a
    // section-owned line with no blank line between them merges into one
    // range whose resolveParentId reports boundaryAmbiguous — see
    // parser/complexBlocks.ts's scanParagraphBlocks.
    const text = ["# H", "- item1", "  Child paragraph of item1.", "Not indented at all."].join(
      "\n"
    );
    const doc = parseDocument(text);
    const r = resolveParagraphAtCursor(doc, 3);
    expect(r.paragraph).toBeNull();
    expect(r.reason).toBe("boundary-ambiguous");
  });

  it("fails on a paragraph downgraded to ambiguous by a merge conflict (table's own rows)", () => {
    const text = ["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const doc = parseDocument(text);
    // The table's own lines are independently, legitimately re-candidated
    // by the paragraph scanner and then downgraded — see
    // parser/complexBlocks.ts's mergeBlockRangesSafely. Cursor here still
    // resolves to "no-paragraph" via the non-paragraph-kind check (the
    // table itself), not this ambiguous branch specifically — covered by
    // "fails inside a table" above. This test instead confirms an
    // ambiguous-only paragraph (no competing higher-priority kind at all)
    // is rejected via the editability check.
    const scan = scanComplexBlocks(doc);
    const ambiguousParagraph = scan.blocks.find((b) => b.kind === "paragraph")!;
    expect(ambiguousParagraph.editability).toBe("ambiguous");
    const r = resolveParagraphAtCursor(doc, ambiguousParagraph.range.startLine, [
      ambiguousParagraph,
    ]);
    expect(r.paragraph).toBeNull();
    expect(r.reason).toBe("boundary-ambiguous");
  });

  it("fails with out-of-range for a negative or too-large cursor line", () => {
    const doc = parseDocument("Just one paragraph.");
    expect(resolveParagraphAtCursor(doc, -1).reason).toBe("out-of-range");
    expect(resolveParagraphAtCursor(doc, 99).reason).toBe("out-of-range");
  });

  it("does not mutate the input ParsedDocument", () => {
    const text = ["# H", "Body paragraph."].join("\n");
    const doc = parseDocument(text);
    const nodeCountBefore = doc.nodes.size;
    resolveParagraphAtCursor(doc, 1);
    expect(doc.nodes.size).toBe(nodeCountBefore);
  });
});
