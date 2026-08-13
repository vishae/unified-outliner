/**
 * Phase 5C-1 ticket 3b: confirmation modal shown before deleting a
 * CompositeBlock from the Outline Tree. Mirrors
 * view/PartialEditView.ts's private DiscardChangesModal pattern exactly —
 * a `resolved` flag, `onChoice` firing exactly once whether from an
 * explicit button click (choose()) or an implicit dismiss (onClose(),
 * Escape/backdrop click), and the implicit-dismiss case always resolving
 * to the SAFE choice (here: "not confirmed", matching DiscardChangesModal's
 * "cancel").
 *
 * Deliberately shows only a minimal summary — never the composite's full
 * Markdown text (see this ticket's completion report §6 for why): the
 * block's own short display label (the same string already shown in the
 * Outline Tree row, e.g. "Image + OCR"), its member count, and its 1-based
 * line range. This is display-only information for the user's own
 * judgment; it plays no role in whether the deletion is actually safe —
 * that is decided entirely by edit/deleteCompositeBlock.ts's own re-parse/
 * re-scan/re-match/re-verify pipeline at the moment "Delete" is clicked
 * (see OutlineTreeView.ts#dispatchAndApplyCompositeDelete), never by
 * anything this modal displays or captures.
 *
 * No `.focus()` call is made on either button — see this ticket's
 * completion report for why: Obsidian's Modal API gives no documented
 * guarantee about which element (if any) receives initial keyboard focus,
 * and this modal intentionally does not assume Enter is safe to leave
 * unbound to "Delete". A future ticket may add an explicit safe default
 * (e.g. focusing "Cancel") after a real desktop check confirms what
 * Obsidian does by default.
 */
import { App, Modal } from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import { CompositeBlockSnapshot } from "../edit/deleteCompositeBlock";

export class ConfirmCompositeDeleteModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly plugin: UnifiedOutlinerPlugin,
    private readonly label: string,
    private readonly snapshot: CompositeBlockSnapshot,
    private readonly onChoice: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.plugin.t("modal.deleteCompositeBlockTitle"));

    // 1-based, human-facing line numbers — snapshot.range itself is the
    // existing 0-based ParsedDocument/LineRange convention used everywhere
    // else in this codebase (see model/block.ts's LineRange doc comment);
    // this is display-only, never fed back into any pure function.
    this.contentEl.createEl("p", {
      text: this.plugin.t("modal.deleteCompositeBlockBody", {
        label: this.label,
        memberCount: this.snapshot.members.length,
        startLine: this.snapshot.range.startLine + 1,
        endLine: this.snapshot.range.endLine + 1,
      }),
    });
    this.contentEl.createEl("p", {
      text: this.plugin.t("modal.deleteCompositeBlockUndoNote"),
      cls: "unified-outliner-composite-delete-modal-undo-note",
    });

    const buttonsEl = this.contentEl.createDiv({
      cls: "unified-outliner-composite-delete-modal-buttons",
    });
    // Cancel listed first (the safe default) and intentionally NOT
    // `.focus()`ed — see this class's own doc comment.
    const cancelEl = buttonsEl.createEl("button", { text: this.plugin.t("common.cancel") });
    cancelEl.addEventListener("click", () => this.choose(false));
    const deleteEl = buttonsEl.createEl("button", {
      text: this.plugin.t("common.delete"),
      cls: "mod-warning",
    });
    deleteEl.addEventListener("click", () => this.choose(true));
  }

  private choose(confirmed: boolean): void {
    this.resolved = true;
    this.close();
    this.onChoice(confirmed);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onChoice(false);
    }
  }
}
