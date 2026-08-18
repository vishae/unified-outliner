/**
 * Phase 5T-1 ("Outline Tree の paragraph context menu からの安全な上下移動"):
 * a pure function that safely moves a paragraph from a Tree-triggered
 * context-menu click, given the CURRENT Markdown text and an anchor
 * captured when the Tree's context menu was built.
 *
 * This module does NOT implement a new swap algorithm. Step 4 below
 * delegates entirely to move/resolveMoveTarget.ts's existing
 * `moveComplexBlock` / `findComplexSiblingTarget` — the exact same pure
 * functions Phase 5P-4's body-cursor-triggered "Move block up/down"
 * already uses for paragraph. This file's only job is the part 5P-4 never
 * needed: safely turning a Tree row (which has no live cursor position to
 * re-resolve from) back into a `ResolvedMoveUnit`, without ever trusting
 * the Tree's own transient state as ground truth.
 *
 * ---- Why this is a NEW module rather than reusing an existing snapshot type ----
 *
 * edit/moveCompositeBlock.ts's `CompositeBlockSnapshot` and
 * edit/moveStandaloneComplexBlock.ts's `StandaloneComplexBlockSnapshot`
 * both re-verify identity STRUCTURALLY ONLY (kind/range/parentId, or
 * ruleId/sectionId/members) — deliberately WITHOUT a body-text comparison
 * (see moveStandaloneComplexBlock.ts's own top doc comment: "no
 * content/text-hash comparison ... a move relocates whatever content
 * currently sits at the re-verified structural position"). That is safe
 * for callout/blockquote/CompositeBlock because their own Markdown syntax
 * (`>`, `>[!...]`, a matched member sequence) already makes a
 * mis-identification structurally implausible.
 *
 * A paragraph has no such syntax marker at all — it is defined purely as
 * "text that isn't any other kind" (parser/complexBlocks.ts's
 * scanParagraphBlocks) — so a structural-only match (parentId/depth) is
 * NOT enough to safely conclude "this is the same logical paragraph the
 * user right-clicked": an unrelated edit elsewhere in the note can shift
 * scan-local `paragraph-N` numbering without changing this paragraph's
 * position, or leave a DIFFERENT, unrelated paragraph sitting at the same
 * structural slot. Phase 5P-2's `edit/paragraphPartialEdit.ts` already
 * solved exactly this problem for paragraph Partial Edit's Apply step
 * (three checks: scan-local id as a cheap pre-filter, parentId/depth
 * structural match, byte-for-byte content match) — this module reuses that
 * same three-layer design for the Tree move case, per the 5T-0 design
 * doc's §5-2 proposal and the 5T-1 ticket's explicit instruction to build
 * `ParagraphMoveAnchor` on the same model.
 */
import { ParsedDocument } from "../model/block";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../model/complexBlock";
import { complexBlockDepth, scanComplexBlocks } from "../parser/complexBlocks";
import { parseDocument } from "../parser/parseDocument";
import { MoveDirection } from "../move/findMoveTarget";
import {
  ComplexSiblingReason,
  ResolvedMoveUnit,
  moveComplexBlock,
} from "../move/resolveMoveTarget";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";
import { TranslationKey } from "../i18n";

/**
 * Captured once, at Tree context-menu build time, from a live
 * `ComplexBlockInfo` (kind "paragraph") the Tree's own refresh() cycle
 * already resolved — see `buildParagraphMoveAnchor` below. Never persisted
 * beyond the moment the user clicks "Move up"/"Move down"; never written to
 * the note, to plugin settings, or to any Markdown comment/hidden
 * attribute. `complexBlockId` is a scan-local id (parser/complexBlocks.ts's
 * own per-call sequence) — kept here ONLY as a cheap first-pass filter
 * (§4 stage 1 of moveParagraphFromAnchor below), never as the sole or
 * final determinant of identity. The Tree node's own view-layer id
 * (`tree-paragraph:N` — tree/buildOutlineTree.ts) never appears anywhere
 * in this type: an anchor is built from the paragraph's OWN
 * `ComplexBlockInfo`, not from the Tree node that happened to display it.
 */
export interface ParagraphMoveAnchor {
  kind: "paragraph";
  complexBlockId: string;
  parentId: string | null;
  depth: number;
  /** Byte-for-byte "before the move" snapshot — compared verbatim at execution time (stage 3, below). */
  originalText: string;
  rangeStart: number;
  rangeEnd: number;
}

/**
 * Projects a live, already-resolved paragraph `ComplexBlockInfo` into a
 * `ParagraphMoveAnchor`. This is the one intended way to build an anchor —
 * a caller should never hand-construct one field-by-field, and must never
 * derive one from the Tree node's own `line`/`rangeStart` alone (those are
 * usable only as a UI-time HINT for which `ComplexBlockInfo` to resolve
 * from the CURRENT scan — see this module's own top doc comment and the
 * 5T-0 design doc §5-2). Returns `null` when `info` is not an eligible
 * paragraph (wrong kind, or `editability !== "supported"`) — defense in
 * depth for a caller that has not already filtered to Phase 5P-3/5P-4's
 * own eligible set, mirroring
 * edit/moveStandaloneComplexBlock.ts#buildStandaloneComplexBlockSnapshot's
 * identical "return null rather than guess" convention.
 */
export function buildParagraphMoveAnchor(
  doc: ParsedDocument,
  info: ComplexBlockInfo
): ParagraphMoveAnchor | null {
  if (info.kind !== "paragraph") return null;
  if (info.editability !== "supported") return null;
  return {
    kind: "paragraph",
    complexBlockId: info.id,
    parentId: info.parentId,
    depth: complexBlockDepth(doc, info.parentId),
    originalText: doc.lines.slice(info.range.startLine, info.range.endLine + 1).join("\n"),
    rangeStart: info.range.startLine,
    rangeEnd: info.range.endLine,
  };
}

/**
 * A minimal, structural hint shape for resolving a paragraph
 * `ComplexBlockInfo` from a Tree-node-like object. Deliberately NOT the
 * full `OutlineTreeParagraphNode` type (this module stays independent of
 * tree/buildOutlineTree.ts and view/OutlineTreeView.ts, matching this
 * file's existing "pure function, no Tree/Obsidian dependency"
 * convention) — any caller holding a `rangeStart`/`rangeEnd`/`parentId`
 * triple, Tree node or otherwise, can use this.
 */
export interface ParagraphTreeNodeHint {
  rangeStart: number;
  rangeEnd: number;
  parentId: string | null;
}

/**
 * Phase 5T-1R §2/§3: resolves the LIVE `ComplexBlockInfo` (kind
 * "paragraph") that a Tree-node-like `hint` currently corresponds to,
 * given a fresh `scanComplexBlocks()` result over the CURRENT document.
 *
 * This is the extraction, mandated by the 5T-1R ticket, of the resolution
 * glue that used to live inline inside
 * view/OutlineTreeView.ts#showParagraphMoveMenu (added there as the
 * Phase 5T-1 post-commit real-device bug fix, faadbac) — pulled out here
 * so it is directly unit-testable without an OutlineTreeView instance or
 * a DOM, and so any future Tree-triggered paragraph feature reuses this
 * exact function rather than re-deriving (and potentially re-breaking)
 * the same logic inline a second time.
 *
 * ---- Root-cause context (why this function exists at all) ----
 *
 * A paragraph Tree node's OWN `id` (tree/buildOutlineTree.ts's
 * `paragraphViewId` — `` `tree-paragraph:${ordinal}` ``) is a Tree-VIEW-ONLY
 * identity: a display-ordinal string, rebuilt fresh on every `refresh()`,
 * that exists purely for the DOM key / event wiring / row highlighting /
 * `nodeById` lookup. It is NEVER the same id space as
 * `ComplexBlockInfo.id` (parser/complexBlocks.ts's scan-local
 * `` `paragraph-${n}` ``, valid only within one `scanComplexBlocks()`
 * call) — comparing the two directly is exactly the bug Phase 5T-1's
 * initial commit (0fc3b0a) shipped and the real-device-only-detectable
 * failure faadbac fixed (the two id spaces simply never match, so the
 * paragraph context menu silently never opened for any paragraph row).
 * This function is the one, and from now on the ONLY, sanctioned way to
 * bridge a Tree node back to its live `ComplexBlockInfo`: treat the Tree
 * node's structural fields (`rangeStart`/`rangeEnd`/`parentId`) as HINTS
 * for a fresh scan, never its `id` string.
 *
 * Returns `null` when: no `kind === "paragraph"` block in `scan.blocks`
 * matches all three hint fields (the paragraph the Tree row displayed no
 * longer exists at that structural position — deleted, merged into a
 * neighbor, or the document changed since the Tree was last built); or
 * more than one block matches (a well-formed scan should never produce
 * two blocks sharing one exact line range, but resolving to `null` rather
 * than picking arbitrarily keeps this function's own "never guess"
 * contract, matching `moveParagraphFromAnchor`'s own stage-3 "ambiguous ->
 * reject" convention below).
 *
 * IMPORTANT — this function alone is NOT a green light to write to the
 * body. A caller must still run the returned block through
 * `buildParagraphMoveAnchor` and then `moveParagraphFromAnchor` (which
 * re-derives its OWN fresh scan and re-verifies parentId/depth/content
 * byte-for-byte) before ever touching the note — this function only
 * answers "which live block does this Tree node currently point at",
 * never "is it still safe to move".
 */
export function resolveParagraphFromTreeHint(
  hint: ParagraphTreeNodeHint,
  scan: ComplexBlockScanResult
): ComplexBlockInfo | null {
  const matches = scan.blocks.filter(
    (b) =>
      b.kind === "paragraph" &&
      b.range.startLine === hint.rangeStart &&
      b.range.endLine === hint.rangeEnd &&
      b.parentId === hint.parentId
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Every way moveParagraphFromAnchor refuses to touch the note.
 *
 *   - "resolve-failed": no paragraph with `anchor.complexBlockId` exists in
 *     a fresh scan of the CURRENT text at all (deleted, merged into a
 *     neighbor, split by a new blank line so a different/shorter candidate
 *     now occupies that id slot, or downgraded to an unsupported/ambiguous
 *     kind) — mirrors edit/paragraphPartialEdit.ts's identical reason of
 *     the same name (stage 1).
 *   - "identity-changed": the id-matched candidate exists and is
 *     "supported", but its `parentId`/depth no longer match the anchor —
 *     it moved to a different section/list-item parent, or its nesting
 *     depth changed, even though its own text may be unchanged (stage 2).
 *   - "content-changed": id, parentId, and depth all still match, but the
 *     freshly re-extracted text differs from `anchor.originalText` — the
 *     note changed (this paragraph's own content, specifically) since the
 *     Tree's context menu was built (stage 3).
 *   - "ambiguous-match": the id-matched candidate passes every check above,
 *     but at least one OTHER paragraph currently in the document
 *     independently shares the exact same `parentId`/depth/content triple.
 *     When that happens, scan-local id numbering could have silently
 *     shifted onto either one of two structurally-identical duplicates —
 *     nothing in the fresh scan can prove which one the user actually
 *     right-clicked, so this rejects rather than guessing (stage 3,
 *     defense-in-depth beyond what edit/paragraphPartialEdit.ts's Apply
 *     step needed, because a Tree click has no live cursor position to
 *     break the tie the way a body-cursor command always does).
 *   - "no-sibling"/"boundary-unknown": exactly
 *     move/resolveMoveTarget.ts#ComplexSiblingReason — the re-resolved
 *     paragraph is a real, uniquely-identified move source, but
 *     `moveComplexBlock` found no safe adjacent partner in `direction`
 *     (stage 4, delegated verbatim — see this module's own top doc
 *     comment).
 */
export type NoParagraphTreeMoveReason =
  | "resolve-failed"
  | "identity-changed"
  | "content-changed"
  | "ambiguous-match"
  | ComplexSiblingReason;

/**
 * moveParagraphFromAnchor's result — a deliberate structural subtype of
 * commands/applyLineEditOutcome.ts's LineEditOutcome, exactly like
 * CompositeMoveOutcome/StandaloneComplexBlockMoveOutcome. Never sets
 * `newCursorCh` on success: a move is a swap, the moved paragraph still
 * exists afterward just at a new line, and applyLineEditOutcome's default
 * "preserve the caller's relative offset within the block" behavior
 * already handles that correctly (same reasoning as those two sibling
 * outcome types).
 */
export interface ParagraphTreeMoveOutcome extends LineEditOutcome {
  reason?: NoParagraphTreeMoveReason;
}

function rejected(lines: string[], reason: NoParagraphTreeMoveReason): ParagraphTreeMoveOutcome {
  return { changed: false, lines, newStartLine: -1, reason };
}

function extractText(doc: ParsedDocument, startLine: number, endLine: number): string {
  return doc.lines.slice(startLine, endLine + 1).join("\n");
}

/**
 * Moves the paragraph described by `anchor` one step in `direction`, in
 * `text` — or returns `changed: false` (original `lines` byte-for-byte
 * unchanged) with a stable `reason` when it cannot safely do so.
 *
 * Steps (fixed order, per the 5T-1 ticket §4):
 *
 *   1. Candidate resolution: re-parse `text` fresh and re-scan for
 *      `kind === "paragraph"` / `editability === "supported"` blocks.
 *      `anchor.complexBlockId` narrows this to (at most) ONE id-matched
 *      candidate — used ONLY to narrow, never alone as confirmation (see
 *      `NoParagraphTreeMoveReason`'s own doc comment). No candidate ->
 *      "resolve-failed".
 *   2. Structural match: the id-matched candidate's `parentId` and
 *      `complexBlockDepth` must equal the anchor's. Mismatch ->
 *      "identity-changed".
 *   3. Content match: the candidate's current text, re-extracted from the
 *      fresh `doc.lines`, must equal `anchor.originalText` byte-for-byte.
 *      Mismatch -> "content-changed". Then, independently of the
 *      id-matched candidate, every OTHER currently-recognized paragraph
 *      sharing the same `parentId`/depth/content is checked too — more
 *      than one match anywhere in the document -> "ambiguous-match" (see
 *      that reason's own doc comment for why this is a real, not merely
 *      theoretical, safety gap for a Tree-triggered move specifically).
 *   4. Delegation: build a `ResolvedMoveUnit` from the now-uniquely
 *      re-resolved paragraph and hand it directly to
 *      move/resolveMoveTarget.ts#moveComplexBlock — the SAME function
 *      Phase 5P-4's body-cursor "Move block up/down" already uses. No new
 *      swap/adjacency logic exists in this file; a "no-sibling"/
 *      "boundary-unknown" rejection from that call is returned verbatim.
 */
export function moveParagraphFromAnchor(
  text: string,
  anchor: ParagraphMoveAnchor,
  direction: MoveDirection
): ParagraphTreeMoveOutcome {
  const doc: ParsedDocument = parseDocument(text);
  const lines = doc.lines;

  const scan = scanComplexBlocks(doc);
  const eligibleParagraphs = scan.blocks.filter(
    (b) => b.kind === "paragraph" && b.editability === "supported"
  );

  // Stage 1: candidate resolution. anchor.complexBlockId narrows to at most
  // one candidate — deliberately never trusted alone (see this file's top
  // doc comment).
  const idCandidate = eligibleParagraphs.find((b) => b.id === anchor.complexBlockId);
  if (!idCandidate) {
    return rejected(lines, "resolve-failed");
  }

  // Stage 2: structural match.
  const idCandidateDepth = complexBlockDepth(doc, idCandidate.parentId);
  if (idCandidate.parentId !== anchor.parentId || idCandidateDepth !== anchor.depth) {
    return rejected(lines, "identity-changed");
  }

  // Stage 3: content match, then a document-wide ambiguity check.
  const idCandidateText = extractText(doc, idCandidate.range.startLine, idCandidate.range.endLine);
  if (idCandidateText !== anchor.originalText) {
    return rejected(lines, "content-changed");
  }

  const allStructuralAndContentMatches = eligibleParagraphs.filter((b) => {
    if (b.parentId !== anchor.parentId) return false;
    if (complexBlockDepth(doc, b.parentId) !== anchor.depth) return false;
    return extractText(doc, b.range.startLine, b.range.endLine) === anchor.originalText;
  });
  if (allStructuralAndContentMatches.length > 1) {
    return rejected(lines, "ambiguous-match");
  }

  // Stage 4: delegate to the existing 5P-4 move pipeline. No new swap logic.
  const unit: ResolvedMoveUnit = {
    kind: "paragraph",
    range: idCandidate.range,
    parentId: idCandidate.parentId,
    complexBlockId: idCandidate.id,
  };
  const outcome = moveComplexBlock(doc, unit, direction, scan);
  if (!outcome.changed) {
    return rejected(lines, outcome.reason ?? "no-sibling");
  }
  return { changed: true, lines: outcome.lines, newStartLine: outcome.newStartLine };
}

/**
 * Translates a paragraph-Tree-move rejection reason into the current
 * locale — mirrors edit/moveCompositeBlock.ts#compositeMoveReasonText's and
 * edit/moveStandaloneComplexBlock.ts#standaloneComplexBlockMoveReasonText's
 * identical role for their own features. `t` is passed in rather than a
 * Plugin/View instance so this stays Obsidian-independent.
 *
 * "no-sibling"/"boundary-unknown" fall through to the ordinary
 * "reason." + reason pattern and resolve to the SAME existing keys Phase
 * 5P-4's body-cursor move already uses (see this module's own top doc
 * comment for why reusing those two specifically is correct — their
 * wording is already move-specific and operation-neutral). Every other
 * value gets its own dedicated `reason.paragraphTreeMove*` key rather than
 * reusing edit/paragraphPartialEdit.ts's `reason.identity-changed`/
 * `reason.content-changed` (worded for the Partial Edit Pane's "reopen and
 * try again" apply flow, which does not apply to a move) — see i18n.ts's
 * own comment at those new keys for the full rationale.
 */
export function paragraphTreeMoveReasonText(
  t: (key: TranslationKey) => string,
  reason: NoParagraphTreeMoveReason | undefined
): string | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case "resolve-failed":
      return t("reason.paragraphTreeMoveResolveFailed");
    case "identity-changed":
      return t("reason.paragraphTreeMoveIdentityChanged");
    case "content-changed":
      return t("reason.paragraphTreeMoveContentChanged");
    case "ambiguous-match":
      return t("reason.paragraphTreeMoveAmbiguous");
    default:
      return t(("reason." + reason) as TranslationKey);
  }
}
