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
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";
import {
  buildQuotePrefixProjection,
  invertQuotePrefixProjection,
  projectedDisplayText,
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
