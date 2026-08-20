/**
 * Phase 5T-9A ("Outline Tree paragraph の delete を最小スコープで実装する"):
 * a pure function that safely deletes a top-level or section-direct
 * paragraph from the Outline Tree, given the CURRENT Markdown text and an
 * anchor captured when the Tree's context menu was built.
 *
 * ---- Why this reuses edit/paragraphTreeMove.ts#resolveAnchorUnit verbatim ----
 *
 * A paragraph has no syntax marker of its own (parser/complexBlocks.ts's
 * scanParagraphBlocks defines it purely as "a run of consecutive
 * non-blank/non-heading/non-list lines"), so — exactly as
 * edit/paragraphTreeMove.ts's own top doc comment explains for move —
 * re-resolving "the same logical paragraph" the user right-clicked requires
 * the full three-stage (candidate / structural / content) + document-wide
 * ambiguity re-verification, not a thin id-only re-check. Phase 5T-2 already
 * extracted that exact contract into `resolveAnchorUnit`, shared today by
 * both `moveParagraphFromAnchor` and `resolveParagraphDropDirection`. This
 * module reuses it a third time, unmodified, rather than writing a fourth,
 * independently-maintained copy of the same safety logic.
 *
 * ---- What this module adds beyond resolveAnchorUnit ----
 *
 *   - Scope gating (5T-9A ticket §2/§3, per the user's final decision):
 *     only a `parentId === null` (top-level) or `parentId` resolving to a
 *     `BlockNode` of `type === "section"` (section-direct) paragraph may be
 *     deleted this phase. A `parentId` resolving to a list item (`type ===
 *     "list"`) is rejected as `"list-item-parent"` — list-item-child
 *     paragraph delete is explicitly out of scope this round (the
 *     edit/listBodyRange.ts double-representation debt recorded in
 *     docs/phase5t9_paragraph_delete_insert_design.md and NOT fixed here).
 *   - Composite-member exclusion: this module re-runs `matchCompositeBlocks`
 *     against the SAME fresh scan `resolveAnchorUnit` already produced, and
 *     rejects as `"composite-member"` if the re-resolved paragraph's id
 *     appears in any matched composite's member list. VERIFIED CURRENTLY
 *     UNREACHABLE (see tests/deleteParagraph.test.ts's own matching test):
 *     parser/compositeBlocks.ts#collectCandidates explicitly excludes every
 *     `kind === "paragraph"` block from composite-candidate collection
 *     ("CompositeBlock membership is a SEPARATE, not-yet-designed
 *     capability for paragraph" — that function's own comment), so
 *     `matchCompositeBlocks` can never actually produce a composite with a
 *     paragraph member today, regardless of what CompositeBlockRule is
 *     passed in. This check is kept anyway — cheap, and exactly the
 *     forward-compatible "starts correctly protecting against it with zero
 *     code changes here" defense-in-depth edit/deleteCompositeBlock.ts's own
 *     NoCompositeDeleteReason doc comment already establishes as this
 *     codebase's convention — for the day paragraph composite membership is
 *     designed. A CompositeBlock's own (non-paragraph) member rows are
 *     separately never reachable via this Tree entry point at all (they
 *     render as part of the composite's own aggregate row, never as a
 *     standalone `OutlineTreeParagraphNode` — see tree/buildOutlineTree.ts),
 *     which is a second, independent reason this path is unreachable today,
 *     on top of every other pure
 *     function in this codebase that never trusts its caller's own
 *     eligibility filtering as the sole safety net.
 *   - "Reject readOnly targets" (5T-9A ticket §5): a paragraph Tree row's
 *     own `isReadOnly: true` field (tree/buildOutlineTree.ts) is a
 *     PERMANENT, unconditional Tree-view-layer marker — every paragraph row
 *     carries it, so checking it here would be a permanent no-op (same
 *     observation Phase 5T-8A's `beginParagraphRenameForNode` doc comment
 *     already makes for rename). The REAL safety gate this ticket's
 *     "readOnly" language maps to is `editability === "supported"` — a
 *     paragraph inside an unterminated fence / nested callout / malformed
 *     table (editability "unsupported"/"ambiguous") is exactly what this
 *     codebase otherwise calls "read-only", and it is already rejected by
 *     `resolveAnchorUnit`'s own eligibility filter as `"resolve-failed"`.
 *     No separate readOnly check is added — see this module's own tests for
 *     the specific unterminated-fence-adjacent-paragraph case this covers.
 *   - Blank-line-merge safety on delete (5T-9A ticket §5's "ensureBlankSeparation
 *     と同種の条件付き空行補正"): unlike edit/paragraphNonAdjacentMove.ts's
 *     `ensureBlankSeparation` (which protects a MOVED block's own two
 *     boundaries), a delete leaves exactly ONE new boundary — the line that
 *     used to precede the deleted range and the line that used to follow it
 *     become newly adjacent. If BOTH are themselves paragraph-candidate
 *     lines (non-blank, non-heading, non-list-marker — the same three
 *     boundary types parser/complexBlocks.ts's own `isCandidate` already
 *     recognizes), `scanParagraphBlocks` would sweep them into one run on
 *     the next re-parse, silently merging two previously-independent
 *     paragraphs (or a paragraph and a callout/blockquote's own
 *     quote-prefixed line) into one. A single blank line is inserted at that
 *     one boundary ONLY when both neighbors are candidate-like — never
 *     otherwise, so no unnecessary blank line is ever added (ticket's
 *     explicit "不要な空行は増やさないこと").
 *
 *     NOTE (see tests/deleteParagraph.test.ts's own matching test for the
 *     full derivation): for a paragraph that resolveAnchorUnit was actually
 *     willing to accept, this branch is structurally UNREACHABLE today.
 *     scanParagraphBlocks' greedy candidate sweep already consumes every
 *     consecutive non-blank/non-heading/non-list line — regardless of kind
 *     — into ONE range; a paragraph can only ever resolve as its own
 *     independent, editability:"supported" block when it is ALREADY bounded
 *     on both sides by a blank line, a heading, a list marker, a code-fence
 *     boundary, or the document's own edge. Deleting it therefore only ever
 *     exposes an already-non-candidate boundary to its post-delete
 *     neighbor. This check is kept anyway, as defense-in-depth, mirroring
 *     edit/deleteCompositeBlock.ts's own documented precedent of keeping
 *     currently-unreachable rejection paths "so that if [a scanner's
 *     candidate rule] ever [changes], this starts correctly [protecting
 *     against it] with zero code changes here" — see that module's
 *     NoCompositeDeleteReason doc comment for the identical reasoning
 *     applied to its own five currently-unreachable reasons.
 *   - Post-delete fallback line (5T-9A ticket §6): next sibling (nearest
 *     paragraph/callout/blockquote sharing this paragraph's own
 *     parentId/depth, per edit/paragraphNonAdjacentMove.ts#listNonAdjacentMoveTargets,
 *     that starts AFTER the deleted range) → else the nearest such sibling
 *     that starts BEFORE it → else the enclosing section's own start line →
 *     else the deletion's own (clamped) start line. Reuses the exact
 *     sibling-group notion Phase 5T-3A's non-adjacent move already
 *     established for paragraph, rather than inventing a new adjacency
 *     concept (ticket's explicit "新しい focus management の仕組みを発明し
 *     ないこと").
 *
 * ---- Deliberately out of scope (ticket §3) ----
 *
 * paragraph insert, list-item-child paragraph delete, CompositeBlock-member
 * paragraph delete (rejected, not supported), callout/blockquote/
 * code-fence/table-internal paragraph delete (never reachable — not kind
 * "paragraph"), any change to rename/Partial Edit/dblclick/F2 contracts,
 * D&D, `draggable`, `computeDropMode`, `runRelocateCommand`, drop indicator,
 * mobile long-press, edit/listBodyRange.ts, parser/parseDocument.ts,
 * styles.css. This file imports nothing from any of those and does not
 * touch parser/parseDocument.ts.
 */
import { ParsedDocument } from "../model/block";
import { ComplexBlockInfo } from "../model/complexBlock";
import { CompositeBlockRule } from "../model/compositeBlock";
import { complexBlockDepth } from "../parser/complexBlocks";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import { isBlankLine, parseDocument } from "../parser/parseDocument";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";
import { TranslationKey } from "../i18n";
import {
  NoParagraphTreeMoveReason,
  ParagraphMoveAnchor,
  resolveAnchorUnit,
} from "./paragraphTreeMove";
import { listNonAdjacentMoveTargets } from "./paragraphNonAdjacentMove";

/**
 * Every way `deleteParagraph` refuses to touch the note. The first four
 * reuse `NoParagraphTreeMoveReason`'s own SOURCE-side re-resolution values
 * verbatim (via `resolveAnchorUnit`) — see that type's own doc comment for
 * the full per-stage rationale. The last two are this module's own:
 *
 *   - "list-item-parent": the re-resolved paragraph's parent is a list item
 *     — out of scope this phase (see this module's top doc comment).
 *   - "composite-member": the re-resolved paragraph is currently a member of
 *     a matched CompositeBlock — delete must go through the CompositeBlock's
 *     own delete path (edit/deleteCompositeBlock.ts), never this one.
 */
export type NoParagraphDeleteReason =
  | NoParagraphTreeMoveReason
  | "list-item-parent"
  | "composite-member";

/**
 * deleteParagraph's result — a deliberate structural subtype of
 * commands/applyLineEditOutcome.ts's LineEditOutcome, exactly like every
 * other paragraph outcome type in this codebase family. `newCursorCh` is
 * always 0 on success (mirrors edit/deleteBlock.ts's DeleteOutcome — a
 * deleted paragraph has no meaningful "offset within the block" left to
 * preserve).
 */
export interface ParagraphDeleteOutcome extends LineEditOutcome {
  newCursorCh: number;
  reason?: NoParagraphDeleteReason;
}

function rejected(lines: string[], reason: NoParagraphDeleteReason): ParagraphDeleteOutcome {
  return { changed: false, lines, newStartLine: -1, newCursorCh: 0, reason };
}

// Byte-identical duplicates of parser/complexBlocks.ts's own HEADING_RE/
// LIST_RE — same "duplicated, not imported" policy
// edit/paragraphNonAdjacentMove.ts's own copies already establish (see that
// file's top doc comment). Used only to recognize the two boundary-line
// shapes that already safely terminate a paragraph-candidate run on their
// own — see `needsSeparatingBlankLine` below.
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const LIST_RE = /^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+.*)?$/;

function isParagraphCandidateLine(line: string | undefined): boolean {
  if (line === undefined) return false;
  if (isBlankLine(line)) return false;
  if (HEADING_RE.test(line)) return false;
  if (LIST_RE.test(line)) return false;
  return true;
}

/**
 * Deletes the paragraph described by `anchor` from `text` — or returns
 * `changed: false` (original `lines` byte-for-byte unchanged) with a stable
 * `reason` when it cannot safely do so. See this module's top doc comment
 * for the full re-resolution / scope / composite-member / blank-line /
 * fallback-line contract.
 *
 * `rules` must be the CALLER's currently-enabled CompositeBlockRule set
 * (e.g. settingsDefaults.ts's getEnabledCompositeBlockRules(settings.compositeBlocks)
 * — the same value view/OutlineTreeView.ts#refresh() already computes and
 * showCompositeCommandMenu/dispatchAndApplyCompositeDelete already pass to
 * matchCompositeBlocks), exactly as that function itself requires.
 */
export function deleteParagraph(
  text: string,
  anchor: ParagraphMoveAnchor,
  rules: CompositeBlockRule[]
): ParagraphDeleteOutcome {
  const doc: ParsedDocument = parseDocument(text);
  const resolved = resolveAnchorUnit(doc, anchor);
  if (!resolved.ok) {
    return rejected(doc.lines, resolved.reason);
  }
  const { scan, unit } = resolved;

  if (unit.parentId !== null) {
    const parent = doc.nodes.get(unit.parentId);
    if (!parent || parent.type !== "section") {
      return rejected(doc.lines, "list-item-parent");
    }
  }

  const composites = matchCompositeBlocks(doc, scan, rules);
  const isCompositeMember = composites.some((c) =>
    c.members.some((m) => m.kind === "paragraph" && m.id === unit.complexBlockId)
  );
  if (isCompositeMember) {
    return rejected(doc.lines, "composite-member");
  }

  const { startLine, endLine } = unit.range;
  const deletedCount = endLine - startLine + 1;

  const depth = complexBlockDepth(doc, unit.parentId);
  const siblingGroup: ComplexBlockInfo[] = listNonAdjacentMoveTargets(
    scan,
    unit.range,
    unit.parentId,
    depth,
    doc
  );
  const nextSibling = siblingGroup.find((b) => b.range.startLine > endLine);
  const prevSibling = [...siblingGroup].reverse().find((b) => b.range.startLine < startLine);
  const parentNode = unit.parentId !== null ? doc.nodes.get(unit.parentId) : undefined;
  const fallbackPreLine =
    nextSibling?.range.startLine ?? prevSibling?.range.startLine ?? parentNode?.range.startLine;

  const beforeLine = startLine > 0 ? doc.lines[startLine - 1] : undefined;
  const afterLine = endLine + 1 < doc.lines.length ? doc.lines[endLine + 1] : undefined;
  const needsSeparator = isParagraphCandidateLine(beforeLine) && isParagraphCandidateLine(afterLine);

  const removedLines = [...doc.lines.slice(0, startLine), ...doc.lines.slice(endLine + 1)];
  const outLines = needsSeparator
    ? [...removedLines.slice(0, startLine), "", ...removedLines.slice(startLine)]
    : removedLines;

  let newStartLine: number;
  if (fallbackPreLine === undefined) {
    newStartLine = startLine;
  } else if (fallbackPreLine < startLine) {
    newStartLine = fallbackPreLine;
  } else {
    newStartLine = fallbackPreLine - deletedCount + (needsSeparator ? 1 : 0);
  }
  newStartLine = Math.max(0, Math.min(newStartLine, outLines.length - 1));

  return { changed: true, lines: outLines, newStartLine, newCursorCh: 0 };
}

/**
 * Translates a paragraph-delete rejection reason into the current locale —
 * mirrors edit/paragraphTreeMove.ts#paragraphTreeMoveReasonText's identical
 * role for the move case. The four source-side reasons get NEW, dedicated
 * `reason.paragraphDelete*` keys rather than reusing
 * `reason.paragraphTreeMove*` — those are worded "...so the move was
 * cancelled", which would be actively misleading for a delete (see
 * i18n.ts's own comment at those keys for the identical rationale applied
 * to why paragraphNonAdjacentMove.ts didn't reuse
 * edit/paragraphPartialEdit.ts's Partial-Edit-flow wording either).
 */
export function paragraphDeleteReasonText(
  t: (key: TranslationKey) => string,
  reason: NoParagraphDeleteReason | undefined
): string | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case "resolve-failed":
      return t("reason.paragraphDeleteResolveFailed");
    case "identity-changed":
      return t("reason.paragraphDeleteIdentityChanged");
    case "content-changed":
      return t("reason.paragraphDeleteContentChanged");
    case "ambiguous-match":
      return t("reason.paragraphDeleteAmbiguous");
    case "list-item-parent":
      return t("reason.paragraphDeleteListItemParent");
    case "composite-member":
      return t("reason.paragraphDeleteCompositeMember");
    default:
      return t(("reason." + reason) as TranslationKey);
  }
}

// Re-exported for callers (view/OutlineTreeView.ts) that need to gate a
// delete menu item's own VISIBILITY at menu-build time, without duplicating
// this scope rule inline. Menu-time use only — never itself a green light to
// write to the note; the actual delete always re-derives this same check
// against a FRESH doc inside `deleteParagraph` above (see this module's top
// doc comment).
export function isInScopeParagraphParent(doc: ParsedDocument, parentId: string | null): boolean {
  if (parentId === null) return true;
  const parent = doc.nodes.get(parentId);
  return parent?.type === "section";
}
