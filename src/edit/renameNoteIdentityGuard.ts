/**
 * Phase 5T-12A ("Outline Tree rename の cross-note write 防止"): a pure,
 * Obsidian-independent predicate used by view/OutlineTreeView.ts's
 * commitRename() / commitPendingParagraphInsert() /
 * rollbackPendingParagraphInsert() immediately before they would otherwise
 * write to or Undo an editor's document.
 *
 * ---- Why this exists (see docs/phase5t12_rename_note_leaf_switch_safety_design.md) ----
 *
 * `ActiveMarkdownViewTracker` (view/activeMarkdownViewTracker.ts) is a
 * SINGLE instance shared by every OutlineTreeView, and its `.get()` re-reads
 * "whichever Markdown view is currently active" fresh on every call. None of
 * the three commit/rollback methods above pin the Editor/MarkdownView that
 * was active when a rename began — each re-fetches "the current active
 * view" at the moment it is about to write. If the user switches to a
 * different note while a heading/list rename sits uncommitted, and that
 * different note happens to re-resolve against the rename's snapshot
 * (heading/list re-resolution is id + coarse structural fields only — no
 * byte-for-byte content check, see renameBlock.ts), the commit can land in
 * the WRONG note.
 *
 * `OutlineTreeView.currentFilePath` already exists for an unrelated reason
 * (fold-sync, see `syncFoldToBodyEditor`) and is already frozen for the
 * exact duration of a rename: `refresh()` bails out at its very first line
 * whenever `this.renameState` is non-null, so `currentFilePath` keeps
 * whatever value it held immediately before the rename began, no matter how
 * many `active-leaf-change`/`file-open` events fire while the rename box is
 * open. That makes it exactly the "which note did this rename start
 * against" identity this guard needs, with no new persistent field.
 *
 * ---- What this function does NOT do ----
 *
 * It only decides "may a write/Undo proceed against the CURRENTLY active
 * view". It has no opinion on UI cleanup (closing the rename box, restoring
 * `draggable`, re-rendering the Tree) or on Notice text — those remain the
 * caller's job (OutlineTreeView.ts's own abortRenameForNoteSwitch()) so
 * this stays a trivial, dependency-free predicate that a plain unit test
 * can exercise with bare strings, no Obsidian ItemView/Editor/MarkdownView
 * involved at all.
 */

/** Discriminates WHY a write was disallowed, purely for the caller's own
 * Notice/no-Notice decision (see OutlineTreeView.ts's callers): a
 * genuinely missing active view/file is treated as the pre-existing
 * silent "nothing is open to write to" case in Escape/Cancel paths,
 * while "note-switched" is the new, actively user-visible case this
 * phase adds a Notice for. */
export type RenameNoteIdentityDecision =
  | { allowed: true }
  | { allowed: false; reason: "no-current-file" | "no-active-view" | "note-switched" };

/**
 * @param currentFilePath - `OutlineTreeView.currentFilePath` at the moment
 *   of the commit/rollback attempt (frozen since the rename began, per the
 *   `refresh()` early-return described above).
 * @param activeViewFilePath - the vault path of the file backing whichever
 *   MarkdownView `ActiveMarkdownViewTracker.get()` returns right now (i.e.
 *   `view?.file?.path`), or `null`/`undefined` if there is no active view,
 *   or the active view has no backing file.
 */
export function evaluateRenameNoteIdentity(
  currentFilePath: string | null,
  activeViewFilePath: string | null | undefined
): RenameNoteIdentityDecision {
  if (!currentFilePath) return { allowed: false, reason: "no-current-file" };
  if (!activeViewFilePath) return { allowed: false, reason: "no-active-view" };
  if (activeViewFilePath !== currentFilePath) {
    return { allowed: false, reason: "note-switched" };
  }
  return { allowed: true };
}
