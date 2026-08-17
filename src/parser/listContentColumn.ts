/**
 * Phase 5P-1R: single source of truth for "the column at which a list
 * item's own text content begins" (its content-start column), shared by
 * BOTH parser/complexBlocks.ts (Phase 5P-1's list-item-child paragraph
 * recognition) and edit/insertBlock.ts (Phase 5C-1B's insertChildListItem).
 *
 * Before this ticket, the two call sites carried independently-maintained,
 * byte-identical COPIES of this exact computation — a real drift risk a
 * 5P-1 review flagged (two implementations that must always agree, with
 * nothing enforcing that beyond a doc-comment reminder to keep them in
 * sync). This module is the fix: a single, side-effect-free, Obsidian-free
 * function that both parser/* and edit/* import, so there is exactly one
 * place this rule can ever be wrong.
 *
 * This does NOT live in parser/parseDocument.ts. parseDocument.ts is the
 * section/list AUTHORITY parser — its own boundary/closing logic (in
 * particular ListBlockNode.indentColumns, the MARKER's own column) is
 * explicitly out of scope for Phase 5P to touch, and every Phase 5P ticket
 * to date has treated "do not change parseDocument.ts" as a hard
 * constraint. This module only ever READS an already-parsed
 * ParsedDocument/ListBlockNode — it computes a DERIVED column (marker +
 * separating whitespace), never a boundary decision parseDocument.ts itself
 * is responsible for.
 *
 * Supported input shapes (all four of parser/parseDocument.ts's own
 * LIST_RE marker forms): unordered `-`, `*`, `+`; ordered `N.` and `N)`,
 * including multi-digit N (`10.`, `123)`); any number of separating spaces
 * or tabs between the marker and the item's own text (tab-stop math via
 * parser/parseDocument.ts's own indentColumnsOf, which already snaps to
 * the correct tab stop from the CURRENT running column, not a flat
 * per-tab constant); a marker with NO separating whitespace at all (a bare
 * "-" with nothing following) falls back to exactly one column past the
 * marker, matching this module's pre-extraction behavior in both of its
 * former call sites. Leading whitespace that mixes tabs and spaces
 * (ListBlockNode.unsafeIndent) is NOT specially handled here — this
 * function still returns a column for such an item (deriving one is not
 * itself unsafe), but every EXISTING caller already refuses to use that
 * column for anything unsafe-indent-sensitive (edit/insertBlock.ts's
 * insertChildListItem already checks `parent.unsafeIndent` and refuses
 * BEFORE calling this function at all; parser/complexBlocks.ts's
 * scanParagraphBlocks does not perform any unsafe-indent check of its own,
 * matching every other kind that scanner recognizes — recognition, not an
 * edit operation, is being performed there).
 */
import { ListBlockNode, ParsedDocument } from "../model/block";
import { indentColumnsOf, TAB_WIDTH } from "./parseDocument";

const LIST_MARKER_PREFIX_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]*)/;

/**
 * The column at which `item`'s own text content begins — read directly from
 * its actual line text (leading whitespace + marker + separating
 * whitespace), never assumed from a fixed constant.
 */
export function listItemContentColumn(doc: ParsedDocument, item: ListBlockNode): number {
  const line = doc.lines[item.range.startLine];
  const m = line.match(LIST_MARKER_PREFIX_RE);
  if (!m) return item.indentColumns + TAB_WIDTH;
  const [, leadWs, marker, gapWs] = m;
  const col = indentColumnsOf(leadWs + marker + gapWs);
  return gapWs.length === 0 ? col + 1 : col;
}
