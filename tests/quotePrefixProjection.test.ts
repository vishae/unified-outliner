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
  buildQuotePrefixProjection,
  invertQuotePrefixProjection,
  projectedDisplayText,
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
