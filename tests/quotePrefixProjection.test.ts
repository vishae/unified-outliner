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
//
// Phase 5D-1B ("Callout Fold Marker Editing") extended
// QuoteHeaderTitleSlot's shape — `beforeTitle` (prefix + [!type] + fold
// marker + separator, one opaque span) was split further into
// `beforeMarker` (prefix + [!type] only) / `marker` / `separator`, and
// reconstructQuoteHeader's signature grew a `newMarker` parameter
// (`reconstructQuoteHeader(slot, newMarker, newTitle)`). Every test below
// reflects that new shape; the 5D-1A separator-rule tests below still
// exist and still pass an UNCHANGED marker (`slot.marker`) into
// reconstructQuoteHeader, confirming pure title editing regresses none of
// its 5D-1A behavior now that marker travels alongside it.

describe("buildQuoteHeaderTitleSlot: lossless 4-piece header split (Phase 5D-1A / 5D-1B)", () => {
  it("splits a header WITH a title and no marker into beforeMarker / marker(\"\") / separator / title, round-tripping byte-for-byte", () => {
    const header = "> [!note] My Title";
    const slot = buildQuoteHeaderTitleSlot(header);
    expect(slot).not.toBeNull();
    if (!slot) return;
    expect(slot.beforeMarker).toBe("> [!note]");
    expect(slot.marker).toBe("");
    expect(slot.separator).toBe(" ");
    expect(slot.title).toBe("My Title");
    expect(slot.beforeMarker + slot.marker + slot.separator + slot.title).toBe(header);
  });

  it("splits a header with NO title and NO marker into beforeMarker === the whole line, marker/separator/title all ''", () => {
    const header = "> [!warning]";
    const slot = buildQuoteHeaderTitleSlot(header);
    expect(slot).not.toBeNull();
    if (!slot) return;
    expect(slot.beforeMarker).toBe(header);
    expect(slot.marker).toBe("");
    expect(slot.separator).toBe("");
    expect(slot.title).toBe("");
    expect(slot.beforeMarker + slot.marker + slot.separator + slot.title).toBe(header);
  });

  it("splits the fold marker (+/-) into its OWN field, never inside beforeMarker or title", () => {
    for (const fold of ["+", "-"]) {
      const header = `> [!tip]${fold} Folded Title`;
      const slot = buildQuoteHeaderTitleSlot(header);
      expect(slot).not.toBeNull();
      if (!slot) continue;
      expect(slot.beforeMarker).toBe("> [!tip]");
      expect(slot.marker).toBe(fold);
      expect(slot.separator).toBe(" ");
      expect(slot.title).toBe("Folded Title");
      expect(slot.beforeMarker + slot.marker + slot.separator + slot.title).toBe(header);
    }
  });

  it("preserves list-item-owned indentation before the `>` marker inside beforeMarker", () => {
    const header = "  > [!ocr] Scan";
    const slot = buildQuoteHeaderTitleSlot(header);
    expect(slot).not.toBeNull();
    if (!slot) return;
    expect(slot.beforeMarker).toBe("  > [!ocr]");
    expect(slot.separator).toBe(" ");
    expect(slot.title).toBe("Scan");
    expect(slot.beforeMarker + slot.marker + slot.separator + slot.title).toBe(header);
  });

  it("round-trips byte-for-byte across title-present / title-absent / fold-marker(none/+/-) / indented / 0-or-1-space-after->  header shapes", () => {
    const headers = [
      "> [!note] Title",
      "> [!warning]",
      "> [!tip]+ Folded",
      "> [!tip]- Folded",
      "  > [!ocr] Indented Title",
      "    > [!ocr]",
      ">[!note] no space after >",
      "> [!tip]+  Old Title", // double-space separator
    ];
    for (const header of headers) {
      const slot = buildQuoteHeaderTitleSlot(header);
      expect(slot).not.toBeNull();
      if (!slot) continue;
      expect(slot.beforeMarker + slot.marker + slot.separator + slot.title).toBe(header);
    }
  });
});

describe("reconstructQuoteHeader: title-slot round-trip and the 3 fixed separator rules, marker held UNCHANGED (Phase 5D-1A regression, now via the 5D-1B signature)", () => {
  it("rule 3 (unedited): the same non-empty title AND same marker reconstructs the header byte-identical to the original", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] My Title")!;
    const result = reconstructQuoteHeader(slot, slot.marker, "My Title");
    expect(result).toEqual({ ok: true, header: "> [!note] My Title" });
  });

  it("rule 1: a non-empty title emptied (marker unchanged) reuses the separator completely unmodified", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] My Title")!;
    const result = reconstructQuoteHeader(slot, slot.marker, "");
    expect(result).toEqual({ ok: true, header: "> [!note] " });
  });

  it("rule 1: an already-empty title left empty (unedited, marker unchanged) also reconstructs byte-identical to the original", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const result = reconstructQuoteHeader(slot, slot.marker, "");
    expect(result).toEqual({ ok: true, header: "> [!warning]" });
  });

  it("rule 2: an empty title made non-empty (marker unchanged), with NO existing separator, inserts exactly one space", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const result = reconstructQuoteHeader(slot, slot.marker, "New Title");
    expect(result).toEqual({ ok: true, header: "> [!warning] New Title" });
  });

  it("rule 2: an empty title made non-empty (marker unchanged), with an EXISTING trailing separator, does not duplicate the space", () => {
    // A stray trailing space after the marker position even with no title
    // present (e.g. left behind by an external editor) — the split regex
    // still captures it as `separator`, since title itself is "".
    const slot = buildQuoteHeaderTitleSlot("> [!warning] ")!;
    expect(slot.title).toBe("");
    expect(slot.separator).toBe(" ");
    const result = reconstructQuoteHeader(slot, slot.marker, "New Title");
    expect(result).toEqual({ ok: true, header: "> [!warning] New Title" });
  });

  it("rule 3: a non-empty title changed to a different non-empty title (marker unchanged) preserves the separator byte-for-byte, including a non-single-space convention", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!tip]+  Old Title")!; // two spaces before the title
    expect(slot.separator).toBe("  ");
    const result = reconstructQuoteHeader(slot, slot.marker, "New Title");
    expect(result).toEqual({ ok: true, header: "> [!tip]+  New Title" });
  });

  it("passes through wiki links, URLs, emoji, Japanese, inline Markdown, and an embedded `>` in the title completely untouched (marker unchanged)", () => {
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
      const result = reconstructQuoteHeader(slot, slot.marker, title);
      expect(result).toEqual({ ok: true, header: `> [!note] ${title}` });
    }
  });

  it("rejects a title containing a newline with reason 'newline' (marker unchanged)", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, slot.marker, "line one\nline two");
    expect(result).toEqual({ ok: false, reason: "newline" });
  });
});

describe("buildQuotePrefixProjection: titleSlot field, 4-piece shape (Phase 5D-1A / 5D-1B)", () => {
  it("a callout WITH a title and no marker gets a non-null titleSlot matching buildQuoteHeaderTitleSlot's own split of the same header", () => {
    const raw = ["> [!note] My Title", "> body"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.titleSlot).toEqual({
      beforeMarker: "> [!note]",
      marker: "",
      separator: " ",
      title: "My Title",
    });
  });

  it("a callout with NO title still gets a non-null titleSlot, with marker/separator/title all ''", () => {
    const raw = ["> [!warning]", "> body"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.titleSlot).toEqual({
      beforeMarker: "> [!warning]",
      marker: "",
      separator: "",
      title: "",
    });
  });

  it("a blockquote always has titleSlot === null — no header line, no title/marker concept", () => {
    const raw = ["> line one", "> line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.titleSlot).toBeNull();
  });
});

// ---- Phase 5D-1B ("Callout Fold Marker Editing") -------------------------
//
// Pure-function tests for the marker half of reconstructQuoteHeader — the
// title half is already covered exhaustively above (with marker held
// unchanged); these tests hold TITLE unchanged and exercise the marker
// transitions, plus the runtime guard and simultaneous marker+title edits.

describe("reconstructQuoteHeader: fold-marker transitions, title UNCHANGED (Phase 5D-1B)", () => {
  it("round-trips all 4 marker transitions (none->+, none->-, +->none, -->+) with title held unchanged", () => {
    const cases: Array<[string, "" | "+" | "-", string]> = [
      ["> [!note] My Title", "+", "> [!note]+ My Title"],
      ["> [!note] My Title", "-", "> [!note]- My Title"],
      ["> [!tip]+ Folded", "", "> [!tip] Folded"],
      ["> [!tip]- Folded", "+", "> [!tip]+ Folded"],
    ];
    for (const [header, newMarker, expected] of cases) {
      const slot = buildQuoteHeaderTitleSlot(header)!;
      const result = reconstructQuoteHeader(slot, newMarker, slot.title);
      expect(result).toEqual({ ok: true, header: expected });
    }
  });

  it("a marker-only change on a title-less callout keeps title empty and does not synthesize a separator (title stays empty, rule 1 applies)", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const toPlus = reconstructQuoteHeader(slot, "+", slot.title);
    expect(toPlus).toEqual({ ok: true, header: "> [!warning]+" });
    const toMinus = reconstructQuoteHeader(slot, "-", slot.title);
    expect(toMinus).toEqual({ ok: true, header: "> [!warning]-" });
  });

  it("a marker-only change on an indented, list-item-owned callout preserves the indentation and quote prefix exactly", () => {
    const slot = buildQuoteHeaderTitleSlot("  > [!ocr] Scan")!;
    const result = reconstructQuoteHeader(slot, "-", slot.title);
    expect(result).toEqual({ ok: true, header: "  > [!ocr]- Scan" });
  });

  it("a marker-only change preserves a multi-space separator convention byte-for-byte", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!tip]+  Old Title")!;
    const result = reconstructQuoteHeader(slot, "-", slot.title);
    expect(result).toEqual({ ok: true, header: "> [!tip]-  Old Title" });
  });

  it("marker-only changes never alter type, quote prefix, or title — beforeMarker and title are always byte-identical to the original", () => {
    const slot = buildQuoteHeaderTitleSlot("  > [!custom-type] Some Title")!;
    for (const newMarker of ["", "+", "-"] as const) {
      const result = reconstructQuoteHeader(slot, newMarker, slot.title);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.header.startsWith(slot.beforeMarker)).toBe(true);
      expect(result.header.endsWith(slot.title)).toBe(true);
    }
  });

  it("an unedited marker (newMarker === slot.marker) with title unchanged reconstructs byte-identical to the original, for none/+/- alike", () => {
    for (const header of ["> [!note] Title", "> [!tip]+ Title", "> [!tip]- Title"]) {
      const slot = buildQuoteHeaderTitleSlot(header)!;
      const result = reconstructQuoteHeader(slot, slot.marker, slot.title);
      expect(result).toEqual({ ok: true, header });
    }
  });
});

describe("reconstructQuoteHeader: simultaneous marker + title edits, single reassembly (Phase 5D-1B)", () => {
  it("marker none->+ AND title empty->non-empty together: rule 2's space-insertion still applies correctly", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const result = reconstructQuoteHeader(slot, "+", "New Title");
    expect(result).toEqual({ ok: true, header: "> [!warning]+ New Title" });
  });

  it("marker none->- AND title emptied together: rule 1's separator-preservation still applies correctly", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Old")!;
    const result = reconstructQuoteHeader(slot, "-", "");
    expect(result).toEqual({ ok: true, header: "> [!note]- " });
  });

  it("marker +->none AND title changed to a different non-empty value together: rule 3's separator-preservation still applies correctly", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!tip]+ Folded")!;
    const result = reconstructQuoteHeader(slot, "", "New");
    expect(result).toEqual({ ok: true, header: "> [!tip] New" });
  });

  it("simultaneous marker+title change on an indented, multi-space-separator header composes correctly", () => {
    const slot = buildQuoteHeaderTitleSlot("  > [!ocr]-  Old Scan")!;
    const result = reconstructQuoteHeader(slot, "+", "New Scan");
    expect(result).toEqual({ ok: true, header: "  > [!ocr]+  New Scan" });
  });
});

describe("reconstructQuoteHeader: invalid-marker runtime guard (Phase 5D-1B)", () => {
  it("rejects any newMarker value outside \"\" | \"+\" | \"-\" with reason 'invalid-marker', never throwing and never silently coercing it", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    // The TypeScript signature restricts newMarker to CalloutFoldMarker;
    // this simulates an out-of-band value (e.g. from DOM manipulation
    // bypassing the closed-set <select>) reaching the function anyway.
    for (const bogus of ["*", "++", " ", "warning", "\n"]) {
      const result = reconstructQuoteHeader(slot, bogus as unknown as "" | "+" | "-", slot.title);
      expect(result).toEqual({ ok: false, reason: "invalid-marker" });
    }
  });

  it("checks marker validity independently of title validity — an invalid marker is rejected even when the title itself is otherwise fine", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, "toggle" as unknown as "" | "+" | "-", "A perfectly fine title");
    expect(result).toEqual({ ok: false, reason: "invalid-marker" });
  });
});
