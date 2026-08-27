/**
 * Phase 5D-0.5 ("Quote Prefix Projection for Partial Edit"): a pure,
 * Obsidian-free text transform that lets the Partial Edit Pane show a
 * callout/blockquote's BODY content without its leading `>` prefix (and,
 * for a callout, without its header line at all), while still round-
 * tripping back to byte-identical raw Markdown on Apply.
 *
 * This module does NOT know about ParsedDocument, ComplexBlockInfo,
 * doc.nodes, or any parser/scanner concept — it operates purely on the
 * raw multi-line text edit/partialEdit.ts's extractSubtreeText already
 * returns for a "supported" callout/blockquote (see that function's own
 * doc comment), plus the caller-supplied `kind`. This keeps the same
 * "each layer is independently testable, no Obsidian dependency creeps
 * downward" discipline every other edit/* module in this plugin already
 * follows. No new parser/writer/Markdown-normalization logic is added —
 * this module only ever slices/rejoins strings that extractSubtreeText/
 * applySubtreeEdit (both unmodified) already treat as ground truth.
 *
 * ---- The core invariant: prefix + content === original line, always ----
 *
 * Every QuotePrefixLineMapping splits ONE raw body line into exactly two
 * substrings — `prefix` (everything from the start of the line through
 * its `>` marker and at most one following space/tab) and `content`
 * (everything after that) — such that `prefix + content` reconstructs the
 * original line byte-for-byte, unconditionally, for ANY input line (the
 * split point can never fail to cover the whole line, since `content` is
 * captured via `.*` with no length restriction — see LINE_PREFIX_RE).
 * This is what makes invertQuotePrefixProjection lossless: it never
 * re-derives or re-normalizes a prefix, it only ever concatenates the
 * ORIGINAL prefix (captured once, at build time) with whatever content
 * the textarea now holds for that line.
 *
 * ---- Two "do not project" cases ----
 *
 * buildQuotePrefixProjection reports exactly two distinct failure
 * reasons, and the two are NOT interchangeable — see this ticket's
 * approved scope for the exact caller-side handling of each:
 *
 *   - "nested": some body line, after stripping exactly ONE level of `>`
 *     prefix, ITSELF still starts with a quote prefix — a plain nested
 *     blockquote (`> > text`, no `[!` marker). This is a real, confirmed
 *     gap in parser/complexBlocks.ts's own nested-quote detection: that
 *     module's hasEmbeddedCalloutMarker/NESTED_CALLOUT_RE only fire for a
 *     nested CALLOUT marker (`> > [!type]`), never for a plain nested
 *     blockquote with no marker at all, so a block containing one can
 *     still reach editability "supported" upstream. This module's own,
 *     independent check is what closes that remaining gap, without
 *     touching parser/complexBlocks.ts at all. The caller (PartialEditView)
 *     must refuse to open the Pane at all for this reason — never fall
 *     back to raw editing — per the approved scope's explicit "raw
 *     fallback を使わない" instruction: nested quote structure is not
 *     something this phase's flat line-mapping model can represent
 *     safely, projected OR raw-in-a-projecting-pane.
 *   - "no-body": a callout whose range is header-only (zero body lines).
 *     The caller must fall back to the EXISTING, unmodified raw Partial
 *     Edit behavior for this reason — this is NOT a rejection; nothing
 *     about the block is unsupported, there is simply nothing to project.
 *     A blockquote can never produce this reason: a "supported"
 *     blockquote's range always has at least one line, and blockquote has
 *     no header line to exclude, so its body-line list is never empty.
 *
 * ---- What counts as an allowed edit ----
 *
 * invertQuotePrefixProjection accepts ONLY a per-line CONTENT change,
 * including emptying a line's content entirely (which still reconstructs
 * as `prefix + ""` — a valid, syntactically bare quoted line like a lone
 * `>`). Any edit that changes the number of lines — adding a line,
 * deleting a line, or splitting/joining lines via an embedded newline —
 * changes `editedDisplayText.split("\n").length` relative to the
 * projection's own `lines.length`, and is refused wholesale with reason
 * "line-count-changed": there is no per-line prefix to attribute to a
 * line that did not exist when the projection was built, and guessing
 * one (e.g. "reuse the previous line's prefix") would silently fabricate
 * Markdown structure that was never in the original note. This mirrors
 * every other refusal policy in this codebase: resolve safely, refuse
 * the operation, never guess.
 */

/** Only callout/blockquote ever reach this module — see extractSubtreeText's SubtreeKind (edit/partialEdit.ts), which also includes "section"/"list" that never project. */
export type QuotePrefixProjectionKind = "callout" | "blockquote";

/**
 * One body line's lossless split. `prefix + content` always reconstructs
 * the original raw line byte-for-byte — see this module's top doc
 * comment for why that invariant holds unconditionally.
 */
export interface QuotePrefixLineMapping {
  prefix: string;
  content: string;
}

/**
 * Phase 5D-1A ("Callout Header Title Editing"): the callout header line
 * split into a READ-ONLY portion (`beforeTitle` — quote prefix, `[!type]`,
 * fold marker, and whatever separator whitespace originally followed it)
 * and the EDITABLE `title` itself. Exactly the same lossless-split
 * discipline as QuotePrefixLineMapping above: `beforeTitle + title` always
 * reconstructs the original header line byte-for-byte — see
 * buildQuoteHeaderTitleSlot's own doc comment. Only ever built for kind
 * "callout"; a blockquote has no header/title concept at all.
 */
export interface QuoteHeaderTitleSlot {
  beforeTitle: string;
  title: string;
}

/**
 * `header` is the callout's own header line (`> [!type]+ title`),
 * verbatim, shown read-only OUTSIDE the textarea by the caller — never
 * null for kind "callout", always null for kind "blockquote" (a
 * blockquote has no header concept; every one of its lines is body
 * content). `lines` never includes the header line for a callout.
 *
 * Phase 5D-1A: `titleSlot` is the header's title split out for editing —
 * always null for kind "blockquote", and for kind "callout" null only in
 * the defensive case where the header line unexpectedly doesn't match
 * HEADER_TITLE_SPLIT_RE (should not happen for a header that already
 * matched parser/complexBlocks.ts's own CALLOUT_START_RE at scan time;
 * see buildQuoteHeaderTitleSlot's doc comment). `header` and `titleSlot`
 * are two independent views of the SAME header line — `header` for
 * read-only display when title editing isn't offered, `titleSlot` for
 * the editable case — never out of sync with each other, since both are
 * derived from the identical `rawLines[0]` in buildQuotePrefixProjection.
 */
export interface QuotePrefixProjection {
  kind: QuotePrefixProjectionKind;
  header: string | null;
  titleSlot: QuoteHeaderTitleSlot | null;
  lines: QuotePrefixLineMapping[];
}

export type QuotePrefixProjectionBuildReason = "nested" | "no-body";

export type QuotePrefixProjectionBuildResult =
  | { ok: true; projection: QuotePrefixProjection }
  | { ok: false; reason: QuotePrefixProjectionBuildReason };

/**
 * Splits ONE raw line into (prefix, content) covering the whole line —
 * `[ \t]*` (leading indentation, e.g. list-item-owned continuation),
 * `>` (the quote marker itself, required), `[ \t]?` (at most one
 * following space/tab — a SECOND space, if present, becomes part of
 * `content`, which is still lossless since prefix+content always equals
 * the original line regardless of where the split falls). Intentionally
 * NOT the same regex as parser/complexBlocks.ts's QUOTE_PREFIX_RE/
 * CALLOUT_START_RE (boundary-detection, not display/round-trip) or
 * tree/buildOutlineTree.ts's stripQuotePrefixForDisplay (display-only,
 * lossy — it `.trim()`s the result, which this module must never do).
 */
const LINE_PREFIX_RE = /^([ \t]*>[ \t]?)(.*)$/;

/** True when `content` (already one level of `>` stripped) itself starts with another quote prefix — the plain-nested-blockquote case this module exists to catch. */
const NESTED_QUOTE_CONTENT_RE = /^[ \t]*>/;

/**
 * Phase 5D-1A: splits a callout HEADER line into (beforeTitle, title),
 * covering the whole line — mirrors LINE_PREFIX_RE's split discipline
 * exactly, just anchored to the header's own shape (quote prefix,
 * `[!type]`, optional fold marker, then whatever run of spaces/tabs
 * follows) instead of a body line's bare `>` prefix. Structurally the
 * same anchor as parser/complexBlocks.ts's CALLOUT_START_RE, but with the
 * ENTIRE "everything before the title" span captured as ONE group
 * (rather than separate type/fold groups) — this module only ever needs
 * to treat that whole span as an opaque, read-only, reused-verbatim unit,
 * never to inspect type or fold marker individually (both stay
 * unconditionally read-only per this ticket's approved scope).
 */
const HEADER_TITLE_SPLIT_RE = /^([ \t]*>[ \t]?\[![^\]]+\][+-]?[ \t]*)(.*)$/;

/**
 * Build a QuoteHeaderTitleSlot from a raw callout header line. Returns
 * null only defensively — a header line that already matched
 * CALLOUT_START_RE at scan time (the only way a block is ever classified
 * "callout" in the first place) is structurally guaranteed to also match
 * HEADER_TITLE_SPLIT_RE above, since the latter is anchored identically.
 * A caller seeing null here should treat it exactly like a callout with
 * no title slot at all — fall back to read-only header display, offer no
 * title input — never throw or guess.
 */
export function buildQuoteHeaderTitleSlot(headerLine: string): QuoteHeaderTitleSlot | null {
  const m = headerLine.match(HEADER_TITLE_SPLIT_RE);
  if (!m) return null;
  return { beforeTitle: m[1], title: m[2] };
}

/**
 * Build a QuotePrefixProjection from `rawText` — the EXACT string
 * extractSubtreeText returned for a "supported" callout/blockquote (the
 * whole block's range, `\n`-joined, header line included for a callout).
 * See this module's top doc comment for the "nested"/"no-body" failure
 * reasons and how a caller must handle each.
 */
export function buildQuotePrefixProjection(
  rawText: string,
  kind: QuotePrefixProjectionKind
): QuotePrefixProjectionBuildResult {
  const rawLines = rawText.split("\n");
  let header: string | null = null;
  let titleSlot: QuoteHeaderTitleSlot | null = null;
  let bodyLines = rawLines;
  if (kind === "callout") {
    header = rawLines[0] ?? "";
    titleSlot = buildQuoteHeaderTitleSlot(header);
    bodyLines = rawLines.slice(1);
  }
  if (bodyLines.length === 0) {
    // Only reachable for kind "callout" (header-only range) — see this
    // module's top doc comment for why a blockquote can never hit this.
    return { ok: false, reason: "no-body" };
  }

  const lines: QuotePrefixLineMapping[] = [];
  for (const raw of bodyLines) {
    const m = raw.match(LINE_PREFIX_RE);
    if (!m) {
      // Defensive only: every line inside a "supported" callout/
      // blockquote range is guaranteed by parser/complexBlocks.ts's
      // scanQuoteRuns to match its own QUOTE_PREFIX_RE, and LINE_PREFIX_RE
      // above matches a strict superset of that (it never requires
      // anything QUOTE_PREFIX_RE doesn't already require) — so this
      // should be unreachable in practice. If it is somehow reached, the
      // raw text does not actually describe a well-formed quote body;
      // fail closed exactly like a genuinely nested run, rather than
      // guessing a synthetic prefix for it.
      return { ok: false, reason: "nested" };
    }
    const prefix = m[1];
    const content = m[2];
    if (NESTED_QUOTE_CONTENT_RE.test(content)) {
      return { ok: false, reason: "nested" };
    }
    lines.push({ prefix, content });
  }
  return { ok: true, projection: { kind, header, titleSlot, lines } };
}

/** The textarea's display value for a built projection — each body line's `content`, joined with "\n". Never includes the header (callers render that separately, read-only). */
export function projectedDisplayText(projection: QuotePrefixProjection): string {
  return projection.lines.map((line) => line.content).join("\n");
}

export type QuotePrefixProjectionInvertReason = "line-count-changed";

export type QuotePrefixProjectionInvertResult =
  | { ok: true; rawText: string }
  | { ok: false; reason: QuotePrefixProjectionInvertReason };

/**
 * Reconstruct raw Markdown text from `projection` and the textarea's
 * CURRENT (possibly edited) display text. Refuses with
 * "line-count-changed" — never guesses a prefix for an added/removed
 * line — whenever `editedDisplayText`'s own line count no longer matches
 * `projection.lines.length`, per this module's top doc comment. On
 * success, each edited line is reunited with its ORIGINAL prefix (never
 * a re-derived one), and the callout header (if any) is reattached
 * verbatim and unedited — the header is never part of `editedDisplayText`
 * at all, since projectedDisplayText never included it either.
 */
export function invertQuotePrefixProjection(
  projection: QuotePrefixProjection,
  editedDisplayText: string
): QuotePrefixProjectionInvertResult {
  const editedLines = editedDisplayText.split("\n");
  if (editedLines.length !== projection.lines.length) {
    return { ok: false, reason: "line-count-changed" };
  }
  const rawBodyLines = projection.lines.map((mapping, i) => mapping.prefix + editedLines[i]);
  const rawLines =
    projection.kind === "callout" ? [projection.header ?? "", ...rawBodyLines] : rawBodyLines;
  return { ok: true, rawText: rawLines.join("\n") };
}

export type QuoteHeaderTitleReconstructReason = "newline";

export type QuoteHeaderTitleReconstructResult =
  | { ok: true; header: string }
  | { ok: false; reason: QuoteHeaderTitleReconstructReason };

/**
 * Phase 5D-1A: reconstruct a full callout header line from `slot` (the
 * ORIGINAL, load-time split — never mutated) and `newTitle` (the title
 * input's CURRENT value, edited or not). `slot.beforeTitle` — quote
 * prefix, `[!type]`, fold marker, original separator whitespace — is
 * NEVER altered by this function; only the title portion changes.
 *
 * Refuses with reason "newline" whenever `newTitle` contains one — a
 * callout header is exactly one raw Markdown line, so a title spanning
 * multiple lines has no well-formed reconstruction. Callers must treat
 * this exactly like invertQuotePrefixProjection's own
 * "line-count-changed": reject the WHOLE Apply (title edit AND any body
 * edit together), zero-byte-change, never a partial write.
 *
 * The three formatting rules below are this ticket's own approved,
 * fixed specification — not a heuristic this function invents:
 *
 *   1. newTitle === "" (title emptied, or was already empty and stays
 *      empty/unedited): `slot.beforeTitle` is reused completely
 *      unmodified, including any trailing separator whitespace it may
 *      already contain. Nothing is trimmed.
 *   2. `slot.title === ""` (the ORIGINAL title was empty) and newTitle
 *      is non-empty: if `slot.beforeTitle` already ends in a space or
 *      tab, `beforeTitle + newTitle`; otherwise exactly one space is
 *      inserted (`beforeTitle + " " + newTitle`) — the minimum
 *      readability correction needed for a brand-new title to not glue
 *      onto `]`/the fold marker. This is a pure insertion; it never
 *      touches `beforeTitle` itself.
 *   3. `slot.title !== ""` and newTitle is non-empty (non-empty to a
 *      different non-empty value): `beforeTitle + newTitle`, no space
 *      logic — `beforeTitle` already carries whatever separator
 *      convention the ORIGINAL non-empty title used, and rule 3
 *      deliberately preserves that as-is rather than reformatting it.
 *
 * An unedited title (newTitle === slot.title, non-empty) also falls
 * under rule 3 and reconstructs the header byte-identical to the
 * original — the same "unedited Apply changes nothing" guarantee
 * QuotePrefixProjection's body-line split already provides.
 */
export function reconstructQuoteHeader(
  slot: QuoteHeaderTitleSlot,
  newTitle: string
): QuoteHeaderTitleReconstructResult {
  if (newTitle.includes("\n")) {
    return { ok: false, reason: "newline" };
  }
  if (newTitle === "") {
    return { ok: true, header: slot.beforeTitle };
  }
  if (slot.title === "" && !/[ \t]$/.test(slot.beforeTitle)) {
    return { ok: true, header: slot.beforeTitle + " " + newTitle };
  }
  return { ok: true, header: slot.beforeTitle + newTitle };
}
