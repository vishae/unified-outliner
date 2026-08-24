/**
 * UXP-03b (2026-08-15, "Partial Edit Pane Placement Follow-up"): pure,
 * Obsidian-runtime-free helper deciding whether ANY currently-open Outline
 * Tree View leaf sits in the left sidebar — the single fact
 * main.ts's activatePartialEditView needs to decide whether opening a
 * brand-new Partial Edit Pane should split the right sidebar (existing,
 * unchanged default) or open there WITHOUT a split (UXP-03b's new rule).
 *
 * Deliberately typed structurally (LeafRootLike's `getRoot(): unknown`,
 * not Obsidian's own `WorkspaceLeaf`/`WorkspaceItem` types) rather than
 * importing anything from "obsidian" as a VALUE or TYPE, so this module —
 * like settingsDefaults.ts before it — can be imported directly from
 * vitest with plain mock objects. A real `WorkspaceLeaf` still satisfies
 * `LeafRootLike` structurally (its own `getRoot(): WorkspaceItem` is a
 * narrower return type than `unknown`), so main.ts's real call site needs
 * no cast.
 *
 * Per UXP-03b's approval: this checks the ACTUAL current position of any
 * open Outline Tree View leaf, never `settings.outlineTreeSidebarPosition`
 * — that setting only governs where a brand-new Outline Tree View leaf is
 * created (see settingsDefaults.ts's own doc comment on that field) and
 * can freely diverge from where a leaf actually is, since UXP-03
 * deliberately never auto-moves an existing leaf when the setting changes,
 * and the user can always drag a leaf to any location via Obsidian's own
 * standard tab-drag gesture.
 *
 * The comparison is a plain `===` against `leftSplit`, so an unrecognized
 * or unexpected `getRoot()` result (main area, a popout window, or any
 * future Obsidian root kind this function doesn't know about) simply fails
 * to match and contributes `false` — never throws, never needs a
 * default/fallback branch of its own. With multiple Outline Tree View
 * leaves (not the normal case — this plugin's own activateOutlineTreeView
 * always reuses a single leaf — but not otherwise prevented), a single
 * matching leftSplit leaf is enough: this intentionally does NOT attempt
 * to rank, dedupe, or otherwise manage multiple leaves, per UXP-03b's own
 * explicit "推測で複雑な優先順位を作らない" instruction.
 */
export interface LeafRootLike {
  getRoot(): unknown;
}

export function hasOutlineTreeLeafInLeftSidebar(
  leaves: readonly LeafRootLike[],
  leftSplit: unknown
): boolean {
  return leaves.some((leaf) => leaf.getRoot() === leftSplit);
}

/**
 * UXP-03c (2026-08-25, "Partial Edit Pane Stale Tab-Group Reuse Fix"):
 * pure, Obsidian-runtime-free helper answering a narrower question than
 * hasOutlineTreeLeafInLeftSidebar above — not "where should a BRAND-NEW
 * Partial Edit Pane leaf go", but "is this ALREADY-OPEN Partial Edit Pane
 * leaf currently sharing a tab group with an open Outline Tree View
 * leaf". Real-device report: with the Outline Tree View in the right
 * sidebar, opening the Partial Edit Pane replaced/covered the Tree
 * instead of splitting beside it, even though the split-by-default logic
 * in main.ts (see activatePartialEditView's own doc comment) still chose
 * `getRightLeaf(true)` correctly whenever it actually ran.
 *
 * Root cause: main.ts's existing "reuse an existing Partial Edit Pane
 * leaf" branch (`existing.length > 0`) — deliberately UNCHANGED by
 * UXP-03b, predating it — always wins over the split-placement decision
 * once ANY Partial Edit Pane leaf is already open, with no re-check of
 * where that leaf actually lives relative to the Tree's CURRENT
 * position. A leaf created as a plain tab (via UXP-03b's
 * `getRightLeaf(false)`, while the Tree briefly sat in the left sidebar)
 * then gets reused forever afterward — including after the Tree moves
 * back to the right sidebar — silently sharing its tab group and hiding
 * it behind the pane. This is exactly the "shared tab" symptom the
 * original split-by-default fix (activatePartialEditView's own doc
 * comment, point 2) was written to prevent in the first place; the reuse
 * branch just never got the same treatment.
 *
 * `WorkspaceLeaf.parent` (a `WorkspaceTabs | WorkspaceMobileDrawer`,
 * public API since Obsidian 1.6.6) identifies a leaf's immediate tab
 * group; two leaves share a tab group iff their `.parent` is `===`. As
 * with `hasOutlineTreeLeafInLeftSidebar`, this is typed structurally
 * (`LeafParentLike`) rather than importing anything from "obsidian" as a
 * value or type, so it stays directly testable from vitest with plain
 * mock objects — a real `WorkspaceLeaf` satisfies it without a cast.
 */
export interface LeafParentLike {
  parent: unknown;
}

export function partialEditLeafSharesTabGroupWithOutlineTree(
  candidate: LeafParentLike,
  outlineTreeLeaves: readonly LeafParentLike[]
): boolean {
  return outlineTreeLeaves.some((tree) => tree.parent === candidate.parent);
}
