/**
 * Phase 5T-9A ticket §4/§8: confirmation modal shown before deleting a
 * top-level or section-direct paragraph from the Outline Tree. Deliberately
 * mirrors view/ConfirmCompositeDeleteModal.ts byte-for-byte in structure —
 * per the ticket's own explicit instruction ("CompositeBlock delete パター
 * ンを踏襲する") — down to the `resolved` flag, `onChoice` firing exactly
 * once whether from an explicit button click (choose()) or an implicit
 * dismiss (onClose(), Escape/backdrop click), and the implicit-dismiss case
 * always resolving to the SAFE choice ("not confirmed").
 *
 * Deliberately shows only a minimal summary — the paragraph's own short
 * Tree-row label (tree/buildOutlineTree.ts's OutlineTreeParagraphNode#label,
 * the same truncated preview already shown in the Tree row) and its 1-based
 * line range — never the full paragraph text. Exactly like
 * ConfirmCompositeDeleteModal's own doc comment explains: this is
 * display-only information for the user's own judgment; it plays no role in
 * whether the deletion is actually safe — that is decided entirely by
 * edit/deleteParagraph.ts's own re-parse/re-scan/re-resolve/re-verify
 * pipeline at the moment "Delete" is clicked (see
 * view/OutlineTreeView.ts#dispatchAndApplyParagraphDelete).
 *
 * No `.focus()` call is made on either button, for the exact same reason
 * ConfirmCompositeDeleteModal's own doc comment gives: Obsidian's Modal API
 * gives no documented guarantee about which element (if any) receives
 * initial keyboard focus, so Enter is intentionally left unbound to
 * "Delete".
 */
import { App, Modal } from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import { ParagraphMoveAnchor } from "../edit/paragraphTreeMove";

export class ConfirmParagraphDeleteModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly plugin: UnifiedOutlinerPlugin,
    private readonly label: string,
    private readonly anchor: ParagraphMoveAnchor,
    private readonly onChoice: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.plugin.t("modal.deleteParagraphTitle"));

    // 1-based, human-facing line numbers — anchor.rangeStart/rangeEnd
    // themselves are the existing 0-based ParsedDocument convention used
    // everywhere else in this codebase; this is display-only, never fed
    // back into deleteParagraph.
    this.contentEl.createEl("p", {
      text: this.plugin.t("modal.deleteParagraphBody", {
        label: this.label,
        startLine: this.anchor.rangeStart + 1,
        endLine: this.anchor.rangeEnd + 1,
      }),
    });
    this.contentEl.createEl("p", {
      text: this.plugin.t("modal.deleteParagraphUndoNote"),
      cls: "unified-outliner-paragraph-delete-modal-undo-note",
    });

    const buttonsEl = this.contentEl.createDiv({
      cls: "unified-outliner-paragraph-delete-modal-buttons",
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
