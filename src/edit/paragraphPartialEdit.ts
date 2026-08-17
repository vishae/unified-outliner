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
 * Safety contract (5P-2 ticket §4): Apply never trusts the cursor position
 * or the anchor's own line numbers — the caller always re-parses the
 * CURRENT note fresh and hands the resulting ParsedDocument here, where
 * this module re-scans it and re-resolves the SAME logical paragraph via
 * three independent checks, all of which must agree before `newText` is
 * ever spliced in:
 *   1. the SAME scan-local id the pane's original projection captured
 *      (ParagraphEditAnchor.complexBlockId) — a cheap first filter, same
 *      convention edit/partialEdit.ts's extractComplexBlockText already
 *      uses for callout/blockquote (never assumed persistent across an
 *      unrelated edit elsewhere in the note — see model/complexBlock.ts's
 *      own id-stability caveat);
 *   2. an explicit parentId/depth match against the anchor's own snapshot
 *      — catches "same text, different structural position", which a
 *      content-only compare cannot detect;
 *   3. a byte-for-byte compare of the freshly re-extracted text against
 *      the anchor's own "before editing" snapshot — mirrors
 *      edit/partialEdit.ts's applySubtreeEdit conflict check exactly.
 * Any disagreement no-ops (byte-identical `lines`) with a distinct, typed
 * reason rather than guessing which paragraph the user meant. On success,
 * the replacement always covers EXACTLY the re-resolved paragraph's own
 * range — nothing before or after it is ever touched, so an adjacent
 * heading/list/callout/blockquote/fence/table can never be affected by an
 * Apply.
 */
import { ParsedDocument } from "../model/block";
import { complexBlockDepth, scanComplexBlocks } from "../parser/complexBlocks";

/**
 * Captured once, at load time, from a successful
 * resolver/resolveParagraphAtCursor.ts result (complexBlockId, parentId,
 * depth, text -> originalText) — see that module's own doc comment for
 * field meanings. Never persisted beyond the Partial Edit Pane's own
 * in-memory session; never written to the note or to plugin settings.
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
}

export type NoParagraphApplyReason = "resolve-failed" | "identity-changed" | "content-changed";

export interface ApplyParagraphEditOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the replaced range (valid when changed). */
  newStartLine: number;
  reason?: NoParagraphApplyReason;
}

/**
 * Re-resolve `anchor` against a fresh scan of `doc` (the CURRENT note,
 * already re-parsed by the caller) and splice `newText` in over exactly
 * that paragraph's own range — but only once every check in this module's
 * top doc comment passes.
 *
 * Failure reasons:
 *   - "resolve-failed": no paragraph with `anchor.complexBlockId` exists in
 *     the fresh scan at all, or one does but its editability is no longer
 *     "supported" — covers "the paragraph was deleted", "it was split by a
 *     blank line" (the id-slot's content now differs enough that a
 *     DIFFERENT, shorter candidate ends up there, or no candidate at all
 *     once numbering shifts), "it was merged into a neighbor", and "it
 *     became a different, unsupported/ambiguous kind".
 *   - "identity-changed": a same-id paragraph was found and is
 *     "supported", but its parentId or depth no longer matches the
 *     anchor — it moved to a different section/list-item parent, or its
 *     nesting depth changed, even though its own text may be unchanged.
 *   - "content-changed": id, parentId, and depth all still match, but the
 *     freshly re-extracted text differs from `anchor.originalText` — the
 *     note changed (this paragraph's own content, specifically) since the
 *     pane loaded it.
 */
export function applyParagraphEdit(
  doc: ParsedDocument,
  anchor: ParagraphEditAnchor,
  newText: string
): ApplyParagraphEditOutcome {
  const scan = scanComplexBlocks(doc);
  const block = scan.blocks.find(
    (b) => b.id === anchor.complexBlockId && b.kind === "paragraph"
  );
  if (!block || block.editability !== "supported") {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "resolve-failed" };
  }
  if (
    block.parentId !== anchor.parentId ||
    complexBlockDepth(doc, block.parentId) !== anchor.depth
  ) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "identity-changed" };
  }
  const currentText = doc.lines.slice(block.range.startLine, block.range.endLine + 1).join("\n");
  if (currentText !== anchor.originalText) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "content-changed" };
  }

  const newLines = newText.split("\n");
  const lines = [
    ...doc.lines.slice(0, block.range.startLine),
    ...newLines,
    ...doc.lines.slice(block.range.endLine + 1),
  ];
  return { changed: true, lines, newStartLine: block.range.startLine };
}
