/**
 * Phase 5D-4C ("CompositeBlock Atomic Drag-and-Drop 最小実装", Phase 5D-4B
 * design approved): a pure function that safely drops a CompositeBlock
 * parent row at a specific, arbitrary NON-ADJACENT before/after position,
 * given the CURRENT Markdown text and a snapshot of what the caller
 * believes it is dragging.
 *
 * Strictly mirrors edit/dropStandaloneComplexBlock.ts's own "re-parse ->
 * re-scan -> re-match -> snapshot照合 -> target再解決 -> resolver再解決 ->
 * insertBlockAt" design, and edit/moveCompositeBlock.ts's own
 * findRangeInvalidReason/snapshotMatches local reimplementation
 * convention (each CompositeBlock-editing module keeps its own small,
 * independent copy of these two structural checks rather than importing a
 * shared one — see moveCompositeBlock.ts's own top doc comment for why).
 * This module has NO Obsidian dependency and is wired into
 * view/OutlineTreeView.ts only via a thin dispatch method
 * (dispatchAndApplyCompositeDrop), exactly like moveCompositeBlock/
 * deleteCompositeBlock.
 *
 * ---- Relationship to the ADJACENT case ----
 *
 * This executor handles ONLY the non-adjacent case. The adjacent case
 * (dropping immediately next to the source, in a position
 * move/findCompositeMoveTarget.ts#findCompositeMoveTarget would itself
 * resolve for that direction) is deliberately NOT handled here — it is
 * dispatched straight to the existing, UNCHANGED
 * edit/moveCompositeBlock.ts#moveCompositeBlock instead, by
 * view/OutlineTreeView.ts#dispatchAndApplyCompositeDrop (see that
 * method's own doc comment for the exact adjacency test). Phase 5D-4B
 * design §5's own explicit requirement: adjacent and non-adjacent drop
 * must never be unified into one executor.
 *
 * ---- Why this function re-resolves the TARGET too, not just the source --
 *
 * Mirrors edit/dropStandaloneComplexBlock.ts's own identical reasoning
 * exactly: a target hint captured at a prior dragover (or even at the
 * drop event itself, a moment earlier) could have gone stale by the time
 * this function actually runs (external edit, or a Tree refresh
 * mid-drag). Both source and target staleness are reported as safe
 * no-ops (`changed: false`), never a best-effort write against stale
 * coordinates.
 *
 * ---- What this function does NOT do ----
 *
 * No blank-line cleanup, no Markdown reformatting/renormalization of any
 * kind, no content/text-hash comparison of the SOURCE beyond structural
 * snapshot matching (matching moveCompositeBlock's own "a move/drop
 * relocates whatever content currently sits at the re-verified structural
 * position" policy). Every rejection path leaves `lines` byte-identical to
 * the input (`changed: false`).
 */
import { LineRange, ParsedDocument } from "../model/block";
import { CompositeBlockInfo, CompositeBlockRule } from "../model/compositeBlock";
import { parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import {
  CompositeBlockDropRejectReason,
  CompositeBlockDropTargetCandidate,
  CompositeBlockDropTargetHint,
  CompositeBlockDropZone,
  resolveCompositeBlockDropTarget,
} from "../move/findCompositeBlockDropTarget";
import { insertBlockAt } from "../move/moveBlock";
import { CompositeBlockSnapshot } from "./deleteCompositeBlock";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";

export interface CompositeBlockDropRequest {
  snapshot: CompositeBlockSnapshot;
  target: CompositeBlockDropTargetHint;
  zone: CompositeBlockDropZone;
}

/**
 * Every way dropCompositeBlock refuses to touch the note. The first five
 * values are EXACTLY CompositeBlockDropRejectReason
 * (move/findCompositeBlockDropTarget.ts's own resolver, re-run here
 * against a FRESH parse/scan/match — never re-derived differently). The
 * last three mirror moveCompositeBlock.ts's/deleteCompositeBlock.ts's own
 * request/re-resolution-step additions:
 *
 *   - "composite-boundary-changed": the current text no longer contains a
 *     CompositeBlock matching every field of the caller's snapshot.
 *   - "range-invalid": the snapshot itself is not self-consistent, checked
 *     BEFORE attempting any match.
 *   - "target-boundary-changed": no CURRENT list item or CompositeBlock
 *     has exactly the hinted target's range/parentId.
 */
export type NoCompositeDropReason =
  | CompositeBlockDropRejectReason
  | "composite-boundary-changed"
  | "range-invalid"
  | "target-boundary-changed";

export interface CompositeBlockDropOutcome extends LineEditOutcome {
  reason?: NoCompositeDropReason;
}

function rejected(lines: string[], reason: NoCompositeDropReason): CompositeBlockDropOutcome {
  return { changed: false, lines, newStartLine: -1, reason };
}

/**
 * Structural self-consistency check on `snapshot` alone, against the
 * CURRENT document's line count — deliberately checked BEFORE any parse/
 * scan/match attempt. Reimplemented locally rather than imported — see
 * this module's own top doc comment for why (mirrors
 * moveCompositeBlock.ts's own findRangeInvalidReason exactly, same
 * conditions).
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
 * field-for-field, the SAME CompositeBlock `snapshot` describes.
 * Reimplemented locally rather than imported — see this module's own top
 * doc comment for why (mirrors moveCompositeBlock.ts's own snapshotMatches
 * exactly).
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
 * Re-resolves `target` (a possibly-stale hint — range + parentId only)
 * against CURRENT ground truth: either a live ListBlockNode with exactly
 * this range/parentId (a plain list item target), or a live
 * CompositeBlockInfo with exactly this range whose own anchor
 * (`members[0]`) has this parentId (another CompositeBlock's own
 * aggregate row as target — already "widened" by construction, since the
 * whole composite's own range is used directly). Returns a fully-fresh
 * CompositeBlockDropTargetCandidate (range/parentId/depth/indentColumns
 * ALL read from the CURRENT node, never from the hint) or null when
 * neither match — the caller reports "target-boundary-changed" in that
 * case. Mirrors edit/dropStandaloneComplexBlock.ts's own
 * dropTargetHintStillValid in spirit, extended to also produce the
 * depth/indentColumns sameCompositeAnchorLevel needs (which the
 * standalone module's own boolean-only check has no need for).
 */
function resolveTargetCandidate(
  doc: ParsedDocument,
  composites: CompositeBlockInfo[],
  target: CompositeBlockDropTargetHint
): CompositeBlockDropTargetCandidate | null {
  for (const node of doc.nodes.values()) {
    if (node.type !== "list") continue;
    if (
      node.range.startLine === target.range.startLine &&
      node.range.endLine === target.range.endLine &&
      node.parentId === target.parentId
    ) {
      return {
        range: { startLine: node.range.startLine, endLine: node.range.endLine },
        parentId: node.parentId,
        depth: node.depth,
        indentColumns: node.indentColumns,
      };
    }
  }

  for (const composite of composites) {
    if (
      composite.range.startLine === target.range.startLine &&
      composite.range.endLine === target.range.endLine
    ) {
      const anchor = doc.nodes.get(composite.members[0].id);
      if (anchor && anchor.type === "list" && anchor.parentId === target.parentId) {
        return {
          range: { startLine: composite.range.startLine, endLine: composite.range.endLine },
          parentId: anchor.parentId,
          depth: anchor.depth,
          indentColumns: anchor.indentColumns,
        };
      }
    }
  }

  return null;
}

/**
 * Drops the CompositeBlock described by `request.snapshot` at
 * `request.zone` relative to `request.target`, in `text` — or returns
 * `changed: false` (original `lines` byte-for-byte unchanged) with a
 * stable `reason` when it cannot safely do so.
 *
 * Steps (fixed order):
 *   1. `findRangeInvalidReason` on the snapshot alone — "range-invalid" on
 *      failure.
 *   2. A cheap structural bounds check on `request.target.range` against
 *      the CURRENT line count — "target-boundary-changed" on failure
 *      (checked before any parse/scan/match attempt, mirroring step 1).
 *   3. `parseDocument` -> `scanComplexBlocks` -> `matchCompositeBlocks`
 *      (fresh, against `rules` — the CALLER's currently-enabled rule set).
 *   4. Re-resolve the source: find the CompositeBlockInfo matching
 *      `request.snapshot` via `snapshotMatches`.
 *      "composite-boundary-changed" if none matches.
 *   5. Re-resolve the target via `resolveTargetCandidate` (above).
 *      "target-boundary-changed" if none matches.
 *   6. `resolveCompositeBlockDropTarget(doc, resolvedSource, composites,
 *      candidate, request.zone)` (the resolver). `allowed: false` -> that
 *      exact `reason`.
 *   7. `move/moveBlock.ts#insertBlockAt(lines, resolvedSource.range,
 *      insertBeforeLine)` — UNCHANGED, existing primitive. Returns
 *      `changed: true` with the moved block's own new start line.
 */
export function dropCompositeBlock(
  text: string,
  request: CompositeBlockDropRequest,
  rules: CompositeBlockRule[]
): CompositeBlockDropOutcome {
  const doc: ParsedDocument = parseDocument(text);
  const lines = doc.lines;
  const { snapshot, target, zone } = request;

  const rangeInvalidReason = findRangeInvalidReason(snapshot, lines.length);
  if (rangeInvalidReason) {
    return rejected(lines, rangeInvalidReason);
  }
  if (
    target.range.startLine < 0 ||
    target.range.endLine < target.range.startLine ||
    target.range.endLine >= lines.length
  ) {
    return rejected(lines, "target-boundary-changed");
  }

  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);

  const resolvedSource = composites.find((c) => snapshotMatches(snapshot, c));
  if (!resolvedSource) {
    return rejected(lines, "composite-boundary-changed");
  }

  const candidate = resolveTargetCandidate(doc, composites, target);
  if (!candidate) {
    return rejected(lines, "target-boundary-changed");
  }

  const resolution = resolveCompositeBlockDropTarget(doc, resolvedSource, composites, candidate, zone);
  if (!resolution.allowed) {
    return rejected(lines, resolution.reason);
  }

  const sourceRange: LineRange = {
    startLine: resolvedSource.range.startLine,
    endLine: resolvedSource.range.endLine,
  };
  const { lines: outLines, newStart } = insertBlockAt(lines, sourceRange, resolution.insertBeforeLine);

  return { changed: true, lines: outLines, newStartLine: newStart };
}
