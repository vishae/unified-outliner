/**
 * Phase 5C-1 ticket 2 (2026-08-13): a pure function that safely deletes a
 * CompositeBlock (model/compositeBlock.ts) as one unit, given the CURRENT
 * Markdown text and a snapshot of what the caller believes it selected.
 *
 * Scope reminder (see this ticket's completion report): this module has NO
 * Obsidian dependency, calls no Editor API, and is not called from
 * view/OutlineTreeView.ts, any context menu, any confirmation dialog, or
 * any command yet — a later ticket wires it up. It reuses
 * commands/applyLineEditOutcome.ts UNCHANGED (see CompositeDeleteOutcome's
 * doc comment below for why its shape is a structural subtype of
 * LineEditOutcome, requiring no adapter code).
 *
 * ---- Why this function re-parses / re-scans / re-matches internally ----
 *
 * Unlike edit/deleteBlock.ts (which trusts a ParsedDocument its caller
 * already produced, because a BlockNode's `sec-N`/`li-N` id is cheap for a
 * caller to re-resolve with a single fresh parseDocument() call, and
 * view/OutlineTreeView.ts#dispatchAndApply already does exactly that before
 * every block command), a CompositeBlockInfo's `composite-N` id is the
 * product of THREE chained steps — parseDocument -> scanComplexBlocks ->
 * matchCompositeBlocks — each of which re-numbers its own output from
 * scratch on every call. Trusting an id captured at Tree-render time would
 * mean trusting that all three steps reproduce byte-identical numbering
 * after ANY unrelated document edit, which this codebase's "never guess,
 * always re-verify against current ground truth" policy (see
 * parser/compositeBlocks.ts's evaluateCompositeBlockDeletability,
 * tree/buildOutlineTree.ts's isCompositeSafelyProjectable,
 * edit/partialEdit.ts's re-extract-and-compare conflict check) explicitly
 * rejects.
 *
 * So deleteCompositeBlock takes the raw CURRENT `text` (not a pre-parsed
 * ParsedDocument) and performs its own parseDocument -> scanComplexBlocks ->
 * matchCompositeBlocks pass, then finds the CompositeBlock that matches the
 * caller-supplied CompositeBlockSnapshot BY CONTENT (ruleId, sectionId,
 * range, and every member's kind/id/range, in document order) —
 * deliberately NEVER by `id` alone (see snapshotMatches below, and
 * CompositeBlockSnapshot.id's own doc comment). A caller (e.g. a future
 * Tree command) is expected to build the snapshot via
 * buildCompositeBlockSnapshot from whatever CompositeBlockInfo it showed
 * the user at the moment they chose to delete it — never to hand-construct
 * one from scratch.
 *
 * ---- What this function does NOT do ----
 *
 * No blank-line cleanup before/after the deleted range, no merging of
 * whatever becomes adjacent, no Markdown reformatting/renormalization of
 * any kind — mirrors edit/deleteBlock.ts's own "never touch anything the
 * caller didn't ask to touch" policy exactly. Every rejection path leaves
 * `lines` byte-identical to the input (`changed: false`).
 */
import { LineRange, ParsedDocument } from "../model/block";
import {
  CompositeBlockDeleteRejectionReason,
  CompositeBlockInfo,
  CompositeBlockRule,
  CompositeMemberKind,
} from "../model/compositeBlock";
import { parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { evaluateCompositeBlockDeletability, matchCompositeBlocks } from "../parser/compositeBlocks";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";

/** One member's identity/position, as captured at snapshot time — see CompositeBlockSnapshot. */
export interface CompositeBlockMemberSnapshot {
  kind: CompositeMemberKind;
  id: string;
  range: LineRange;
}

/**
 * A point-in-time capture of a CompositeBlockInfo, taken by the caller when
 * the user selects a CompositeBlock for deletion — typically via
 * buildCompositeBlockSnapshot, applied to whatever CompositeBlockInfo was
 * shown in the Tree at that moment. Deleting NEVER trusts this snapshot's
 * fields as current truth by themselves: deleteCompositeBlock always
 * re-derives a fresh CompositeBlockInfo from the CURRENT text and compares
 * it against every field here (see snapshotMatches) before acting.
 */
export interface CompositeBlockSnapshot {
  /**
   * The CompositeBlockInfo's own id AT SNAPSHOT TIME. Kept for caller
   * convenience/debugging/logging only — deliberately NEVER used as a
   * matching key by snapshotMatches (see this module's top doc comment for
   * why `composite-N` ids cannot be trusted to survive a re-parse). A
   * snapshot's `id` field being present has no bearing on whether it will
   * be found deletable: two snapshots with the SAME `id` but different
   * `ruleId`/`range`/`members` are never treated as the same target, and a
   * snapshot's own `id` reappearing (reused by an unrelated CompositeBlock
   * after the document changed) never causes a false match either.
   */
  id: string;
  ruleId: string;
  sectionId: string | null;
  range: LineRange;
  /** In document order — see snapshotMatches for the exact equality this requires. */
  members: CompositeBlockMemberSnapshot[];
}

/**
 * Projects a live CompositeBlockInfo (as produced by
 * parser/compositeBlocks.ts's matchCompositeBlocks) into a
 * CompositeBlockSnapshot. This is the one intended way to build a
 * CompositeBlockDeleteRequest's `snapshot` field — a caller should never
 * hand-construct one field-by-field.
 */
export function buildCompositeBlockSnapshot(composite: CompositeBlockInfo): CompositeBlockSnapshot {
  return {
    id: composite.id,
    ruleId: composite.ruleId,
    sectionId: composite.sectionId,
    range: { startLine: composite.range.startLine, endLine: composite.range.endLine },
    members: composite.members.map((m) => ({
      kind: m.kind,
      id: m.id,
      range: { startLine: m.range.startLine, endLine: m.range.endLine },
    })),
  };
}

export interface CompositeBlockDeleteRequest {
  snapshot: CompositeBlockSnapshot;
}

/**
 * Every way deleteCompositeBlock refuses to touch the note. The first
 * seven values are EXACTLY model/compositeBlock.ts's
 * CompositeBlockDeleteRejectionReason (ticket 1's
 * evaluateCompositeBlockDeletability, re-run here against a FRESH
 * parse/scan/match — never re-derived differently). The last two are
 * specific to the request/re-resolution step this ticket adds:
 *
 *   - "composite-boundary-changed": the current text no longer contains a
 *     CompositeBlock matching every field of the caller's snapshot
 *     (content drift, deletion elsewhere, a disabled rule, or an unrelated
 *     CompositeBlock now occupying the same `id` — see snapshotMatches).
 *   - "range-invalid": the snapshot itself is not self-consistent (members
 *     not contiguous, aggregate range disagreeing with the first/last
 *     member's own range, a member's own range reversed) or falls outside
 *     the CURRENT document's line count — checked BEFORE attempting any
 *     match, since a structurally broken snapshot can never legitimately
 *     match anything.
 *
 * IMPORTANT (see this ticket's completion report for the full analysis):
 * because matchCompositeBlocks itself only ever assembles a
 * CompositeBlockInfo out of members that are ALREADY
 * editability:"supported" (nested callout / unterminated fence / malformed
 * table / paragraph never qualify as match candidates at all — see
 * parser/compositeBlocks.ts's collectCandidates) and always requires every
 * member to share one enclosing section, the five reasons
 * "member-resolve-failed" / "member-not-supported" / "member-has-diagnostic" /
 * "unsupported-member-kind" / "ambiguous-section" are — for THIS function's
 * actual call path — effectively unreachable: any CompositeBlockInfo that
 * could possibly satisfy snapshotMatches already passed those same
 * conditions during matchCompositeBlocks's own candidate collection. A
 * snapshot describing something that has since become nested/unterminated/
 * malformed/diagnosed will simply no longer be FOUND by snapshotMatches at
 * all, and is rejected as "composite-boundary-changed" instead — which is
 * the semantically correct reason from this function's perspective ("the
 * thing you selected is no longer recognizable"), not a gap. Only
 * "nested-in-list" and "member-unsafe-indent" are reachable through a
 * genuinely-matched, freshly-recognized composite, because
 * matchCompositeBlocks does not itself check either of those two — see
 * evaluateCompositeBlockDeletability's own doc comment. The five
 * currently-unreachable reasons are kept in this union (rather than
 * narrowed away) so that if evaluateCompositeBlockDeletability ever gains a
 * NEW check matchCompositeBlocks does not already guarantee, this function
 * starts correctly reporting it with zero code changes here.
 */
export type NoCompositeDeleteReason =
  | CompositeBlockDeleteRejectionReason
  | "composite-boundary-changed"
  | "range-invalid";

/**
 * deleteCompositeBlock's result — a deliberate STRUCTURAL SUBTYPE of
 * commands/applyLineEditOutcome.ts's LineEditOutcome (`changed`/`lines`/
 * `newStartLine`/`reason`/`newCursorCh`, with `reason` narrowed from
 * `string` to this module's own NoCompositeDeleteReason literal union — a
 * valid interface-extension narrowing since every NoCompositeDeleteReason
 * value is itself a `string`). Investigated per this ticket's brief and
 * found fully compatible WITHOUT any change to LineEditOutcome or
 * applyLineEditOutcome.ts (see this ticket's completion report §2 for the
 * comparison). A future caller can therefore pass a CompositeDeleteOutcome
 * directly wherever a LineEditOutcome is expected — e.g.
 * view/OutlineTreeView.ts#dispatchAndApply's `dispatch` callback shape — the
 * exact same way edit/deleteBlock.ts's DeleteOutcome and
 * edit/insertBlock.ts's InsertOutcome already do, with zero adapter code.
 */
export interface CompositeDeleteOutcome extends LineEditOutcome {
  reason?: NoCompositeDeleteReason;
}

function rejected(lines: string[], reason: NoCompositeDeleteReason): CompositeDeleteOutcome {
  return { changed: false, lines, newStartLine: -1, newCursorCh: 0, reason };
}

/**
 * Structural self-consistency check on `snapshot` alone, against the
 * CURRENT document's line count (`lineCount`) — deliberately checked
 * BEFORE any parse/scan/match attempt, since a snapshot that fails this
 * can never legitimately describe any real CompositeBlock, past or
 * present. Covers every case Phase 5C-1 ticket 2's brief calls
 * "不連続、逆転、文書範囲外、または安全に確定できない": non-contiguous
 * members (a gap or overlap between consecutive members' ranges), a
 * member's own range reversed, the aggregate `range` disagreeing with the
 * first/last member's own range, or any line number outside `[0,
 * lineCount)`.
 */
function findRangeInvalidReason(
  snapshot: CompositeBlockSnapshot,
  lineCount: number
): NoCompositeDeleteReason | null {
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
 * field-for-field, the SAME CompositeBlock the caller's `snapshot`
 * describes. Deliberately does NOT compare `composite.id` — see
 * CompositeBlockSnapshot.id's own doc comment for why a `composite-N`
 * label is never trustworthy across a re-parse. Every other field is
 * compared: `ruleId`, `sectionId`, the aggregate `range`, member count,
 * and — in document order — each member's `kind`/`id`/`range`. Any single
 * disagreement means "not confirmed to be the same target", never "close
 * enough".
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
 * Deletes the CompositeBlock described by `request.snapshot` from `text`,
 * as one unit — or returns `changed: false` (original `lines` byte-for-byte
 * unchanged) with a stable `reason` when it cannot safely do so. See this
 * module's top doc comment for the full re-parse/re-scan/re-match/re-verify
 * pipeline and NoCompositeDeleteReason's doc comment for exactly which
 * reasons are reachable in practice.
 *
 * `rules` must be the CALLER's currently-enabled CompositeBlockRule set
 * (e.g. settingsDefaults.ts's getEnabledCompositeBlockRules(settings.compositeBlocks)
 * — the same value view/OutlineTreeView.ts#refresh() already computes),
 * exactly as matchCompositeBlocks itself requires; this function does not
 * infer or cache a rule set from the snapshot. A rule the snapshot's
 * composite depended on being disabled between selection and delete is
 * handled for free by this requirement: matchCompositeBlocks simply will
 * not produce that composite again, so snapshotMatches finds nothing and
 * this function safely reports "composite-boundary-changed".
 *
 * Deletion itself (once every check passes) removes exactly
 * `resolved.range.startLine` through `resolved.range.endLine` (inclusive)
 * from `doc.lines` — a single array-slice-and-concat, mirroring
 * edit/deleteBlock.ts's own deleteBlock() exactly. No blank-line cleanup,
 * no merging of newly-adjacent content, no renormalization.
 *
 * `newStartLine` (the post-delete fallback cursor line) is the deletion's
 * own start line, clamped into the shorter document — the SAME final
 * fallback edit/deleteBlock.ts's computeFallbackLine uses when no
 * sibling/parent resolves. This function does not attempt a
 * composite-level "sibling" fallback (unlike deleteBlock.ts's
 * prev-sibling/next-sibling/parent chain): CompositeBlockInfo carries no
 * such linkage of its own (see model/compositeBlock.ts — it is a read-only
 * VIEW over ids from two other models, not a first-class node with
 * sibling pointers), and this ticket's brief scopes UI/cursor-placement
 * refinement out. See this ticket's completion report for why a smarter
 * fallback is left as a later (Tree-wiring ticket) decision, not a pure-
 * function correctness requirement.
 */
export function deleteCompositeBlock(
  text: string,
  request: CompositeBlockDeleteRequest,
  rules: CompositeBlockRule[]
): CompositeDeleteOutcome {
  const doc: ParsedDocument = parseDocument(text);
  const lines = doc.lines;
  const { snapshot } = request;

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

  const deletability = evaluateCompositeBlockDeletability(doc, complexScan, resolved);
  if (!deletability.deletable) {
    return rejected(lines, deletability.reason ?? "ambiguous-section");
  }

  const { startLine, endLine } = resolved.range;
  const outLines = [...lines.slice(0, startLine), ...lines.slice(endLine + 1)];
  const newStartLine = Math.max(0, Math.min(startLine, outLines.length - 1));

  return { changed: true, lines: outLines, newStartLine, newCursorCh: 0 };
}
