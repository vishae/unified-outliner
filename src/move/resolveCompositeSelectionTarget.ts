/**
 * Phase 5C-1 ticket 4-5 (2026-08-14): pure, Obsidian-independent resolution
 * of "does the body editor's current cursor/selection point at exactly one
 * CompositeBlock (model/compositeBlock.ts), unambiguously enough to move
 * it?" — the gate a caller (main.ts) runs BEFORE building a
 * CompositeBlockSnapshot and handing it to edit/moveCompositeBlock.ts.
 *
 * ---- Explicit non-goal: this does NOT resolve "the selection" as a move
 * unit ----
 *
 * This ticket's approved scope note is binding: "選択範囲そのものを移動する
 * 機能ではない。常に移動対象は1個の、既に一意に確定した CompositeBlock 全体
 * である。selection はその CompositeBlock を指していることを確認するための
 * 制約としてのみ使う。" The only thing this function ever returns as a move
 * target is ONE CompositeBlock, found via `cursorLine` alone
 * (`findCompositeContainingLine`, below). `anchorLine`/`headLine` are used
 * SOLELY as an additional constraint — proof that whatever text the user
 * highlighted (if any) stays entirely inside that one CompositeBlock's own
 * `range` — never as an independent source of what to move. A selection
 * that spans multiple blocks, or extends even one line past the resolved
 * CompositeBlock's boundary, is rejected outright ("selection-outside-
 * composite"); it is never widened, clamped, or split into a multi-block
 * move. Multi-block move, Tree multi-select, and multi-cursor support are
 * all out of scope for this ticket (see this ticket's own "非対象" list) —
 * future tickets, if ever pursued, must not silently piggyback on this
 * function's shape.
 *
 * ---- Why cursorLine is a separate field from anchorLine/headLine ----
 *
 * In practice, Obsidian's `Editor.getCursor()` (no argument) returns the
 * PRIMARY selection's head, so `cursorLine === headLine` for every real
 * call site today. This function still takes `cursorLine` as an
 * independent parameter — never derived internally from `headLine` — so
 * the "which CompositeBlock is targeted" step and the "does the selection
 * stay inside it" step remain two independently testable, independently
 * reasoned-about concerns, and so this function's own contract does not
 * quietly assume an Obsidian API convention that could change.
 *
 * ---- Relationship to evaluateCompositeBlockMovability / moveCompositeBlock
 * ----
 *
 * This function answers a DIFFERENT question than
 * parser/compositeBlocks.ts#evaluateCompositeBlockMovability: that function
 * asks "given a specific CompositeBlock, is it SAFE to move in this
 * direction" (parent/depth/adjacency checks); this function asks "given the
 * editor's current cursor/selection, which CompositeBlock (if any) is even
 * BEING SELECTED". A caller runs this function first, then — only if it
 * allows — proceeds through the existing, unchanged
 * buildCompositeBlockSnapshot -> moveCompositeBlock pipeline (ticket 4-3),
 * which re-verifies movability and boundary identity all over again against
 * the current text, exactly like the Outline Tree's own
 * dispatchAndApplyCompositeMove (ticket 4-4) already does. This function is
 * never a substitute for that re-verification — it only decides whether
 * there is a well-defined target to attempt it with.
 */
import { CompositeBlockInfo } from "../model/compositeBlock";

/** The body editor state this function needs to make its decision — see this file's own top doc comment for why `cursorLine` is independent of `anchorLine`/`headLine`. */
export interface CompositeSelectionQuery {
  /** `editor.listSelections().length` at call time. Anything other than exactly 1 (multi-cursor or a discontiguous/multiple selection) is rejected outright — see "multiple-selections" below. */
  selectionCount: number;
  /** The single selection's anchor line (0-based) — may be after `headLine` if the user dragged upward. */
  anchorLine: number;
  /** The single selection's head line (0-based) — where the caret currently sits. Equal to `anchorLine` for a plain, non-dragged cursor (no highlighted text). */
  headLine: number;
  /** The line used to resolve WHICH CompositeBlock is targeted — see this file's own top doc comment. */
  cursorLine: number;
}

/**
 * Every way resolveCompositeSelectionTarget refuses to name a target.
 *   - "multiple-selections": `selectionCount !== 1` — multi-cursor or a
 *     discontiguous selection. Mirrors every other move/delete command in
 *     this codebase's own multi-cursor guard (see main.ts's
 *     moveCurrentBlock, view/OutlineTreeView.ts's
 *     dispatchAndApplyCompositeMove) — reported via the same
 *     "notice.multipleCursors" text (see compositeMoveReasonText in
 *     edit/moveCompositeBlock.ts), not a new key, since the meaning is
 *     identical.
 *   - "no-composite-at-cursor": `cursorLine` does not fall inside any
 *     currently-matched CompositeBlock's own `range` — the cursor is
 *     somewhere ordinary (a plain paragraph, a non-composite list item, a
 *     heading, ...), or resolution was otherwise ambiguous (defensive only
 *     — see findCompositeContainingLine's own doc comment).
 *   - "selection-outside-composite": a CompositeBlock WAS resolved at
 *     `cursorLine`, but the selection's line envelope
 *     (`min(anchorLine,headLine)`..`max(anchorLine,headLine)`) extends
 *     outside that composite's own `range` — the user has highlighted text
 *     that reaches into an adjacent block, a plain paragraph, or across a
 *     section/list boundary. Per this function's own non-goal (top doc
 *     comment), this is always a flat rejection, never a widened target.
 */
export type CompositeSelectionRejectionReason =
  | "multiple-selections"
  | "no-composite-at-cursor"
  | "selection-outside-composite";

export type CompositeSelectionResolution =
  | { allowed: true; composite: CompositeBlockInfo }
  | { allowed: false; reason: CompositeSelectionRejectionReason };

/**
 * Finds the CompositeBlockInfo (if any) whose own `range` contains `line`.
 * parser/compositeBlocks.ts's own matching guarantee is that CompositeBlock
 * ranges never overlap (every candidate participates in at most one
 * CompositeBlock — see matchCompositeBlocks's own doc comment, condition
 * 5/6), so in the real pipeline this is always at most one match; the
 * `matches.length > 1` branch below is pure defense against that invariant
 * ever being violated (e.g. a future rule change), never an expected path.
 * Either way — zero matches or an (unexpected) ambiguous multi-match — this
 * returns `null`, which resolveCompositeSelectionTarget reports as
 * "no-composite-at-cursor".
 */
function findCompositeContainingLine(
  allComposites: CompositeBlockInfo[],
  line: number
): CompositeBlockInfo | null {
  const matches = allComposites.filter((c) => line >= c.range.startLine && line <= c.range.endLine);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * The single entry point this ticket adds. Pure: no Obsidian dependency, no
 * text mutation, no re-parse of its own (the caller already has
 * `allComposites` from its own parseDocument -> scanComplexBlocks ->
 * matchCompositeBlocks pass — this function only ever reads their
 * `.range`).
 *
 * Order of checks (each an unconditional early return — never combined or
 * reordered):
 *   1. `query.selectionCount !== 1` -> "multiple-selections".
 *   2. No CompositeBlock's `range` contains `query.cursorLine` (or more
 *      than one does, defensively) -> "no-composite-at-cursor".
 *   3. The selection's line envelope extends outside the resolved
 *      composite's `range` -> "selection-outside-composite".
 *   4. Otherwise -> `{ allowed: true, composite }`.
 */
export function resolveCompositeSelectionTarget(
  allComposites: CompositeBlockInfo[],
  query: CompositeSelectionQuery
): CompositeSelectionResolution {
  if (query.selectionCount !== 1) {
    return { allowed: false, reason: "multiple-selections" };
  }

  const composite = findCompositeContainingLine(allComposites, query.cursorLine);
  if (!composite) {
    return { allowed: false, reason: "no-composite-at-cursor" };
  }

  const selStart = Math.min(query.anchorLine, query.headLine);
  const selEnd = Math.max(query.anchorLine, query.headLine);
  if (selStart < composite.range.startLine || selEnd > composite.range.endLine) {
    return { allowed: false, reason: "selection-outside-composite" };
  }

  return { allowed: true, composite };
}
