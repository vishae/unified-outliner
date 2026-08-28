/**
 * Phase 5D-2A ("Atomic CompositeBlock Partial Edit"): unit tests for
 * src/edit/compositeBlockPartialEdit.ts — the pure extract/apply functions
 * that project an ENTIRE CompositeBlock (list item + callout/blockquote)
 * as one raw-Markdown range into the Partial Edit Pane and write it back
 * as a single splice.
 *
 * Scope reminder: same testing boundary as tests/deleteCompositeBlock.test
 * .ts / tests/compositeBlockMoveUiWiring.test.ts — nothing here touches an
 * Editor, view/PartialEditView.ts, main.ts, or view/OutlineTreeView.ts.
 * Every test operates on plain strings/ParsedDocuments in and out.
 * tests/compositeBlockPartialEditUiWiring.test.ts (a separate file) covers
 * the PartialEditView/main.ts/OutlineTreeView.ts wiring this module feeds.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { buildCompositeBlockSnapshot, CompositeBlockSnapshot } from "../src/edit/deleteCompositeBlock";
import {
  applyCompositeBlockEdit,
  compositePartialEditReasonText,
  extractCompositeBlockText,
  NoCompositePartialEditReason,
} from "../src/edit/compositeBlockPartialEdit";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { createTranslator } from "../src/i18n";

/** Real pipeline: parse -> scan -> match -> snapshot the Nth recognized composite (0-based). */
function snapshotOf(
  text: string,
  rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES,
  index = 0
): CompositeBlockSnapshot {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return buildCompositeBlockSnapshot(composites[index]);
}

/** Convenience: snapshot + extract the Nth composite from `text`, exactly as loadCompositeInternal does. */
function loadOwn(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES, index = 0) {
  const snapshot = snapshotOf(text, rules, index);
  const doc = parseDocument(text);
  const extracted = extractCompositeBlockText(doc, snapshot, rules);
  return { snapshot, extracted };
}

describe("extractCompositeBlockText: contiguous full-range extraction", () => {
  it("extracts the whole raw range for a top-level List + Callout composite", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const doc = parseDocument(text);
    const snapshot = snapshotOf(text);
    const outcome = extractCompositeBlockText(doc, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe(text);
    expect(outcome.startLine).toBe(0);
    expect(outcome.endLine).toBe(2);
    expect(outcome.resolvedSnapshot?.ruleId).toBe("image-ocr");
  });

  it("extracts the whole raw range for a top-level List + Quote composite", () => {
    const text = ["- source", "> plain quote"].join("\n");
    const doc = parseDocument(text);
    const snapshot = snapshotOf(text);
    const outcome = extractCompositeBlockText(doc, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe(text);
    expect(outcome.resolvedSnapshot?.ruleId).toBe("image-quote");
  });

  it("extracts correctly when the composite is nested inside a section, not at document start/end", () => {
    const text = ["# H", "intro", "", "- one", "> [!note]", "> body", "", "after"].join("\n");
    const doc = parseDocument(text);
    const snapshot = snapshotOf(text);
    const outcome = extractCompositeBlockText(doc, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe(["- one", "> [!note]", "> body"].join("\n"));
    expect(outcome.startLine).toBe(3);
    expect(outcome.endLine).toBe(5);
  });
});

describe("extractCompositeBlockText: rejections", () => {
  it("rejects (range-invalid) a structurally reversed snapshot range", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const doc = parseDocument(text);
    const snapshot = snapshotOf(text);
    const tampered: CompositeBlockSnapshot = { ...snapshot, range: { startLine: 2, endLine: 0 } };
    const outcome = extractCompositeBlockText(doc, tampered, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.text).toBe("");
  });

  it("rejects (range-invalid) a snapshot whose members have a gap between them (non-contiguous)", () => {
    const gapText = ["- one", "", "> [!note]", "> body"].join("\n");
    const doc = parseDocument(gapText);
    const snapshot: CompositeBlockSnapshot = {
      id: "composite-0",
      ruleId: "image-ocr",
      sectionId: null,
      range: { startLine: 0, endLine: 3 },
      members: [
        { kind: "single-line-list", id: "li-0", range: { startLine: 0, endLine: 0 } },
        { kind: "callout", id: "callout-0", range: { startLine: 2, endLine: 3 } },
      ],
    };
    const outcome = extractCompositeBlockText(doc, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
  });

  it("rejects (snapshot-mismatch) when the composite has shifted to a different line range", () => {
    const originalText = ["- one", "> [!note]", "> body"].join("\n");
    const snapshot = snapshotOf(originalText);
    const currentText = ["unrelated new line", ...originalText.split("\n")].join("\n");
    const doc = parseDocument(currentText);
    const outcome = extractCompositeBlockText(doc, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("snapshot-mismatch");
  });

  it("rejects (snapshot-mismatch) when the composite was deleted elsewhere (no longer resolvable at all)", () => {
    const originalText = ["- one", "> [!note]", "> body", "trailing"].join("\n");
    const snapshot = snapshotOf(originalText);
    const currentText = ["plain paragraph", "another line", "third line", "trailing"].join("\n");
    const doc = parseDocument(currentText);
    const outcome = extractCompositeBlockText(doc, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("snapshot-mismatch");
  });

  it("rejects (snapshot-mismatch) when the composite's rule was disabled (settings change) while the pane was open", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const doc = parseDocument(text);
    const snapshot = snapshotOf(text);
    // Simulates the "image-ocr" rule being disabled in settings after the
    // pane loaded: matchCompositeBlocks is re-run with a narrower rule
    // set, so the previously-matched composite no longer exists at all.
    const onlyQuoteRule = DEFAULT_COMPOSITE_BLOCK_RULES.filter((r) => r.id === "image-quote");
    const outcome = extractCompositeBlockText(doc, snapshot, onlyQuoteRule);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("snapshot-mismatch");
  });
});
describe("applyCompositeBlockEdit: single-splice write-back, both rule kinds", () => {
  it("commits a SIMULTANEOUS edit of both the list item AND the callout body in one Apply (List + Callout)", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc = parseDocument(text);
    const newText = ["- ONE edited", "> [!note]", "> body edited"].join("\n");
    const outcome = applyCompositeBlockEdit(doc, snapshot, extracted.text, newText, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(newText);
    expect(outcome.ruleStillMatches).toBe(true);
    expect(outcome.resolvedSnapshot?.ruleId).toBe("image-ocr");
  });

  it("commits a SIMULTANEOUS edit of both the list item AND the blockquote body in one Apply (List + Quote)", () => {
    const text = ["- source", "> plain quote"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc = parseDocument(text);
    const newText = ["- SOURCE edited", "> plain quote edited"].join("\n");
    const outcome = applyCompositeBlockEdit(doc, snapshot, extracted.text, newText, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(newText);
    expect(outcome.ruleStillMatches).toBe(true);
    expect(outcome.resolvedSnapshot?.ruleId).toBe("image-quote");
  });

  it("leaves preceding/following blocks and the enclosing section completely untouched", () => {
    const text = [
      "# H",
      "before paragraph",
      "",
      "- one",
      "> [!note]",
      "> body",
      "",
      "after paragraph",
    ].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc = parseDocument(text);
    const newText = ["- one edited", "> [!note]", "> body edited"].join("\n");
    const outcome = applyCompositeBlockEdit(doc, snapshot, extracted.text, newText, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "before paragraph",
      "",
      "- one edited",
      "> [!note]",
      "> body edited",
      "",
      "after paragraph",
    ]);
  });

  it("re-anchors via resolvedSnapshot so a SECOND Apply in the same pane session succeeds against the just-written content", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc1 = parseDocument(text);
    const firstNewText = ["- one edited once", "> [!note]", "> body"].join("\n");
    const first = applyCompositeBlockEdit(doc1, snapshot, extracted.text, firstNewText, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(first.changed).toBe(true);
    expect(first.resolvedSnapshot).toBeDefined();

    const doc2 = parseDocument(first.lines.join("\n"));
    const secondNewText = ["- one edited twice", "> [!note]", "> body"].join("\n");
    const second = applyCompositeBlockEdit(
      doc2,
      first.resolvedSnapshot!,
      firstNewText,
      secondNewText,
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(second.changed).toBe(true);
    expect(second.lines.join("\n")).toBe(secondNewText);
  });
});

describe("applyCompositeBlockEdit: 方針A — structural edits are PERMITTED, never rejected for breaking the rule", () => {
  it("blank-line insertion between the list item and the callout: Apply succeeds, Markdown written verbatim, re-parse shows two INDIVIDUAL nodes (no longer a composite)", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc = parseDocument(text);
    const newText = ["- one", "", "> [!note]", "> body"].join("\n");
    const outcome = applyCompositeBlockEdit(doc, snapshot, extracted.text, newText, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(newText);
    expect(outcome.ruleStillMatches).toBe(false);
    expect(outcome.resolvedSnapshot).toBeUndefined();

    const reparsed = parseDocument(outcome.lines.join("\n"));
    const reparsedComplex = scanComplexBlocks(reparsed);
    const reparsedComposites = matchCompositeBlocks(reparsed, reparsedComplex, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(reparsedComposites).toEqual([]);
  });

  it("deleting the callout member entirely: Apply succeeds, the list item remains, no longer recognized as a composite", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc = parseDocument(text);
    const newText = "- one";
    const outcome = applyCompositeBlockEdit(doc, snapshot, extracted.text, newText, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(newText);
    expect(outcome.ruleStillMatches).toBe(false);

    const reparsed = parseDocument(outcome.lines.join("\n"));
    expect(reparsed.topLevelIds.length).toBe(1);
    const reparsedComplex = scanComplexBlocks(reparsed);
    const reparsedComposites = matchCompositeBlocks(reparsed, reparsedComplex, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(reparsedComposites).toEqual([]);
  });

  it("deleting the blockquote member entirely: Apply succeeds, the list item remains, no longer recognized as a composite", () => {
    const text = ["- source", "> plain quote"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc = parseDocument(text);
    const newText = "- source";
    const outcome = applyCompositeBlockEdit(doc, snapshot, extracted.text, newText, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(newText);
    expect(outcome.ruleStillMatches).toBe(false);
  });

  it("deleting the list item entirely: Apply succeeds, the callout remains (now unanchored), no longer recognized as a composite", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc = parseDocument(text);
    const newText = ["> [!note]", "> body"].join("\n");
    const outcome = applyCompositeBlockEdit(doc, snapshot, extracted.text, newText, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines.join("\n")).toBe(newText);
    expect(outcome.ruleStillMatches).toBe(false);

    const reparsed = parseDocument(outcome.lines.join("\n"));
    const reparsedComplex = scanComplexBlocks(reparsed);
    const reparsedComposites = matchCompositeBlocks(reparsed, reparsedComplex, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(reparsedComposites).toEqual([]);
  });

  it("an edit that keeps the rule matching reports ruleStillMatches: true (contrast case)", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc = parseDocument(text);
    const newText = ["- one still anchored", "> [!note]", "> body still here"].join("\n");
    const outcome = applyCompositeBlockEdit(doc, snapshot, extracted.text, newText, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.ruleStillMatches).toBe(true);
  });
});

describe("applyCompositeBlockEdit: rejections leave the note COMPLETELY unchanged (zero bytes touched)", () => {
  it("rejects (conflict) when the current text differs from the pane's original load-time snapshot — direct body-editor edit while the pane is open", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    // The document changed underneath the pane (e.g. the user typed
    // directly in the body editor) — `doc` here reflects that change, but
    // `extracted.text` (the pane's stale "before editing" snapshot) does
    // not, so applyCompositeBlockEdit's own re-extract-and-compare must
    // reject before ever touching the splice.
    const editedElsewhere = ["- one", "> [!note]", "> body changed elsewhere"].join("\n");
    const doc = parseDocument(editedElsewhere);
    const outcome = applyCompositeBlockEdit(
      doc,
      snapshot,
      extracted.text,
      "- one\n> [!note]\n> body from pane",
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
    expect(outcome.lines.join("\n")).toBe(editedElsewhere);
  });

  it("rejects (conflict) when a member-unit Partial Edit Applied FIRST already changed this exact content — the composite-wide pane's later Apply must lose", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    // Simulates the member-unit pane's own Apply having already landed
    // (e.g. the callout body alone was edited and written back) before the
    // composite-wide pane's Apply runs.
    const afterMemberUnitApply = ["- one", "> [!note]", "> body edited by member pane"].join("\n");
    const doc = parseDocument(afterMemberUnitApply);
    const outcome = applyCompositeBlockEdit(
      doc,
      snapshot,
      extracted.text,
      "- one edited\n> [!note]\n> body",
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
    expect(outcome.lines.join("\n")).toBe(afterMemberUnitApply);
  });

  it("rejects (snapshot-mismatch) when the composite was moved or deleted elsewhere while the pane was open", () => {
    const text = ["- one", "> [!note]", "> body", "trailer"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const movedElsewhere = ["unrelated inserted line", "- one", "> [!note]", "> body", "trailer"].join("\n");
    const doc = parseDocument(movedElsewhere);
    const outcome = applyCompositeBlockEdit(
      doc,
      snapshot,
      extracted.text,
      "- one edited\n> [!note]\n> body",
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("snapshot-mismatch");
    expect(outcome.lines.join("\n")).toBe(movedElsewhere);
  });

  it("rejects (snapshot-mismatch) when the composite disappeared via a settings change (rule disabled) while the pane was open", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc = parseDocument(text);
    const onlyQuoteRule = DEFAULT_COMPOSITE_BLOCK_RULES.filter((r) => r.id === "image-quote");
    const outcome = applyCompositeBlockEdit(doc, snapshot, extracted.text, "- one edited\n> [!note]\n> body", onlyQuoteRule);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("snapshot-mismatch");
    expect(outcome.lines.join("\n")).toBe(text);
  });

  it("rejects (range-invalid) a structurally broken snapshot before ever attempting a match", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc = parseDocument(text);
    const tampered: CompositeBlockSnapshot = { ...snapshot, range: { startLine: 2, endLine: 0 } };
    const outcome = applyCompositeBlockEdit(doc, tampered, extracted.text, "whatever", DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines.join("\n")).toBe(text);
  });
});

describe("applyCompositeBlockEdit / extractCompositeBlockText: purity", () => {
  it("does not mutate the snapshot object passed in", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const snapshotCopy = JSON.parse(JSON.stringify(snapshot));
    const doc = parseDocument(text);
    applyCompositeBlockEdit(doc, snapshot, extracted.text, "- one edited\n> [!note]\n> body", DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(snapshot).toEqual(snapshotCopy);
  });

  it("does not mutate the rules array passed in", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { snapshot, extracted } = loadOwn(text);
    const doc = parseDocument(text);
    const rules = [...DEFAULT_COMPOSITE_BLOCK_RULES];
    const rulesCopy = JSON.parse(JSON.stringify(rules));
    applyCompositeBlockEdit(doc, snapshot, extracted.text, "- one edited\n> [!note]\n> body", rules);
    expect(rules).toEqual(rulesCopy);
  });
});

describe("compositePartialEditReasonText: reason -> dedicated i18n key mapping", () => {
  it("maps range-invalid/snapshot-mismatch/conflict to their own dedicated compositePartialEdit* keys, not any shared delete/move-worded key", () => {
    const en = createTranslator("en");
    expect(compositePartialEditReasonText(en, "range-invalid")).toBe(
      en("reason.compositePartialEditRangeInvalid")
    );
    expect(compositePartialEditReasonText(en, "snapshot-mismatch")).toBe(
      en("reason.compositePartialEditSnapshotMismatch")
    );
    expect(compositePartialEditReasonText(en, "conflict")).toBe(en("reason.compositePartialEditConflict"));
  });

  it("maps resolve-failed, and the undefined fallback, to the generic reason.resolve-failed key", () => {
    const en = createTranslator("en");
    expect(compositePartialEditReasonText(en, "resolve-failed")).toBe(en("reason.resolve-failed"));
    expect(compositePartialEditReasonText(en, undefined)).toBe(en("reason.resolve-failed"));
  });

  it("the dedicated compositePartialEdit* keys are distinct from delete's/move's own reason.* wording", () => {
    const en = createTranslator("en");
    expect(compositePartialEditReasonText(en, "range-invalid")).not.toBe(en("reason.range-invalid"));
    expect(compositePartialEditReasonText(en, "snapshot-mismatch")).not.toBe(
      en("reason.composite-boundary-changed")
    );
    expect(compositePartialEditReasonText(en, "range-invalid")).not.toBe(
      en("reason.compositeMoveRangeInvalid")
    );
  });

  it("every NoCompositePartialEditReason resolves to a non-empty, distinct-per-locale string in both en and ja", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    const allReasons: NoCompositePartialEditReason[] = [
      "resolve-failed",
      "range-invalid",
      "snapshot-mismatch",
      "conflict",
    ];
    for (const reason of allReasons) {
      const enText = compositePartialEditReasonText(en, reason);
      const jaText = compositePartialEditReasonText(ja, reason);
      expect(enText.length).toBeGreaterThan(0);
      expect(jaText.length).toBeGreaterThan(0);
      expect(enText).not.toBe(jaText);
    }
  });
});
