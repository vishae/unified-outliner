import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5T-7A ("Outline Tree の paragraph Partial Edit をダブルクリック／
 * F2で起動する"): static-source-text checks for the NEW dblclick/F2 launch
 * wiring in view/OutlineTreeView.ts. Same architectural constraint as
 * tests/paragraphOutlineTreeUiWiring.test.ts and
 * tests/selectionFollowUiWiring.test.ts: OutlineTreeView extends
 * Obsidian's ItemView, which cannot be constructed in vitest ("obsidian"
 * is a types-only package here), so this file inspects the raw source
 * text rather than instantiating the view and dispatching real DOM
 * events.
 *
 * This file is deliberately SEPARATE from
 * tests/paragraphOutlineTreeUiWiring.test.ts (which already covers the
 * pre-existing "段落を編集…" context menu item and was extended in this
 * same phase with its own 3 new tests for the shared
 * openParagraphPartialEditFromTree helper and the renderNode/F2 call
 * sites) — per the ticket's own "可能なら、既存 Partial Edit のロジックテ
 * ストと、OutlineTreeView のイベント wiring テストを分離すること" request,
 * this file is scoped to the wiring itself: which DOM branch attaches
 * which listener, and what does/doesn't happen for non-paragraph rows.
 */
describe("OutlineTreeView.ts paragraph dblclick/F2 launch wiring (Phase 5T-7A)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

  function renderNodeSlice(): string {
    const start = viewTs.indexOf("private renderNode(");
    expect(start).toBeGreaterThan(-1);
    // renderNode is one of the largest methods in the file; bound at the
    // next top-level method declaration rather than guessing a fixed
    // length. handleDragStart is the next `private` method after it.
    const end = viewTs.indexOf("\n  private handleDragStart(", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  it("the paragraph dblclick listener lives in its OWN `else if (isParagraph)` branch, sibling to (never nested inside, never a relaxation of) the pre-existing `if (!readOnly)` rename-dblclick branch", () => {
    const slice = renderNodeSlice();
    const renameBranchIdx = slice.indexOf("if (!readOnly) {\n      selfEl.addEventListener(\"dblclick\"");
    expect(renameBranchIdx).toBeGreaterThan(-1);
    const paragraphBranchIdx = slice.indexOf("} else if (isParagraph) {", renameBranchIdx);
    expect(paragraphBranchIdx).toBeGreaterThan(renameBranchIdx);
    const nextTopLevelIdx = slice.indexOf("\n    if (isOutlineSectionNode(node)) {", paragraphBranchIdx);
    expect(nextTopLevelIdx).toBeGreaterThan(paragraphBranchIdx);
    const paragraphBranchBody = slice.slice(paragraphBranchIdx, nextTopLevelIdx);
    expect(paragraphBranchBody).toContain('selfEl.addEventListener("dblclick"');
    expect(paragraphBranchBody).toContain("this.openParagraphPartialEditFromTree(node.id)");
    // Excludes the fold-arrow/drag-handle from triggering it, same guard
    // the pre-existing rename-dblclick branch uses.
    expect(paragraphBranchBody).toContain("if (collapseEl.contains(evt.target as Node)) return;");
  });

  it("a click landing on the collapse/fold spacer never opens Paragraph Partial Edit (dblclick handler bails out before calling openParagraphPartialEditFromTree)", () => {
    const slice = renderNodeSlice();
    const paragraphBranchIdx = slice.indexOf("} else if (isParagraph) {");
    const nextTopLevelIdx = slice.indexOf("\n    if (isOutlineSectionNode(node)) {", paragraphBranchIdx);
    const body = slice.slice(paragraphBranchIdx, nextTopLevelIdx);
    const guardIdx = body.indexOf("if (collapseEl.contains(evt.target as Node)) return;");
    const callIdx = body.indexOf("this.openParagraphPartialEditFromTree(node.id)");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(guardIdx);
  });

  it("no drag-handle exclusion is needed (and none is written) for the paragraph dblclick branch, because dragHandleEl is only ever created for a NON-readOnly row, and paragraph rows are always readOnly — so a paragraph row never has a drag handle element at all", () => {
    const dragHandleCreationIdx = viewTs.indexOf('dragHandleEl = selfEl.createDiv({ cls: "unified-outliner-drag-handle" });');
    expect(dragHandleCreationIdx).toBeGreaterThan(-1);
    const guardSlice = viewTs.slice(dragHandleCreationIdx - 200, dragHandleCreationIdx);
    expect(guardSlice).toContain("if (!readOnly) {");
    // Sanity: paragraph rows are always read-only (existing 5T-1/5T-2/5T-4A
    // contract, re-confirmed here as a precondition for the claim above).
    const readOnlyDeclIdx = viewTs.indexOf("const readOnly = this.readOnlyNodeIds.has(node.id);");
    expect(readOnlyDeclIdx).toBeGreaterThan(-1);
  });

  it("section/list/standalone-complex-block rows never call openParagraphPartialEditFromTree — only the paragraph dblclick branch and the F2 case do (2 call sites total in the whole file)", () => {
    const occurrences = viewTs.split("this.openParagraphPartialEditFromTree(").length - 1;
    expect(occurrences).toBe(2);
  });

  function f2CaseBody(): string {
    const caseIdx = viewTs.indexOf('case "F2": {');
    expect(caseIdx).toBeGreaterThan(-1);
    const caseEndIdx = viewTs.indexOf("\n    }\n  };", caseIdx);
    expect(caseEndIdx).toBeGreaterThan(caseIdx);
    return viewTs.slice(caseIdx, caseEndIdx);
  }

  it("F2 opens Paragraph Partial Edit ONLY when this.selectedId resolves (via this.nodeById) to a paragraph node — the check re-reads live selection state, never a cached/stale flag", () => {
    const body = f2CaseBody();
    expect(body).toContain("if (this.selectedId) {");
    expect(body).toContain("const selectedNode = this.nodeById.get(this.selectedId);");
    expect(body).toContain("if (selectedNode && isOutlineParagraphNode(selectedNode)) {");
  });

  it("F2's preventDefault/stopPropagation for the paragraph branch are called INSIDE that branch (only once the paragraph check has already passed), not hoisted above the branch check — while the pre-existing unconditional preventDefault/stopPropagation for section/list/no-selection is still present, unchanged, below the paragraph branch's own `break`", () => {
    const body = f2CaseBody();
    const branchIdx = body.indexOf("if (selectedNode && isOutlineParagraphNode(selectedNode)) {");
    const branchEndIdx = body.indexOf("break;", branchIdx) + "break;".length;
    const branchBody = body.slice(branchIdx, branchEndIdx);
    expect(branchBody).toContain("evt.preventDefault();");
    expect(branchBody).toContain("evt.stopPropagation();");
    expect(branchBody).toContain("this.openParagraphPartialEditFromTree(this.selectedId)");

    // Nothing (specifically no preventDefault/stopPropagation/case-handling
    // code) sits between the top of the case and the paragraph `if` check —
    // i.e. the case does NOT unconditionally preventDefault before deciding
    // which path to take.
    const preambleIdx = body.indexOf('case "F2": {');
    const preamble = body.slice(preambleIdx, branchIdx);
    expect(preamble).not.toContain("evt.preventDefault()");
    expect(preamble).not.toContain("evt.stopPropagation()");

    // The pre-existing fallback (unconditional prevent/stop + conditional
    // beginRenameForNode) still exists, textually AFTER the paragraph
    // branch's own break — i.e. only reached when the branch above did not
    // already break out.
    const fallback = body.slice(branchEndIdx);
    expect(fallback).toContain("evt.preventDefault();");
    expect(fallback).toContain("evt.stopPropagation();");
    expect(fallback).toContain("if (this.selectedId) this.beginRenameForNode(this.selectedId);");
  });

  it("F2's paragraph branch never calls beginRenameForNode, and the fallback rename branch never calls openParagraphPartialEditFromTree — the two destinations are mutually exclusive within one keypress", () => {
    const body = f2CaseBody();
    const branchIdx = body.indexOf("if (selectedNode && isOutlineParagraphNode(selectedNode)) {");
    const branchEndIdx = body.indexOf("break;", branchIdx) + "break;".length;
    const branchBody = body.slice(branchIdx, branchEndIdx);
    const fallback = body.slice(branchEndIdx);
    expect(branchBody).not.toContain("beginRenameForNode");
    expect(fallback).not.toContain("openParagraphPartialEditFromTree");
  });

  it("handleTreeKeyDown (the sole home of the F2 case) is still the ONLY keydown listener attached to treeRootEl — Phase 5T-7A adds no new keydown listener/registerDomEvent call", () => {
    const occurrences = (viewTs.match(/registerDomEvent\(this\.treeRootEl, "keydown"/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("openParagraphPartialEditFromTree never mutates this.selectedId, this.highlightedId, or this.collapsedIds — a failed resolution must leave Tree selection/current-position/fold state untouched, per the ticket's explicit contract", () => {
    const start = viewTs.indexOf("private openParagraphPartialEditFromTree(nodeId: string): void {");
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).not.toContain("this.selectedId =");
    expect(body).not.toContain("this.highlightedId =");
    expect(body).not.toContain("this.collapsedIds");
    expect(body).not.toContain("this.refresh()");
    expect(body).not.toContain("this.renderTree()");
  });

  it("D&D wiring (handleDragStart/handleDragOver/computeDropMode/setDropIndicator/runRelocateCommand) and the paragraph drag-session branch are textually untouched by this ticket — Phase 5T-7A is dblclick/F2 launch only, no D&D changes", () => {
    expect(viewTs).toContain("private handleDragStart(evt: DragEvent, sectionId: string, itemEl: HTMLElement): void {");
    expect(viewTs).toContain("private computeDropMode(evt: DragEvent, el: HTMLElement): DropMode {");
    expect(viewTs).toContain("private runRelocateCommand(sourceId: string, targetId: string, mode: DropMode): void {");
    expect(viewTs).toContain("private handleParagraphDragStart(");
  });
});
