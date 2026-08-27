/**
 * Phase 5D-0.5 ("Quote Prefix Projection for Partial Edit"): real,
 * Obsidian-free integration tests for the exact pipeline
 * view/PartialEditView.ts's applyEdit now runs for a projecting callout/
 * blockquote — buildQuotePrefixProjection -> (edit) ->
 * invertQuotePrefixProjection -> applySubtreeEdit (the last of which is
 * completely unmodified by this ticket; see edit/partialEdit.ts).
 *
 * PartialEditView itself cannot be constructed in vitest (ItemView is
 * Obsidian-dependent — "obsidian" is a types-only package in this repo;
 * see tests/paragraphPartialEditViewWiring.test.ts's own doc comment for
 * the established precedent). This file instead exercises the identical
 * sequence of pure calls the View makes, directly — real behavioral
 * coverage of Apply/conflict/resolve-failed/two-consecutive-Applies
 * without any Obsidian mocking. The View's own wiring (which fields it
 * reads/writes, and in what order) is covered separately by
 * tests/quotePrefixPartialEditViewWiring.test.ts's static source checks.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";
import {
  buildQuotePrefixProjection,
  invertQuotePrefixProjection,
  projectedDisplayText,
  reconstructQuoteHeader,
  QuotePrefixProjection,
} from "../src/edit/quotePrefixProjection";

const FIXTURE = [
  "# Notes",
  "- an unrelated list item",
  "> [!note] My Callout",
  "> line one",
  "> line two",
  "",
  "> a blockquote line one",
  "> a blockquote line two",
  "# Next section",
  "still here",
].join("\n");

function calloutId(doc: ReturnType<typeof parseDocument>): string {
  const b = scanComplexBlocks(doc).blocks.find((x) => x.kind === "callout");
  if (!b) throw new Error("no callout in fixture");
  return b.id;
}

function blockquoteId(doc: ReturnType<typeof parseDocument>): string {
  const b = scanComplexBlocks(doc).blocks.find((x) => x.kind === "blockquote");
  if (!b) throw new Error("no blockquote in fixture");
  return b.id;
}

describe("quote-prefix projection Apply pipeline: standalone callout", () => {
  it("editing body content via the projected display text updates only the callout's own range, preserving the header and every `>` prefix", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    expect(extracted.kind).toBe("callout");

    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const editedDisplay = ["line one EDITED", "line two"].join("\n");
    const inverted = invertQuotePrefixProjection(built.projection, editedDisplay);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(
      ["> [!note] My Callout", "> line one EDITED", "> line two"].join("\n")
    );

    const outcome = applySubtreeEdit(doc, id, extracted.text, inverted.rawText);
    expect(outcome.changed).toBe(true);
    if (!outcome.changed) return;
    expect(outcome.lines.join("\n")).toBe(
      [
        "# Notes",
        "- an unrelated list item",
        "> [!note] My Callout",
        "> line one EDITED",
        "> line two",
        "",
        "> a blockquote line one",
        "> a blockquote line two",
        "# Next section",
        "still here",
      ].join("\n")
    );
  });

  it("two consecutive Applies both succeed, the second starting from the freshly-reconstructed raw snapshot (mirrors PartialEditView's post-apply re-anchor)", () => {
    let doc = parseDocument(FIXTURE);
    const id = calloutId(doc);

    // First Apply.
    let extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    let built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    let inverted = invertQuotePrefixProjection(built.projection, ["FIRST EDIT", "line two"].join("\n"));
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    let outcome = applySubtreeEdit(doc, id, extracted.text, inverted.rawText);
    expect(outcome.changed).toBe(true);
    if (!outcome.changed) return;

    // Re-parse the just-applied document, exactly like loadNodeInternal/
    // applyEdit always do — never reuse the stale `doc` from before Apply.
    doc = parseDocument(outcome.lines.join("\n"));

    // Second Apply, against the id re-resolved in the fresh document and
    // a projection rebuilt from the just-applied raw text (the View's own
    // post-apply re-anchor step).
    const idAgain = calloutId(doc);
    extracted = extractSubtreeText(doc, idAgain);
    expect(extracted.ok).toBe(true);
    expect(extracted.text).toBe(inverted.rawText);
    built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    inverted = invertQuotePrefixProjection(built.projection, ["FIRST EDIT", "SECOND EDIT"].join("\n"));
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    outcome = applySubtreeEdit(doc, idAgain, extracted.text, inverted.rawText);
    expect(outcome.changed).toBe(true);
    if (!outcome.changed) return;
    expect(outcome.lines.join("\n")).toContain(
      ["> [!note] My Callout", "> FIRST EDIT", "> SECOND EDIT"].join("\n")
    );
  });

  it("an unedited Apply (projected display text round-tripped verbatim) leaves the note byte-for-byte unchanged", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const unedited = projectedDisplayText(built.projection);
    const inverted = invertQuotePrefixProjection(built.projection, unedited);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(extracted.text);
    const outcome = applySubtreeEdit(doc, id, extracted.text, inverted.rawText);
    expect(outcome.changed).toBe(true);
    if (!outcome.changed) return;
    expect(outcome.lines.join("\n")).toBe(FIXTURE);
  });

  it("a line-count-changing edit is refused by invertQuotePrefixProjection BEFORE applySubtreeEdit is ever called — zero-byte-change", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const editedWithExtraLine = [
      projectedDisplayText(built.projection),
      "a brand new line",
    ].join("\n");
    const inverted = invertQuotePrefixProjection(built.projection, editedWithExtraLine);
    expect(inverted).toEqual({ ok: false, reason: "line-count-changed" });
    // The View returns false right here without ever calling
    // applySubtreeEdit — confirmed structurally by
    // quotePrefixPartialEditViewWiring.test.ts's static source check.
  });
});

describe("quote-prefix projection Apply pipeline: standalone blockquote", () => {
  it("editing body content updates only the blockquote's own range, leaving the callout and surrounding sections untouched", () => {
    const doc = parseDocument(FIXTURE);
    const id = blockquoteId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    expect(extracted.kind).toBe("blockquote");
    const built = buildQuotePrefixProjection(extracted.text, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.header).toBeNull();

    const inverted = invertQuotePrefixProjection(
      built.projection,
      ["blockquote line one EDITED", "a blockquote line two"].join("\n")
    );
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    const outcome = applySubtreeEdit(doc, id, extracted.text, inverted.rawText);
    expect(outcome.changed).toBe(true);
    if (!outcome.changed) return;
    expect(outcome.lines.join("\n")).toBe(
      [
        "# Notes",
        "- an unrelated list item",
        "> [!note] My Callout",
        "> line one",
        "> line two",
        "",
        "> blockquote line one EDITED",
        "> a blockquote line two",
        "# Next section",
        "still here",
      ].join("\n")
    );
  });
});

describe("quote-prefix projection: nested-quote and no-body cases (real doc integration)", () => {
  it("a 'supported' blockquote containing a PLAIN nested blockquote (no `[!` marker — the confirmed gap in the existing scanner) still reaches buildQuotePrefixProjection, which correctly refuses it with reason 'nested'", () => {
    const doc = parseDocument(
      ["# Notes", "> outer line", "> > nested line, no [! marker", "> outer again", "# Next"].join(
        "\n"
      )
    );
    const block = scanComplexBlocks(doc).blocks.find((b) => b.kind === "blockquote");
    expect(block).toBeDefined();
    // Confirms the audit finding: the existing scanner's own nested
    // detection (hasEmbeddedCalloutMarker) does NOT catch this — the
    // block reaches "supported", not "unsupported". This module's own
    // independent check is what actually closes the gap, one layer up.
    expect(block?.editability).toBe("supported");

    const extracted = extractSubtreeText(doc, block!.id);
    expect(extracted.ok).toBe(true);
    const built = buildQuotePrefixProjection(extracted.text, "blockquote");
    expect(built).toEqual({ ok: false, reason: "nested" });
  });

  it("a header-only callout (zero body lines) extracts fine via the existing raw path, and applySubtreeEdit still works completely unmodified for it", () => {
    const doc = parseDocument(["# Notes", "> [!note] Header only, no body", "# Next"].join("\n"));
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built).toEqual({ ok: false, reason: "no-body" });

    // Caller (PartialEditView) falls back to raw editing: the textarea
    // shows extracted.text verbatim, and Apply calls applySubtreeEdit
    // directly with the raw edited text — exactly the pre-5D-0.5 path.
    const rawEdited = "> [!note] Header only, EDITED";
    const outcome = applySubtreeEdit(doc, id, extracted.text, rawEdited);
    expect(outcome.changed).toBe(true);
    if (!outcome.changed) return;
    expect(outcome.lines.join("\n")).toBe(["# Notes", rawEdited, "# Next"].join("\n"));
  });
});

describe("quote-prefix projection: existing refusal paths do not regress", () => {
  it("applySubtreeEdit still refuses with 'conflict' when the note changed elsewhere between load and Apply", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const inverted = invertQuotePrefixProjection(
      built.projection,
      ["an edit made in the pane", "line two"].join("\n")
    );
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;

    // The note changed elsewhere (e.g. edited directly) since the pane
    // loaded this callout — re-parse a DIFFERENT version of the document.
    const changedElsewhere = parseDocument(
      FIXTURE.replace("> line one", "> line one changed by someone else")
    );
    const outcome = applySubtreeEdit(changedElsewhere, id, extracted.text, inverted.rawText);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
    // Zero-byte-change: the note passed in is returned untouched.
    expect(outcome.lines).toBe(changedElsewhere.lines);
  });

  it("applySubtreeEdit still refuses with 'resolve-failed' when the target callout was deleted before Apply", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const inverted = invertQuotePrefixProjection(
      built.projection,
      ["an edit made in the pane", "line two"].join("\n")
    );
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;

    const withCalloutDeleted = parseDocument(
      ["# Notes", "- an unrelated list item", "# Next section", "still here"].join("\n")
    );
    const outcome = applySubtreeEdit(withCalloutDeleted, id, extracted.text, inverted.rawText);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });
});

// ---- Phase 5D-1A ("Callout Header Title Editing") -----------------------
//
// The same Apply pipeline above, extended with reconstructQuoteHeader for
// a callout whose header successfully split out a titleSlot. Mirrors
// view/PartialEditView.ts's applyEdit EXACTLY: invert the body first,
// then — only when the projection's own titleSlot is non-null —
// reconstruct the header from the title input's current value and splice
// it in as the new first line, BEFORE the single applySubtreeEdit call.
// Never two separate writes, never a new conflict-detection path.

const OCR_COMPOSITE_FIXTURE = [
  "# Notes",
  "- ![[scan.png]]",
  "> [!ocr] Scan Result",
  "> extracted line one",
  "> extracted line two",
  "# Next section",
  "still here",
].join("\n");

/**
 * Mirrors the exact sequence PartialEditView.ts's applyEdit runs for a
 * projecting callout: invert the body via invertQuotePrefixProjection,
 * then — only when the projection's own titleSlot is non-null —
 * reconstruct the header via reconstructQuoteHeader and splice it in as
 * the new first line, before the single applySubtreeEdit call. This is
 * NOT a new production function — the real logic is the few inline lines
 * inside applyEdit, already pinned by
 * tests/quotePrefixPartialEditViewWiring.test.ts's static source checks;
 * this is a local test helper only, matching this file's own established
 * "exercise the identical sequence of pure calls the View makes,
 * directly" policy (see this file's top doc comment).
 */
function applyProjected(
  doc: ReturnType<typeof parseDocument>,
  id: string,
  extractedText: string,
  projection: QuotePrefixProjection,
  editedBodyDisplay: string,
  newTitleValue: string
):
  | { applied: false; stage: "invert"; reason: "line-count-changed" }
  | { applied: false; stage: "reconstruct"; reason: "newline" }
  | { applied: true; outcome: ReturnType<typeof applySubtreeEdit>; newRawText: string } {
  const inverted = invertQuotePrefixProjection(projection, editedBodyDisplay);
  if (!inverted.ok) {
    return { applied: false, stage: "invert", reason: inverted.reason };
  }
  let newRawText = inverted.rawText;
  const titleSlot = projection.titleSlot;
  if (titleSlot) {
    const reconstructed = reconstructQuoteHeader(titleSlot, newTitleValue);
    if (!reconstructed.ok) {
      return { applied: false, stage: "reconstruct", reason: reconstructed.reason };
    }
    const bodyOnlyLines = newRawText.split("\n").slice(1);
    newRawText = [reconstructed.header, ...bodyOnlyLines].join("\n");
  }
  const outcome = applySubtreeEdit(doc, id, extractedText, newRawText);
  return { applied: true, outcome, newRawText };
}

describe("quote-prefix projection Apply pipeline: title editing (Phase 5D-1A, standalone callout)", () => {
  it("a title-only edit updates only the header's title, leaving every body line and its `>` prefix untouched", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const unedited = projectedDisplayText(built.projection);
    const result = applyProjected(doc, id, extracted.text, built.projection, unedited, "Renamed Title");
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.outcome.changed).toBe(true);
    if (!result.outcome.changed) return;
    expect(result.outcome.lines.join("\n")).toBe(
      [
        "# Notes",
        "- an unrelated list item",
        "> [!note] Renamed Title",
        "> line one",
        "> line two",
        "",
        "> a blockquote line one",
        "> a blockquote line two",
        "# Next section",
        "still here",
      ].join("\n")
    );
  });

  it("a simultaneous title + body edit applies both changes in a single Apply", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const editedBody = ["line one EDITED", "line two"].join("\n");
    const result = applyProjected(doc, id, extracted.text, built.projection, editedBody, "New Title");
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.outcome.changed).toBe(true);
    if (!result.outcome.changed) return;
    expect(result.outcome.lines.join("\n")).toBe(
      [
        "# Notes",
        "- an unrelated list item",
        "> [!note] New Title",
        "> line one EDITED",
        "> line two",
        "",
        "> a blockquote line one",
        "> a blockquote line two",
        "# Next section",
        "still here",
      ].join("\n")
    );
  });

  it("an unedited title + unedited body Apply leaves the callout byte-for-byte unchanged", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const titleSlot = built.projection.titleSlot;
    expect(titleSlot).not.toBeNull();
    if (!titleSlot) return;

    const unedited = projectedDisplayText(built.projection);
    const result = applyProjected(doc, id, extracted.text, built.projection, unedited, titleSlot.title);
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.newRawText).toBe(extracted.text);
    expect(result.outcome.changed).toBe(true);
    if (!result.outcome.changed) return;
    expect(result.outcome.lines.join("\n")).toBe(FIXTURE);
  });

  it("emptying an existing title reuses beforeTitle unmodified — no dangling separator space is left behind", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const unedited = projectedDisplayText(built.projection);
    const result = applyProjected(doc, id, extracted.text, built.projection, unedited, "");
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.outcome.changed).toBe(true);
    if (!result.outcome.changed) return;
    expect(result.outcome.lines).toContain("> [!note] ");
  });

  it("adding a title to a previously title-less callout inserts exactly one separating space", () => {
    const doc = parseDocument(["# Notes", "> [!warning]", "> only body content", "# Next"].join("\n"));
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const unedited = projectedDisplayText(built.projection);
    const result = applyProjected(doc, id, extracted.text, built.projection, unedited, "New Title");
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.outcome.changed).toBe(true);
    if (!result.outcome.changed) return;
    expect(result.outcome.lines.join("\n")).toBe(
      ["# Notes", "> [!warning] New Title", "> only body content", "# Next"].join("\n")
    );
  });

  it("a title containing a newline is refused before applySubtreeEdit is ever called — zero-byte-change, and a simultaneously-pending body edit is discarded too", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const editedBody = ["line one EDITED", "line two"].join("\n");
    const result = applyProjected(
      doc,
      id,
      extracted.text,
      built.projection,
      editedBody,
      "line one\nline two"
    );
    expect(result).toEqual({ applied: false, stage: "reconstruct", reason: "newline" });
    // Confirmed structurally too: PartialEditView.ts's applyEdit returns
    // false at this exact point, before assembling newRawText or calling
    // applySubtreeEdit — see quotePrefixPartialEditViewWiring.test.ts.
  });
});

describe("quote-prefix projection Apply pipeline: title editing (Phase 5D-1A, composite-member callout)", () => {
  it("a composite-member callout's title-only edit produces the exact same shaped result as a standalone callout — no separate writer, no different behavior", () => {
    const doc = parseDocument(OCR_COMPOSITE_FIXTURE);
    const complexScan = scanComplexBlocks(doc);
    const info = complexScan.blocks.find((b) => b.kind === "callout");
    expect(info).toBeDefined();
    const composites = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    // Confirm this callout genuinely IS a composite member before relying
    // on that framing below — not merely a list-item-owned but otherwise
    // standalone callout.
    expect(composites.some((c) => c.members.some((m) => m.id === info!.id))).toBe(true);

    const id = info!.id;
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const unedited = projectedDisplayText(built.projection);
    const result = applyProjected(doc, id, extracted.text, built.projection, unedited, "Renamed Scan");
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.outcome.changed).toBe(true);
    if (!result.outcome.changed) return;
    expect(result.outcome.lines.join("\n")).toBe(
      [
        "# Notes",
        "- ![[scan.png]]",
        "> [!ocr] Renamed Scan",
        "> extracted line one",
        "> extracted line two",
        "# Next section",
        "still here",
      ].join("\n")
    );
  });
});

describe("quote-prefix projection: existing refusal paths do not regress when a title edit is pending (Phase 5D-1A)", () => {
  it("applySubtreeEdit still refuses with 'conflict' when the header's title changed elsewhere between load and Apply, even though the pane's own pending edit was ALSO a title edit — no new conflict-detection logic needed", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const unedited = projectedDisplayText(built.projection);
    const result = applyProjected(doc, id, extracted.text, built.projection, unedited, "Pane's New Title");
    expect(result.applied).toBe(true);
    if (!result.applied) return;

    // The note's header title changed elsewhere (e.g. edited directly)
    // since the pane loaded this callout.
    const changedElsewhere = parseDocument(FIXTURE.replace("My Callout", "Externally Renamed"));
    const outcome = applySubtreeEdit(changedElsewhere, id, extracted.text, result.newRawText);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
    expect(outcome.lines).toBe(changedElsewhere.lines);
  });

  it("applySubtreeEdit still refuses with 'resolve-failed' when the target callout was deleted before Apply, even with a pending title edit", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const unedited = projectedDisplayText(built.projection);
    const result = applyProjected(doc, id, extracted.text, built.projection, unedited, "Pane's New Title");
    expect(result.applied).toBe(true);
    if (!result.applied) return;

    const withCalloutDeleted = parseDocument(
      ["# Notes", "- an unrelated list item", "# Next section", "still here"].join("\n")
    );
    const outcome = applySubtreeEdit(withCalloutDeleted, id, extracted.text, result.newRawText);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });
});
