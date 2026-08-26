import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5D-0.5 ("Quote Prefix Projection for Partial Edit"): static-
 * source-text checks pinning view/PartialEditView.ts's wiring to
 * edit/quotePrefixProjection.ts, and the exact ORDER of operations at
 * each of the hook points the approved implementation scope itemized.
 *
 * Same constraint as tests/paragraphPartialEditViewWiring.test.ts and
 * tests/commandTable.test.ts: PartialEditView extends Obsidian's ItemView
 * and cannot be constructed in vitest ("obsidian" is a types-only package
 * in this repo), so this file inspects the raw source text instead of
 * calling into the class. Real behavioral coverage of the projection
 * pipeline itself (build/invert/apply, conflict, resolve-failed, two
 * consecutive Applies) lives in
 * tests/quotePrefixPartialEditApply.test.ts and
 * tests/quotePrefixProjection.test.ts — this file only confirms the View
 * layer actually calls into that logic at the right place, in the right
 * order, and that no hook point was missed.
 */
describe("view/PartialEditView.ts quote-prefix-projection wiring (static source check, Phase 5D-0.5)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");

  function bodyOf(source: string, needle: string, label: string): string {
    const start = source.indexOf(needle);
    if (start === -1) {
      throw new Error(`${label} not found — has it been renamed or removed?`);
    }
    const end = source.indexOf("\n  }", start);
    if (end === -1 || end <= start) {
      throw new Error(
        `Could not find ${label}'s closing brace — its shape may have changed; update this test's bounding logic.`
      );
    }
    return source.slice(start, end);
  }

  it("imports buildQuotePrefixProjection/invertQuotePrefixProjection/projectedDisplayText from edit/quotePrefixProjection", () => {
    expect(viewTs).toContain('from "../edit/quotePrefixProjection"');
    expect(viewTs).toContain("buildQuotePrefixProjection");
    expect(viewTs).toContain("invertQuotePrefixProjection");
    expect(viewTs).toContain("projectedDisplayText");
  });

  it("declares a quoteProjection field, initialized to null", () => {
    expect(viewTs).toMatch(/private quoteProjection: QuotePrefixProjection \| null = null;/);
  });

  it("currentDisplayText() returns projectedDisplayText(quoteProjection) when set, else raw originalText — never the reverse", () => {
    const body = bodyOf(viewTs, "private currentDisplayText(): string {", "currentDisplayText()");
    expect(body).toContain(
      "this.quoteProjection ? projectedDisplayText(this.quoteProjection) : this.originalText"
    );
  });

  it("loadNodeInternal: buildQuotePrefixProjection runs, and a 'nested' refusal returns, strictly BEFORE this.nodeId is ever assigned — a refusal must leave the pane's prior state completely untouched", () => {
    const body = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal()");
    const buildIndex = body.indexOf("buildQuotePrefixProjection(extracted.text, extracted.kind)");
    const nestedNoticeIndex = body.indexOf('this.plugin.t("partialEdit.quoteNestedUnsupported")');
    const nodeIdAssignIndex = body.indexOf("this.nodeId = nodeId;");
    expect(buildIndex).toBeGreaterThan(-1);
    expect(nestedNoticeIndex).toBeGreaterThan(-1);
    expect(nodeIdAssignIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeLessThan(nestedNoticeIndex);
    expect(nestedNoticeIndex).toBeLessThan(nodeIdAssignIndex);
  });

  it("loadNodeInternal: this.quoteProjection is assigned alongside this.originalText (same load, one snapshot)", () => {
    const body = bodyOf(viewTs, "private loadNodeInternal(nodeId: string): void {", "loadNodeInternal()");
    const originalTextIndex = body.indexOf("this.originalText = extracted.text;");
    const quoteProjectionIndex = body.indexOf("this.quoteProjection = quoteProjection;");
    expect(originalTextIndex).toBeGreaterThan(-1);
    expect(quoteProjectionIndex).toBeGreaterThan(-1);
    expect(originalTextIndex).toBeLessThan(quoteProjectionIndex);
  });

  it("loadParagraphInternal resets quoteProjection to null — a paragraph never projects", () => {
    const body = bodyOf(
      viewTs,
      "private loadParagraphInternal(cursorLine: number): void {",
      "loadParagraphInternal()"
    );
    expect(body).toContain("this.quoteProjection = null;");
  });

  it("renderEmptyState resets quoteProjection to null and calls renderQuoteHeader", () => {
    const body = bodyOf(viewTs, "private renderEmptyState(): void {", "renderEmptyState()");
    expect(body).toContain("this.quoteProjection = null;");
    expect(body).toContain("this.renderQuoteHeader();");
  });

  it("renderLoadedState sets the textarea from currentDisplayText(), never from raw originalText directly, and calls renderQuoteHeader", () => {
    const body = bodyOf(viewTs, "private renderLoadedState(): void {", "renderLoadedState()");
    expect(body).toContain("this.textareaEl.value = this.currentDisplayText();");
    expect(body).not.toContain("this.textareaEl.value = this.originalText;");
    expect(body).toContain("this.renderQuoteHeader();");
  });

  it("cancelEdit reverts the textarea to currentDisplayText(), never to raw originalText directly", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit()");
    expect(body).toContain("this.textareaEl.value = this.currentDisplayText();");
    expect(body).not.toContain("this.textareaEl.value = this.originalText;");
  });

  it("isDirty() compares the textarea against currentDisplayText(), never against raw originalText directly", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty()");
    expect(body).toContain("this.textareaEl.value !== this.currentDisplayText()");
    expect(body).not.toContain("this.textareaEl.value !== this.originalText");
  });

  it("applyEdit's non-paragraph branch inverts the projection (when present) and refuses on failure BEFORE ever calling applySubtreeEdit", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit()");
    const invertIndex = body.indexOf(
      "invertQuotePrefixProjection(this.quoteProjection, this.textareaEl.value)"
    );
    const lineCountNoticeIndex = body.indexOf('this.plugin.t("partialEdit.quoteLineCountChanged")');
    const applySubtreeEditIndex = body.indexOf(
      "applySubtreeEdit(doc, this.nodeId!, this.originalText, newRawText)"
    );
    expect(invertIndex).toBeGreaterThan(-1);
    expect(lineCountNoticeIndex).toBeGreaterThan(-1);
    expect(applySubtreeEditIndex).toBeGreaterThan(-1);
    expect(invertIndex).toBeLessThan(lineCountNoticeIndex);
    expect(lineCountNoticeIndex).toBeLessThan(applySubtreeEditIndex);
  });

  it("applyEdit's non-paragraph success path re-anchors originalText to the reconstructed raw text (newRawText), never to the textarea's own (possibly prefix-stripped) value", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit()");
    expect(body).toContain("this.originalText = newRawText;");
    // The OLD pre-5D-0.5 line must be gone from this branch — keeping it
    // would silently re-introduce raw/display desync for a projecting
    // node the very next time isDirty()/currentDisplayText() runs.
    const nonParagraphTail = body.slice(body.indexOf("const outcome = applySubtreeEdit(doc, this.nodeId!"));
    expect(nonParagraphTail).not.toContain("this.originalText = this.textareaEl.value;");
  });

  it("applyEdit's non-paragraph success path rebuilds quoteProjection fresh from the just-applied raw text when a projection was active", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit()");
    const reanchorIndex = body.indexOf("this.originalText = newRawText;");
    const rebuildIndex = body.indexOf("buildQuotePrefixProjection(newRawText, kind)");
    expect(reanchorIndex).toBeGreaterThan(-1);
    expect(rebuildIndex).toBeGreaterThan(-1);
    expect(reanchorIndex).toBeLessThan(rebuildIndex);
  });

  it("renderQuoteHeader hides the header row when quoteProjection has no header (blockquote / non-projecting) and shows it verbatim for a projecting callout", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteHeaderEl.toggleVisibility(false);");
    expect(body).toContain("this.quoteHeaderEl.toggleVisibility(true);");
    expect(body).toContain("this.quoteHeaderEl.setText(header);");
  });

  it("the i18n keys this ticket introduces (quoteNestedUnsupported / quoteLineCountChanged) exist with non-empty en/ja text", () => {
    const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
    for (const key of ["partialEdit.quoteNestedUnsupported", "partialEdit.quoteLineCountChanged"]) {
      const matches = i18nTs.match(new RegExp(`"${key}":\\s*\\n?\\s*"([^"]+)"`, "g")) ?? [];
      // Present in both the en and ja dictionaries.
      expect(matches.length).toBe(2);
      for (const m of matches) {
        const textMatch = m.match(/"([^"]+)"\s*$/);
        expect(textMatch?.[1]?.length).toBeGreaterThan(0);
      }
    }
  });
});
