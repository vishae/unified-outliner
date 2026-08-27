/**
 * Phase 5D-0.5 ("Quote Prefix Projection for Partial Edit"): pure-function
 * tests for edit/quotePrefixProjection.ts — buildQuotePrefixProjection /
 * projectedDisplayText / invertQuotePrefixProjection. No Obsidian, no
 * ParsedDocument — every fixture here is a raw multi-line string, exactly
 * the shape extractSubtreeText already returns for a "supported" callout/
 * blockquote (see edit/partialEdit.ts's own doc comment), matching this
 * module's own "operates purely on raw text + kind" contract.
 */
import { describe, expect, it } from "vitest";
import {
  buildQuoteHeaderTitleSlot,
  buildQuotePrefixProjection,
  invertQuotePrefixProjection,
  projectedDisplayText,
  reconstructQuoteHeader,
} from "../src/edit/quotePrefixProjection";

describe("buildQuotePrefixProjection + projectedDisplayText: blockquote", () => {
  it("round-trips a mix of prefix formats (`>text`, `> text`, `>  text`) with content unedited", () => {
    const raw = [">text", "> text", ">  text"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.header).toBeNull();
    const display = projectedDisplayText(built.projection);
    const inverted = invertQuotePrefixProjection(built.projection, display);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(raw);
  });

  it("round-trips several blank quoted lines (`>` alone) unedited", () => {
    const raw = ["> first", ">", ">", "> last"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const display = projectedDisplayText(built.projection);
    expect(display).toBe(["first", "", "", "last"].join("\n"));
    const inverted = invertQuotePrefixProjection(built.projection, display);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(raw);
  });

  it("emptying an existing body line still round-trips with its own original prefix", () => {
    const raw = ["> keep this", "> erase this one"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const editedDisplay = ["keep this", ""].join("\n");
    const inverted = invertQuotePrefixProjection(built.projection, editedDisplay);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    // The erased line must reconstruct as its bare original prefix ("> "),
    // never as an empty raw line or a line with no `>` at all.
    expect(inverted.rawText).toBe(["> keep this", "> "].join("\n"));
  });

  it("preserves list-item-owned leading indentation before the `>` marker", () => {
    const raw = ["  > indented quote line one", "  > indented quote line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const display = projectedDisplayText(built.projection);
    const inverted = invertQuotePrefixProjection(built.projection, display);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(raw);
  });

  it("rejects with reason 'nested' when a body line, after stripping one level of `>`, still starts with `>` (plain nested blockquote, no `[!` marker)", () => {
    const raw = ["> outer line", "> > nested line", "> outer again"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built).toEqual({ ok: false, reason: "nested" });
  });
});

describe("buildQuotePrefixProjection + projectedDisplayText: callout", () => {
  it("round-trips a callout WITH a title, unedited", () => {
    const raw = ["> [!note] My Title", "> body line one", "> body line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.header).toBe("> [!note] My Title");
    const display = projectedDisplayText(built.projection);
    expect(display).toBe(["body line one", "body line two"].join("\n"));
    const inverted = invertQuotePrefixProjection(built.projection, display);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(raw);
  });

  it("round-trips a callout with NO title", () => {
    const raw = ["> [!warning]", "> only body content"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.header).toBe("> [!warning]");
    const display = projectedDisplayText(built.projection);
    const inverted = invertQuotePrefixProjection(built.projection, display);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(raw);
  });

  it("round-trips fold markers (+/-) in the header, unchanged", () => {
    for (const fold of ["+", "-"]) {
      const raw = [`> [!tip]${fold} Folded`, "> body"].join("\n");
      const built = buildQuotePrefixProjection(raw, "callout");
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      expect(built.projection.header).toBe(`> [!tip]${fold} Folded`);
      const inverted = invertQuotePrefixProjection(
        built.projection,
        projectedDisplayText(built.projection)
      );
      expect(inverted.ok && inverted.rawText).toBe(raw);
    }
  });

  it("preserves list-item-owned indentation on both the header and body lines", () => {
    const raw = ["  > [!ocr] Scan", "  > line one", "  > line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.header).toBe("  > [!ocr] Scan");
    const inverted = invertQuotePrefixProjection(
      built.projection,
      projectedDisplayText(built.projection)
    );
    expect(inverted.ok && inverted.rawText).toBe(raw);
  });

  it("excludes the header line from the projected display body", () => {
    const raw = ["> [!note] Title", "> body"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const display = projectedDisplayText(built.projection);
    expect(display).not.toContain("[!note]");
    expect(display).not.toContain("Title");
    expect(display).toBe("body");
  });

  it("returns 'no-body' for a header-only callout (zero body lines) — caller falls back to raw editing, this is not a rejection", () => {
    const raw = "> [!note] Header only, no body";
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built).toEqual({ ok: false, reason: "no-body" });
  });

  it("rejects with reason 'nested' for a nested quote-like line inside a callout body", () => {
    const raw = ["> [!note] Title", "> outer", "> > nested"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built).toEqual({ ok: false, reason: "nested" });
  });
});

describe("invertQuotePrefixProjection: line-count-changed refusal", () => {
  it("rejects an added line with reason 'line-count-changed'", () => {
    const raw = ["> line one", "> line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const edited = ["line one", "line two", "a brand new third line"].join("\n");
    const inverted = invertQuotePrefixProjection(built.projection, edited);
    expect(inverted).toEqual({ ok: false, reason: "line-count-changed" });
  });

  it("rejects a removed line with reason 'line-count-changed'", () => {
    const raw = ["> line one", "> line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const edited = "line one";
    const inverted = invertQuotePrefixProjection(built.projection, edited);
    expect(inverted).toEqual({ ok: false, reason: "line-count-changed" });
  });

  it("rejects a line split via an embedded newline with reason 'line-count-changed'", () => {
    const raw = "> a single body line";
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const edited = ["a single", "body line"].join("\n");
    const inverted = invertQuotePrefixProjection(built.projection, edited);
    expect(inverted).toEqual({ ok: false, reason: "line-count-changed" });
  });
});

// ---- Phase 5D-1A ("Callout Header Title Editing") -----------------------
//
// Pure-function tests for buildQuoteHeaderTitleSlot / reconstructQuoteHeader
// (both new this ticket), plus the new `titleSlot` field on
// QuotePrefixProjection itself. Same "raw text in, raw text out, never
// normalized/trimmed" contract as the body-line split above — see both
// functions' own doc comments in edit/quotePrefixProjection.ts for the
// exact invariant and the ticket's 3 fixed whitespace rules.

describe("buildQuoteHeaderTitleSlot: lossless header split (Phase 5D-1A)", () => {
  it("splits a header WITH a title into beforeTitle (prefix + [!type] + fold marker + separator) and title, round-tripping byte-for-byte", () => {
    const header = "> [!note] My Title";
    const slot = buildQuoteHeaderTitleSlot(header);
    expect(slot).not.toBeNull();
    if (!slot) return;
    expect(slot.beforeTitle).toBe("> [!note] ");
    expect(slot.title).toBe("My Title");
    expect(slot.beforeTitle + slot.title).toBe(header);
  });

  it("splits a header with NO title into beforeTitle === the whole line and title === ''", () => {
    const header = "> [!warning]";
    const slot = buildQuoteHeaderTitleSlot(header);
    expect(slot).not.toBeNull();
    if (!slot) return;
    expect(slot.beforeTitle).toBe(header);
    expect(slot.title).toBe("");
    expect(slot.beforeTitle + slot.title).toBe(header);
  });

  it("keeps the fold marker (+/-) inside beforeTitle, never inside title", () => {
    for (const fold of ["+", "-"]) {
      const header = `> [!tip]${fold} Folded Title`;
      const slot = buildQuoteHeaderTitleSlot(header);
      expect(slot).not.toBeNull();
      if (!slot) continue;
      expect(slot.beforeTitle).toBe(`> [!tip]${fold} `);
      expect(slot.title).toBe("Folded Title");
      expect(slot.beforeTitle + slot.title).toBe(header);
    }
  });

  it("preserves list-item-owned indentation before the `>` marker inside beforeTitle", () => {
    const header = "  > [!ocr] Scan";
    const slot = buildQuoteHeaderTitleSlot(header);
    expect(slot).not.toBeNull();
    if (!slot) return;
    expect(slot.beforeTitle).toBe("  > [!ocr] ");
    expect(slot.title).toBe("Scan");
    expect(slot.beforeTitle + slot.title).toBe(header);
  });

  it("round-trips byte-for-byte across title-present / title-absent / fold-marker / indented header shapes", () => {
    const headers = [
      "> [!note] Title",
      "> [!warning]",
      "> [!tip]+ Folded",
      "> [!tip]- Folded",
      "  > [!ocr] Indented Title",
      "    > [!ocr]",
    ];
    for (const header of headers) {
      const slot = buildQuoteHeaderTitleSlot(header);
      expect(slot).not.toBeNull();
      if (!slot) continue;
      expect(slot.beforeTitle + slot.title).toBe(header);
    }
  });
});

describe("reconstructQuoteHeader: title-slot round-trip and the 3 fixed whitespace rules (Phase 5D-1A)", () => {
  it("rule 3 (unedited): the same non-empty title reconstructs the header byte-identical to the original", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] My Title")!;
    const result = reconstructQuoteHeader(slot, "My Title");
    expect(result).toEqual({ ok: true, header: "> [!note] My Title" });
  });

  it("rule 1: a non-empty title emptied reuses beforeTitle completely unmodified, including its trailing separator space", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] My Title")!;
    const result = reconstructQuoteHeader(slot, "");
    expect(result).toEqual({ ok: true, header: "> [!note] " });
  });

  it("rule 1: an already-empty title left empty (unedited) also reconstructs byte-identical to the original", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const result = reconstructQuoteHeader(slot, "");
    expect(result).toEqual({ ok: true, header: "> [!warning]" });
  });

  it("rule 2: an empty title made non-empty, with NO existing separator in beforeTitle, inserts exactly one space", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const result = reconstructQuoteHeader(slot, "New Title");
    expect(result).toEqual({ ok: true, header: "> [!warning] New Title" });
  });

  it("rule 2: an empty title made non-empty, with an EXISTING trailing separator already in beforeTitle, does not duplicate the space", () => {
    // A stray trailing space after the marker even with no title present
    // (e.g. left behind by an external editor) — the split regex still
    // captures it as part of beforeTitle, since title itself is "".
    const slot = buildQuoteHeaderTitleSlot("> [!warning] ")!;
    expect(slot.title).toBe("");
    expect(slot.beforeTitle).toBe("> [!warning] ");
    const result = reconstructQuoteHeader(slot, "New Title");
    expect(result).toEqual({ ok: true, header: "> [!warning] New Title" });
  });

  it("rule 3: a non-empty title changed to a different non-empty title preserves beforeTitle byte-for-byte, including its original (non-single-space) separator convention", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!tip]+  Old Title")!; // two spaces before the title
    expect(slot.beforeTitle).toBe("> [!tip]+  ");
    const result = reconstructQuoteHeader(slot, "New Title");
    expect(result).toEqual({ ok: true, header: "> [!tip]+  New Title" });
  });

  it("passes through wiki links, URLs, emoji, Japanese, inline Markdown, and an embedded `>` in the title completely untouched", () => {
    const titles = [
      "[[Some Note]] reference",
      "see https://example.com/path?q=1",
      "important 🔥 emoji",
      "日本語のタイトル",
      "**bold** and *italic* and `code`",
      "> looks like another quote marker",
    ];
    for (const title of titles) {
      const slot = buildQuoteHeaderTitleSlot("> [!note] placeholder")!;
      const result = reconstructQuoteHeader(slot, title);
      expect(result).toEqual({ ok: true, header: `> [!note] ${title}` });
    }
  });

  it("rejects a title containing a newline with reason 'newline'", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, "line one\nline two");
    expect(result).toEqual({ ok: false, reason: "newline" });
  });
});

describe("buildQuotePrefixProjection: titleSlot field (Phase 5D-1A)", () => {
  it("a callout WITH a title gets a non-null titleSlot matching buildQuoteHeaderTitleSlot's own split of the same header", () => {
    const raw = ["> [!note] My Title", "> body"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.titleSlot).toEqual({ beforeTitle: "> [!note] ", title: "My Title" });
  });

  it("a callout with NO title still gets a non-null titleSlot, with title === ''", () => {
    const raw = ["> [!warning]", "> body"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.titleSlot).toEqual({ beforeTitle: "> [!warning]", title: "" });
  });

  it("a blockquote always has titleSlot === null — no header line, no title concept", () => {
    const raw = ["> line one", "> line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.titleSlot).toBeNull();
  });
});
