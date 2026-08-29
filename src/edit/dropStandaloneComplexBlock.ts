/**
 * Phase 5D-3C ("Callout and Blockquote Drag and Drop", 案A approved): a
 * pure function that safely drops a standalone OR CompositeBlock-member
 * callout/blockquote at a specific, arbitrary before/after position, given
 * the CURRENT Markdown text and a snapshot of what the caller believes it
 * is dragging.
 *
 * Strictly mirrors edit/moveStandaloneComplexBlock.ts's own "re-parse ->
 * re-scan -> re-match -> snapshot照合 -> resolver再解決 -> insertBlockAt"
 * design and reuses that module's exported `snapshotMatches`/
 * `findRangeInvalidReason` verbatim (Phase 5D-3C approval: "Drag and Drop
 * の source snapshot は、既存 Move の StandaloneComplexBlockSnapshot を
 * 再利用するか、それと同じ契約を守る専用 snapshot とする") — this module
 * has NO Obsidian dependency and is wired into view/OutlineTreeView.ts
 * only via a thin dispatch method, exactly like moveStandaloneComplexBlock.
 *
 * ---- Relationship to the resolver layer ----
 *
 *   - move/findStandaloneComplexBlockDropTarget.ts#resolveStandaloneComplexBlockDropTarget
 *     (resolver): given an already-resolved source/target pair and a zone,
 *     is this specific position safe, and if so what is the exact
 *     `insertBeforeLine`.
 *   - dropStandaloneComplexBlock (this file, executor): given the caller's
 *     source snapshot and target hint, re-resolve BOTH against the CURRENT
 *     text, re-run the resolver, and perform the drop via
 *     move/moveBlock.ts's existing `insertBlockAt` primitive (UNCHANGED —
 *     no new splice/rewrite logic is written here).
 *
 * ---- Why this function re-resolves the TARGET too, not just the source --
 *
 * The ticket's approval explicitly mandates source re-resolution ("drop
 *時には必ず最新の文書を再パースし、drag source を再解決・再照合する"). This
 * function extends the same discipline to the target hint: a target's own
 * `range`/`parentId` captured at a prior dragover could equally have gone
 * stale by drop time (external edit, or a Tree refresh mid-drag) — trusting
 * a stale target position could otherwise insert content at a line number
 * that no longer means what it meant when the hint was captured. Both
 * failures are reported as safe no-ops (`changed: false`), never a
 * best-effort write against stale coordinates.
 *
 * ---- What this function does NOT do ----
 *
 * No blank-line cleanup, no Markdown reformatting/renormalization of any
 * kind, no content/text-hash comparison of the SOURCE (matching Move's own
 * "a move/drop relocates whatever content currently sits at the
 * re-verified structural position" policy — this is not a round-trip edit
 * like the Partial Edit Pane). Every rejection path leaves `lines`
 * byte-identical to the input (`changed: false`).
 */
import { ParsedDocument } from "../model/block";
import { ComplexBlockScanResult, StandaloneComplexBlockDropRejectReason } from "../model/complexBlock";
import { CompositeBlockRule } from "../model/compositeBlock";
import { parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import {
  resolveStandaloneComplexBlockDropTarget,
  StandaloneComplexBlockDropTargetHint,
  StandaloneComplexBlockDropZone,
} from "../move/findStandaloneComplexBlockDropTarget";
import { insertBlockAt } from "../move/moveBlock";
import {
  StandaloneComplexBlockSnapshot,
  findRangeInvalidReason,
  snapshotMatches,
} from "./moveStandaloneComplexBlock";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";

export interface StandaloneComplexBlockDropRequest {
  snapshot: StandaloneComplexBlockSnapshot;
  target: StandaloneComplexBlockDropTargetHint;
  zone: StandaloneComplexBlockDropZone;
}

export interface StandaloneComplexBlockDropOutcome extends LineEditOutcome {
  reason?: StandaloneComplexBlockDropRejectReason;
}

function rejected(
  lines: string[],
  reason: StandaloneComplexBlockDropRejectReason
): StandaloneComplexBlockDropOutcome {
  return { changed: false, lines, newStartLine: -1, reason };
}

/**
 * True when SOME currently-real node (a complex block OR a plain list
 * item) has EXACTLY `target`'s own `range`/`parentId` right now. Checks
 * both `complexScan.blocks` (paragraph/callout/blockquote/fenced-code/
 * table/thematic-break) and `doc.nodes` list-type entries (a plain list
 * item target), since a StandaloneComplexBlockDropTargetHint carries no
 * kind discriminant of its own — only `range`/`parentId` matter for the
 * `insertBeforeLine` arithmetic the resolver performs, so confirming
 * EITHER source still currently has this exact shape is sufficient to
 * treat the hint as live.
 */
function dropTargetHintStillValid(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  target: StandaloneComplexBlockDropTargetHint
): boolean {
  for (const info of complexScan.blocks) {
    if (
      info.range.startLine === target.range.startLine &&
      info.range.endLine === target.range.endLine &&
      info.parentId === target.parentId
    ) {
      return true;
    }
  }
  for (const node of doc.nodes.values()) {
    if (node.type !== "list") continue;
    if (
      node.range.startLine === target.range.startLine &&
      node.range.endLine === target.range.endLine &&
      node.parentId === target.parentId
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Drops the standalone-or-composite-member complex block described by
 * `request.snapshot` at `request.zone` relative to `request.target`, in
 * `text` — or returns `changed: false` (original `lines` byte-for-byte
 * unchanged) with a stable `reason` when it cannot safely do so.
 *
 * Steps (fixed order):
 *   1. `findRangeInvalidReason` on the snapshot alone (reused from
 *      edit/moveStandaloneComplexBlock.ts) — "range-invalid" on failure.
 *   2. A cheap structural bounds check on `request.target.range` against
 *      the CURRENT line count — "target-boundary-changed" on failure
 *      (checked before any parse/scan/match attempt, mirroring step 1).
 *   3. `parseDocument` -> `scanComplexBlocks` -> `matchCompositeBlocks`
 *      (fresh, against `rules` — the CALLER's currently-enabled rule set).
 *   4. Re-resolve the source: find the ComplexBlockInfo matching
 *      `request.snapshot` via `snapshotMatches` (reused, unchanged, from
 *      edit/moveStandaloneComplexBlock.ts). "source-boundary-changed" if
 *      none matches.
 *   5. Re-verify the target hint is still live (`dropTargetHintStillValid`,
 *      above). "target-boundary-changed" if not.
 *   6. `resolveStandaloneComplexBlockDropTarget(doc, resolvedSource,
 *      composites, request.target, request.zone)` (the resolver).
 *      `allowed: false` -> that exact `reason`.
 *   7. `move/moveBlock.ts#insertBlockAt(lines, resolvedSource.range,
 *      insertBeforeLine)` — UNCHANGED, existing primitive. Returns
 *      `changed: true` with the moved block's own new start line.
 */
export function dropStandaloneComplexBlock(
  text: string,
  request: StandaloneComplexBlockDropRequest,
  rules: CompositeBlockRule[]
): StandaloneComplexBlockDropOutcome {
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

  const resolvedSource = complexScan.blocks.find((b) => snapshotMatches(snapshot, b));
  if (!resolvedSource) {
    return rejected(lines, "source-boundary-changed");
  }

  if (!dropTargetHintStillValid(doc, complexScan, target)) {
    return rejected(lines, "target-boundary-changed");
  }

  const resolution = resolveStandaloneComplexBlockDropTarget(doc, resolvedSource, composites, target, zone);
  if (!resolution.allowed) {
    return rejected(lines, resolution.reason);
  }

  const { lines: outLines, newStart } = insertBlockAt(lines, resolvedSource.range, resolution.insertBeforeLine);

  return { changed: true, lines: outLines, newStartLine: newStart };
}
