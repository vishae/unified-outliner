/**
 * Phase 5C-1 ticket 4-3 (2026-08-14): a pure function that safely swaps a
 * CompositeBlock (model/compositeBlock.ts) with the adjacent block in a
 * given up/down direction, given the CURRENT Markdown text and a snapshot
 * of what the caller believes it selected.
 *
 * Deliberately, strictly mirrors edit/deleteCompositeBlock.ts's own
 * "re-parse -> re-scan -> re-match -> snapshot照合" design (per this
 * ticket's own instructions): this module has NO Obsidian dependency,
 * calls no Editor API, and is not called from view/OutlineTreeView.ts, any
 * context menu, or any command yet (ticket 4-4). It reuses
 * commands/applyLineEditOutcome.ts UNCHANGED, exactly like
 * deleteCompositeBlock.ts's own CompositeDeleteOutcome does — see
 * CompositeMoveOutcome's own doc comment below.
 *
 * ---- Relationship to tickets 4-1 and 4-2 ----
 *
 * moveCompositeBlock is the third and final layer of the same
 * judge/resolver/executor split this ticket's approval established:
 *   - parser/compositeBlocks.ts#evaluateCompositeBlockMovability (4-1): may
 *     this composite move in this direction (with an explainable reason
 *     when not).
 *   - move/findCompositeMoveTarget.ts#findCompositeMoveTarget (4-2): given
 *     that it may, what is the exact LineRange to swap with (including
 *     composite-widening).
 *   - moveCompositeBlock (this file, 4-3): given the caller's snapshot,
 *     actually re-verify identity against the CURRENT text and perform the
 *     swap via move/moveBlock.ts's existing swapBlocks primitive
 *     (UNCHANGED — no new swap logic is written here).
 * Each layer calls the one before it directly rather than re-deriving an
 * equivalent judgment independently — see moveCompositeBlock's own doc
 * comment below for exactly how, and why calling
 * evaluateCompositeBlockMovability a SECOND time here (findCompositeMoveTarget
 * already calls it once internally) is deliberate, not wasteful, mirroring
 * this whole codebase's "never guess, always re-verify against current
 * ground truth" policy (e.g. deleteCompositeBlock.ts's own re-parse/re-scan
 * /re-match pipeline, which this file's structure directly parallels).
 *
 * ---- Deviations from this ticket's original (pre-4-1/4-2) API sketch ----
 *
 * This ticket was originally sketched (in an earlier planning pass, before
 * 4-1/4-2 were designed and approved) with a `CompositeMoveSnapshot`
 * carrying `compositeStartLine`/`compositeEndLine`/`rulesHash` fields and a
 * `{ok:true,newLines}|{ok:false,reason}` outcome shape. Implemented instead
 * with the ACTUAL, since-approved 4-1/4-2 APIs in mind:
 *   - The snapshot type is deleteCompositeBlock.ts's own already-exported
 *     `CompositeBlockSnapshot` (ruleId/sectionId/range/members, matched by
 *     CONTENT — never by id, see that type's own doc comment) — not a new,
 *     narrower `compositeStartLine`/`compositeEndLine` pair. Reusing the
 *     existing type avoids a second "what does it mean to identify a
 *     composite" concept in this codebase, and lets a future caller (ticket
 *     4-4) build ONE snapshot via buildCompositeBlockSnapshot and use it for
 *     either delete or move.
 *   - No `rulesHash`: deleteCompositeBlock's own signature already takes
 *     `rules: CompositeBlockRule[]` directly (the caller's currently-enabled
 *     rule set) rather than a hash of it — this file follows the exact same
 *     convention for consistency, and because no hashing scheme for
 *     CompositeBlockRule[] exists anywhere else in this codebase to reuse.
 *   - `direction` is a separate function parameter, not a snapshot field —
 *     matching evaluateCompositeBlockMovability's and
 *     findCompositeMoveTarget's own signatures (both take `direction`
 *     alongside the composite, never embedded in an identity snapshot).
 *   - The outcome is `CompositeMoveOutcome extends LineEditOutcome`
 *     (changed/lines/newStartLine/reason), not a bespoke
 *     `{ok,newLines}|{ok,reason}` union — this is what lets a future ticket
 *     4-4 pass a CompositeMoveOutcome directly into
 *     commands/applyLineEditOutcome.ts#applyLineEditOutcome with zero
 *     adapter code, exactly the way deleteCompositeBlock.ts's
 *     CompositeDeleteOutcome, edit/deleteBlock.ts's DeleteOutcome, and
 *     edit/insertBlock.ts's InsertOutcome already do.
 */
import { LineRange, ParsedDocument } from "../model/block";
import { CompositeBlockInfo, CompositeBlockMoveRejectionReason, CompositeBlockRule } from "../model/compositeBlock";
import { parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { evaluateCompositeBlockMovability, matchCompositeBlocks } from "../parser/compositeBlocks";
import { CompositeMoveDirection, findCompositeMoveTarget } from "../move/findCompositeMoveTarget";
import { swapBlocks } from "../move/moveBlock";
import { CompositeBlockSnapshot } from "./deleteCompositeBlock";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";

export interface CompositeMoveRequest {
  snapshot: CompositeBlockSnapshot;
  direction: CompositeMoveDirection;
}

/**
 * Every way moveCompositeBlock refuses to touch the note. The first four
 * values are EXACTLY model/compositeBlock.ts's
 * CompositeBlockMoveRejectionReason (ticket 4-1's
 * evaluateCompositeBlockMovability, re-run here against a FRESH parse/scan/
 * match — never re-derived differently, and never assumed from
 * findCompositeMoveTarget's own internal call to it, since that function's
 * return type collapses every rejection reason into a single `null`). The
 * last two mirror deleteCompositeBlock.ts's own NoCompositeDeleteReason
 * additions for the request/re-resolution step this function adds:
 *
 *   - "composite-boundary-changed": the current text no longer contains a
 *     CompositeBlock matching every field of the caller's snapshot —
 *     exactly deleteCompositeBlock.ts's own reason of the same name (see
 *     that module's own doc comment for the full rationale; the logic here
 *     is a deliberate, small, independent re-implementation — see this
 *     module's own snapshotMatches, below — rather than an import, to keep
 *     this file's own NoCompositeMoveReason union independent of
 *     deleteCompositeBlock.ts's NoCompositeDeleteReason).
 *   - "range-invalid": the snapshot itself is not self-consistent, checked
 *     BEFORE attempting any match — see findRangeInvalidReason, below,
 *     mirroring deleteCompositeBlock.ts's own check of the same name.
 *   - "no-target": defensive only. `evaluateCompositeBlockMovability`
 *     returning `eligible: true` against the SAME doc/complexScan/
 *     composites this function just computed should always mean
 *     `findCompositeMoveTarget` (called immediately after, against those
 *     exact same values) succeeds too — both share the identical
 *     skipBlankLines/findAdjacentAnchorNode primitives (see
 *     move/findCompositeMoveTarget.ts's own doc comment). Kept in this
 *     union anyway, exactly like deleteCompositeBlock.ts keeps several
 *     "currently unreachable through this function's own call path"
 *     reasons in its own NoCompositeDeleteReason union, so a future change
 *     to either 4-1 or 4-2 that breaks this invariant fails safely (a
 *     reported reason) rather than silently (a thrown error or a bad
 *     swap).
 */
export type NoCompositeMoveReason =
  | CompositeBlockMoveRejectionReason
  | "composite-boundary-changed"
  | "range-invalid"
  | "no-target";

/**
 * moveCompositeBlock's result — a deliberate STRUCTURAL SUBTYPE of
 * commands/applyLineEditOutcome.ts's LineEditOutcome, exactly like
 * deleteCompositeBlock.ts's CompositeDeleteOutcome. Unlike
 * CompositeDeleteOutcome, this type does NOT set `newCursorCh` on a
 * successful outcome: a delete has no "old position" left to be offset
 * from (so it always resets to column 0), but a MOVE is a swap — the
 * moved composite still exists afterward, just at a new line — so the
 * existing move/moveBlock.ts#moveBlock's own MoveOutcome convention (no
 * newCursorCh field at all) is followed here too, letting
 * applyLineEditOutcome's default "preserve the caller's relative offset
 * within the block" behavior apply, exactly like plain "Move block up/
 * down" already does for non-composite blocks today.
 */
export interface CompositeMoveOutcome extends LineEditOutcome {
  reason?: NoCompositeMoveReason;
}

function rejected(lines: string[], reason: NoCompositeMoveReason): CompositeMoveOutcome {
  return { changed: false, lines, newStartLine: -1, reason };
}

/**
 * Structural self-consistency check on `snapshot` alone, against the
 * CURRENT document's line count (`lineCount`) — deliberately checked
 * BEFORE any parse/scan/match attempt, mirroring
 * deleteCompositeBlock.ts's own findRangeInvalidReason exactly (same
 * conditions: non-contiguous members, a member's own range reversed, the
 * aggregate range disagreeing with the first/last member's own range, or
 * any line number outside `[0, lineCount)`). Reimplemented locally rather
 * than imported — see this module's own top doc comment for why.
 */
function findRangeInvalidReason(snapshot: CompositeBlockSnapshot, lineCount: number): "range-invalid" | null {
  if (snapshot.members.length === 0) return "range-invalid";

  const { startLine, endLine } = snapshot.range;
  if (startLine < 0 || endLine < startLine || endLine >= lineCount) return "range-invalid";

  const first = snapshot.members[0];
  const last = snapshot.members[snapshot.members.length - 1];
  if (first.range.startLine !== startLine || last.range.endLine !== endLine) return "range-invalid";

  for (const member of snapshot.members) {
    const r = member.range;
    if (r.startLine < 0 || r.endLine < r.startLine || r.endLine >= lineCount) return "range-invalid";
  }

  for (let k = 1; k < snapshot.members.length; k++) {
    const prevEnd = snapshot.members[k - 1].range.endLine;
    const currStart = snapshot.members[k].range.startLine;
    if (currStart !== prevEnd + 1) return "range-invalid";
  }

  return null;
}

/**
 * True when `composite` (a freshly re-matched CompositeBlockInfo) is,
 * field-for-field, the SAME CompositeBlock `snapshot` describes. Mirrors
 * deleteCompositeBlock.ts's own snapshotMatches exactly (same fields
 * compared, same deliberate exclusion of `id` — see
 * CompositeBlockSnapshot's own doc comment for why a `composite-N` label
 * is never trustworthy across a re-parse). Reimplemented locally rather
 * than imported — see this module's own top doc comment for why.
 */
function snapshotMatches(snapshot: CompositeBlockSnapshot, composite: CompositeBlockInfo): boolean {
  if (composite.ruleId !== snapshot.ruleId) return false;
  if (composite.sectionId !== snapshot.sectionId) return false;
  if (
    composite.range.startLine !== snapshot.range.startLine ||
    composite.range.endLine !== snapshot.range.endLine
  ) {
    return false;
  }
  if (composite.members.length !== snapshot.members.length) return false;

  for (let i = 0; i < composite.members.length; i++) {
    const actual = composite.members[i];
    const expected = snapshot.members[i];
    if (actual.kind !== expected.kind) return false;
    if (actual.id !== expected.id) return false;
    if (
      actual.range.startLine !== expected.range.startLine ||
      actual.range.endLine !== expected.range.endLine
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Swaps the CompositeBlock described by `request.snapshot` with the
 * adjacent block in `request.direction`, in `text` — or returns
 * `changed: false` (original `lines` byte-for-byte unchanged) with a
 * stable `reason` when it cannot safely do so.
 *
 * Steps:
 *   1. `findRangeInvalidReason` on the snapshot alone (before any
 *      parse/scan/match) — "range-invalid" on failure.
 *   2. `parseDocument` -> `scanComplexBlocks` -> `matchCompositeBlocks`
 *      (fresh, against `rules` — the CALLER's currently-enabled rule set,
 *      exactly like deleteCompositeBlock.ts requires), then find the
 *      composite matching `snapshot` via `snapshotMatches`.
 *      "composite-boundary-changed" if none matches.
 *   3. `evaluateCompositeBlockMovability(doc, complexScan, resolved,
 *      direction, composites)` (ticket 4-1). `eligible: false` -> that
 *      exact `reason`.
 *   4. `findCompositeMoveTarget(doc, complexScan, resolved, direction,
 *      composites)` (ticket 4-2), re-run against the SAME doc/complexScan/
 *      composites step 3 just used. `null` -> "no-target" (defensive; see
 *      NoCompositeMoveReason's own doc comment for why this should be
 *      unreachable in practice).
 *   5. `move/moveBlock.ts#swapBlocks(lines, resolved.range, target.range)`
 *      — UNCHANGED, existing primitive; blank-line gap between the two
 *      swapped ranges is preserved automatically (swapBlocks's own
 *      contract — see that function's doc comment), no new gap-handling
 *      code is written here. Returns `changed: true` with the moved
 *      composite's own new start line (`newStartOfA`, since `resolved.range`
 *      was passed as `swapBlocks`'s first argument — its result correctly
 *      corresponds regardless of whether `resolved` was originally above or
 *      below `target`, per that function's own internal reordering).
 */
export function moveCompositeBlock(
  text: string,
  request: CompositeMoveRequest,
  rules: CompositeBlockRule[]
): CompositeMoveOutcome {
  const doc: ParsedDocument = parseDocument(text);
  const lines = doc.lines;
  const { snapshot, direction } = request;

  const rangeInvalidReason = findRangeInvalidReason(snapshot, lines.length);
  if (rangeInvalidReason) {
    return rejected(lines, rangeInvalidReason);
  }

  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);

  const resolved = composites.find((c) => snapshotMatches(snapshot, c));
  if (!resolved) {
    return rejected(lines, "composite-boundary-changed");
  }

  const movability = evaluateCompositeBlockMovability(doc, complexScan, resolved, direction, composites);
  if (!movability.eligible) {
    return rejected(lines, movability.reason);
  }

  const target = findCompositeMoveTarget(doc, complexScan, resolved, direction, composites);
  if (!target) {
    return rejected(lines, "no-target");
  }

  const sourceRange: LineRange = { startLine: resolved.range.startLine, endLine: resolved.range.endLine };
  const { lines: outLines, newStartOfA } = swapBlocks(lines, sourceRange, target.range);

  return { changed: true, lines: outLines, newStartLine: newStartOfA };
}
