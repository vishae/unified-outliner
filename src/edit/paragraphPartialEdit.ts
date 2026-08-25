/**
 * Phase 5P-2: Apply-time counterpart to
 * resolver/resolveParagraphAtCursor.ts — the "load" side of paragraph
 * Partial Edit hoist. This module is the only place that ever splices an
 * edited paragraph's text back into a note.
 *
 * Deliberately NOT built on edit/partialEdit.ts's
 * extractSubtreeText/applySubtreeEdit (both left completely unchanged by
 * this ticket): those two resolve purely by id against a fresh scan/parse
 * — sufficient for a section/list (a stable BlockNode id) or a standalone
 * callout/blockquote (re-verified only by id + editability + a
 * byte-for-byte content compare). A paragraph has no persistent id at all
 * (Markdown text is this plugin's only source of truth — see
 * docs/phase5p_paragraph-block-foundation-plan.md) and — unlike
 * callout/blockquote — is explicitly required to also survive re-parenting
 * detection: an id could coincidentally still resolve to A paragraph after
 * the note changed elsewhere, and its text could even coincidentally still
 * match, while its STRUCTURAL position moved (e.g. a new heading inserted
 * directly above an otherwise byte-identical paragraph changes its
 * parentId/depth without changing a single character of its own text) —
 * see this module's applyParagraphEdit doc comment for the full contract
 * this guards against.
 *
 * ---- Phase 5P-4 supplement: id-instability across a paragraph<->paragraph
 * swap (this module's own persistent-anchor fix) ----
 *
 * The Partial Edit Pane holds a `ParagraphEditAnchor` for as long as it
 * stays open — unlike edit/paragraphTreeMove.ts's `ParagraphMoveAnchor`,
 * which is built and consumed within a single, effectively atomic
 * command. In that window, `complexBlockId`
 * (parser/complexBlocks.ts's `paragraph-${seq++}`, a per-scan sequence
 * number, never a persistent id) can silently start pointing at a
 * DIFFERENT paragraph: Phase 5P-4's own "Move block up/down" swaps two
 * adjacent same-parent paragraphs by exchanging their POSITIONS, which
 * re-numbers every paragraph-kind candidate from that point on in scan
 * order. A stale id-only lookup can therefore resolve to the wrong
 * paragraph (or to none at all) even though the pane's own target is
 * still sitting safely in the note, merely repositioned.
 *
 * `applyParagraphEdit` below fixes this by never trusting
 * `complexBlockId` alone. It is kept only as a fast first-choice lookup
 * (requirement: still cheap for the overwhelmingly common "nothing moved"
 * case) — see the "Two-pass identity resolution" section of this
 * function's own doc comment for the full algorithm and the reasoning
 * behind each of its outcomes. `ParagraphEditAnchor.siblingCount` (new
 * field, populated by the new `buildParagraphEditAnchor` builder below)
 * exists solely to support this: it lets a failed content-match tell "the
 * paragraph population under this parent is exactly what it was — the
 * text itself must have changed" apart from "something was inserted,
 * removed, split, or merged nearby — identity can no longer be safely
 * attributed", without needing a persistent id at all (deliberately out
 * of scope this round — see docs/phase5p_paragraph-block-foundation-
 * plan.md and this ticket's own explicit exclusion list).
 *
 * Safety contract (5P-2 ticket §4, extended by the above): Apply never
 * trusts the cursor position or the anchor's own line numbers — the
 * caller always re-parses the CURRENT note fresh and hands the resulting
 * ParsedDocument here, where this module re-scans it and re-resolves the
 * SAME logical paragraph. Any disagreement no-ops (byte-identical `lines`)
 * with a distinct, typed reason rather than guessing which paragraph the
 * user meant. On success, the replacement always covers EXACTLY the
 * re-resolved paragraph's own range — nothing before or after it is ever
 * touched, so an adjacent heading/list/callout/blockquote/fence/table can
 * never be affected by an Apply.
 */
import { ParsedDocument } from "../model/block";
import { ComplexBlockInfo } from "../model/complexBlock";
import { complexBlockDepth, scanComplexBlocks } from "../parser/complexBlocks";

/**
 * Captured once, at load time, via `buildParagraphEditAnchor` below — see
 * that function's own doc comment for how each field is derived. Never
 * persisted beyond the Partial Edit Pane's own in-memory session; never
 * written to the note or to plugin settings.
 */
export interface ParagraphEditAnchor {
  complexBlockId: string;
  parentId: string | null;
  depth: number;
  /**
   * The pane's "before editing" snapshot — compared byte-for-byte against
   * the freshly re-extracted text at Apply time, exactly like
   * edit/partialEdit.ts's applySubtreeEdit.
   */
  originalText: string;
  /**
   * Phase 5P-4 supplement: the number of "supported" paragraph-kind
   * siblings under `parentId`/`depth` at the moment this anchor was built
   * (this paragraph included). Used only to distinguish, at Apply time, a
   * pure content edit (population unchanged) from a structural change
   * nearby (population changed) once a byte-for-byte content match can no
   * longer be found — see `applyParagraphEdit`'s own doc comment.
   */
  siblingCount: number;
}

/**
 * Projects a live, already-resolved paragraph (kind "paragraph",
 * editability "supported") into a `ParagraphEditAnchor` — the one
 * intended way to build one; a caller should never hand-construct the
 * object literal field-by-field (that would silently skip the
 * `siblingCount` computation this fix depends on). Accepts the flattened
 * shape `resolver/resolveParagraphAtCursor.ts`'s `ResolvedParagraphAtCursor`
 * already exposes (complexBlockId/parentId/depth/text), so callers never
 * need the raw `ComplexBlockInfo` — mirrors
 * edit/paragraphTreeMove.ts#buildParagraphMoveAnchor's "one true builder"
 * convention for that module's own, separate anchor type.
 *
 * `complexBlocks` defaults to a fresh scan, but a caller that already has
 * one (e.g. PartialEditView re-anchoring right after a successful Apply,
 * from the same scan it just re-parsed for) may pass it to avoid a
 * redundant re-scan — same convention as
 * resolver/resolveParagraphAtCursor.ts's own default-parameter shape.
 */
export function buildParagraphEditAnchor(
  doc: ParsedDocument,
  resolved: { complexBlockId: string; parentId: string | null; depth: number; text: string },
  complexBlocks: ComplexBlockInfo[] = scanComplexBlocks(doc).blocks
): ParagraphEditAnchor {
  const siblingCount = complexBlocks.filter(
    (b) =>
      b.kind === "paragraph" &&
      b.editability === "supported" &&
      b.parentId === resolved.parentId &&
      complexBlockDepth(doc, b.parentId) === resolved.depth
  ).length;
  return {
    complexBlockId: resolved.complexBlockId,
    parentId: resolved.parentId,
    depth: resolved.depth,
    originalText: resolved.text,
    siblingCount,
  };
}

export type NoParagraphApplyReason =
  | "anchor-unresolved"
  | "content-changed"
  | "blank-line-not-allowed";

export interface ApplyParagraphEditOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the replaced range (valid when changed). */
  newStartLine: number;
  reason?: NoParagraphApplyReason;
}

/**
 * Phase 5T-4A ("Tree paragraph → 既存 Partial Edit の最小実装",
 * docs/phase5t4_tree_paragraph_partial_edit_design.md §5-3): a paragraph's
 * own text can legitimately span multiple lines (soft-wrapped, no blank
 * separator — see this file's own "successful apply" test for
 * "a multi-line paragraph can grow or shrink in line count on Apply",
 * unchanged and still supported), but it must never contain a genuinely
 * BLANK line — parser/complexBlocks.ts's own paragraph-boundary rule
 * treats a blank (or whitespace-only) line as a hard paragraph separator,
 * so splicing one into the middle of `newText` would, on the next parse,
 * silently turn one paragraph into two: exactly the "分割" the 5T-4A
 * ticket §4 requires this module to reject outright, safe-side, whenever
 * the input is even ambiguous.
 *
 * A line counts as "blank" here whenever it is empty OR whitespace-only
 * after trimming — both are indistinguishable from an ordinary Markdown
 * blank-line separator once written back to the note, so both are
 * rejected identically; there is no separate "whitespace-only is more
 * lenient" case.
 *
 * A trailing newline in the caller's `newText` (e.g. the user pressed
 * Enter once at the very end of the Partial Edit Pane's textarea) is
 * DELIBERATELY treated exactly like any other blank line, not stripped or
 * special-cased: `"Some text.\n".split("\n")` ends in an empty-string
 * element, which this function flags the same as an interior blank line.
 * This keeps the rule simple and total (one check, no exceptions to
 * explain), and matches the 5T-4A ticket's own explicit fallback ("仕様が
 * 曖昧なら「paragraph を複数段落に分割し得る入力はすべて拒否」とすること") —
 * a paragraph's own `originalText` snapshot (doc.lines.slice(...).join
 * ("\n")) never carries a trailing newline in the first place, so an
 * unedited round-trip Apply never trips this check.
 *
 * A newline strictly BETWEEN two non-blank lines (ordinary multi-line
 * paragraph text, e.g. `"Line one.\nLine two."`) is explicitly NOT
 * rejected — see the doc comment above for why this remains supported,
 * pre-existing 5P-2 behavior.
 */
export function paragraphEditTextContainsBlankLine(text: string): boolean {
  return text.split("\n").some((line) => line.trim().length === 0);
}

/**
 * Re-resolve `anchor` against a fresh scan of `doc` (the CURRENT note,
 * already re-parsed by the caller) and splice `newText` in over exactly
 * that paragraph's own range — but only once every check below passes.
 *
 * ---- Two-pass identity resolution (Phase 5P-4 supplement) ----
 *
 * Pass 1 (fast path): if a "supported" paragraph with
 * `id === anchor.complexBlockId` exists AND its parentId/depth/content all
 * still match the anchor exactly, apply immediately. This is the
 * overwhelmingly common case (nothing moved since the pane loaded) and
 * needs no further search.
 *
 * Pass 2 (structural + content re-search): reached whenever Pass 1 does
 * not fully match — the id may be stale (a paragraph<->paragraph swap
 * elsewhere renumbered it), missing, or pointing at a structurally
 * different slot. Every "supported" paragraph sharing `anchor.parentId`/
 * `anchor.depth` is a candidate; among those, look for an EXACT
 * byte-for-byte match of `anchor.originalText`:
 *   - exactly one match -> that is the same logical paragraph, merely
 *     repositioned (a pure Phase 5P-4 swap never touches a paragraph's
 *     own text) -> apply to it, regardless of how many times it has moved
 *     since the anchor was built.
 *   - two or more matches -> genuinely ambiguous (e.g. two byte-identical
 *     sibling paragraphs) -> "anchor-unresolved"; never guesses.
 *   - zero matches -> nothing under this parent currently has the
 *     anchor's exact text. Compare the CURRENT same-parent/depth
 *     "supported" paragraph count against `anchor.siblingCount`:
 *       - equal -> the population is unchanged, so the anchor's own
 *         paragraph must still be there with DIFFERENT text -> "content-
 *         changed" (a genuine edit, independent of this fix).
 *       - different -> something was inserted, removed, split, or merged
 *         nearby (or the paragraph reparented) -> too uncertain to safely
 *         attribute to any one candidate -> "anchor-unresolved".
 *
 * Reasons:
 *   - "blank-line-not-allowed" (Phase 5T-4A): `newText` itself contains a
 *     blank (or whitespace-only) line — see
 *     `paragraphEditTextContainsBlankLine`'s own doc comment above.
 *     Checked FIRST, before any re-resolution against `doc`, since this is
 *     purely an input-validity question independent of the target
 *     paragraph's current state.
 *   - "anchor-unresolved": the target paragraph could not be safely and
 *     uniquely re-identified — covers deletion, an ambiguous duplicate,
 *     and any nearby structural change (split/merge/reparent) that makes
 *     content-based re-identification unsafe. Never touches the note.
 *   - "content-changed": the target WAS safely and uniquely re-identified
 *     (by id, or by structural position + an unchanged sibling
 *     population), but its own text differs from the anchor's snapshot —
 *     the note changed since the pane loaded it. Never touches the note.
 */
export function applyParagraphEdit(
  doc: ParsedDocument,
  anchor: ParagraphEditAnchor,
  newText: string
): ApplyParagraphEditOutcome {
  if (paragraphEditTextContainsBlankLine(newText)) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "blank-line-not-allowed" };
  }

  const scan = scanComplexBlocks(doc);
  const paragraphCandidates = scan.blocks.filter(
    (b) => b.kind === "paragraph" && b.editability === "supported"
  );

  const extract = (b: ComplexBlockInfo): string =>
    doc.lines.slice(b.range.startLine, b.range.endLine + 1).join("\n");

  const applyAt = (b: ComplexBlockInfo): ApplyParagraphEditOutcome => {
    const newLines = newText.split("\n");
    const lines = [
      ...doc.lines.slice(0, b.range.startLine),
      ...newLines,
      ...doc.lines.slice(b.range.endLine + 1),
    ];
    return { changed: true, lines, newStartLine: b.range.startLine };
  };

  // Pass 1: fast path via the (possibly stale) scan-local id.
  const idCandidate = paragraphCandidates.find((b) => b.id === anchor.complexBlockId);
  if (
    idCandidate &&
    idCandidate.parentId === anchor.parentId &&
    complexBlockDepth(doc, idCandidate.parentId) === anchor.depth &&
    extract(idCandidate) === anchor.originalText
  ) {
    return applyAt(idCandidate);
  }

  // Pass 2: structural re-search, never trusting the id alone (see this
  // function's own doc comment for the full rationale).
  const sameSlotCandidates = paragraphCandidates.filter(
    (b) => b.parentId === anchor.parentId && complexBlockDepth(doc, b.parentId) === anchor.depth
  );
  const exactMatches = sameSlotCandidates.filter((b) => extract(b) === anchor.originalText);

  if (exactMatches.length === 1) {
    return applyAt(exactMatches[0]);
  }
  if (exactMatches.length >= 2) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "anchor-unresolved" };
  }
  // exactMatches.length === 0: nothing under this parent currently holds
  // the anchor's exact text.
  if (sameSlotCandidates.length === anchor.siblingCount) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "content-changed" };
  }
  return { changed: false, lines: doc.lines, newStartLine: -1, reason: "anchor-unresolved" };
}
