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

  it("renderQuoteHeader hides the header row when quoteProjection has no header (blockquote / non-projecting) and shows it verbatim for a projecting callout with no titleSlot", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteHeaderEl.toggleVisibility(false);");
    expect(body).toContain("this.quoteHeaderEl.toggleVisibility(true);");
    // Phase 5D-1A: renderQuoteHeader now targets quoteHeaderLabelEl (the
    // read-only child), never quoteHeaderEl itself — see
    // quoteHeaderLabelEl's own doc comment for why. This is an
    // intentional 5D-1A call-site change, not a regression: the OLD
    // `this.quoteHeaderEl.setText(header)` call site is gone.
    expect(body).toContain("this.quoteHeaderLabelEl.setText(header);");
  });

  it("renderQuoteHeader (Phase 5D-1B): when quoteProjection.titleSlot is non-null, it shows the row, sets the label to beforeMarker, reveals+enables the title input, and pre-fills it with the loaded title", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteHeaderLabelEl.setText(titleSlot.beforeMarker);");
    expect(body).toContain("this.quoteTitleInputEl.toggleVisibility(true);");
    expect(body).toContain("this.quoteTitleInputEl.disabled = false;");
    expect(body).toContain("this.quoteTitleInputEl.value = titleSlot.title;");
  });

  it("renderQuoteHeader (Phase 5D-1A): hides and clears the title input whenever titleSlot is null (blockquote, non-projecting, or a callout header with no title slot)", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteTitleInputEl.toggleVisibility(false);");
    expect(body).toContain('this.quoteTitleInputEl.value = "";');
  });

  it("renderQuoteHeader (Phase 5D-1B): when titleSlot is non-null, it also reveals+enables the fold-marker select and pre-fills it with the loaded marker", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteMarkerSelectEl.toggleVisibility(true);");
    expect(body).toContain("this.quoteMarkerSelectEl.disabled = false;");
    expect(body).toContain("this.quoteMarkerSelectEl.value = titleSlot.marker;");
  });

  it("renderQuoteHeader (Phase 5D-1B): hides the fold-marker select and resets it to the empty (not-foldable) option whenever titleSlot is null", () => {
    const body = bodyOf(viewTs, "private renderQuoteHeader(): void {", "renderQuoteHeader()");
    expect(body).toContain("this.quoteMarkerSelectEl.toggleVisibility(false);");
    expect(body).toContain('this.quoteMarkerSelectEl.value = "";');
  });

  it("onOpen (Phase 5D-1A): creates quoteHeaderLabelEl and quoteTitleInputEl as children of quoteHeaderEl, and wires the title input's own 'input' listener to updateDirtyState", () => {
    const body = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen()");
    expect(body).toContain("this.quoteHeaderLabelEl = this.quoteHeaderEl.createSpan(");
    expect(body).toContain('this.quoteTitleInputEl = this.quoteHeaderEl.createEl("input"');
    expect(body).toContain(
      'this.quoteTitleInputEl.addEventListener("input", () => this.updateDirtyState());'
    );
  });

  it("onOpen (Phase 5D-1B): creates quoteMarkerSelectEl as a child of quoteHeaderEl, with exactly the three closed-set options (\"\", \"+\", \"-\"), a tooltip, and its own 'change' listener wired to updateDirtyState", () => {
    const body = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen()");
    expect(body).toContain('this.quoteMarkerSelectEl = this.quoteHeaderEl.createEl("select"');
    expect(body).toContain('value: "",');
    expect(body).toContain('text: this.plugin.t("partialEdit.quoteFoldMarkerNone"),');
    expect(body).toContain('value: "+",');
    expect(body).toContain('text: this.plugin.t("partialEdit.quoteFoldMarkerExpand"),');
    expect(body).toContain('value: "-",');
    expect(body).toContain('text: this.plugin.t("partialEdit.quoteFoldMarkerCollapse"),');
    expect(body).toContain(
      'setTooltip(this.quoteMarkerSelectEl, this.plugin.t("partialEdit.quoteFoldMarkerLabel"));'
    );
    expect(body).toContain(
      'this.quoteMarkerSelectEl.addEventListener("change", () => this.updateDirtyState());'
    );
  });

  it("onOpen (Phase 5D-1B): quoteMarkerSelectEl is created BEFORE quoteTitleInputEl — the fold-behavior control sits between the read-only label and the title input", () => {
    const body = bodyOf(viewTs, "async onOpen(): Promise<void> {", "onOpen()");
    const selectIndex = body.indexOf('this.quoteMarkerSelectEl = this.quoteHeaderEl.createEl("select"');
    const titleInputIndex = body.indexOf('this.quoteTitleInputEl = this.quoteHeaderEl.createEl("input"');
    expect(selectIndex).toBeGreaterThan(-1);
    expect(titleInputIndex).toBeGreaterThan(-1);
    expect(selectIndex).toBeLessThan(titleInputIndex);
  });

  it("cancelEdit (Phase 5D-1A): reverts the title input back to the loaded titleSlot's own title whenever a titleSlot is active", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit()");
    expect(body).toContain("this.quoteTitleInputEl.value = titleSlot.title;");
  });

  it("cancelEdit (Phase 5D-1B): also reverts the fold-marker select back to the loaded titleSlot's own marker, in the same titleSlot-gated branch as the title revert", () => {
    const body = bodyOf(viewTs, "private cancelEdit(): void {", "cancelEdit()");
    expect(body).toContain("this.quoteMarkerSelectEl.value = titleSlot.marker;");
    const markerRevertIndex = body.indexOf("this.quoteMarkerSelectEl.value = titleSlot.marker;");
    const titleRevertIndex = body.indexOf("this.quoteTitleInputEl.value = titleSlot.title;");
    const ifTitleSlotIndex = body.lastIndexOf("if (titleSlot)", markerRevertIndex);
    expect(ifTitleSlotIndex).toBeGreaterThan(-1);
    expect(ifTitleSlotIndex).toBeLessThan(markerRevertIndex);
    expect(ifTitleSlotIndex).toBeLessThan(titleRevertIndex);
  });

  it("isDirty (Phase 5D-1A): considers the title input dirty too — the pane is dirty if EITHER the textarea OR the title input differs from its own loaded value", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty()");
    expect(body).toContain("this.quoteTitleInputEl.value !== titleSlot.title");
    expect(body).toMatch(/this\.textareaEl\.value !== this\.currentDisplayText\(\)\s*\|\|\s*titleDirty/);
  });

  it("isDirty (Phase 5D-1B): also considers the fold-marker select dirty — markerDirty is computed from quoteMarkerSelectEl vs. titleSlot.marker, gated the same way as titleDirty, and included in the same OR chain", () => {
    const body = bodyOf(viewTs, "private isDirty(): boolean {", "isDirty()");
    expect(body).toContain(
      "const markerDirty = titleSlot !== null && this.quoteMarkerSelectEl.value !== titleSlot.marker;"
    );
    expect(body).toMatch(
      /this\.textareaEl\.value !== this\.currentDisplayText\(\)\s*\|\|\s*titleDirty\s*\|\|\s*markerDirty/
    );
  });

  it("applyEdit (Phase 5D-1B): when titleSlot is active, reconstructs the header from BOTH the fold-marker select's and the title input's CURRENT values via a single reconstructQuoteHeader(titleSlot, newMarker, title) call, refuses (returns false) on failure BEFORE ever calling applySubtreeEdit, and otherwise splices the reconstructed header in as newRawText's first line", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit()");
    const newMarkerCastIndex = body.indexOf(
      "const newMarker = this.quoteMarkerSelectEl.value as CalloutFoldMarker;"
    );
    const reconstructIndex = body.indexOf(
      "reconstructQuoteHeader(titleSlot, newMarker, this.quoteTitleInputEl.value)"
    );
    const noticeIndex = body.indexOf('this.plugin.t("partialEdit.quoteTitleNewlineUnsupported")');
    const applySubtreeEditIndex = body.indexOf(
      "applySubtreeEdit(doc, this.nodeId!, this.originalText, newRawText)"
    );
    expect(newMarkerCastIndex).toBeGreaterThan(-1);
    expect(reconstructIndex).toBeGreaterThan(-1);
    expect(noticeIndex).toBeGreaterThan(-1);
    expect(applySubtreeEditIndex).toBeGreaterThan(-1);
    expect(newMarkerCastIndex).toBeLessThan(reconstructIndex);
    expect(reconstructIndex).toBeLessThan(noticeIndex);
    expect(noticeIndex).toBeLessThan(applySubtreeEditIndex);
    expect(body).toContain("const bodyOnlyLines = newRawText.split(\"\\n\").slice(1);");
    expect(body).toContain("newRawText = [reconstructed.header, ...bodyOnlyLines].join(\"\\n\");");
  });

  it("applyEdit (Phase 5D-1B): a reconstructQuoteHeader failure shows the newline Notice only for reason \"newline\" — the unreachable \"invalid-marker\" reason is a silent, safe no-op with NO new user-facing Notice added for it", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit()");
    const failureStart = body.indexOf("if (!reconstructed.ok) {");
    expect(failureStart).toBeGreaterThan(-1);
    const returnFalseIndex = body.indexOf("return false;", failureStart);
    expect(returnFalseIndex).toBeGreaterThan(-1);
    const failureBlock = body.slice(failureStart, returnFalseIndex + "return false;".length);
    expect(failureBlock).toContain('if (reconstructed.reason === "newline") {');
    // Exactly one Notice call in the whole failure-handling block — the
    // "invalid-marker" reason (structurally unreachable through this
    // view's own closed-set <select>) falls through to the bare
    // `return false;` with no Notice of its own, per the ticket's
    // explicit "既存のNoticeを増やさない" instruction.
    const noticeCallCount = (failureBlock.match(/new Notice\(/g) ?? []).length;
    expect(noticeCallCount).toBe(1);
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

  it("the i18n keys Phase 5D-1B introduces (quoteFoldMarkerLabel / quoteFoldMarkerNone / quoteFoldMarkerExpand / quoteFoldMarkerCollapse) exist with non-empty en/ja text", () => {
    const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
    for (const key of [
      "partialEdit.quoteFoldMarkerLabel",
      "partialEdit.quoteFoldMarkerNone",
      "partialEdit.quoteFoldMarkerExpand",
      "partialEdit.quoteFoldMarkerCollapse",
    ]) {
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
