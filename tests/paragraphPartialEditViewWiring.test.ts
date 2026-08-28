import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5P-2: static-source-text checks for the "Edit paragraph at cursor"
 * command's wiring across main.ts and view/PartialEditView.ts.
 *
 * Same constraint as tests/commandTable.test.ts and
 * tests/partialEditPanePlacementUiWiring.test.ts: UnifiedOutlinerPlugin
 * (extends Obsidian's Plugin) and PartialEditView (extends Obsidian's
 * ItemView) cannot be constructed in vitest, since "obsidian" is a
 * types-only package in this repo. So this file inspects the raw source
 * text of both files instead of calling into them.
 *
 * What real, non-Obsidian-dependent logic exists (the resolver and the
 * apply-time safety contract) is unit-tested directly with real assertions
 * in tests/resolveParagraphAtCursor.test.ts and
 * tests/paragraphPartialEdit.test.ts — this file only confirms the UI/
 * command layer actually calls into that logic at the right place, and
 * that Phase 5P-2 did not introduce anything outside its approved scope
 * (Tree-based paragraph selection/D&D, a second modal/flow, etc.).
 */
describe("main.ts + PartialEditView.ts paragraph wiring (static source check, Phase 5P-2)", () => {
  const mainTs = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf-8");
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

  it("registers the edit-paragraph-at-cursor command with an editorCallback wired to openParagraphPartialEditForCursor", () => {
    const specsBody = bodyOf(
      mainTs,
      "private getCommandSpecs(): CommandSpec[] {",
      "getCommandSpecs()"
    );
    expect(specsBody).toContain('id: "edit-paragraph-at-cursor"');
    expect(specsBody).toContain('translationKey: "command.editParagraphAtCursor"');
    expect(specsBody).toContain("this.openParagraphPartialEditForCursor(editor)");
  });

  it("openParagraphPartialEditForCursor resolves via resolveParagraphAtCursor and never opens the pane before that resolution succeeds", () => {
    const body = bodyOf(
      mainTs,
      "private openParagraphPartialEditForCursor(editor: Editor): void {",
      "openParagraphPartialEditForCursor"
    );
    const resolveIndex = body.indexOf("resolveParagraphAtCursor(doc, cursor.line)");
    const activateIndex = body.indexOf("this.activatePartialEditViewForParagraph(");
    expect(resolveIndex).toBeGreaterThan(-1);
    expect(activateIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeLessThan(activateIndex);
    // The failure branch (!resolved.paragraph) must return before ever
    // reaching activatePartialEditViewForParagraph — i.e. the "return"
    // inside the failure guard appears strictly between the resolve call
    // and the activate call.
    const failureGuardIndex = body.indexOf("if (!resolved.paragraph)");
    expect(failureGuardIndex).toBeGreaterThan(resolveIndex);
    expect(failureGuardIndex).toBeLessThan(activateIndex);
  });

  it("imports resolveParagraphAtCursor from the resolver module (not a Tree/Move path)", () => {
    expect(mainTs).toContain(
      'import { resolveParagraphAtCursor } from "./resolver/resolveParagraphAtCursor";'
    );
  });

  it("activatePartialEditViewForParagraph exists, is a fully independent method (does not call activatePartialEditView or a shared extracted helper), and hands off to requestLoadParagraphAtCursor", () => {
    const body = bodyOf(
      mainTs,
      "async activatePartialEditViewForParagraph(",
      "activatePartialEditViewForParagraph"
    );
    expect(body).toContain("requestLoadParagraphAtCursor(cursorLine)");
    // Must not delegate to activatePartialEditView or any shared
    // "openPartialEditLeaf"-style helper — this method owns its own
    // leaf-open/reveal logic so activatePartialEditView's own body (relied
    // on verbatim by tests/partialEditPanePlacementUiWiring.test.ts) stays
    // completely untouched.
    expect(body).not.toContain("this.activatePartialEditView(");
    expect(body).not.toContain("openPartialEditLeaf");
    // Same placement rules as activatePartialEditView (reuse existing leaf,
    // split-placement, popout) are duplicated here, not reimplemented
    // differently.
    expect(body).toContain("hasOutlineTreeLeafInLeftSidebar(");
    expect(body).toContain("requestLoadParagraphAtCursor(cursorLine)");
  });

  it("activatePartialEditView's own body is untouched by the paragraph addition (still ends with requestLoadNode, never mentions paragraph)", () => {
    const body = bodyOf(mainTs, "async activatePartialEditView(", "activatePartialEditView");
    expect(body).toContain("leaf.view.requestLoadNode(nodeId)");
    expect(body.toLowerCase()).not.toContain("paragraph");
  });

  it("PartialEditView exposes requestLoadParagraphAtCursor as a public entry point with the same unsaved-edit guard as requestLoadNode", () => {
    const body = bodyOf(
      viewTs,
      "requestLoadParagraphAtCursor(cursorLine: number): void {",
      "requestLoadParagraphAtCursor"
    );
    expect(body).toContain("DiscardChangesModal");
    expect(body).toContain("this.loadParagraphInternal(cursorLine)");
  });

  it("loadParagraphInternal resolves via resolveParagraphAtCursor and sets nodeKind to \"paragraph\" without ever setting nodeId", () => {
    const body = bodyOf(
      viewTs,
      "private loadParagraphInternal(cursorLine: number): void {",
      "loadParagraphInternal"
    );
    expect(body).toContain("resolveParagraphAtCursor(doc, cursorLine)");
    expect(body).toContain('this.nodeKind = "paragraph"');
    expect(body).toContain("this.nodeId = null");
  });

  it("applyEdit's paragraph branch calls applyParagraphEdit, not applySubtreeEdit, and never mutates the document unless outcome.changed", () => {
    const body = bodyOf(viewTs, "private applyEdit(): boolean {", "applyEdit");
    const paragraphBranchStart = body.indexOf("if (this.paragraphAnchor) {");
    expect(paragraphBranchStart).toBeGreaterThan(-1);
    // Phase 5D-2A inserted a THIRD branch (if (this.compositeAnchor) {...})
    // between the paragraph branch and the node branch's own
    // `applySubtreeEdit` call — bounding on that call directly would now
    // swallow the whole composite branch into this slice (its own doc
    // comment mentions "applySubtreeEdit" in prose, which would then
    // spuriously fail the `not.toContain` assertion below even though the
    // executable paragraph-branch code itself never changed). Bounding on
    // the compositeAnchor branch's own start instead isolates exactly the
    // paragraph branch's own code, exactly like before Phase 5D-2A.
    const paragraphBranchEnd = body.indexOf("if (this.compositeAnchor) {", paragraphBranchStart);
    expect(paragraphBranchEnd).toBeGreaterThan(paragraphBranchStart);
    const paragraphBranch = body.slice(paragraphBranchStart, paragraphBranchEnd);
    expect(paragraphBranch).toContain("applyParagraphEdit(doc, this.paragraphAnchor");
    expect(paragraphBranch).toContain("if (!outcome.changed)");
    expect(paragraphBranch).not.toContain("applySubtreeEdit");
  });

  it("does not introduce any Tree-based paragraph selection, drag-and-drop, or always-on node handling in main.ts/PartialEditView.ts", () => {
    // Phase 5P-2 explicitly forbids Tree paragraph nodes / D&D / rename /
    // delete / insert for paragraph. Nothing in either touched file should
    // reference a drag-and-drop paragraph affordance or a BlockNode-style
    // paragraph tree node.
    expect(mainTs).not.toContain("paragraph-node");
    expect(mainTs).not.toContain("draggableParagraph");
    expect(viewTs).not.toContain("paragraph-node");
    expect(viewTs).not.toContain("draggableParagraph");
  });
});
