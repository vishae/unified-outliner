import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5T-11A (docs/phase5t11_rename_session_teardown_design.md §8 案A,
 * §10 第1段階): static-source-text checks for OutlineTreeView.ts's
 * onClose() rename-session teardown — same constraint as the other
 * *UiWiring test files (an Obsidian ItemView subclass cannot be
 * constructed in vitest, since "obsidian" is a types-only package here),
 * so this file inspects the raw source text of OutlineTreeView.ts rather
 * than calling into it.
 *
 * Scope reminder (ticket §2): this phase ONLY adds
 * `if (this.renameState) this.cancelRename();` as the first statement of
 * onClose(). cancelRename()/rollbackPendingParagraphInsert() themselves
 * are unmodified and already covered by tests/paragraphInlineRename.test.ts
 * and tests/paragraphOutlineTreeUiWiring.test.ts — this file only confirms
 * the new call site and its ordering relative to onClose()'s pre-existing
 * cleanup steps.
 */

const viewTs = readFileSync(
  path.join(__dirname, "..", "src", "view", "OutlineTreeView.ts"),
  "utf8"
);

function extractOnClose(): string {
  const start = viewTs.indexOf("async onClose(): Promise<void> {");
  expect(start).toBeGreaterThan(-1);
  const end = viewTs.indexOf("\n  }", start);
  return viewTs.slice(start, end);
}

describe("Phase 5T-11A: onClose() rename-session teardown", () => {
  it("onClose() calls cancelRename() when a rename is in progress, guarded so it's a no-op when renameState is already null", () => {
    const body = extractOnClose();
    expect(body).toContain("if (this.renameState) this.cancelRename();");
  });

  it("the new cancelRename() call runs BEFORE activeMenu cleanup, paragraphDragSession cleanup, and contentEl.empty() — cancelRename()/rollbackPendingParagraphInsert() end by touching this.treeRootEl via renderTree()/refresh(), which is only safe while the existing DOM is still alive", () => {
    const body = extractOnClose();
    const cancelRenameIdx = body.indexOf("if (this.renameState) this.cancelRename();");
    const activeMenuIdx = body.indexOf("this.activeMenu?.hide();");
    const cancelDragIdx = body.indexOf("this.cancelParagraphDrag();");
    const emptyIdx = body.indexOf("this.contentEl.empty();");

    expect(cancelRenameIdx).toBeGreaterThan(-1);
    expect(activeMenuIdx).toBeGreaterThan(-1);
    expect(cancelDragIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeGreaterThan(-1);

    expect(cancelRenameIdx).toBeLessThan(activeMenuIdx);
    expect(cancelRenameIdx).toBeLessThan(cancelDragIdx);
    expect(cancelRenameIdx).toBeLessThan(emptyIdx);
  });

  it("onClose()'s pre-existing cleanup steps (activeMenu hide+null, cancelParagraphDrag, contentEl.empty, foldStateManager.flush) are all still present and unmodified", () => {
    const body = extractOnClose();
    expect(body).toContain("this.activeMenu?.hide();");
    expect(body).toContain("this.activeMenu = null;");
    expect(body).toContain("this.cancelParagraphDrag();");
    expect(body).toContain("this.contentEl.empty();");
    expect(body).toContain("await this.plugin.foldStateManager.flush();");
  });

  it("onClose() does not introduce any new document-writing call (applyLineEditOutcome/replaceRange/editor.undo/insertParagraph) — the only path to Editor#undo() is via the pre-existing, unmodified rollbackPendingParagraphInsert() reached through cancelRename()", () => {
    const body = extractOnClose();
    expect(body).not.toContain("applyLineEditOutcome");
    expect(body).not.toContain("replaceRange");
    expect(body).not.toContain(".undo()");
    expect(body).not.toContain("insertParagraph(");
  });

  it("cancelRename() and rollbackPendingParagraphInsert() themselves remain unmodified by this phase — both still exist with their pre-5T-11A signatures/guards", () => {
    expect(viewTs).toContain("private cancelRename(): void {");
    expect(viewTs).toContain("private rollbackPendingParagraphInsert(anchor: ParagraphMoveAnchor): void {");
    // The pendingParagraphInsert branch inside cancelRename() must still be
    // the sole route to rollbackPendingParagraphInsert — unchanged from
    // 5T-10A.
    const cancelRenameStart = viewTs.indexOf("private cancelRename(): void {");
    const cancelRenameEnd = viewTs.indexOf("\n  }", cancelRenameStart);
    const cancelRenameBody = viewTs.slice(cancelRenameStart, cancelRenameEnd);
    expect(cancelRenameBody).toContain(
      "this.rollbackPendingParagraphInsert(this.renameState.snapshot as ParagraphMoveAnchor);"
    );
  });
});
