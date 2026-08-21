import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5T-12A ("Outline Tree rename の cross-note write 防止", implementing
 * docs/phase5t12_rename_note_leaf_switch_safety_design.md §10 案A): static-
 * source-text checks for OutlineTreeView.ts's wiring of the note-identity
 * guard into commitRename()/commitPendingParagraphInsert()/
 * rollbackPendingParagraphInsert() — same constraint as the other
 * *UiWiring/*Teardown test files in this suite (an Obsidian ItemView
 * subclass cannot be constructed in vitest, since "obsidian" is a
 * types-only package here), so this file inspects the raw source text of
 * OutlineTreeView.ts rather than calling into it.
 *
 * The guard predicate itself (evaluateRenameNoteIdentity) is exercised by
 * plain unit tests in tests/renameNoteIdentityGuard.test.ts — this file
 * only pins that the three call sites actually invoke it, in the right
 * order relative to the write/Undo calls it must gate, and that rejection
 * never leaves renameState/UI in a stale state.
 */

const viewTs = readFileSync(
  path.join(__dirname, "..", "src", "view", "OutlineTreeView.ts"),
  "utf8"
);

// Matches tests/paragraphOutlineTreeUiWiring.test.ts's own methodBody()
// convention exactly: "\n  }\n" (WITH the trailing newline) as the
// end-of-method marker. The trailing "\n" is load-bearing — without it, a
// multi-line method signature whose own parameter TYPE is itself a
// `{ ... }` block (e.g. commitPendingParagraphInsert's `insertOrigin: {
// anchor: ...; position: ...; }`) would match its own parameter block's
// closing `  }): void {` line first, since indexOf's `start` argument only
// bounds where the search begins, not where the signature text itself
// ends — the signature string is still fully present at and after `start`.
function extractMethod(signature: string): string {
  const start = viewTs.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const end = viewTs.indexOf("\n  }\n", start);
  expect(end).toBeGreaterThan(start);
  return viewTs.slice(start, end);
}

describe("Phase 5T-12A: note identity guard import", () => {
  it("imports evaluateRenameNoteIdentity from edit/renameNoteIdentityGuard", () => {
    expect(viewTs).toContain(
      'import { evaluateRenameNoteIdentity } from "../edit/renameNoteIdentityGuard";'
    );
  });
});

describe("Phase 5T-12A: commitRename() note identity guard", () => {
  it("checks evaluateRenameNoteIdentity(this.currentFilePath, view.file?.path).allowed and aborts via abortRenameForNoteSwitch() when it fails", () => {
    const body = extractMethod("private commitRename(): void {");
    expect(body).toContain(
      "if (!evaluateRenameNoteIdentity(this.currentFilePath, view.file?.path).allowed) {"
    );
    expect(body).toContain("this.abortRenameForNoteSwitch();");
  });

  it("runs the guard AFTER the existing !view check but BEFORE parseDocument()/applyLineEditOutcome() ever touch this view's editor", () => {
    const body = extractMethod("private commitRename(): void {");
    const noActiveEditorIdx = body.indexOf('this.notify(this.plugin.t("reason.no-active-editor"));');
    const guardIdx = body.indexOf("evaluateRenameNoteIdentity(this.currentFilePath, view.file?.path)");
    const parseDocIdx = body.indexOf("const doc = parseDocument(editor.getValue());");
    const applyIdx = body.indexOf("applyLineEditOutcome(");

    expect(noActiveEditorIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(parseDocIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(-1);

    expect(noActiveEditorIdx).toBeLessThan(guardIdx);
    expect(guardIdx).toBeLessThan(parseDocIdx);
    expect(guardIdx).toBeLessThan(applyIdx);
  });
});

describe("Phase 5T-12A: commitPendingParagraphInsert() note identity guard", () => {
  // The method's own parameter type is itself a multi-line `{ ... }` block
  // (`insertOrigin: { anchor: ...; position: ...; }`), so — matching the
  // established convention already used by
  // tests/paragraphOutlineTreeUiWiring.test.ts's own methodBody() calls for
  // this exact method — the signature passed to extractMethod() must
  // include that whole parameter block verbatim. Passing only the opening
  // line would make extractMethod's own "\n  }" end-of-method search match
  // the parameter block's OWN closing `  }): void {` first, truncating the
  // "body" down to nothing but the signature.
  const COMMIT_PENDING_PARAGRAPH_INSERT_SIGNATURE =
    "private commitPendingParagraphInsert(insertOrigin: {\n" +
    "    anchor: ParagraphMoveAnchor;\n" +
    "    position: ParagraphInsertPosition;\n" +
    "  }): void {";

  it("checks evaluateRenameNoteIdentity(this.currentFilePath, view.file?.path).allowed and aborts via abortRenameForNoteSwitch() when it fails", () => {
    const body = extractMethod(COMMIT_PENDING_PARAGRAPH_INSERT_SIGNATURE);
    expect(body).toContain(
      "if (!evaluateRenameNoteIdentity(this.currentFilePath, view.file?.path).allowed) {"
    );
    expect(body).toContain("this.abortRenameForNoteSwitch();");
  });

  it("runs the guard BEFORE canSafelyRollbackParagraphInsert()/editor.undo() — a note switch must never Undo a different note's history", () => {
    const body = extractMethod(COMMIT_PENDING_PARAGRAPH_INSERT_SIGNATURE);
    const guardIdx = body.indexOf("evaluateRenameNoteIdentity(this.currentFilePath, view.file?.path)");
    const canCollapseIdx = body.indexOf("canSafelyRollbackParagraphInsert(editor.getValue(), placeholderAnchor)");
    const undoIdx = body.indexOf("editor.undo();");

    expect(guardIdx).toBeGreaterThan(-1);
    expect(canCollapseIdx).toBeGreaterThan(-1);
    expect(undoIdx).toBeGreaterThan(-1);

    expect(guardIdx).toBeLessThan(canCollapseIdx);
    expect(guardIdx).toBeLessThan(undoIdx);
  });
});

describe("Phase 5T-12A: rollbackPendingParagraphInsert() note identity guard", () => {
  it("computes identity via evaluateRenameNoteIdentity and folds it into canRollback BEFORE any editor.undo() call", () => {
    const body = extractMethod("private rollbackPendingParagraphInsert(anchor: ParagraphMoveAnchor): void {");
    const identityIdx = body.indexOf(
      "const identity = evaluateRenameNoteIdentity(this.currentFilePath, view?.file?.path);"
    );
    const canRollbackIdx = body.indexOf("const canRollback =");
    const undoIdx = body.indexOf("view.editor.undo();");

    expect(identityIdx).toBeGreaterThan(-1);
    expect(canRollbackIdx).toBeGreaterThan(identityIdx);
    expect(undoIdx).toBeGreaterThan(canRollbackIdx);
    expect(body).toContain("identity.allowed && !!view &&");
  });

  it("notifies reason.note-switched ONLY when identity.reason is specifically 'note-switched' — a bare missing view stays the pre-existing silent no-op", () => {
    const body = extractMethod("private rollbackPendingParagraphInsert(anchor: ParagraphMoveAnchor): void {");
    expect(body).toContain('if (!identity.allowed && identity.reason === "note-switched") {');
    expect(body).toContain('this.notify(this.plugin.t("reason.note-switched"));');
  });

  it("still ends by clearing renameState and choosing refresh()/renderTree() based on canRollback, unchanged from before this phase", () => {
    const body = extractMethod("private rollbackPendingParagraphInsert(anchor: ParagraphMoveAnchor): void {");
    expect(body).toContain('state.rowSelfEl.setAttribute("draggable", "true");');
    expect(body).toContain("this.renameState = null;");
    expect(body).toContain("if (canRollback) {");
    expect(body).toContain("this.refresh();");
    expect(body).toContain("this.renderTree();");
  });
});

describe("Phase 5T-12A: abortRenameForNoteSwitch() shared teardown", () => {
  it("exists, shows exactly the reason.note-switched Notice, and never touches editor/document state", () => {
    const body = extractMethod("private abortRenameForNoteSwitch(): void {");
    expect(body).toContain('this.notify(this.plugin.t("reason.note-switched"));');
    expect(body).toContain('state.rowSelfEl.setAttribute("draggable", "true");');
    expect(body).toContain("this.renameState = null;");
    expect(body).toContain("this.renderTree();");
    expect(body).not.toContain("applyLineEditOutcome");
    expect(body).not.toContain("replaceRange");
    expect(body).not.toContain(".undo()");
    expect(body).not.toContain("parseDocument(");
  });
});

describe("Phase 5T-12A: i18n coverage", () => {
  it("defines reason.note-switched for both en and ja (Record<TranslationKey, string> requires both)", () => {
    const i18nTs = readFileSync(path.join(__dirname, "..", "src", "i18n.ts"), "utf8");
    const occurrences = i18nTs.split('"reason.note-switched"').length - 1;
    expect(occurrences).toBe(2);
  });
});

describe("Phase 5T-12A: unrelated cleanup/logic remains untouched", () => {
  it("commitRename()'s pendingParagraphInsert delegation branch still runs before the guard/view lookup, unaffected by this phase", () => {
    const body = extractMethod("private commitRename(): void {");
    const delegateIdx = body.indexOf("this.commitPendingParagraphInsert(state.insertOrigin);");
    const viewIdx = body.indexOf("const view = this.activeMarkdownView.get();");
    expect(delegateIdx).toBeGreaterThan(-1);
    expect(viewIdx).toBeGreaterThan(-1);
    expect(delegateIdx).toBeLessThan(viewIdx);
  });

  it("cancelRename()'s own pendingParagraphInsert delegation to rollbackPendingParagraphInsert is unmodified", () => {
    const body = extractMethod("private cancelRename(): void {");
    expect(body).toContain(
      "this.rollbackPendingParagraphInsert(this.renameState.snapshot as ParagraphMoveAnchor);"
    );
  });
});
