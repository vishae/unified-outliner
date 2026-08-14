/**
 * Phase 5C-4 (2026-08-14, "Standalone Callout / Blockquote の Partial Edit
 * Popout 完成と元ノート同一性の安全化"): a small, Obsidian-free, pure
 * comparison used by view/PartialEditView.ts's Apply path as an ADDITIONAL
 * safety valve — never a replacement for edit/partialEdit.ts's own
 * content-based conflict detection (applySubtreeEdit's own
 * `current.text !== originalText` compare, left completely unchanged by
 * this ticket).
 *
 * Why this exists: PartialEditView resolves "the note to read/write
 * against" via `this.activeMarkdownView.get()` at BOTH load time and Apply
 * time — it has never tracked which file it was actually loaded from. With
 * Phase 5A's pre-existing popout support (`activatePartialEditView`'s
 * `openInNewWindow` option — unchanged, reused as-is by this ticket), the
 * Partial Edit Pane and the note's own editor can now be visible and
 * separately interactable in two different OS windows at once, which makes
 * "switch the active note in the OTHER window while this pane stays open,
 * then click Apply" a materially easier mistake to make than it was while
 * the pane was always docked alongside the note it was editing. The
 * existing content-based conflict check alone cannot distinguish "the same
 * note changed" from "a completely different note happens to still resolve
 * this node id with byte-identical text" (astronomically unlikely, but not
 * provably impossible) — this path-based check closes that gap explicitly,
 * independent of and layered on top of the content check, per this
 * ticket's own approved scope ("path一致はcontent conflict検知の代替では
 * ない").
 *
 * Deliberately NOT folded into extractSubtreeText/applySubtreeEdit
 * (edit/partialEdit.ts) — per this ticket's approval, those two functions'
 * signatures are not touched for this. Responsibility split (per the
 * ticket's own fixed design):
 *   - View layer (PartialEditView.ts): records `sourcePath` at load time
 *     (`view.file?.path ?? null`) and calls this pure function at Apply
 *     time with the freshly re-resolved current path.
 *   - Model layer (edit/partialEdit.ts): entirely unaware of this concept;
 *     its own conflict detection is untouched.
 *
 * Both a stored `loadedPath` and a fresh `currentPath` are required to be
 * non-null, non-empty strings for the result to be "ok" — either one being
 * null (no active note, or a MarkdownView with `file === null`, e.g. a
 * pane that somehow was never warmed up) fails safe as "unknown" rather
 * than silently treating a missing path as "no note switch happened".
 */
export type PartialEditSourceNoteCheckResult = "ok" | "changed" | "unknown";

export function checkPartialEditSourceNote(
  loadedPath: string | null,
  currentPath: string | null
): PartialEditSourceNoteCheckResult {
  if (!loadedPath || !currentPath) return "unknown";
  return loadedPath === currentPath ? "ok" : "changed";
}
