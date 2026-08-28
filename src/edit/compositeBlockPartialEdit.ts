/**
 * Phase 5D-2A ("Atomic CompositeBlock Partial Edit"): pure, Obsidian-free
 * extract/apply functions for editing an ENTIRE CompositeBlock (a
 * List + Callout or List + Quote group — model/compositeBlock.ts) as ONE
 * raw-Markdown range in the Partial Edit Pane, in a single Apply.
 *
 * Mirrors edit/partialEdit.ts's extractSubtreeText/applySubtreeEdit
 * contract almost exactly (raw-text extract, full-text-fingerprint
 * conflict check, single splice) — the one real difference is HOW the
 * target is re-identified on every call. A section/list is re-identified
 * by a single `doc.nodes.get(nodeId)` lookup because its id is stable
 * within one parse; a CompositeBlockInfo's own `composite-N` id (and even
 * a member's own id — model/compositeBlock.ts's CompositeBlockMember.id
 * doc comment) is the product of a THREE-step chain
 * (parseDocument -> scanComplexBlocks -> matchCompositeBlocks) that
 * re-numbers everything from scratch on every call, so trusting either id
 * across a re-parse is exactly what edit/deleteCompositeBlock.ts's own top
 * doc comment explains this codebase never does. This module re-parses /
 * re-scans / re-matches fresh on every extract/apply call and re-identifies
 * the caller's target purely by CONTENT — ruleId, sectionId, aggregate
 * range, and every member's kind/id/range, in order — exactly like
 * deleteCompositeBlock.ts and moveCompositeBlock.ts already do.
 *
 * findRangeInvalidReason/snapshotMatches below are DELIBERATE, INDEPENDENT
 * re-implementations, not imports from deleteCompositeBlock.ts/
 * moveCompositeBlock.ts. This mirrors those two modules' own established
 * convention — see moveCompositeBlock.ts's top doc comment: each operation
 * keeps its own NoXReason union (and the matching logic that produces it)
 * fully independent of its siblings', at the cost of ~30 lines of
 * duplication per module, rather than coupling three unrelated reason
 * unions to one shared helper. CompositeBlockSnapshot/
 * buildCompositeBlockSnapshot themselves ARE reused as-is (imported from
 * deleteCompositeBlock.ts) — only the MATCHING logic is kept local, per
 * that same convention. This ticket's own approval explicitly confirms:
 * "既存の snapshot helper を共通化するためだけのリファクタリングは今回
 * 行わない".
 *
 * ---- Design: one contiguous raw-text range, one splice ----
 *
 * A CompositeBlockInfo's own `range` already spans
 * `members[0].range.startLine..members[last].range.endLine` CONTIGUOUSLY
 * — matchCompositeBlocks requires no blank line between adjacent members,
 * so there is never a gap to bridge. Extracting/replacing that whole range
 * as ONE string therefore covers every member (the list item AND its
 * callout/blockquote) at once — no per-member split/rejoin logic is
 * needed, and none is written here. Partial application (writing back only
 * the list item, or only the callout/blockquote) is impossible by
 * construction: there is only ever one string, one range, one splice.
 *
 * ---- Structural edits are NOT rejected (Phase 5D-2 audit's 方針A) ----
 *
 * applyCompositeBlockEdit never validates that `newText`, once spliced
 * back, still forms a CompositeBlock matching the same rule (or any rule
 * at all) — inserting a blank line between the list item and its
 * callout/blockquote, deleting one member entirely, editing either
 * member's content, all splice through unconditionally once the safety
 * checks below (range-invalid / snapshot-mismatch / conflict) pass. This
 * mirrors edit/partialEdit.ts's applySubtreeEdit, which never validates
 * that ITS OWN newText still parses as a well-formed list item/section
 * either — and matches this whole codebase's design where a CompositeBlock
 * is never a structure written INTO the Markdown, only one OBSERVED, live,
 * derived from it on every parse (model/compositeBlock.ts's own top doc
 * comment). `ruleStillMatches` on ApplyCompositeBlockEditOutcome exists
 * purely so a caller can show an after-the-fact, informational Notice —
 * it is never consulted before the splice, and is never a reason Apply
 * itself is refused (see NoCompositePartialEditReason, which has no such
 * value).
 */
import { ParsedDocument } from "../model/block";
import { CompositeBlockInfo, CompositeBlockRule } from "../model/compositeBlock";
import { parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import { buildCompositeBlockSnapshot, CompositeBlockSnapshot } from "./deleteCompositeBlock";
import { TranslationKey } from "../i18n";

/**
 * Every way extractCompositeBlockText/applyCompositeBlockEdit refuse to
 * touch the note. "resolve-failed" is the generic, operation-neutral
 * fallback (mirrors edit/partialEdit.ts's own `current.reason ??
 * "resolve-failed"` pattern) for a path this module's own logic below
 * cannot actually produce today — kept in the union, unused in practice,
 * exactly like deleteCompositeBlock.ts/moveCompositeBlock.ts each keep
 * several "currently unreachable through this function's own call path"
 * reasons in their own unions, so a future change fails safely (a reported
 * reason) rather than silently. "range-invalid" and "snapshot-mismatch"
 * are this module's own analogues of deleteCompositeBlock.ts's identically-
 * named/spirited checks (findRangeInvalidReason, and
 * "composite-boundary-changed" renamed here to this ticket's own requested
 * vocabulary) — deliberately NOT the same i18n wording, since "deletion"-
 * flavored text would misdescribe an edit rejection (see
 * moveCompositeBlock.ts's own top doc comment for why compositeMove* keys
 * exist separately from delete's, for exactly this reason). "conflict" is
 * this module's own analogue of applySubtreeEdit's identically-named
 * content-fingerprint check.
 */
export type NoCompositePartialEditReason =
  | "resolve-failed"
  | "range-invalid"
  | "snapshot-mismatch"
  | "conflict";

export interface ExtractCompositeBlockOutcome {
  ok: boolean;
  /** The CompositeBlock's whole raw-Markdown range (every member, in document order), joined by "\n". Empty when !ok. */
  text: string;
  startLine: number;
  endLine: number;
  /** The freshly re-matched CompositeBlockInfo's own CURRENT snapshot — present only when ok. Use this (not the caller's stale input snapshot) to re-anchor a later Apply. */
  resolvedSnapshot?: CompositeBlockSnapshot;
  reason?: NoCompositePartialEditReason;
}

/**
 * Structural self-consistency check on `snapshot` alone, against the
 * CURRENT document's line count — deliberately checked BEFORE any parse/
 * scan/match attempt, since a snapshot that fails this can never
 * legitimately describe any real CompositeBlock, past or present. A local
 * re-implementation of deleteCompositeBlock.ts's own findRangeInvalidReason
 * (same conditions: non-contiguous members, a member's own range reversed,
 * the aggregate range disagreeing with the first/last member's own range,
 * or any line number outside `[0, lineCount)`) — see this module's top doc
 * comment for why it is not imported instead.
 */
function findRangeInvalidReason(
  snapshot: CompositeBlockSnapshot,
  lineCount: number
): "range-invalid" | null {
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
 * field-for-field, the SAME CompositeBlock `snapshot` describes. A local
 * re-implementation of deleteCompositeBlock.ts's own snapshotMatches (same
 * fields compared, same deliberate exclusion of `id` — see
 * CompositeBlockSnapshot.id's own doc comment for why a `composite-N`
 * label is never trustworthy across a re-parse) — see this module's top
 * doc comment for why it is not imported instead.
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
 * Extracts the whole raw-Markdown text of the CompositeBlock described by
 * `snapshot`, against the CURRENT `doc` — a fresh parse of the note as it
 * stands right now, never a cached one (see edit/partialEdit.ts's
 * extractSubtreeText for the identical caller contract). `rules` must be
 * the caller's currently-enabled CompositeBlockRule set (e.g.
 * settingsDefaults.ts's getEnabledCompositeBlockRules(settings.compositeBlocks)),
 * exactly as matchCompositeBlocks itself requires.
 *
 * Safety order: (1) `snapshot` must be self-consistent against `doc`'s own
 * current line count (findRangeInvalidReason) — checked BEFORE any parse/
 * scan/match attempt, since a structurally broken snapshot can never
 * legitimately match anything; (2) a fresh scanComplexBlocks/
 * matchCompositeBlocks pass must produce a CompositeBlockInfo that
 * field-for-field matches `snapshot` (snapshotMatches) — never trusting
 * `snapshot`'s own `id`/member ids as current truth by themselves.
 */
export function extractCompositeBlockText(
  doc: ParsedDocument,
  snapshot: CompositeBlockSnapshot,
  rules: CompositeBlockRule[]
): ExtractCompositeBlockOutcome {
  const rangeInvalidReason = findRangeInvalidReason(snapshot, doc.lines.length);
  if (rangeInvalidReason) {
    return { ok: false, text: "", startLine: -1, endLine: -1, reason: rangeInvalidReason };
  }

  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  const resolved = composites.find((c) => snapshotMatches(snapshot, c));
  if (!resolved) {
    return { ok: false, text: "", startLine: -1, endLine: -1, reason: "snapshot-mismatch" };
  }

  const text = doc.lines.slice(resolved.range.startLine, resolved.range.endLine + 1).join("\n");
  return {
    ok: true,
    text,
    startLine: resolved.range.startLine,
    endLine: resolved.range.endLine,
    resolvedSnapshot: buildCompositeBlockSnapshot(resolved),
  };
}

export interface ApplyCompositeBlockEditOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the replaced range (valid when changed). */
  newStartLine: number;
  /**
   * Present only when changed === true: the freshly re-derived snapshot
   * for the CompositeBlock as it now stands (present only when the edited
   * range still matches the ORIGINAL ruleId — see ruleStillMatches below;
   * undefined when it no longer does, since there is then no CompositeBlock
   * left to anchor a further Apply against). A caller re-anchors its own
   * "before editing" state from THIS value, never from the pre-Apply
   * snapshot, so a second Apply within the same pane session starts from a
   * fully current basis (mirrors view/PartialEditView.ts's existing
   * paragraph-Apply re-anchoring policy).
   */
  resolvedSnapshot?: CompositeBlockSnapshot;
  /**
   * Present only when changed === true. False when the just-written
   * `newText`, spliced back, no longer forms a CompositeBlock matching the
   * snapshot's ORIGINAL ruleId at the same position (a blank line
   * inserted, a member deleted or edited into something unrecognizable,
   * etc. — see this module's own top doc comment, Phase 5D-2 audit's
   * 方針A). Purely informational, for a caller's post-Apply Notice —
   * never consulted before the splice above, and never a reason Apply
   * itself was refused (see NoCompositePartialEditReason, which has no
   * such value).
   */
  ruleStillMatches?: boolean;
  reason?: NoCompositePartialEditReason;
}

/**
 * Replaces the CompositeBlock described by `snapshot` with `newText` as
 * ONE atomic raw-text splice, against the CURRENT `doc`. Mirrors
 * edit/partialEdit.ts's applySubtreeEdit exactly in spirit: re-extract
 * fresh, compare to the pane's own "before editing" snapshot
 * (`originalText`), refuse on any mismatch, otherwise splice once.
 *
 * `originalText` must be exactly what extractCompositeBlockText returned
 * when the Partial Edit Pane first loaded this CompositeBlock (or what a
 * PRIOR successful applyCompositeBlockEdit call's own `lines` slice at
 * `[newStartLine, newStartLine + newText.split("\n").length)` would read
 * back as) — NOT `newText` itself.
 */
export function applyCompositeBlockEdit(
  doc: ParsedDocument,
  snapshot: CompositeBlockSnapshot,
  originalText: string,
  newText: string,
  rules: CompositeBlockRule[]
): ApplyCompositeBlockEditOutcome {
  const current = extractCompositeBlockText(doc, snapshot, rules);
  if (!current.ok) {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: current.reason ?? "resolve-failed",
    };
  }
  if (current.text !== originalText) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "conflict" };
  }

  const newLines = newText.split("\n");
  const lines = [
    ...doc.lines.slice(0, current.startLine),
    ...newLines,
    ...doc.lines.slice(current.endLine + 1),
  ];

  // Phase 5D-2A 方針A: re-derive, purely for the caller's own post-Apply
  // Notice, whether the just-spliced text still forms a CompositeBlock
  // matching the ORIGINAL ruleId at the SAME start line — never to gate
  // the splice above, which has already unconditionally happened by this
  // point. `c.range.startLine === current.startLine` is safe to compare
  // directly (not re-resolved through any id): nothing before
  // current.startLine in `lines` was touched by the splice, so a
  // CompositeBlock that still starts there is unambiguously "the same
  // one, edited" rather than some unrelated composite that happens to
  // start at the same line.
  const freshDoc = parseDocument(lines.join("\n"));
  const freshComplexScan = scanComplexBlocks(freshDoc);
  const freshComposites = matchCompositeBlocks(freshDoc, freshComplexScan, rules);
  const stillMatching = freshComposites.find(
    (c) => c.ruleId === snapshot.ruleId && c.range.startLine === current.startLine
  );

  return {
    changed: true,
    lines,
    newStartLine: current.startLine,
    resolvedSnapshot: stillMatching ? buildCompositeBlockSnapshot(stillMatching) : undefined,
    ruleStillMatches: !!stillMatching,
  };
}

/**
 * Maps a NoCompositePartialEditReason to its user-facing i18n key — a
 * deliberate, explicit switch, NOT a plain "reason." + reason lookup,
 * mirroring moveCompositeBlock.ts's own compositeMoveReasonText exactly
 * (see that function's own doc comment for why: "range-invalid" and
 * "snapshot-mismatch"/"conflict" are ALSO reason values used by
 * deleteCompositeBlock.ts/moveCompositeBlock.ts, each with its own
 * existing reason.* key worded specifically for THEIR operation —
 * "...deletion was cancelled...", "...move was cancelled..." — so reusing
 * those verbatim would misdescribe a Partial Edit refusal; this module
 * therefore has its own dedicated reason.compositePartialEdit* keys,
 * added alongside NoCompositePartialEditReason itself). "resolve-failed"
 * is the one exception: it is a plain, operation-neutral key already
 * reused across every Partial Edit path in this codebase (see
 * view/PartialEditView.ts's own "reason." + (outcome.reason ??
 * "resolve-failed") pattern for section/list/paragraph), so it is left to
 * the generic reason.resolve-failed key here too, consistent with that.
 */
export function compositePartialEditReasonText(
  t: (key: TranslationKey) => string,
  reason: NoCompositePartialEditReason | undefined
): string {
  switch (reason) {
    case "range-invalid":
      return t("reason.compositePartialEditRangeInvalid");
    case "snapshot-mismatch":
      return t("reason.compositePartialEditSnapshotMismatch");
    case "conflict":
      return t("reason.compositePartialEditConflict");
    case "resolve-failed":
    default:
      return t("reason.resolve-failed");
  }
}
