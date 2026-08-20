/**
 * Phase 5T-10A ("Outline Tree paragraph insert を最小スコープで実装する,
 * delete 契約・rename 契約を再利用する"): a pure function that safely
 * inserts a brand-new placeholder paragraph immediately before/after an
 * existing top-level or section-direct paragraph, given the CURRENT
 * Markdown text and an anchor captured when the Tree's context menu was
 * built.
 *
 * ---- Reused unchanged (5T-9A/5T-1/5T-2 precedent) ----
 *
 *   - edit/paragraphTreeMove.ts#resolveAnchorUnit — the SAME three-stage
 *     (candidate / structural / content + document-wide ambiguity)
 *     re-resolution contract edit/deleteParagraph.ts already reuses a
 *     third time; this is now its fourth reuse, still unmodified. See that
 *     module's own top doc comment for the full per-stage rationale.
 *   - edit/deleteParagraph.ts#isInScopeParagraphParent — the exact same
 *     "top-level or section-direct only" scope gate 5T-9A's delete already
 *     established, imported directly rather than re-derived, so insert can
 *     never structurally drift from delete's own scope contract (both
 *     tickets' own explicit instruction: "delete 契約・rename 契約を再利用
 *     する").
 *
 * ---- New in this file ----
 *
 *   - `PARAGRAPH_INSERT_PLACEHOLDER_TEXT` — a fixed, non-empty placeholder
 *     string ("新しい段落"), inserted so the new line is immediately
 *     recognized by parser/complexBlocks.ts#scanParagraphBlocks as its own
 *     paragraph (a blank line would NOT qualify — scanParagraphBlocks only
 *     ever begins a candidate run at a non-blank line). This is the exact
 *     string 5T-10A's own §11 item 6 requires be documented in the
 *     completion report; chosen deliberately short/generic since it is
 *     never meant to be read — view/OutlineTreeView.ts's own
 *     post-insert auto-rename immediately opens this text pre-selected in
 *     the inline rename box, so the very next keystroke replaces it.
 *   - Bidirectional blank-line-separator logic, structurally mirroring
 *     edit/paragraphNonAdjacentMove.ts#ensureBlankSeparation's own
 *     "check both real sides independently, insert only where actually
 *     needed" pattern (never edit/deleteParagraph.ts's single-boundary
 *     check — an insert creates TWO new boundaries, not one). By
 *     construction (the target paragraph only ever resolves as its own
 *     independent, editability:"supported" block when it is ALREADY
 *     bounded on both sides by a blank line / heading / list marker /
 *     document edge — the exact same invariant edit/deleteParagraph.ts's
 *     own top doc comment proves for its own now-unreachable merge-safety
 *     branch), the side touching the pre-existing target is always a
 *     paragraph-candidate line and always needs a separator, while the far
 *     side (touching whatever already sat there) is always already
 *     non-candidate and never needs one. This file still implements the
 *     check as a GENERIC, conditional, bidirectional test of the actual
 *     content on both real sides — never hard-coded on that derived
 *     invariant alone — matching this codebase's established "never trust
 *     a derived invariant blindly, always recheck actual content"
 *     philosophy (the same reasoning edit/deleteParagraph.ts's own
 *     doc comment applies to its own currently-unreachable checks).
 *   - `canSafelyRollbackParagraphInsert` — a lightweight, read-only
 *     verification helper for view/OutlineTreeView.ts's own insert-then-
 *     rename-then-maybe-rollback flow (5T-10A ticket §6/§7): re-runs
 *     `resolveAnchorUnit` against the placeholder paragraph's own anchor
 *     (built immediately after a successful insert) and reports whether it
 *     STILL resolves as itself, unedited. The caller uses this immediately
 *     before calling Obsidian's own `Editor#undo()` to revert a cancelled
 *     post-insert rename — see that call site's own doc comment for the
 *     full rollback design (why `editor.undo()` rather than a manual
 *     reverse-splice, and why this check exists at all: to refuse to
 *     revert if something ELSE has changed the note in the meantime,
 *     matching the ticket's own explicit "resolve不能な場合は安全側no-op"
 *     allowance).
 *
 * ---- Composite-member exclusion ----
 *
 * Mirrors edit/deleteParagraph.ts's own composite-member check verbatim
 * (re-run matchCompositeBlocks against the SAME fresh scan, reject if the
 * re-resolved TARGET paragraph's id appears in any matched composite's
 * member list). VERIFIED CURRENTLY UNREACHABLE for the exact same reason
 * that module's own doc comment already documents in full:
 * parser/compositeBlocks.ts#collectCandidates unconditionally excludes
 * every `kind === "paragraph"` block from composite-candidate collection,
 * so a paragraph can never actually be a composite member today regardless
 * of rule configuration. Kept anyway as the same forward-compatible
 * defense-in-depth precedent edit/deleteCompositeBlock.ts/
 * edit/deleteParagraph.ts already establish.
 *
 * ---- Deliberately out of scope (ticket §3) ----
 *
 * list-item-child paragraph insert, parent head/tail insert, insert
 * crossing section/list boundaries, any change to the paragraph delete
 * contract (5T-9A) or the existing paragraph/heading/list rename contracts
 * (5T-8A and earlier), Paragraph Partial Edit, F2, D&D, `draggable`,
 * `computeDropMode`, `runRelocateCommand`, drop indicator, mobile
 * long-press, edit/listBodyRange.ts, parser/parseDocument.ts, styles.css.
 * This file imports nothing from any of those and does not touch
 * parser/parseDocument.ts. The post-insert auto-rename / Cancel-rollback
 * UI wiring itself lives entirely in view/OutlineTreeView.ts, not here —
 * this module only ever produces or verifies a `lines[]` outcome.
 */
import { ParsedDocument } from "../model/block";
import { CompositeBlockRule } from "../model/compositeBlock";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import { isBlankLine, parseDocument } from "../parser/parseDocument";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";
import { TranslationKey } from "../i18n";
import {
  NoParagraphTreeMoveReason,
  ParagraphMoveAnchor,
  resolveAnchorUnit,
} from "./paragraphTreeMove";
import { isInScopeParagraphParent } from "./deleteParagraph";

/**
 * "before" places the new paragraph immediately ahead of the target's own
 * current position; "after" immediately behind it — the same before/after
 * meaning move/relocateSection.ts#DropMode and
 * edit/paragraphNonAdjacentMove.ts#NonAdjacentMovePosition already use.
 */
export type ParagraphInsertPosition = "before" | "after";

/**
 * Every way `insertParagraph` refuses to touch the note. The first four
 * reuse `NoParagraphTreeMoveReason`'s own SOURCE-side (here: the existing
 * TARGET paragraph the insert is anchored to) re-resolution values verbatim
 * (via `resolveAnchorUnit`) — see that type's own doc comment for the full
 * per-stage rationale. The last two mirror
 * edit/deleteParagraph.ts#NoParagraphDeleteReason's own identically-named
 * values:
 *
 *   - "list-item-parent": the re-resolved anchor paragraph's parent is a
 *     list item — out of scope this phase (see this module's top doc
 *     comment).
 *   - "composite-member": the re-resolved anchor paragraph is currently a
 *     member of a matched CompositeBlock — see this module's top doc
 *     comment for why this is currently unreachable but kept as
 *     defense-in-depth.
 */
export type NoParagraphInsertReason =
  | NoParagraphTreeMoveReason
  | "list-item-parent"
  | "composite-member";

/**
 * insertParagraph's result — a deliberate structural subtype of
 * commands/applyLineEditOutcome.ts's LineEditOutcome, exactly like
 * ParagraphDeleteOutcome. `newCursorCh` is always set to the placeholder's
 * own text length on success (mirrors edit/insertBlock.ts's InsertOutcome —
 * the cursor lands ready-to-type at the end of the placeholder), which is
 * also the exact mechanism view/OutlineTreeView.ts's refresh() already uses
 * (5T-5A's resolveCurrentPositionNodeId) to determine the newly-inserted
 * paragraph's own Tree node id for the post-insert auto-rename.
 */
export interface ParagraphInsertOutcome extends LineEditOutcome {
  newCursorCh: number;
  reason?: NoParagraphInsertReason;
}

function rejected(lines: string[], reason: NoParagraphInsertReason): ParagraphInsertOutcome {
  return { changed: false, lines, newStartLine: -1, newCursorCh: 0, reason };
}

// Byte-identical duplicates of parser/complexBlocks.ts's own HEADING_RE/
// LIST_RE — same "duplicated, not imported" policy
// edit/deleteParagraph.ts's/edit/paragraphNonAdjacentMove.ts's own copies
// already establish. Used only to recognize the three boundary-line shapes
// that already safely bound a paragraph-candidate run on their own — see
// `isParagraphCandidateLine` below.
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
 * The fixed placeholder text inserted for a brand-new paragraph — see this
 * module's top doc comment for why a non-empty, Markdown-paragraph-shaped
 * string is required, and why this exact string was chosen. Exported so
 * view/OutlineTreeView.ts's tests (and any future caller) can assert
 * against it directly rather than a magic string duplicated at each call
 * site.
 */
export const PARAGRAPH_INSERT_PLACEHOLDER_TEXT = "新しい段落";

/**
 * Inserts a new placeholder paragraph immediately before/after the
 * paragraph described by `anchor`, in `text` — or returns `changed: false`
 * (original `lines` byte-for-byte unchanged) with a stable `reason` when it
 * cannot safely do so. See this module's top doc comment for the full
 * re-resolution / scope / composite-member / blank-line contract.
 *
 * `rules` must be the CALLER's currently-enabled CompositeBlockRule set,
 * exactly as edit/deleteParagraph.ts#deleteParagraph already requires.
 */
export function insertParagraph(
  text: string,
  anchor: ParagraphMoveAnchor,
  position: ParagraphInsertPosition,
  rules: CompositeBlockRule[]
): ParagraphInsertOutcome {
  const doc: ParsedDocument = parseDocument(text);
  const resolved = resolveAnchorUnit(doc, anchor);
  if (!resolved.ok) {
    return rejected(doc.lines, resolved.reason);
  }
  const { scan, unit } = resolved;

  if (!isInScopeParagraphParent(doc, unit.parentId)) {
    return rejected(doc.lines, "list-item-parent");
  }

  const composites = matchCompositeBlocks(doc, scan, rules);
  const isCompositeMember = composites.some((c) =>
    c.members.some((m) => m.kind === "paragraph" && m.id === unit.complexBlockId)
  );
  if (isCompositeMember) {
    return rejected(doc.lines, "composite-member");
  }

  const { startLine, endLine } = unit.range;
  const insertAt = position === "before" ? startLine : endLine + 1;

  // Bidirectional check against the ORIGINAL (pre-insert) lines — see this
  // module's top doc comment for why both sides are always independently
  // rechecked rather than assuming only the "near" side ever needs one.
  const lineBefore = insertAt > 0 ? doc.lines[insertAt - 1] : undefined;
  const lineAfter = insertAt < doc.lines.length ? doc.lines[insertAt] : undefined;
  const needsBefore = isParagraphCandidateLine(lineBefore);
  const needsAfter = isParagraphCandidateLine(lineAfter);

  const segment: string[] = [];
  if (needsBefore) segment.push("");
  segment.push(PARAGRAPH_INSERT_PLACEHOLDER_TEXT);
  if (needsAfter) segment.push("");

  const outLines = [...doc.lines.slice(0, insertAt), ...segment, ...doc.lines.slice(insertAt)];
  const placeholderLine = insertAt + (needsBefore ? 1 : 0);

  return {
    changed: true,
    lines: outLines,
    newStartLine: placeholderLine,
    newCursorCh: PARAGRAPH_INSERT_PLACEHOLDER_TEXT.length,
  };
}

/**
 * True when `anchor` (built for the newly-inserted placeholder paragraph,
 * immediately after a successful `insertParagraph` call) still resolves,
 * via the SAME `resolveAnchorUnit` contract, as itself — unedited, same
 * identity — against `text`. See this module's top doc comment for the
 * full rollback-safety rationale; the caller (view/OutlineTreeView.ts's
 * rollbackPendingParagraphInsert) only calls `Editor#undo()` when this
 * returns true, and otherwise leaves the placeholder as ordinary permanent
 * body text rather than risk reverting unrelated content.
 */
export function canSafelyRollbackParagraphInsert(text: string, anchor: ParagraphMoveAnchor): boolean {
  const doc: ParsedDocument = parseDocument(text);
  return resolveAnchorUnit(doc, anchor).ok;
}

/**
 * Translates a paragraph-insert rejection reason into the current locale —
 * mirrors edit/deleteParagraph.ts#paragraphDeleteReasonText's identical
 * role for the delete case. New, dedicated `reason.paragraphInsert*` keys
 * throughout (not a reuse of `reason.paragraphTreeMove*`/
 * `reason.paragraphDelete*`), matching that module's own precedent of
 * giving each operation its own operation-specific wording ("...so the
 * insert was cancelled") rather than a generic/misleading shared string.
 */
export function paragraphInsertReasonText(
  t: (key: TranslationKey) => string,
  reason: NoParagraphInsertReason | undefined
): string | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case "resolve-failed":
      return t("reason.paragraphInsertResolveFailed");
    case "identity-changed":
      return t("reason.paragraphInsertIdentityChanged");
    case "content-changed":
      return t("reason.paragraphInsertContentChanged");
    case "ambiguous-match":
      return t("reason.paragraphInsertAmbiguous");
    case "list-item-parent":
      return t("reason.paragraphInsertListItemParent");
    case "composite-member":
      return t("reason.paragraphInsertCompositeMember");
    default:
      return t(("reason." + reason) as TranslationKey);
  }
}
