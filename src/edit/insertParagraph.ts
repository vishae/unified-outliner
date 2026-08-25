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
 *     string (a single U+200B ZERO WIDTH SPACE), inserted so the new line
 *     is immediately recognized by
 *     parser/complexBlocks.ts#scanParagraphBlocks as its own paragraph (a
 *     blank line would NOT qualify — scanParagraphBlocks only ever begins
 *     a candidate run at a non-blank line, and parser/parseDocument.ts's
 *     own `isBlankLine` only ever matches literal space/tab runs, never
 *     U+200B, so this one character is enough to keep the line "non-blank"
 *     for every purpose that matters here). Originally a visible Japanese
 *     word ("新しい段落"), replaced with this invisible-but-non-blank
 *     character after real-device feedback: that word was visibly written
 *     into the note body between the insert's own edit and the
 *     auto-rename's commit edit, so a single Undo right after confirming a
 *     rename revealed it sitting in the body instead of cleanly returning
 *     to "nothing typed yet". U+200B renders as nothing in Obsidian's
 *     editor (both before the user types over it and, if they Undo once
 *     after confirming, when it reappears), while still satisfying every
 *     structural requirement a real placeholder paragraph needs (it is a
 *     stable anchor `resolveAnchorUnit`/`canSafelyRollbackParagraphInsert`
 *     can re-resolve, and view/OutlineTreeView.ts's own post-insert
 *     auto-rename opens it pre-selected in the inline rename box exactly
 *     as before — selecting one invisible character is visually
 *     indistinguishable from an empty box, and the very next keystroke
 *     replaces it either way).
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
 * ---- Phase 5P-5 update ("list item 子 paragraph の Tree insert/delete 解禁") ----
 *
 * list-item-child paragraph insert is now IN SCOPE (previously excluded —
 * see the removed entry below). `isInScopeParagraphParent` (imported from
 * ./deleteParagraph, unchanged import) now also accepts a `"list"`-type
 * parent; this file's own new responsibility is making the WRITE ITSELF
 * safe for that case, which the pre-5P-5 version never needed to consider:
 *
 *   - Indentation: a new placeholder/body line inserted with no leading
 *     whitespace would, on re-parse, not just fail to be recognized as the
 *     target list item's child — it would trip
 *     parser/parseDocument.ts's own list-closing rule (`closeItemsWithIndentAtLeast`
 *     with the new line's own column, which for an unindented line is 0,
 *     i.e. "close every currently-open list item, including outer nesting
 *     levels"), corrupting the list structure. Every non-blank line of the
 *     body is now prefixed to the target list item's own content-start
 *     column via `listItemContentColumn` (parser/listContentColumn.ts —
 *     the single shared authority, already used by
 *     parser/complexBlocks.ts's own child-paragraph recognition and by
 *     edit/insertBlock.ts's insertChildListItem) and the LOCAL
 *     `buildColumnPrefix` below, a byte-identical duplicate of
 *     edit/insertBlock.ts's own non-exported helper of the same name (this
 *     codebase's established "duplicated, not imported" convention for a
 *     small, file-local formatting helper — see edit/deleteParagraph.ts's
 *     own `isParagraphCandidateLine` for the same precedent). Blank lines
 *     (the before/after separators this file already inserts) are left
 *     unprefixed — a blank line never closes a list item (see
 *     parser/parseDocument.ts's own `isBlankLine` early-continue in its
 *     scan loop) and needs no indentation to stay harmless.
 *   - `unsafeIndent`: a list item whose own leading whitespace mixes tabs
 *     and spaces (`ListBlockNode.unsafeIndent`) is rejected outright
 *     (`"unsafe-indent"`) before any line is built, mirroring
 *     edit/insertBlock.ts#insertChildListItem's own `if (parent.unsafeIndent)
 *     return rejected(...)` precedent exactly — an unsafe-indent item's own
 *     content column cannot be trusted to compute a correct prefix from.
 *
 * ---- Deliberately out of scope (ticket §3, as narrowed by Phase 5P-5) ----
 *
 * parent head/tail insert, insert crossing section/list boundaries, insert
 * into an `unsafeIndent` list item (rejected, not attempted — see above),
 * any change to the paragraph delete contract's OWN logic (5T-9A/5P-5) or
 * the existing paragraph/heading/list rename contracts (5T-8A and
 * earlier), Paragraph Partial Edit, F2, D&D, `draggable`,
 * `computeDropMode`, `runRelocateCommand`, drop indicator, mobile
 * long-press, edit/listBodyRange.ts (its own double-representation debt is
 * untouched — see docs/phase5t9_paragraph_delete_insert_design.md and the
 * Phase 5P-5 audit that preceded this change), parser/parseDocument.ts,
 * styles.css. This file still imports nothing from any of those and still
 * does not touch parser/parseDocument.ts (only reads facts it already
 * exposes: `leadingWhitespace`, `TAB_WIDTH`). The post-insert auto-rename /
 * Cancel-rollback UI wiring itself lives entirely in view/OutlineTreeView.ts,
 * not here — this module only ever produces or verifies a `lines[]`
 * outcome.
 */
import { isListNode, ParsedDocument } from "../model/block";
import { CompositeBlockRule } from "../model/compositeBlock";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import { isBlankLine, leadingWhitespace, parseDocument, TAB_WIDTH } from "../parser/parseDocument";
import { listItemContentColumn } from "../parser/listContentColumn";
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
 * per-stage rationale. The next two mirror
 * edit/deleteParagraph.ts#NoParagraphDeleteReason's own identically-named
 * values:
 *
 *   - "list-item-parent": as of Phase 5P-5, `isInScopeParagraphParent`
 *     accepts BOTH a `"section"`-type and a `"list"`-type parent, so this
 *     value is now reachable only when the re-resolved parentId fails to
 *     resolve to any BlockNode at all (a dangling/stale reference —
 *     structurally should not happen for a `parentId` produced by the same
 *     fresh `doc` passed to `resolveAnchorUnit`, since `BlockNodeType` is a
 *     closed `"list" | "section"` union). Kept as defense-in-depth, exactly
 *     like "composite-member" below — see this module's top doc comment's
 *     "Phase 5P-5 update" section.
 *   - "composite-member": the re-resolved anchor paragraph is currently a
 *     member of a matched CompositeBlock — see this module's top doc
 *     comment for why this is currently unreachable but kept as
 *     defense-in-depth.
 *
 * New in Phase 5P-5:
 *
 *   - "unsafe-indent": the re-resolved anchor paragraph's parent is a list
 *     item whose own leading whitespace mixes tabs and spaces
 *     (`ListBlockNode.unsafeIndent`) — its content-start column cannot be
 *     trusted, so no line is ever built or inserted. Mirrors
 *     edit/insertBlock.ts#insertChildListItem's own identical rejection.
 */
export type NoParagraphInsertReason =
  | NoParagraphTreeMoveReason
  | "list-item-parent"
  | "composite-member"
  | "unsafe-indent";

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
 * Build a leading-whitespace string reaching `targetColumns`, choosing tabs
 * vs. spaces from `referenceLine`'s own existing indentation style. A
 * byte-identical duplicate of edit/insertBlock.ts's own (non-exported)
 * `buildColumnPrefix` — see this module's top doc comment's "Phase 5P-5
 * update" section for why this is duplicated rather than imported (this
 * codebase's established convention for a small, file-local formatting
 * helper, matching `isParagraphCandidateLine`/`HEADING_RE`/`LIST_RE` above).
 */
function buildColumnPrefix(referenceLine: string, targetColumns: number): string {
  const useTabs = leadingWhitespace(referenceLine).includes("\t");
  return useTabs
    ? "\t".repeat(Math.max(Math.round(targetColumns / TAB_WIDTH), 1))
    : " ".repeat(targetColumns);
}

/**
 * The fixed placeholder text inserted for a brand-new paragraph — see this
 * module's top doc comment for why a non-empty, Markdown-paragraph-shaped
 * string is required, and why this exact single-character string (U+200B
 * ZERO WIDTH SPACE, chosen so the placeholder renders as blank rather than
 * as a visible word) was chosen. Exported so view/OutlineTreeView.ts's
 * tests (and any future caller) can assert against it directly rather than
 * a magic string/character duplicated at each call site.
 */
export const PARAGRAPH_INSERT_PLACEHOLDER_TEXT = "​";

/**
 * Inserts a new placeholder paragraph immediately before/after the
 * paragraph described by `anchor`, in `text` — or returns `changed: false`
 * (original `lines` byte-for-byte unchanged) with a stable `reason` when it
 * cannot safely do so. See this module's top doc comment for the full
 * re-resolution / scope / composite-member / blank-line contract.
 *
 * `rules` must be the CALLER's currently-enabled CompositeBlockRule set,
 * exactly as edit/deleteParagraph.ts#deleteParagraph already requires.
 *
 * `bodyText` defaults to `PARAGRAPH_INSERT_PLACEHOLDER_TEXT` (every
 * pre-existing call site omits it and is byte-for-byte unaffected by this
 * parameter's addition). view/OutlineTreeView.ts's own
 * commitPendingParagraphInsert passes the user's CONFIRMED rename text
 * here instead, immediately after reverting the original placeholder
 * insert with `Editor#undo()` — collapsing "insert placeholder, then
 * separately patch its text on rename-confirm" into a single fresh insert
 * of the real text, which is a single `replaceRange` call (and therefore a
 * single Undo step) at the call site instead of two. Multi-line `bodyText`
 * (soft-wrapped, no blank interior line — see
 * edit/paragraphPartialEdit.ts#paragraphEditTextContainsBlankLine, which
 * callers are expected to have already checked) is supported: each of its
 * own lines becomes its own array element, exactly like any other
 * multi-line paragraph body already spliced elsewhere in this codebase.
 */
export function insertParagraph(
  text: string,
  anchor: ParagraphMoveAnchor,
  position: ParagraphInsertPosition,
  rules: CompositeBlockRule[],
  bodyText: string = PARAGRAPH_INSERT_PLACEHOLDER_TEXT
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

  // Phase 5P-5: when the target's parent is a list item, resolve it now
  // (once) — used both for the unsafeIndent rejection below and for the
  // indentation-prefix computation further down. `isInScopeParagraphParent`
  // above already confirmed `unit.parentId` resolves to a `"section"` or
  // `"list"` node, so a `null` here (parent不存在) cannot occur for a
  // `"list"` parentId in practice; the `isListNode` guard keeps this
  // strictly typed regardless.
  const parentNode = unit.parentId !== null ? doc.nodes.get(unit.parentId) : undefined;
  const listParent = parentNode && isListNode(parentNode) ? parentNode : null;

  if (listParent && listParent.unsafeIndent) {
    return rejected(doc.lines, "unsafe-indent");
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

  // Phase 5P-5: every non-blank line of the body is prefixed to the list
  // item's own content-start column so it re-parses as THAT item's child
  // rather than closing it — see this module's top doc comment's "Phase
  // 5P-5 update" section. Blank lines (never emitted by bodyText itself —
  // callers are expected to have already rejected an interior blank line,
  // see paragraphEditTextContainsBlankLine — but handled defensively here
  // too) are left unprefixed, matching the before/after separators below.
  const rawBodyLines = bodyText.split("\n");
  const bodyLines = listParent
    ? rawBodyLines.map((line) => {
        if (line.length === 0) return line;
        const targetColumns = listItemContentColumn(doc, listParent);
        const prefix = buildColumnPrefix(doc.lines[listParent.range.startLine], targetColumns);
        return prefix + line;
      })
    : rawBodyLines;

  const segment: string[] = [];
  if (needsBefore) segment.push("");
  segment.push(...bodyLines);
  if (needsAfter) segment.push("");

  const outLines = [...doc.lines.slice(0, insertAt), ...segment, ...doc.lines.slice(insertAt)];
  const placeholderLine = insertAt + (needsBefore ? 1 : 0);

  return {
    changed: true,
    lines: outLines,
    newStartLine: placeholderLine,
    newCursorCh: bodyLines[bodyLines.length - 1].length,
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
    case "unsafe-indent":
      return t("reason.paragraphInsertUnsafeIndent");
    default:
      return t(("reason." + reason) as TranslationKey);
  }
}
