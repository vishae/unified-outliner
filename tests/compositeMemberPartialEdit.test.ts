/**
 * Phase 5D-0.4 ("Enable Partial Edit for supported composite-member
 * callouts and blockquotes"): extraction / write-back / safety tests for
 * opening a CompositeBlock MEMBER callout/blockquote in the Partial Edit
 * Pane.
 *
 * Per this ticket's own contract, NO new parser/writer/apply logic was
 * written: extractSubtreeText/applySubtreeEdit (edit/partialEdit.ts) are
 * composite-membership-agnostic — they only ever look at a
 * ComplexBlockInfo's own id/kind/editability/range, exactly as they already
 * do for a standalone callout/blockquote (see
 * tests/partialEdit.test.ts's own "Phase 5C-2: standalone callout/
 * blockquote" describe blocks, which this file deliberately mirrors). This
 * file's only job is to prove that the SAME behavior holds when the target
 * happens to be a CompositeBlock member — fixtures below always assert
 * `matchCompositeBlocks` actually matched the target as a member before
 * exercising extract/apply, so a fixture typo can never silently turn this
 * into a standalone-block test by accident.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";

const FIXTURE = [
  "# Notes",
  "- ![[scan-001.png]]",
  "> [!ocr]",
  "> Line one of OCR text.",
  ">",
  "> - a nested list inside the callout body",
  "> Line two after the blank line.",
  "- ![[scan-002.png]]",
  "> quoted transcription line",
  "# Next section",
].join("\n");

function calloutMemberId(doc: ReturnType<typeof parseDocument>): string {
  const complexScan = scanComplexBlocks(doc);
  const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
  const calloutInfo = complexScan.blocks.find((b) => b.kind === "callout")!;
  const isMember = infos.some((c) => c.members.some((m) => m.id === calloutInfo.id));
  expect(isMember).toBe(true); // guards against this fixture silently stopping being a composite member
  return calloutInfo.id;
}

function blockquoteMemberId(doc: ReturnType<typeof parseDocument>): string {
  const complexScan = scanComplexBlocks(doc);
  const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
  const bqInfo = complexScan.blocks.find((b) => b.kind === "blockquote")!;
  const isMember = infos.some((c) => c.members.some((m) => m.id === bqInfo.id));
  expect(isMember).toBe(true);
  return bqInfo.id;
}

describe("extractSubtreeText: composite-member callout/blockquote", () => {
  it("extracts a composite-member callout's exact raw range (header, `>` prefix, nested list, blank line, all included verbatim)", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutMemberId(doc);
    const outcome = extractSubtreeText(doc, id);
    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("callout");
    expect(outcome.text).toBe(
      [
        "> [!ocr]",
        "> Line one of OCR text.",
        ">",
        "> - a nested list inside the callout body",
        "> Line two after the blank line.",
      ].join("\n")
    );
  });

  it("extracts a composite-member blockquote's exact raw range", () => {
    const doc = parseDocument(FIXTURE);
    const id = blockquoteMemberId(doc);
    const outcome = extractSubtreeText(doc, id);
    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("blockquote");
    expect(outcome.text).toBe("> quoted transcription line");
  });
});

describe("applySubtreeEdit: composite-member callout/blockquote write-back", () => {
  it("Apply on a composite-member callout replaces only its own range — the list item marker, the sibling image-quote pair, and the trailing section are all byte-identical afterwards", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutMemberId(doc);
    const original = extractSubtreeText(doc, id);
    expect(original.ok).toBe(true);

    const newText = ["> [!ocr]", "> corrected OCR text."].join("\n");
    const outcome = applySubtreeEdit(doc, id, original.text, newText);

    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# Notes",
      "- ![[scan-001.png]]",
      "> [!ocr]",
      "> corrected OCR text.",
      "- ![[scan-002.png]]",
      "> quoted transcription line",
      "# Next section",
    ]);
  });

  it("Apply on a composite-member blockquote replaces only its own range — the preceding image-ocr pair and the trailing section are untouched", () => {
    const doc = parseDocument(FIXTURE);
    const id = blockquoteMemberId(doc);
    const original = extractSubtreeText(doc, id);
    expect(original.ok).toBe(true);

    const outcome = applySubtreeEdit(doc, id, original.text, "> corrected transcription");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# Notes",
      "- ![[scan-001.png]]",
      "> [!ocr]",
      "> Line one of OCR text.",
      ">",
      "> - a nested list inside the callout body",
      "> Line two after the blank line.",
      "- ![[scan-002.png]]",
      "> corrected transcription",
      "# Next section",
    ]);
  });

  it("Cancel (never calling applySubtreeEdit at all) leaves the note byte-identical — there is no write path other than applySubtreeEdit", () => {
    const doc = parseDocument(FIXTURE);
    // No apply call. The pane's own Cancel button is UI-only (discards the
    // textarea's pending edits and never calls applySubtreeEdit) — verified
    // here at the level this file can reach: the original document is
    // simply never mutated by extraction alone.
    const id = calloutMemberId(doc);
    extractSubtreeText(doc, id);
    expect(doc.lines.join("\n")).toBe(FIXTURE);
  });
});

describe("applySubtreeEdit: composite-member safety (conflict / deletion / boundary change)", () => {
  it("refuses (conflict) when the composite-member callout's content changed elsewhere since the pane loaded it, leaving lines unchanged", () => {
    const staleOriginal = ["> [!ocr]", "> Line one of OCR text.", ">", "> - a nested list inside the callout body", "> Line two after the blank line."].join("\n");
    const editedElsewhere = FIXTURE.replace("Line one of OCR text.", "someone else's edit");
    const doc = parseDocument(editedElsewhere);
    const id = calloutMemberId(doc);

    const outcome = applySubtreeEdit(doc, id, staleOriginal, "> [!ocr]\n> my pane's edit");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("refuses (resolve-failed) when the composite-member callout was deleted from the note before Apply, leaving lines unchanged", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutMemberId(doc);
    const original = extractSubtreeText(doc, id);

    const withoutCallout = parseDocument(
      ["# Notes", "- ![[scan-001.png]]", "- ![[scan-002.png]]", "> quoted transcription line", "# Next section"].join(
        "\n"
      )
    );
    const outcome = applySubtreeEdit(withoutCallout, id, original.text, "> [!ocr]\n> edited");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
    expect(outcome.lines).toEqual(withoutCallout.lines);
  });

  it("refuses safely when the member's kind changed (callout demoted to a plain blockquote) since the anchor was captured, leaving lines unchanged", () => {
    const doc = parseDocument(FIXTURE);
    const id = calloutMemberId(doc);
    const original = extractSubtreeText(doc, id);

    // The callout at the same position becomes a plain blockquote (no
    // `[!ocr]` marker) — the OLD callout id ("callout-N") no longer
    // resolves to anything of kind "callout" at all.
    const kindChanged = parseDocument(FIXTURE.replace("> [!ocr]", "> just a quote now"));
    const outcome = applySubtreeEdit(kindChanged, id, original.text, "> [!ocr]\n> edited");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
    expect(outcome.lines).toEqual(kindChanged.lines);
  });

  it("no rejection path ever changes even a single character of the note", () => {
    const scenarios: Array<[doc: ReturnType<typeof parseDocument>, id: string, original: string]> = (() => {
      const doc1 = parseDocument(FIXTURE);
      const id1 = calloutMemberId(doc1);
      const doc2 = parseDocument(FIXTURE.replace("Line one of OCR text.", "changed"));
      const id2 = calloutMemberId(doc2);
      return [
        [doc1, "callout-does-not-exist", "> [!ocr]\n> x"],
        [doc2, id2, "> [!ocr]\n> Line one of OCR text.\n>\n> - a nested list inside the callout body\n> Line two after the blank line."],
      ];
    })();
    for (const [doc, id, original] of scenarios) {
      const outcome = applySubtreeEdit(doc, id, original, "> [!ocr]\n> attempted edit");
      expect(outcome.changed).toBe(false);
      expect(outcome.lines).toEqual(doc.lines);
    }
  });
});
