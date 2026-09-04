/**
 * Phase 5D-4C ("CompositeBlock Atomic Drag-and-Drop 最小実装", Phase 5D-4B
 * design approved): resolves whether a CompositeBlock parent row may be
 * safely dropped at a specific, user-chosen before/after position, and if
 * so, the exact `insertBeforeLine` to hand to
 * move/moveBlock.ts#insertBlockAt (UNCHANGED — no new text-splice/
 * range-rewrite primitive is introduced by this ticket).
 *
 * Deliberately a SEPARATE resolver from move/findCompositeMoveTarget.ts
 * (Move, and this ticket's own ADJACENT drop case, which reuses that
 * module UNCHANGED): findCompositeMoveTarget only ever resolves ONE
 * candidate position per direction (the immediately adjacent block, with
 * composite-widening). D&D instead validates an ARBITRARY, user-chosen
 * before/after position against a fixed safety rule set — this module is
 * the NON-ADJACENT counterpart, structurally mirroring
 * move/findStandaloneComplexBlockDropTarget.ts (the callout/blockquote
 * D&D resolver, Phase 5D-3C) but independently implemented for
 * CompositeBlock's own, different safety conditions (parentId/depth/
 * indentColumns equality, not just parentId equality — see
 * sameCompositeAnchorLevel's own doc comment in parser/compositeBlocks.ts
 * for why).
 *
 * ---- v1 scope (Phase 5D-4B design, §1/§2) ----
 *
 *   - source is always a whole CompositeBlockInfo (a CompositeBlock parent
 *     row) — never a member, never a plain list item, never a paragraph.
 *   - Drop position is "before" or "after" only — CompositeBlockDropZone
 *     is a deliberately separate two-way type from move/relocateSection.ts's
 *     three-way DropMode, mirroring
 *     move/findStandaloneComplexBlockDropTarget.ts's own
 *     StandaloneComplexBlockDropZone. CompositeBlock is atomic and has no
 *     child slot, so "inside" is never represented anywhere in this
 *     module's own API.
 *   - Drop TARGET candidates are restricted to whatever the caller
 *     resolves into a CompositeBlockDropTargetCandidate — in practice (see
 *     view/OutlineTreeView.ts#compositeDropTargetHint /
 *     #resolveCompositeDropCandidate and edit/dropCompositeBlock.ts's own
 *     resolveTargetCandidate), a plain list item OR another CompositeBlock
 *     parent row (already widened to that OTHER composite's own full
 *     range + its own anchor's parentId/depth/indentColumns by the
 *     caller — this module performs no widening of its own; see Phase
 *     5D-4B design doc §4/§5 for why widening is the CALLER's
 *     responsibility here, unlike findCompositeMoveTarget's own
 *     line-scan-based widening for the adjacent case).
 *   - Drop source and drop target must resolve to the SAME parentId, depth,
 *     AND indentColumns (sameCompositeAnchorLevel) — D&D v1 never crosses
 *     a section boundary and never targets a different structural level,
 *     exactly like Move's own "different-parent-or-depth" rejection
 *     (evaluateCompositeBlockMovability's own condition 4, shared via
 *     sameCompositeAnchorLevel rather than duplicated).
 *   - A drop that would land STRICTLY INSIDE any existing CompositeBlock's
 *     own aggregate range is rejected as "composite-internal-boundary" —
 *     mirrors move/findStandaloneComplexBlockDropTarget.ts's own condition
 *     of the same name exactly (self-drop is checked FIRST, below, so this
 *     never conflicts with the source's own permitted self-adjacent
 *     positions).
 *
 * ---- What this module does NOT do ----
 *
 * No doc.lines mutation, no move/moveBlock.ts#insertBlockAt call, no
 * command wiring, no Notice, no snapshot re-resolution of source or target
 * (the caller — view/OutlineTreeView.ts at dragover time, and
 * edit/dropCompositeBlock.ts at drop time — is responsible for handing
 * this function an ALREADY freshly-resolved source/target pair; this
 * function only judges whether the position they describe is safe). No
 * widening of a plain-list-item target into some OTHER composite's own
 * range either — that is the caller's job (see above).
 */
import { ParsedDocument } from "../model/block";
import { CompositeBlockInfo } from "../model/compositeBlock";
import { sameCompositeAnchorLevel } from "../parser/compositeBlocks";

/**
 * "before" | "after" — deliberately a separate, two-way-only type,
 * mirroring move/findStandaloneComplexBlockDropTarget.ts's own
 * StandaloneComplexBlockDropZone exactly in shape, independently declared
 * (same convention that module's own doc comment already establishes) so
 * this module carries no cross-feature type dependency.
 */
export type CompositeBlockDropZone = "before" | "after";

/**
 * A drop TARGET's own current range + parentId, as captured by the caller
 * at dragover/dragstart time (e.g.
 * view/OutlineTreeView.ts#compositeDropTargetHint) — NOT yet re-verified
 * against current ground truth, and deliberately carrying no depth/
 * indentColumns of its own (those are re-derived fresh by whichever
 * resolution step turns this hint into a CompositeBlockDropTargetCandidate
 * below, never trusted from a possibly-stale hint). Mirrors
 * move/findStandaloneComplexBlockDropTarget.ts's own
 * StandaloneComplexBlockDropTargetHint shape exactly (range + parentId
 * only), independently declared for the same reason that module's own
 * type is independently declared.
 */
export interface CompositeBlockDropTargetHint {
  range: { startLine: number; endLine: number };
  parentId: string | null;
}

/**
 * A drop target CANDIDATE, already re-resolved by the caller against
 * CURRENT ground truth (a live ListBlockNode, or another CompositeBlock's
 * own full range + its own anchor's fields) — the shape this module's own
 * resolveCompositeBlockDropTarget actually consumes. `range`/`parentId`
 * are used to compute `insertBeforeLine` and the same-section check;
 * `depth`/`indentColumns` (absent from CompositeBlockDropTargetHint above)
 * are what sameCompositeAnchorLevel compares against the source's own
 * anchor.
 */
export interface CompositeBlockDropTargetCandidate {
  range: { startLine: number; endLine: number };
  parentId: string | null;
  depth: number;
  indentColumns: number;
}

/**
 * Every way resolveCompositeBlockDropTarget refuses a drop. Deliberately
 * reuses "nested-in-list" / "different-parent-or-depth" as the exact same
 * string values CompositeBlockMoveRejectionReason
 * (model/compositeBlock.ts) already uses for the semantically identical
 * conditions, and "self-drop" / "composite-internal-boundary" as the exact
 * same string values StandaloneComplexBlockDropRejectReason
 * (model/complexBlock.ts) already uses — never surfaced to the user via a
 * translated Notice (Phase 5D-4B design §6: CompositeBlock D&D is a silent
 * rejection, mirroring every other existing D&D path in this codebase), so
 * no new i18n key is added for this type.
 */
export type CompositeBlockDropRejectReason =
  | "nested-in-list"
  | "unsafe-indent"
  | "self-drop"
  | "different-parent-or-depth"
  | "composite-internal-boundary";

export type CompositeBlockDropResolution =
  | { allowed: true; insertBeforeLine: number }
  | { allowed: false; reason: CompositeBlockDropRejectReason };

/**
 * Resolves whether `source` (a whole CompositeBlockInfo) may be dropped at
 * `zone` relative to `target` (an already-resolved candidate — see
 * CompositeBlockDropTargetCandidate's own doc comment), given the CURRENT
 * `doc` and `allComposites`.
 *
 * Checked in this fixed order, mirroring every other rejection-reporting
 * function in this codebase (evaluateCompositeBlockMovability,
 * resolveStandaloneComplexBlockDropTarget, ...) — the first failing
 * condition determines the single reported reason:
 *
 *   1. `source.members[0]` must resolve in `doc.nodes` to an actual
 *      ListBlockNode, and that node must NOT be nested inside another
 *      list item's continuation — otherwise "nested-in-list" (mirrors
 *      evaluateCompositeBlockMovability's own condition 1 exactly, but
 *      inlined here rather than shared, per Phase 5D-4B design §4: this is
 *      a single-field structural check, not a judgment liable to drift,
 *      matching how resolveStandaloneComplexBlockDropTarget itself inlines
 *      its own nested-in-list check rather than delegating).
 *   2. Every `source.members` entry of kind "list"/"single-line-list" must
 *      have `unsafeIndent === false` — otherwise "unsafe-indent" (mirrors
 *      evaluateCompositeBlockMovability's own condition 2).
 *   3. The candidate `insertBeforeLine` (computed from `target.range` and
 *      `zone`: `zone === "before"` -> `target.range.startLine`,
 *      `zone === "after"` -> `target.range.endLine + 1`) must NOT fall
 *      inside `[source.range.startLine, source.range.endLine + 1]` —
 *      otherwise "self-drop".
 *   4. `sameCompositeAnchorLevel(anchor, target)` must be true — otherwise
 *      "different-parent-or-depth" (the shared helper — see its own doc
 *      comment in parser/compositeBlocks.ts for why this must never be an
 *      independently-duplicated comparison).
 *   5. `insertBeforeLine` must not fall strictly inside any
 *      `allComposites[i].range` — otherwise "composite-internal-boundary".
 */
export function resolveCompositeBlockDropTarget(
  doc: ParsedDocument,
  source: CompositeBlockInfo,
  allComposites: CompositeBlockInfo[],
  target: CompositeBlockDropTargetCandidate,
  zone: CompositeBlockDropZone
): CompositeBlockDropResolution {
  const anchorMember = source.members[0];
  const anchorNode = doc.nodes.get(anchorMember.id);
  if (!anchorNode || anchorNode.type !== "list" || isNestedInList(doc, anchorNode)) {
    return { allowed: false, reason: "nested-in-list" };
  }

  for (const member of source.members) {
    if (member.kind !== "list" && member.kind !== "single-line-list") continue;
    const node = doc.nodes.get(member.id);
    if (node && node.type === "list" && node.unsafeIndent) {
      return { allowed: false, reason: "unsafe-indent" };
    }
  }

  const insertBeforeLine = zone === "before" ? target.range.startLine : target.range.endLine + 1;

  if (insertBeforeLine >= source.range.startLine && insertBeforeLine <= source.range.endLine + 1) {
    return { allowed: false, reason: "self-drop" };
  }

  if (!sameCompositeAnchorLevel(anchorNode, target)) {
    return { allowed: false, reason: "different-parent-or-depth" };
  }

  for (const composite of allComposites) {
    if (insertBeforeLine > composite.range.startLine && insertBeforeLine <= composite.range.endLine) {
      return { allowed: false, reason: "composite-internal-boundary" };
    }
  }

  return { allowed: true, insertBeforeLine };
}

/**
 * True when `node`'s own `parentId` resolves (in `doc.nodes`) to a node of
 * type "list" — i.e. `node` sits nested inside another list item's
 * continuation. Deliberately reimplemented here (rather than imported from
 * parser/compositeBlocks.ts, where an equivalent private, unexported
 * `isNestedInList` already exists) — see this module's own top doc
 * comment / Phase 5D-4B design §4 for why: a single-field structural
 * check, not a judgment liable to independently drift, matching
 * move/findStandaloneComplexBlockDropTarget.ts's own identical inline
 * reimplementation for the same reason.
 */
function isNestedInList(doc: ParsedDocument, node: { parentId: string | null }): boolean {
  if (!node.parentId) return false;
  const owner = doc.nodes.get(node.parentId);
  return !!owner && owner.type === "list";
}
