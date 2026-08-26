/**
 * Phase 3B: Partial Edit Pane (docs/別ペイン実装計画と当面の実装指示.md, forward-looking
 * §7 in spirit — this view is new territory beyond what that doc's earlier
 * phases covered).
 *
 * A focused editing pane for exactly ONE subtree at a time, opened from
 * the Outline Tree View's right-click menu. This is NOT an alternate
 * full-document editor: the original note is always the single source of
 * truth, and this pane only ever holds a temporary, explicitly-applied
 * copy of one subtree's raw Markdown (heading + body + child sections +
 * lists for a section, per section-subtree; item + nested children for a list, per
 * Phase 4A's relocateListSubtree — the exact same range every other
 * block-scoped command already treats as one unit).
 *
 * Deliberately explicit-save, not live-synced: edits made here stay local
 * to the pane's textarea until the user clicks Apply. There is no
 * autosave and no real-time two-way sync with the body editor — see the
 * README's Phase 3B section for the full list of what this phase
 * intentionally does not attempt (multi-node editing, cross-note editing,
 * diff/merge UI, conflict resolution beyond a simple before/after text
 * comparison).
 *
 * Node resolution and the actual text splice are both delegated to
 * ../edit/partialEdit.ts (Obsidian-free, unit-tested) — this view only
 * wires that pure logic to a textarea and to the active note's Editor via
 * ../commands/applyLineEditOutcome.ts, exactly like every other
 * tree-triggered command in this plugin.
 *
 * Phase 4C (list subtrees): originally section-only, this view now loads
 * either kind via the same loadNode()/applyEdit() path — the generalized
 * extractSubtreeText/applySubtreeEdit (edit/partialEdit.ts) don't care
 * which kind of node they're resolving, so nothing here branches on
 * section vs. list except the header label (renderLoadedState below) and
 * the small "(Empty list item)" vs "(Untitled heading)" placeholder text used
 * when a node's own label is empty. Everything else — the textarea, the
 * Apply/Cancel/Close buttons, the conflict check, the unsafeIndent
 * refusal for list nodes — is one shared code path.
 *
 * Real-device follow-up: the header's Apply/Cancel row also has a one-click
 * × (close) button, `this.leaf.detach()` under the hood — before this,
 * closing the pane required Obsidian's own tab-close affordances (the
 * tab's native × or the right-click "Close tab" menu item), a two-step
 * detour compared to every other button on this pane's own header. Closing
 * this way still never applies pending edits, exactly like Cancel and the
 * pre-existing onClose() already didn't.
 *
 * Further real-device follow-up: Apply/Cancel/Close are now each shown
 * conditionally rather than unconditionally whenever a node is loaded —
 * see updateDirtyState (Apply/Cancel only appear once the textarea
 * actually differs from the loaded snapshot) and updateCloseButtonVisibility
 * (this pane's own × only appears where Obsidian doesn't already draw a
 * native tab ×, i.e. while docked directly in the left/right sidebar —
 * see that method's doc comment for the sidebar-vs-tab/popout distinction).
 *
 * Phase 5B (docs/phase5-implementation-plan.md): adds an ancestor
 * breadcrumb below the header row, so the pane (including a popped-out
 * window with no Outline Tree in sight) still shows where the loaded node
 * sits in the document. The node-loading entry point is now split in two:
 * loadNodeInternal (private, unconditional — the old loadNode, renamed)
 * and requestLoadNode (public, the ONLY sanctioned external entry point),
 * which guards loadNodeInternal behind an Apply/Discard/Cancel prompt
 * whenever the pane has an unapplied edit. Every caller that used to reach
 * this pane's loadNode directly — main.ts's activatePartialEditView, and
 * now this file's own breadcrumb segment clicks — goes through
 * requestLoadNode instead, so "switch node" always means the same thing
 * regardless of which UI triggered it. See requestLoadNode's own doc
 * comment for the full rationale.
 *
 * Subtree Navigator (post-Phase-5B follow-up): the downward counterpart to
 * the ancestor breadcrumb above. A third header row (renderSubtreeNavigator)
 * shows the loaded node's own direct children (tree/descendantPath.ts) as
 * clickable chips, so a user can descend into a subtree one level at a
 * time from inside the pane — including a popped-out window with no
 * Outline Tree visible — the same way the breadcrumb lets them climb back
 * up. Every chip (and its overflow Menu, when there are more children than
 * fit inline) calls requestLoadNode, never loadNodeInternal directly, so
 * descending shares the exact same dirty-guard/Apply-Discard-Cancel
 * behavior as breadcrumb and Tree navigation — see requestLoadNode's doc
 * comment, unchanged by this addition.
 *
 * Sibling前後移動 (docs/phase5b_sibling-navigation-spec.md): the sideways
 * counterpart to both of the above. A fourth header row (renderSiblingNav),
 * between the breadcrumb and the Subtree Navigator, holds two buttons —
 * previous/next sibling of the loaded node, resolved by
 * tree/siblingNavigation.ts directly from the node's existing
 * `prevSiblingId`/`nextSiblingId` (no new sibling-order computation). Both
 * buttons call requestLoadNode exactly like every other navigation control
 * on this pane — no new projection path, no new dirty guard. Unlike the
 * breadcrumb and Subtree Navigator (hidden entirely when empty), this row
 * stays visible whenever a node is loaded and disables whichever button has
 * no target, per the spec's §3 UI 仕様.
 *
 * Phase 5C-4 (2026-08-14, "Standalone Callout / Blockquote の Partial Edit
 * Popout 完成と元ノート同一性の安全化"): adds an "Open in new window" menu
 * item for standalone (non-composite-member) callout/blockquote rows (see
 * view/OutlineTreeView.ts's showStandaloneComplexBlockMenu) — reusing this
 * pane's pre-existing, unchanged Phase 5A popout support
 * (activatePartialEditView's `openInNewWindow` option) rather than adding
 * any new window-management code here. This ticket also adds `sourcePath`
 * — the file path of the note this pane's currently-loaded node was
 * actually read from, recorded once per loadNodeInternal call — as an
 * ADDITIONAL, path-based safety valve checked by applyEdit before its
 * existing content-based conflict check, never a replacement for it. See
 * view/partialEditSourceNoteCheck.ts's own doc comment for the full
 * rationale (popout makes "switch notes in the other window, then Apply"
 * an easier mistake to make than it was while the pane was always docked).
 *
 * Phase 5P-2 (2026-08-17, paragraph Partial Edit hoist): adds a SECOND,
 * parallel "what is loaded" identity — `paragraphAnchor` — alongside the
 * existing `nodeId`/`nodeKind` pair above, rather than folding a paragraph
 * into the nodeId-based model. A paragraph has no BlockNode/ComplexBlockInfo
 * id known in advance (the only entry point is a body-editor cursor line —
 * resolver/resolveParagraphAtCursor.ts) and its Apply-time safety contract
 * needs extra parentId/depth re-verification callout/blockquote's existing
 * id-only path has no equivalent for (see edit/paragraphPartialEdit.ts's own
 * doc comment) — reusing extractSubtreeText/applySubtreeEdit's contract
 * as-is would silently drop that extra check. Exactly one of `nodeId` /
 * `paragraphAnchor` is ever non-null at a time (both loadNodeInternal and
 * loadParagraphInternal below clear the other). A loaded paragraph
 * deliberately shows none of the breadcrumb / sibling-nav / Subtree
 * Navigator rows — `ancestors`/`directChildren`/`siblingState` all stay at
 * their empty-state values (mirroring the existing standalone
 * callout/blockquote path, which also leaves them empty), and
 * renderSiblingNav's own visibility check already hinges on `nodeId`
 * specifically (null for a loaded paragraph), so it stays hidden with no
 * further change needed. This is intentional, approved 5P-2 scope — no
 * Tree-based paragraph selection, no always-on Tree display, no paragraph
 * D&D/rename/insert/delete; see resolver/resolveParagraphAtCursor.ts's own
 * doc comment for the full non-goal list.
 */
import { App, ItemView, Menu, Modal, Notice, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import { parseDocument } from "../parser/parseDocument";
import { applySubtreeEdit, extractSubtreeText, SubtreeKind } from "../edit/partialEdit";
import { nodeDisplayLabel, standaloneComplexBlockLabel } from "../tree/buildOutlineTree";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { AncestorPathEntry, findAncestorPath } from "../tree/ancestorPath";
import { DescendantNavigationEntry, findDirectChildren } from "../tree/descendantPath";
import { SiblingNavigationState, getSiblingNavigationState } from "../tree/siblingNavigation";
import { applyLineEditOutcome } from "../commands/applyLineEditOutcome";
import { checkPartialEditSourceNote } from "./partialEditSourceNoteCheck";
import { TranslationKey } from "../i18n";
import { resolveParagraphAtCursor } from "../resolver/resolveParagraphAtCursor";
import {
  applyParagraphEdit,
  buildParagraphEditAnchor,
  ParagraphEditAnchor,
} from "../edit/paragraphPartialEdit";
import {
  buildQuotePrefixProjection,
  invertQuotePrefixProjection,
  projectedDisplayText,
  QuotePrefixProjection,
} from "../edit/quotePrefixProjection";

export const PARTIAL_EDIT_VIEW_TYPE = "unified-outliner-partial-edit";

export class PartialEditView extends ItemView {
  // Shared with OutlineTreeView via plugin.activeMarkdownView, not a local
  // instance. A freshly constructed tracker has no cached view yet, and by
  // the time loadSection() below would call .get(), main.ts's
  // activatePartialEditView has already revealed this pane's own leaf —
  // which shifts workspace.getActiveViewOfType(MarkdownView) to null. The
  // shared, plugin-owned tracker is already warmed up by then (either by
  // OutlineTreeView's continuous refresh cycle, or by
  // activatePartialEditView's own explicit warm-up call), so it still
  // resolves correctly. See the doc comment on the field in main.ts.
  private get activeMarkdownView() {
    return this.plugin.activeMarkdownView;
  }

  private nodeId: string | null = null;
  private nodeKind: SubtreeKind | "paragraph" | null = null;
  /**
   * Phase 5P-2: set instead of (never alongside) `nodeId` when the pane is
   * currently showing a paragraph loaded via requestLoadParagraphAtCursor —
   * see this class's own doc comment for why this is a separate field
   * rather than an extension of nodeId's own contract.
   */
  private paragraphAnchor: ParagraphEditAnchor | null = null;
  private label = "";
  /** The pane's "before editing" snapshot — see edit/partialEdit.ts's applySubtreeEdit doc comment. */
  private originalText = "";
  /**
   * Phase 5D-0.5: set (never for a paragraph/section/list, and never for a
   * callout/blockquote that failed to project — see loadNodeInternal) when
   * the loaded node is a callout/blockquote whose body is currently shown
   * PREFIX-STRIPPED in the textarea. `originalText` above ALWAYS stays the
   * raw, `>`-prefixed snapshot regardless of this field — see
   * currentDisplayText's doc comment for the one place the two are
   * reconciled. null means "show `originalText` verbatim" (every non-quote
   * kind, a quote block with no body to project, and a fresh empty pane).
   */
  private quoteProjection: QuotePrefixProjection | null = null;
  /**
   * Phase 5C-4: the file path of the note `nodeId` was actually loaded
   * from, recorded once per loadNodeInternal call (never recomputed
   * mid-edit, same "static until the next load" policy as `ancestors`/
   * `directChildren`/`siblingState` below). `null` only before any node has
   * ever been loaded, or if the resolved MarkdownView had no file (see
   * loadNodeInternal). Read by applyEdit as the ADDITIONAL, path-based
   * safety check — see view/partialEditSourceNoteCheck.ts.
   */
  private sourcePath: string | null = null;
  /** Phase 5B: root-first ancestors of the currently loaded node, computed once at load time — see renderBreadcrumb's doc comment for why this is never recomputed mid-edit. */
  private ancestors: AncestorPathEntry[] = [];
  /** Subtree Navigator: the loaded node's own direct children, computed once at load time alongside `ancestors` — see renderSubtreeNavigator's doc comment. */
  private directChildren: DescendantNavigationEntry[] = [];
  /** Sibling前後移動: the loaded node's previous/next sibling, computed once at load time alongside `ancestors`/`directChildren` — see renderSiblingNav's doc comment. */
  private siblingState: SiblingNavigationState = { previous: null, next: null };

  /**
   * Phase 5B: how many of the nearest ancestors the breadcrumb shows
   * before collapsing the rest into a leading "…" segment (tooltip-only).
   * A single named constant per the implementation instruction's "マジック
   * ナンバーで散在させない" requirement — every place that needs this number
   * reads it from here.
   */
  private static readonly BREADCRUMB_VISIBLE_ANCESTORS = 3;

  /**
   * Subtree Navigator: how many direct children are shown inline as chips
   * before the rest collapse into a single "More…" chip that opens an
   * Obsidian Menu. Deliberately larger than BREADCRUMB_VISIBLE_ANCESTORS —
   * ancestor chains are usually shallow, but a node can easily have many
   * more direct children than it has ancestors, and the Menu fallback only
   * exists for that long tail.
   */
  private static readonly SUBTREE_VISIBLE_CHILDREN = 5;

  private titleEl!: HTMLElement;
  private breadcrumbEl!: HTMLElement;
  private siblingNavEl!: HTMLElement;
  private siblingPrevEl!: HTMLButtonElement;
  private siblingPrevTargetEl!: HTMLElement;
  private siblingNextEl!: HTMLButtonElement;
  private siblingNextTargetEl!: HTMLElement;
  private subtreeNavEl!: HTMLElement;
  /** Phase 5D-0.5: read-only display of a projecting callout's own header line (`> [!type]+ title`), shown ABOVE the textarea — see renderQuoteHeader's doc comment. Stays hidden for every other case (blockquote has no header; a raw-loaded node has nothing to separate out). */
  private quoteHeaderEl!: HTMLElement;
  private textareaEl!: HTMLTextAreaElement;
  private applyButtonEl!: HTMLButtonElement;
  private cancelButtonEl!: HTMLButtonElement;
  private closeButtonEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: UnifiedOutlinerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return PARTIAL_EDIT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.t("partialEdit.viewName");
  }

  getIcon(): string {
    return "edit-3";
  }

  /**
   * Real-device report, two rounds: (1) force-closing this pane after
   * Obsidian's startup layout restore (via workspace.onLayoutReady) caused
   * a visible flash — the leaf was already drawn once before being
   * removed; (2) leaving the restored, empty pane in place instead was
   * worse — it can end up as an orphaned, blank panel with no Outline Tree
   * View nearby to reload it from, which reads as broken rather than
   * merely idle.
   *
   * `workspace.layoutReady` is false only while Obsidian is still
   * reconstructing the saved workspace at startup, and is permanently true
   * for the rest of the session afterward (including every live open via
   * activatePartialEditView). Checking it here, synchronously, at the very
   * start of onOpen — before any DOM is built — means a restored instance
   * detaches itself before it is ever painted, instead of appearing and
   * then disappearing. A live, user-triggered open (layoutReady already
   * true by then) is completely unaffected and renders normally below.
   */
  async onOpen(): Promise<void> {
    if (!this.app.workspace.layoutReady) {
      this.leaf.detach();
      return;
    }

    this.contentEl.empty();
    this.contentEl.addClass("unified-outliner-partial-edit-view");

    const headerEl = this.contentEl.createDiv({ cls: "unified-outliner-partial-edit-header" });
    this.titleEl = headerEl.createDiv({ cls: "unified-outliner-partial-edit-title" });

    const actionsEl = headerEl.createDiv({ cls: "unified-outliner-partial-edit-actions" });
    this.applyButtonEl = actionsEl.createEl("button", {
      text: this.plugin.t("common.apply"),
      cls: "mod-cta",
    });
    this.applyButtonEl.addEventListener("click", () => this.applyEdit());
    this.cancelButtonEl = actionsEl.createEl("button", { text: this.plugin.t("common.cancel") });
    this.cancelButtonEl.addEventListener("click", () => this.cancelEdit());
    // One-click close, in addition to Obsidian's own tab-close affordances
    // (native tab × / right-click "Close tab"). Deliberately NOT gated by
    // whether a section is loaded — unlike Apply/Cancel, closing the pane
    // is always a valid action. Discards any unsaved edit exactly like
    // Cancel/onClose already do; no confirmation prompt (see onClose's doc
    // comment — Close has never applied pending edits in this pane).
    this.closeButtonEl = actionsEl.createDiv({
      cls: "unified-outliner-partial-edit-close clickable-icon",
    });
    setIcon(this.closeButtonEl, "x");
    setTooltip(this.closeButtonEl, this.plugin.t("partialEdit.close"));
    this.closeButtonEl.addEventListener("click", () => this.leaf.detach());

    // Phase 5B: a second row below the title+actions header, dedicated to
    // the ancestor breadcrumb. Kept as its own element (not squeezed into
    // titleEl) so the existing header row's layout — title left, actions
    // right — stays exactly as it was; see renderBreadcrumb for what goes
    // in here.
    this.breadcrumbEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-breadcrumb",
    });

    // Sibling前後移動: a row between the ancestor breadcrumb and the Subtree
    // Navigator, for moving sideways to the loaded node's previous/next
    // sibling. Its own element (not merged into breadcrumbEl) per the spec's
    // explicit requirement that breadcrumb's own structure stay untouched —
    // see renderSiblingNav for what goes in here. Unlike breadcrumbEl and
    // subtreeNavEl, its two buttons are created once here and only ever
    // toggled/relabeled by renderSiblingNav afterward, since there are
    // always exactly two of them (no variable-length list to rebuild).
    this.siblingNavEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-sibling-nav",
    });
    this.siblingPrevEl = this.siblingNavEl.createEl("button", {
      cls: "unified-outliner-partial-edit-sibling-nav-button unified-outliner-partial-edit-sibling-nav-prev",
    });
    setIcon(this.siblingPrevEl, "chevron-left");
    this.siblingPrevEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-label",
      text: this.plugin.t("partialEdit.previousSibling"),
    });
    // Preview of the previous sibling's own displayLabel, so the pane shows
    // where "Previous" actually goes before it's clicked — see
    // renderSiblingNav for how this span's text/visibility is kept in sync
    // with this.siblingState.previous. CSS-truncated (styles.css) rather
    // than JS-truncated, matching how renderBreadcrumb's segments and
    // appendSubtreeChip's labels already truncate; the button's own tooltip
    // (set in renderSiblingNav) still carries the untruncated label, same
    // pattern as those two.
    this.siblingPrevTargetEl = this.siblingPrevEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-target",
    });
    // Reads this.siblingState.previous fresh at click time rather than
    // capturing it in a stale closure — renderSiblingNav updates that field
    // on every load without ever recreating this button. Same guarded
    // projection entry point as breadcrumb segments and Subtree Navigator
    // chips (see requestLoadNode's own doc comment) — never loadNodeInternal
    // directly.
    this.siblingPrevEl.addEventListener("click", () => {
      const target = this.siblingState.previous;
      if (target) this.requestLoadNode(target.nodeId);
    });

    this.siblingNextEl = this.siblingNavEl.createEl("button", {
      cls: "unified-outliner-partial-edit-sibling-nav-button unified-outliner-partial-edit-sibling-nav-next",
    });
    // Next sibling's target-label span is created FIRST (before the "Next"
    // word and its icon), so it sits closest to the row's center — mirrored
    // against siblingPrevTargetEl, which sits closest to the center on the
    // other side (right after "Previous", before nothing). Reading order
    // ends up "‹ Previous  [target]" / "[target]  Next ›", pointing outward
    // from the loaded node toward each sibling.
    this.siblingNextTargetEl = this.siblingNextEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-target",
    });
    this.siblingNextEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-label",
      text: this.plugin.t("partialEdit.nextSibling"),
    });
    // setIcon(el, ...) replaces ALL of el's existing children with just the
    // icon svg — harmless for siblingPrevEl above (its icon is set first,
    // while the button is still empty), but calling it directly on
    // siblingNextEl here — AFTER the target and label spans above already
    // exist — silently wiped both of them out, leaving "Next" with no
    // target-label preview ever rendered (reported: previous shows its
    // target label, next never does). Fixed by giving the icon its own
    // empty wrapper span that setIcon can safely clear/populate without
    // touching its siblings, instead of calling setIcon on siblingNextEl
    // itself.
    const siblingNextIconEl = this.siblingNextEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-icon",
    });
    setIcon(siblingNextIconEl, "chevron-right");
    this.siblingNextEl.addEventListener("click", () => {
      const target = this.siblingState.next;
      if (target) this.requestLoadNode(target.nodeId);
    });

    // Subtree Navigator: a third header row, below the ancestor breadcrumb,
    // for descending into the loaded node's own direct children. Its own
    // element (not merged into breadcrumbEl) so the two are visually and
    // structurally distinct — "climb up" vs. "descend down" — per the
    // implementation instruction's explicit requirement that the two not
    // share one row. See renderSubtreeNavigator for what goes in here.
    this.subtreeNavEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-subtree-nav",
    });

    // Phase 5D-0.5: created once here (like every other row in this
    // method), visibility/content toggled per-load by renderQuoteHeader —
    // same "create once in onOpen, mutate on each render" policy as
    // breadcrumbEl/siblingNavEl/subtreeNavEl above.
    this.quoteHeaderEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-quote-header",
    });

    this.textareaEl = this.contentEl.createEl("textarea", {
      cls: "unified-outliner-partial-edit-textarea",
    });
    // See updateDirtyState's doc comment: Apply/Cancel are only shown once
    // there is something to Apply/Cancel, so every keystroke needs to
    // re-check whether the textarea still matches its loaded snapshot
    // (originalText, or — Phase 5D-0.5 — the projected displayText for a
    // projecting callout/blockquote; see isDirty/currentDisplayText).
    this.textareaEl.addEventListener("input", () => this.updateDirtyState());

    // Real-device follow-up: keep exactly one visible close affordance.
    // See updateCloseButtonVisibility's doc comment for why a lone leaf
    // docked in the sidebar needs this pane's own ×, while a leaf that's
    // been dragged into a normal tab or popped into its own window
    // (Phase 5A's "open in new window" support) already gets a native tab
    // × from Obsidian — showing both there would be a redundant, confusing
    // double close button. `layout-change` fires whenever a leaf moves
    // between containers (sidebar <-> tab <-> popout), so re-checking on
    // every one of those keeps this correct as the user drags the pane
    // around, not just at first open. registerEvent (not a raw
    // workspace.on) ties this listener's lifetime to the view via
    // Component, so it's automatically removed on close instead of
    // outliving this pane.
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.updateCloseButtonVisibility())
    );

    this.renderEmptyState();
    this.updateCloseButtonVisibility();
  }

  async onClose(): Promise<void> {
    // Intentionally no auto-save here: per the Phase 3B design, Close
    // (like Cancel) never applies pending edits — only the Apply button
    // does. Nothing to clean up beyond the DOM itself.
    this.contentEl.empty();
  }

  /**
   * Phase 5B: the guarded, PUBLIC entry point every external caller must
   * use to switch which node this pane displays — main.ts's
   * activatePartialEditView (itself called from OutlineTreeView's "Open
   * partial edit pane" / "Edit list subtree in pane" menu items), and this
   * file's own breadcrumb segment clicks (renderBreadcrumb below), both
   * call this instead of loadNodeInternal directly. This is the "single
   * common projection entry point" the implementation instruction calls
   * for: Tree-triggered switches and breadcrumb-triggered switches must
   * behave identically, including the unsaved-edit guard below, so neither
   * path may bypass it.
   *
   * When the pane has no unapplied edit (see isDirty), this is a same-tick
   * passthrough to loadNodeInternal — no behavior change from before
   * Phase 5B. When it does, an Apply/Discard/Cancel modal is shown first:
   * - Cancel: nothing happens; the pane stays exactly as it was.
   * - Discard: the unapplied edit is thrown away and `nodeId` loads.
   * - Apply: applyEdit() runs; `nodeId` only loads if that Apply actually
   *   succeeded (outcome.changed) — a failed Apply (conflict, refused
   *   edit, etc.) leaves the pane on its current node, exactly like
   *   clicking the Apply button directly already does, and applyEdit()
   *   has already shown the user a Notice explaining why.
   * Dismissing the modal any other way (Escape, clicking outside) is
   * treated as Cancel — see DiscardChangesModal's onClose.
   */
  requestLoadNode(nodeId: string): void {
    if (!this.isDirty()) {
      this.loadNodeInternal(nodeId);
      return;
    }
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        this.loadNodeInternal(nodeId);
        return;
      }
      // choice === "apply"
      if (this.applyEdit()) {
        this.loadNodeInternal(nodeId);
      }
    }).open();
  }

  /**
   * Phase 5P-2: the paragraph counterpart to requestLoadNode above — the
   * sole external entry point for loading a paragraph into this pane
   * (main.ts's activatePartialEditViewForParagraph, itself called from the
   * "Edit paragraph at cursor" command). Same unsaved-edit guard
   * (Apply/Discard/Cancel), reusing the exact same DiscardChangesModal —
   * deliberately not a second modal/flow.
   */
  requestLoadParagraphAtCursor(cursorLine: number): void {
    if (!this.isDirty()) {
      this.loadParagraphInternal(cursorLine);
      return;
    }
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        this.loadParagraphInternal(cursorLine);
        return;
      }
      // choice === "apply"
      if (this.applyEdit()) {
        this.loadParagraphInternal(cursorLine);
      }
    }).open();
  }

  /**
   * Load `nodeId` (a section OR a list item id) from the currently active
   * note into this pane, replacing whatever was loaded before (the pane
   * always holds at most one node — see the "reuse, don't multiply" leaf
   * policy in main.ts's activatePartialEditView, mirroring
   * activateOutlineTreeView).
   *
   * Phase 4C: renamed from loadSection, then dispatched to
   * extractSubtreeText rather than the section-only extractSectionText —
   * a list item with unsafeIndent is refused here (reason "unsafe-indent",
   * see edit/partialEdit.ts) exactly like an unresolvable id is.
   *
   * Phase 5B: renamed again, from loadNode to loadNodeInternal, and made
   * private — requestLoadNode above is now the only sanctioned way in from
   * outside this class. This method's own behavior is otherwise unchanged
   * (still unconditionally overwrites whatever was loaded before), which
   * is exactly why requestLoadNode's dirty guard has to sit in front of
   * it rather than being folded into it. Also now computes the
   * breadcrumb's ancestor list (findAncestorPath) alongside the existing
   * label lookup, both via the shared nodeDisplayLabel helper so the pane
   * title and the breadcrumb segments never disagree on how a node is
   * labeled. Post-Phase-5B: also computes the Subtree Navigator's direct
   * children (findDirectChildren) the same way — one fresh snapshot per
   * load, covering title, breadcrumb, and navigator together.
   */
  private loadNodeInternal(nodeId: string): void {
    const view = this.activeMarkdownView.get();
    if (!view) {
      new Notice(this.plugin.t("partialEdit.noActiveNote"));
      return;
    }

    const doc = parseDocument(view.editor.getValue());
    const extracted = extractSubtreeText(doc, nodeId);
    if (!extracted.ok || !extracted.kind) {
      const reasonKey = ("reason." + (extracted.reason ?? "resolve-failed")) as TranslationKey;
      new Notice(this.plugin.t(reasonKey));
      return;
    }

    // Phase 5D-0.5: the quote-prefix-projection gate — deliberately BEFORE
    // any field on this pane is mutated below, so a "nested" refusal
    // leaves the pane exactly as it was (whatever was loaded before this
    // call, or the empty state) and never touches the note. Only
    // callout/blockquote ever attempt a projection; every other kind
    // (section/list) leaves `quoteProjection` at null, same as a
    // callout/blockquote whose reason is "no-body" (see
    // buildQuotePrefixProjection's own doc comment) — both fall through to
    // this pane's existing, unmodified raw-text load path below.
    let quoteProjection: QuotePrefixProjection | null = null;
    if (extracted.kind === "callout" || extracted.kind === "blockquote") {
      const built = buildQuotePrefixProjection(extracted.text, extracted.kind);
      if (!built.ok && built.reason === "nested") {
        new Notice(this.plugin.t("partialEdit.quoteNestedUnsupported"));
        return;
      }
      if (built.ok) {
        quoteProjection = built.projection;
      }
      // built.reason === "no-body": quoteProjection stays null, and
      // loadNodeInternal proceeds exactly as it always has — this specific
      // callout is shown raw, `>` prefix and all, via the untouched path
      // below (see renderLoadedState/currentDisplayText).
    }

    const t = this.plugin.t.bind(this.plugin);
    const node = doc.nodes.get(nodeId);
    let label: string;
    if (node) {
      label = nodeDisplayLabel(doc, node, t);
    } else {
      // Phase 5C-2: extracted.ok is true and node is undefined only for
      // the new standalone callout/blockquote path (see
      // extractSubtreeText's own doc comment). A fresh scanComplexBlocks()
      // re-lookup (rather than trusting extracted fields as an id-free
      // proxy) keeps this resolution independently re-verified, same
      // policy as every other CompositeBlock-adjacent module.
      const complexBlock = scanComplexBlocks(doc).blocks.find((b) => b.id === nodeId);
      label = complexBlock ? standaloneComplexBlockLabel(doc, complexBlock, t) : "";
    }

    this.nodeId = nodeId;
    this.nodeKind = extracted.kind;
    // Phase 5P-2: clear any previously-loaded paragraph identity — exactly
    // one of nodeId/paragraphAnchor is ever active at a time (see this
    // class's own doc comment).
    this.paragraphAnchor = null;
    this.originalText = extracted.text;
    this.quoteProjection = quoteProjection;
    this.label = label;
    // Phase 5C-4: recorded fresh on every load, from the SAME `view` this
    // method already resolved `doc` from above — see the class field's own
    // doc comment and view/partialEditSourceNoteCheck.ts for why this
    // exists and how applyEdit uses it.
    this.sourcePath = view.file?.path ?? null;
    // Phase 5C-2: breadcrumb / sibling nav / Subtree Navigator stay at
    // their empty state for a callout/blockquote — this ticket's own
    // approved scope explicitly leaves those three unextended
    // ("complex 対応は今回実装しない"). findAncestorPath/findDirectChildren/
    // getSiblingNavigationState are all doc.nodes-based (BlockNode-only)
    // and are simply not called for a node that isn't one.
    if (node) {
      this.ancestors = findAncestorPath(doc, nodeId, t);
      this.directChildren = findDirectChildren(doc, nodeId, t);
      this.siblingState = getSiblingNavigationState(doc, nodeId, t);
    } else {
      this.ancestors = [];
      this.directChildren = [];
      this.siblingState = { previous: null, next: null };
    }
    this.renderLoadedState();
  }

  /**
   * Phase 5P-2: paragraph counterpart to loadNodeInternal above — loads the
   * SINGLE paragraph at `cursorLine` in the currently active note into this
   * pane. Deliberately NOT a branch inside loadNodeInternal itself: a
   * paragraph has no BlockNode/ComplexBlockInfo id known in advance (the
   * caller only has a cursor line, resolved here via
   * resolver/resolveParagraphAtCursor.ts), and its Apply-time
   * re-resolution needs parentId/depth captured alongside the usual id +
   * "before editing" snapshot — see edit/paragraphPartialEdit.ts's own doc
   * comment for why that extra bookkeeping can't reuse
   * extractSubtreeText/applySubtreeEdit's existing id-only contract as-is.
   */
  private loadParagraphInternal(cursorLine: number): void {
    const view = this.activeMarkdownView.get();
    if (!view) {
      new Notice(this.plugin.t("partialEdit.noActiveNote"));
      return;
    }

    const doc = parseDocument(view.editor.getValue());
    const resolved = resolveParagraphAtCursor(doc, cursorLine);
    if (!resolved.paragraph) {
      const reasonKey = ("reason." + (resolved.reason ?? "no-paragraph")) as TranslationKey;
      new Notice(this.plugin.t(reasonKey));
      return;
    }
    const paragraph = resolved.paragraph;

    this.nodeId = null;
    this.paragraphAnchor = buildParagraphEditAnchor(doc, paragraph);
    this.nodeKind = "paragraph";
    this.originalText = paragraph.text;
    // Phase 5D-0.5: a paragraph never projects — see this class field's own
    // doc comment (quoteProjection is exclusively a callout/blockquote
    // concept). Reset alongside originalText/nodeKind above so a pane that
    // was just showing a projected quote body doesn't leave a stale
    // projection behind for currentDisplayText/isDirty to trip over.
    this.quoteProjection = null;
    this.label = paragraph.preview;
    // Phase 5C-4 convention, reused as-is: recorded fresh on every load,
    // from the SAME `view` this method already resolved `doc` from above.
    this.sourcePath = view.file?.path ?? null;
    // Phase 5P-2 explicit scope: no breadcrumb / sibling nav / Subtree
    // Navigator for a paragraph — see this class's own doc comment.
    // renderSiblingNav's own visibility check hinges on `this.nodeId`
    // (null here), so it stays hidden with no further change needed;
    // renderBreadcrumb/renderSubtreeNavigator hide themselves whenever
    // their backing arrays are empty, which they are here too.
    this.ancestors = [];
    this.directChildren = [];
    this.siblingState = { previous: null, next: null };
    this.renderLoadedState();
  }

  private renderEmptyState(): void {
    this.titleEl.setText(this.plugin.t("partialEdit.viewName"));
    this.textareaEl.value = "";
    this.textareaEl.disabled = true;
    this.applyButtonEl.disabled = true;
    this.cancelButtonEl.disabled = true;
    this.textareaEl.setAttribute("placeholder", this.plugin.t("partialEdit.emptyPlaceholder"));
    this.ancestors = [];
    this.directChildren = [];
    this.siblingState = { previous: null, next: null };
    // Phase 5C-4: reset alongside the other per-load fields above — see
    // the class field's own doc comment.
    this.sourcePath = null;
    // Phase 5P-2: reset alongside nodeId/nodeKind — this method already
    // implicitly leaves nodeId/nodeKind at their initial null values (never
    // set here), so paragraphAnchor is cleared explicitly to match.
    this.paragraphAnchor = null;
    // Phase 5D-0.5: reset alongside paragraphAnchor above — see the class
    // field's own doc comment.
    this.quoteProjection = null;
    this.renderBreadcrumb();
    this.renderSiblingNav();
    this.renderSubtreeNavigator();
    this.renderQuoteHeader();
    this.updateDirtyState();
  }

  /**
   * Phase 4C: the title now prefixes the node's kind (Section / List) so
   * the pane stays honest about what range Apply will replace, without
   * otherwise treating the two kinds differently — see class doc comment.
   */
  private renderLoadedState(): void {
    // Phase 5C-2: extended from a binary list/section ternary to cover the
    // two new standalone-complex-block kinds. kind display is otherwise
    // unified with section/list (same title template, same textarea/Apply/
    // Cancel wiring below) — see class doc comment.
    const kindLabel = ((): string => {
      switch (this.nodeKind) {
        case "list":
          return this.plugin.t("partialEdit.kindList");
        case "callout":
          return this.plugin.t("partialEdit.kindCallout");
        case "blockquote":
          return this.plugin.t("partialEdit.kindBlockquote");
        case "paragraph":
          return this.plugin.t("partialEdit.kindParagraph");
        case "section":
        default:
          return this.plugin.t("partialEdit.kindSection");
      }
    })();
    this.titleEl.setText(this.plugin.t("partialEdit.editingTitle", { kind: kindLabel, label: this.label }));
    this.textareaEl.disabled = false;
    this.applyButtonEl.disabled = false;
    this.cancelButtonEl.disabled = false;
    // Phase 5D-0.5: currentDisplayText() returns the prefix-stripped
    // projectedDisplayText for a projecting callout/blockquote, and
    // `this.originalText` verbatim for every other case (including a
    // callout/blockquote that fell back to raw editing) — see that
    // method's own doc comment.
    this.textareaEl.value = this.currentDisplayText();
    this.renderBreadcrumb();
    this.renderSiblingNav();
    this.renderSubtreeNavigator();
    this.renderQuoteHeader();
    this.updateDirtyState();
  }

  /**
   * Phase 5D-0.5: the pane's "what should the textarea currently show"
   * value. Deliberately the ONLY place these two are reconciled — every
   * other reader (applySubtreeEdit's conflict re-extraction inside
   * applyEdit, the paragraph branch's own originalText bookkeeping) keeps
   * reading `this.originalText` directly and must keep doing so, since
   * that field is the raw snapshot applySubtreeEdit's contract requires.
   * `quoteProjection` is non-null only for a callout/blockquote whose body
   * was successfully projected (see loadNodeInternal/buildQuotePrefixProjection);
   * every other case — section, list, paragraph, and a callout/blockquote
   * that fell back to raw editing (the "no-body" case) — has
   * `quoteProjection === null` and simply shows `originalText` verbatim,
   * exactly as this pane always has.
   */
  private currentDisplayText(): string {
    return this.quoteProjection ? projectedDisplayText(this.quoteProjection) : this.originalText;
  }

  /**
   * Phase 5D-0.5: draw (or hide) the read-only callout-header row above
   * the textarea. Only ever visible for a projecting CALLOUT — a
   * projecting blockquote has no header concept at all
   * (`quoteProjection.header` is always null for kind "blockquote"; see
   * QuotePrefixProjection's own doc comment), and a non-projecting node of
   * any kind has nothing to separate out. Deliberately NOT editable here
   * — this initial version's approved scope explicitly excludes header
   * editing ("callout header は読み取り専用"); the header is carried
   * through Apply unedited, verbatim, by invertQuotePrefixProjection.
   * Re-run only from loadNodeInternal's render call and renderEmptyState,
   * i.e. exactly when the loaded node itself changes — never on every
   * keystroke, matching renderBreadcrumb's own "static until the next
   * load" policy immediately below.
   */
  private renderQuoteHeader(): void {
    const header = this.quoteProjection?.header ?? null;
    if (header === null) {
      this.quoteHeaderEl.toggleVisibility(false);
      this.quoteHeaderEl.setText("");
      return;
    }
    this.quoteHeaderEl.toggleVisibility(true);
    this.quoteHeaderEl.setText(header);
  }

  /**
   * Phase 5B: draw the ancestor breadcrumb from `this.ancestors`, computed
   * once by loadNodeInternal at load time. Deliberately NOT recomputed on
   * every render or on a timer — the breadcrumb is a read-only aid derived
   * from the same "before editing" snapshot as the textarea, and Phase 5B's
   * design principle #5 is explicit that it must not be live-recalculated
   * against in-progress edits or Tree state before an Apply. Re-running
   * this only happens as part of loadNodeInternal/renderEmptyState, i.e.
   * exactly when the loaded node itself changes.
   *
   * The current node itself is never shown here (see class field doc
   * comment on `ancestors` and requestLoadNode) — titleEl already owns
   * that role, so breadcrumb and title stay complementary rather than
   * redundant.
   */
  private renderBreadcrumb(): void {
    this.breadcrumbEl.empty();
    if (this.ancestors.length === 0) {
      this.breadcrumbEl.toggleVisibility(false);
      return;
    }
    this.breadcrumbEl.toggleVisibility(true);

    const visibleCount = PartialEditView.BREADCRUMB_VISIBLE_ANCESTORS;
    const elided =
      this.ancestors.length > visibleCount
        ? this.ancestors.slice(0, this.ancestors.length - visibleCount)
        : [];
    const visible =
      elided.length > 0 ? this.ancestors.slice(elided.length) : this.ancestors;

    if (elided.length > 0) {
      const ellipsisEl = this.breadcrumbEl.createSpan({
        cls: "unified-outliner-partial-edit-breadcrumb-segment unified-outliner-partial-edit-breadcrumb-ellipsis",
        text: "…",
      });
      setTooltip(ellipsisEl, elided.map((a) => a.label).join(" › "));
      this.breadcrumbEl.createSpan({
        cls: "unified-outliner-partial-edit-breadcrumb-sep",
        text: "›",
      });
    }

    visible.forEach((ancestor, index) => {
      const segEl = this.breadcrumbEl.createSpan({
        cls: "unified-outliner-partial-edit-breadcrumb-segment",
        text: ancestor.label,
      });
      setTooltip(segEl, ancestor.label);
      // Phase 5B design principle #3/#5: a breadcrumb click must resolve
      // through the same guarded projection entry point as a Tree click —
      // never a direct loadNodeInternal call. See requestLoadNode's doc
      // comment for the full rationale (dirty-guard parity above all).
      segEl.addEventListener("click", () => this.requestLoadNode(ancestor.id));
      if (index < visible.length - 1) {
        this.breadcrumbEl.createSpan({
          cls: "unified-outliner-partial-edit-breadcrumb-sep",
          text: "›",
        });
      }
    });
  }

  /**
   * Sibling前後移動 (docs/phase5b_sibling-navigation-spec.md §3/§4): update
   * the two sibling-nav buttons from `this.siblingState`, computed once by
   * loadNodeInternal at load time — same "static snapshot until the next
   * load" policy as renderBreadcrumb/renderSubtreeNavigator's own fields,
   * for the same reason (a read-only navigation aid derived from the pane's
   * "before editing" snapshot, not live-recalculated against in-progress
   * edits).
   *
   * Unlike renderBreadcrumb/renderSubtreeNavigator, this never rebuilds the
   * DOM tree itself (no empty()/createSpan for the buttons) — the two
   * buttons, and their target-label spans, are created once in onOpen and
   * always exist; only `disabled` state, tooltip, and the target-label
   * text/visibility change here. The row itself is hidden only when no node
   * is loaded at all (`!this.nodeId`); once a node IS loaded, the row stays
   * visible and each button disables itself independently when that
   * direction has no sibling — deliberately different from the breadcrumb
   * and Subtree Navigator's "hide the whole row when empty" policy, since a
   * node with siblings on only one side should still make that one
   * direction discoverable.
   *
   * Target-label preview: each button's *TargetEl span shows the
   * destination sibling's own displayLabel (same field the breadcrumb and
   * Subtree Navigator already use — see AncestorPathEntry.label /
   * DescendantNavigationEntry.label), so the pane shows where "Previous" /
   * "Next" actually lead before either is clicked. CSS truncates a long
   * label (styles.css); the button's own tooltip below always carries the
   * full, untruncated label. When a direction has no sibling, its target
   * span is cleared and hidden rather than showing empty space — no target
   * label for a disabled button, matching the button's own disabled state.
   */
  private renderSiblingNav(): void {
    if (!this.nodeId) {
      this.siblingNavEl.toggleVisibility(false);
      return;
    }
    this.siblingNavEl.toggleVisibility(true);

    const previous = this.siblingState.previous;
    this.siblingPrevEl.disabled = !previous;
    setTooltip(
      this.siblingPrevEl,
      previous ? previous.displayLabel : this.plugin.t("partialEdit.noPreviousSibling")
    );
    this.siblingPrevTargetEl.setText(previous ? previous.displayLabel : "");
    this.siblingPrevTargetEl.toggleVisibility(!!previous);

    const next = this.siblingState.next;
    this.siblingNextEl.disabled = !next;
    setTooltip(
      this.siblingNextEl,
      next ? next.displayLabel : this.plugin.t("partialEdit.noNextSibling")
    );
    this.siblingNextTargetEl.setText(next ? next.displayLabel : "");
    this.siblingNextTargetEl.toggleVisibility(!!next);
  }

  /**
   * Subtree Navigator: draw the loaded node's direct children
   * (`this.directChildren`, computed once by loadNodeInternal — same
   * "static snapshot until the next load" policy as renderBreadcrumb's
   * ancestors, and for the same reason: this is a read-only navigation aid
   * derived from the pane's "before editing" snapshot, not a live view of
   * in-progress edits). Hidden entirely when the loaded node has no
   * children — a leaf node gets no empty/disabled navigator row, per the
   * implementation instruction's explicit requirement.
   *
   * Up to SUBTREE_VISIBLE_CHILDREN children are shown inline as chips
   * (appendSubtreeChip); any remainder collapses into one "More…" chip
   * that opens an Obsidian Menu — Menu already provides keyboard
   * navigation and correct positioning in every window (main, sidebar
   * split, or popout), so no bespoke popover was written for the overflow
   * case.
   */
  private renderSubtreeNavigator(): void {
    this.subtreeNavEl.empty();
    if (this.directChildren.length === 0) {
      this.subtreeNavEl.toggleVisibility(false);
      return;
    }
    this.subtreeNavEl.toggleVisibility(true);

    this.subtreeNavEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-label",
      text: this.plugin.t("partialEdit.subtreeLabel"),
    });

    const visibleCount = PartialEditView.SUBTREE_VISIBLE_CHILDREN;
    const overflow = this.directChildren.length > visibleCount;
    // Reserve one inline slot for the "More…" chip itself when overflowing,
    // so the row never shows more than SUBTREE_VISIBLE_CHILDREN chips total.
    const visible = overflow
      ? this.directChildren.slice(0, visibleCount - 1)
      : this.directChildren;
    const hidden = overflow ? this.directChildren.slice(visible.length) : [];

    for (const child of visible) {
      this.appendSubtreeChip(child);
    }

    if (hidden.length > 0) {
      const moreEl = this.subtreeNavEl.createSpan({
        cls: "unified-outliner-partial-edit-subtree-nav-chip unified-outliner-partial-edit-subtree-nav-more",
        text: this.plugin.t("partialEdit.moreChip", { count: hidden.length }),
      });
      moreEl.tabIndex = 0;
      moreEl.setAttribute("role", "button");
      setTooltip(moreEl, this.plugin.t("partialEdit.moreCount", { count: hidden.length }));

      const openOverflowMenu = (anchor: HTMLElement, mouseEvt?: MouseEvent) => {
        const menu = new Menu();
        for (const child of hidden) {
          menu.addItem((item) =>
            item
              .setTitle(child.hasChildren ? `${child.label} ›` : child.label)
              .setIcon(child.kind === "section" ? "heading" : "list")
              // Same guarded entry point as every other Subtree Navigator
              // chip — see appendSubtreeChip's doc comment.
              .onClick(() => this.requestLoadNode(child.id))
          );
        }
        if (mouseEvt) {
          menu.showAtMouseEvent(mouseEvt);
        } else {
          // Keyboard-triggered (no MouseEvent): position explicitly, and
          // pass the anchor's OWN document (not the implicit global one) so
          // this opens correctly in a popped-out Partial Edit Pane window
          // too — same cross-window-safety pattern as the rest of this
          // pane (see class doc comment / Phase 5A).
          const rect = anchor.getBoundingClientRect();
          menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument);
        }
      };
      moreEl.addEventListener("click", (evt) => openOverflowMenu(moreEl, evt));
      moreEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          openOverflowMenu(moreEl);
        }
      });
    }
  }

  /**
   * One Subtree Navigator chip: an icon (heading vs. list — see class doc
   * comment on why kind is never conveyed by color alone), the child's
   * label (CSS-truncated with a tooltip carrying the full text, same
   * pattern as renderBreadcrumb's segments), and a subtle "›" marker when
   * the child itself has further children (hasChildren) — a hint that
   * there's more to descend into below it, without committing to showing
   * that deeper level inline.
   *
   * Focusable (tabIndex + role="button") and Enter/Space-activatable, on
   * top of the click handler — the implementation instruction explicitly
   * requires keyboard operability and visible focus here (see
   * styles.css's :focus-visible rule for this chip class).
   *
   * Activating a chip always calls requestLoadNode, never loadNodeInternal
   * — descending into a child must go through the exact same dirty-guard /
   * Apply-Discard-Cancel path as Tree clicks and breadcrumb clicks. See
   * requestLoadNode's own doc comment for the full rationale; nothing
   * about that guard changes for this new caller.
   */
  private appendSubtreeChip(child: DescendantNavigationEntry): void {
    const chipEl = this.subtreeNavEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-chip",
    });
    chipEl.tabIndex = 0;
    chipEl.setAttribute("role", "button");
    setTooltip(chipEl, child.label);

    const iconEl = chipEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-chip-icon",
    });
    setIcon(iconEl, child.kind === "section" ? "heading" : "list");

    chipEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-chip-label",
      text: child.label,
    });

    if (child.hasChildren) {
      chipEl.createSpan({
        cls: "unified-outliner-partial-edit-subtree-nav-chip-marker",
        text: "›",
      });
    }

    const activate = () => this.requestLoadNode(child.id);
    chipEl.addEventListener("click", activate);
    chipEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        activate();
      }
    });
  }

  /** Revert unsaved edits in the textarea — does not close the pane or change which node is loaded. */
  private cancelEdit(): void {
    if (!this.nodeId && !this.paragraphAnchor) return;
    // Phase 5D-0.5: reverts to the projected displayText (not the raw
    // originalText) for a projecting callout/blockquote — see
    // currentDisplayText's own doc comment. Every other kind is
    // unaffected, since currentDisplayText falls through to originalText
    // verbatim whenever quoteProjection is null.
    this.textareaEl.value = this.currentDisplayText();
    this.updateDirtyState();
  }

  /**
   * Apply the textarea's current content back to the active note, via the
   * same resolve-fresh -> compute outcome -> applyLineEditOutcome pipeline
   * every other tree-triggered command in this plugin uses. Unlike a
   * passive no-op (which respects the "Show no-op notices" setting), a
   * failed Apply always shows a Notice — silently doing nothing in
   * response to an explicit Apply click would be actively confusing.
   *
   * Phase 5B: now returns whether the apply actually succeeded. The
   * Apply-button click handler still ignores this (a button click doesn't
   * need to react to it — the Notice already tells the user), but
   * requestLoadNode's "Apply and switch" path needs it to decide whether
   * proceeding to load the next node is safe: a failed Apply (conflict,
   * refused edit, no active note, etc.) must leave the pane on its
   * current node rather than discarding the edit that just failed to
   * save.
   */
  private applyEdit(): boolean {
    if (!this.nodeId && !this.paragraphAnchor) {
      new Notice(this.plugin.t("partialEdit.noNodeLoaded"));
      return false;
    }
    const view = this.activeMarkdownView.get();
    if (!view) {
      new Notice(this.plugin.t("partialEdit.noActiveNoteToApply"));
      return false;
    }
    const editor = view.editor;
    if (editor.listSelections().length > 1) {
      new Notice(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    // Phase 5C-4: an ADDITIONAL, path-based safety valve, checked BEFORE
    // the existing content-based conflict check below — never a
    // replacement for it (that check, in applySubtreeEdit, is completely
    // unchanged by this ticket). `view` here may already be a DIFFERENT
    // note than the one `this.sourcePath` was recorded from, if the active
    // note changed elsewhere (in another window, when this pane is popped
    // out) since this pane last loaded — see
    // view/partialEditSourceNoteCheck.ts's own doc comment for the full
    // rationale. Both "note changed" and "path unavailable" fail safe:
    // Apply is refused and the editor is left byte-for-byte untouched,
    // exactly like every other refusal reason in this method.
    const sourceNoteCheck = checkPartialEditSourceNote(this.sourcePath, view.file?.path ?? null);
    if (sourceNoteCheck !== "ok") {
      const reasonKey: TranslationKey =
        sourceNoteCheck === "changed"
          ? "reason.partialEditSourceNoteChanged"
          : "reason.partialEditSourceNoteUnknown";
      new Notice(this.plugin.t(reasonKey));
      return false;
    }

    const doc = parseDocument(editor.getValue());

    // Phase 5P-2: a loaded paragraph is a fully separate re-resolution path
    // — see edit/paragraphPartialEdit.ts's own doc comment for why it
    // cannot reuse applySubtreeEdit's id-only contract (a paragraph also
    // needs parentId/depth re-verified, not just its scan-local id and
    // content). This branch never touches this.nodeId/applySubtreeEdit
    // below, and the reverse is equally true — exactly one of
    // nodeId/paragraphAnchor is ever set (see this class's own doc
    // comment), so the two paths cannot interfere with each other.
    if (this.paragraphAnchor) {
      const outcome = applyParagraphEdit(doc, this.paragraphAnchor, this.textareaEl.value);
      if (!outcome.changed) {
        const reasonKey = ("reason." + (outcome.reason ?? "anchor-unresolved")) as TranslationKey;
        new Notice(this.plugin.t(reasonKey));
        return false;
      }

      applyLineEditOutcome(
        editor,
        { line: outcome.newStartLine, ch: 0 },
        outcome.newStartLine,
        doc.lines,
        outcome,
        () => {}
      );

      this.originalText = this.textareaEl.value;
      // Phase 5P-4 supplement: re-anchor from a FRESH re-resolution at the
      // outcome's own new position, rather than blindly spreading the old
      // anchor. applyParagraphEdit may have resolved via its Pass 2
      // structural re-search (a same-parent paragraph<->paragraph swap
      // happened elsewhere while this pane was open) — in that case the
      // OLD anchor's complexBlockId no longer points at this paragraph at
      // all, and spreading it forward would silently reintroduce the exact
      // staleness this fix exists to close. Re-resolving via
      // resolveParagraphAtCursor at outcome.newStartLine, against the
      // just-applied document, always yields the correct current id/
      // siblingCount — a SECOND Apply within the same pane session then
      // starts from a fully current anchor, not a stale one.
      const freshDoc = parseDocument(editor.getValue());
      const freshResolved = resolveParagraphAtCursor(freshDoc, outcome.newStartLine);
      this.paragraphAnchor = freshResolved.paragraph
        ? buildParagraphEditAnchor(freshDoc, freshResolved.paragraph)
        : { ...this.paragraphAnchor, originalText: this.textareaEl.value };
      this.updateDirtyState();

      const lineLen = editor.getLine(outcome.newStartLine)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: outcome.newStartLine, ch: 0 }, to: { line: outcome.newStartLine, ch: lineLen } },
        true
      );

      // Phase 5T-5A: selection-follow — see UnifiedOutlinerPlugin
      // #queueOutlineTreeSelectionFollow's own doc comment. A no-op when
      // no Outline Tree View leaf currently has this paragraph selected;
      // resolveSelectionAfterRefresh re-resolves from CURRENT body content
      // on the next refresh, exactly like every other Tree-dispatched
      // move/edit.
      this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);

      new Notice(this.plugin.t("partialEdit.paragraphUpdated"));
      return true;
    }

    // Phase 5D-0.5: for a projecting callout/blockquote, the textarea
    // holds prefix-stripped display text — invert it back to raw Markdown
    // BEFORE handing anything to the raw-text splice call below (unmodified
    // by this ticket — it only ever knows about raw text). A
    // line-count-changed edit (add/remove/newline-split a line) is refused
    // right here, with its own dedicated Notice, and never reaches that
    // splice call at all — no partial/best-effort splice is attempted.
    // Every other kind (quoteProjection === null) is untouched: newRawText
    // is simply whatever the textarea already held, exactly as before
    // this ticket.
    let newRawText = this.textareaEl.value;
    if (this.quoteProjection) {
      const inverted = invertQuotePrefixProjection(this.quoteProjection, this.textareaEl.value);
      if (!inverted.ok) {
        new Notice(this.plugin.t("partialEdit.quoteLineCountChanged"));
        return false;
      }
      newRawText = inverted.rawText;
    }

    const outcome = applySubtreeEdit(doc, this.nodeId!, this.originalText, newRawText);
    const node = doc.nodes.get(this.nodeId!);
    const startLine = node ? node.range.startLine : 0;

    if (!outcome.changed) {
      const reasonKey = ("reason." + (outcome.reason ?? "resolve-failed")) as TranslationKey;
      new Notice(this.plugin.t(reasonKey));
      return false;
    }

    // outcome.changed is already true here, so applyLineEditOutcome's own
    // no-op branch never fires — the notify callback is unreachable, but
    // required by its signature.
    applyLineEditOutcome(
      editor,
      { line: startLine, ch: 0 },
      startLine,
      doc.lines,
      outcome,
      () => {}
    );

    // Phase 5D-0.5: originalText re-anchors to the RECONSTRUCTED raw text
    // (never the textarea's own, possibly prefix-stripped, value) — for
    // every non-projecting kind newRawText === this.textareaEl.value
    // already, so this is byte-identical to the pre-5D-0.5 behavior there.
    this.originalText = newRawText;
    if (this.quoteProjection) {
      // Rebuild the projection/line-mapping fresh from the just-applied
      // raw text, rather than trusting the pre-apply projection's now
      // possibly-stale prefixes — this is what guarantees a SECOND Apply
      // in the same pane session starts from a fully current basis (see
      // the class doc comment's originalText/quoteProjection contract).
      // A rebuild can fail here ONLY with reason "nested" — never
      // "no-body" (line count, and therefore body-line count, cannot
      // change on this path; see invertQuotePrefixProjection) — if the
      // user's own edited content happened to introduce a literal leading
      // `>` into a line (typed, not structural). That is not a data-loss
      // risk (the Apply above already succeeded and the note already
      // holds newRawText); this pane simply, safely degrades to showing
      // that node raw from here on, exactly like the "no-body" fallback
      // already does for a header-only callout.
      const kind = this.quoteProjection.kind;
      const rebuilt = buildQuotePrefixProjection(newRawText, kind);
      this.quoteProjection = rebuilt.ok ? rebuilt.projection : null;
      this.renderQuoteHeader();
      // Keep the textarea itself in sync with whatever currentDisplayText()
      // now resolves to (projected again, or raw on the rare degrade
      // above) — normally a no-op, since projecting the just-reconstructed
      // raw text back should reproduce exactly what the textarea already
      // shows.
      this.textareaEl.value = this.currentDisplayText();
    }
    this.updateDirtyState();

    const lineLen = editor.getLine(outcome.newStartLine)?.length ?? 0;
    editor.scrollIntoView(
      { from: { line: outcome.newStartLine, ch: 0 }, to: { line: outcome.newStartLine, ch: lineLen } },
      true
    );

    // Phase 5T-5A: same selection-follow as the paragraph branch above,
    // for symmetry — a section/list subtree edit doesn't relocate the
    // node's own start line (applySubtreeEdit never moves content, only
    // rewrites it in place), so this is a low-risk, mostly-defensive
    // addition rather than the primary fix this ticket targets.
    this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);

    new Notice(
      this.nodeKind === "list"
        ? this.plugin.t("partialEdit.listSubtreeUpdated")
        : this.plugin.t("partialEdit.sectionUpdated")
    );
    return true;
  }

  /**
   * Real-device follow-up: Apply/Cancel previously stayed visible (only
   * enabled/disabled) for as long as a node was loaded, regardless of
   * whether there was anything to Apply/Cancel. Showing them only while
   * the textarea actually differs from `originalText` (the pane's "before
   * editing" snapshot — see applySubtreeEdit's doc comment in
   * edit/partialEdit.ts) makes the pane read as clean immediately after a
   * fresh load, a successful Apply, or a Cancel, and only surface an
   * action once there's an actual pending edit. `nodeId` is checked too
   * (not just the text comparison) purely for clarity at the empty-state
   * call site — textareaEl.value and originalText are both "" before any
   * node is ever loaded, so the comparison alone would already resolve to
   * false there.
   */
  private updateDirtyState(): void {
    const dirty = this.isDirty();
    this.applyButtonEl.toggleVisibility(dirty);
    this.cancelButtonEl.toggleVisibility(dirty);
  }

  /**
   * Phase 5B: shared by updateDirtyState (Apply/Cancel button visibility)
   * and requestLoadNode (the unsaved-edit guard) — both need the exact
   * same "is there something to Apply/Cancel/lose right now" condition,
   * so it lives in one place instead of being duplicated inline.
   */
  private isDirty(): boolean {
    // Phase 5D-0.5: compares against currentDisplayText() (the projected
    // displayText for a projecting callout/blockquote, originalText
    // verbatim otherwise) — NEVER against raw originalText directly for a
    // projecting node, or every keystroke in the prefix-stripped textarea
    // would spuriously read as dirty relative to the still-`>`-prefixed
    // raw snapshot. See currentDisplayText's own doc comment.
    return (
      (this.nodeId !== null || this.paragraphAnchor !== null) &&
      this.textareaEl.value !== this.currentDisplayText()
    );
  }

  /**
   * Real-device follow-up: keep exactly one visible "close this pane"
   * control. Obsidian only draws a native tab header (with its own ×) for
   * leaves outside the left/right sidedock (`workspace.leftSplit` /
   * `rightSplit`) — a lone leaf docked directly in the sidebar (this
   * pane's default open location; see main.ts's activatePartialEditView)
   * gets no native close control at all, which is why this pane has its
   * own × in the first place. Once the user drags this pane into a normal
   * tab, or pops it into its own window (activatePartialEditView's
   * `openInNewWindow` support), Obsidian draws a native tab × too — this
   * pane's own × would then be a redundant second close button, so it
   * hides itself whenever `this.leaf.getRoot()` is NOT one of the two
   * sidedocks (i.e. whenever a native × is expected to already be
   * present).
   */
  private updateCloseButtonVisibility(): void {
    const { workspace } = this.app;
    const root = this.leaf.getRoot();
    const inSidebar = root === workspace.leftSplit || root === workspace.rightSplit;
    this.closeButtonEl.toggleVisibility(inSidebar);
  }
}

type DiscardChangesChoice = "apply" | "discard" | "cancel";

/**
 * Phase 5B: the Apply/Discard/Cancel prompt PartialEditView.requestLoadNode
 * shows when it's asked to switch nodes while the pane has an unapplied
 * edit. A plain Obsidian Modal rather than anything home-grown — Modal's
 * own `open()` already shows on the window that's currently active (per
 * its doc comment in obsidian.d.ts), so this needs no cross-window
 * plumbing of its own to work correctly from a popped-out Partial Edit
 * Pane (Phase 5A) exactly as it does from the sidebar-docked pane.
 *
 * `onChoice` fires exactly once per modal instance, either from an
 * explicit button click (choose()) or, if the modal is dismissed any other
 * way (Escape key, clicking the backdrop), from onClose() below — treated
 * the same as an explicit Cancel, since either way the answer to "should
 * the pending edit be discarded" is no.
 */
class DiscardChangesModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly plugin: UnifiedOutlinerPlugin,
    private readonly onChoice: (choice: DiscardChangesChoice) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.plugin.t("partialEdit.unsavedChangesTitle"));
    this.contentEl.createEl("p", {
      text: this.plugin.t("partialEdit.unsavedChangesBody"),
    });

    const buttonsEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-modal-buttons",
    });
    const applyEl = buttonsEl.createEl("button", {
      text: this.plugin.t("common.apply"),
      cls: "mod-cta",
    });
    applyEl.addEventListener("click", () => this.choose("apply"));
    const discardEl = buttonsEl.createEl("button", { text: this.plugin.t("common.discard") });
    discardEl.addEventListener("click", () => this.choose("discard"));
    const cancelEl = buttonsEl.createEl("button", { text: this.plugin.t("common.cancel") });
    cancelEl.addEventListener("click", () => this.choose("cancel"));
  }

  private choose(choice: DiscardChangesChoice): void {
    this.resolved = true;
    this.close();
    this.onChoice(choice);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onChoice("cancel");
    }
  }
}
