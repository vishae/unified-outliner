/**
 * Phase 5C-1 ticket 4-4 (2026-08-14): tests for the OutlineTreeView.ts UI
 * wiring introduced in this ticket — showCompositeCommandMenu's move-up/
 * move-down menu show/hide decisions, dispatchAndApplyCompositeMove's
 * snapshot-based dispatch, compositeMoveReasonText's reason -> i18n key
 * mapping, and the reason.* / tree.menu.* i18n keys this ticket added.
 *
 * ---- Scope / what this file deliberately does NOT test -----------------
 *
 * Same testing-boundary rationale as tests/compositeBlockDeleteUiWiring
 * .test.ts (see that file's own top doc comment): "obsidian" is a
 * types-only package in this project, so no ItemView/Menu/Modal is ever
 * instantiated here. This file instead tests the exact PURE decision
 * points showCompositeCommandMenu / dispatchAndApplyCompositeMove /
 * compositeMoveReasonText are built from, reproducing their call sequence
 * verbatim:
 *
 *   showCompositeCommandMenu (move items only):
 *     resolve composite by id -> evaluateCompositeBlockMovability("up") /
 *     ("down") -> (iff eligible) buildCompositeBlockSnapshot
 *
 *   dispatchAndApplyCompositeMove:
 *     moveCompositeBlock(currentText, { snapshot, direction }, rules)
 *
 *   compositeMoveReasonText:
 *     "nested-in-list"/"composite-boundary-changed"/"range-invalid" ->
 *     the move-specific reason.compositeMove* key; every other reason ->
 *     "reason." + reason
 *
 * Real menu-item appearance/absence, Notice() calls, exact
 * applyLineEditOutcome/refresh() call counts, and Obsidian's own Undo
 * granularity are NOT exercised here and require manual desktop/iPad
 * verification instead — same as ticket 3b's own delete UI wiring tests.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { evaluateCompositeBlockMovability, matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { buildCompositeBlockSnapshot } from "../src/edit/deleteCompositeBlock";
import { compositeMoveReasonText, moveCompositeBlock, NoCompositeMoveReason } from "../src/edit/moveCompositeBlock";
import { CompositeMoveDirection } from "../src/move/findCompositeMoveTarget";
import { createTranslator } from "../src/i18n";

function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

/** Reproduces showCompositeCommandMenu's exact decision: does the move-up/move-down item appear for this composite id? */
function wouldShowMoveMenuItem(
  text: string,
  compositeId: string,
  direction: CompositeMoveDirection,
  rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES
): boolean {
  const { doc, complexScan, composites } = pipeline(text, rules);
  const composite = composites.find((c) => c.id === compositeId);
  if (!composite) return false;
  return evaluateCompositeBlockMovability(doc, complexScan, composite, direction, composites).eligible;
}

/**
 * ticket 4-5 (2026-08-14): compositeMoveReasonText moved out of
 * OutlineTreeView.ts into an exported, Obsidian-independent pure function
 * (src/edit/moveCompositeBlock.ts) once main.ts needed the exact same
 * mapping for its own new cursor/selection-driven move commands. The tests
 * below now call that real function directly (via a locale's own
 * translator, e.g. `en`/`ja` from createTranslator) instead of reproducing
 * its switch statement as a local copy — removing the last place this
 * mapping's logic could drift from what OutlineTreeView.ts and main.ts
 * actually call.
 */

describe("showCompositeCommandMenu's move-item gate: eligible composites", () => {
  it("two composites directly adjacent: move-down (first) and move-up (second) both gate true", () => {
    const text = ["- one", "> [!note]", "> body a", "- two", "> [!tip]", "> body b"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(2);
    expect(wouldShowMoveMenuItem(text, composites[0].id, "down")).toBe(true);
    expect(wouldShowMoveMenuItem(text, composites[1].id, "up")).toBe(true);
  });

  it("a composite adjacent to a plain list item gates true in that direction", () => {
    const text = ["- one", "> [!note]", "> body a", "- two"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(wouldShowMoveMenuItem(text, composites[0].id, "down")).toBe(true);
  });
});

describe("showCompositeCommandMenu's move-item gate: absent when ineligible", () => {
  it("nested-in-list: both directions gate false", () => {
    const text = ["- outer", "  - inner", "> [!note]", "> body"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(wouldShowMoveMenuItem(text, composites[0].id, "up")).toBe(false);
    expect(wouldShowMoveMenuItem(text, composites[0].id, "down")).toBe(false);
  });

  it("unsafe-indent: both directions gate false", () => {
    const text = [" \t- flagged", "> [!note]", "> body"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(wouldShowMoveMenuItem(text, composites[0].id, "up")).toBe(false);
    expect(wouldShowMoveMenuItem(text, composites[0].id, "down")).toBe(false);
  });

  it("no-adjacent-compatible-unit at the document's start/end: only the blocked direction gates false", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(wouldShowMoveMenuItem(text, composites[0].id, "up")).toBe(false);
    expect(wouldShowMoveMenuItem(text, composites[0].id, "down")).toBe(false);
  });

  it("different-parent-or-depth: gates false in the affected direction only", () => {
    const text = ["- one", "> [!note]", "> body a", "  - two"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(wouldShowMoveMenuItem(text, composites[0].id, "down")).toBe(false);
  });

  it("unresolvable composite id (note changed since the Tree last rendered): gate is false, not a throw", () => {
    const text = ["- source", "> plain quote"].join("\n");
    expect(wouldShowMoveMenuItem(text, "composite-does-not-exist", "up")).toBe(false);
    expect(wouldShowMoveMenuItem(text, "composite-does-not-exist", "down")).toBe(false);
  });
});

describe("dispatchAndApplyCompositeMove's dispatch: snapshot flows through unchanged text to a real move", () => {
  it("passes the snapshot straight through to moveCompositeBlock and it swaps the composite down", () => {
    const text = ["# Section", "", "- one", "> [!note]", "> body a", "- two", "", "trailing"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const snapshot = buildCompositeBlockSnapshot(composites[0]);

    const outcome = moveCompositeBlock(text, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# Section", "", "- two", "- one", "> [!note]", "> body a", "", "trailing"]);
  });
});

describe("dispatchAndApplyCompositeMove's dispatch: mid-flow text change is safely rejected", () => {
  it("note edited between menu-build and click yields composite-boundary-changed and untouched lines", () => {
    const originalText = ["- caption", "> [!note]", "> body", "- two"].join("\n");
    const { composites } = pipeline(originalText);
    const snapshot = buildCompositeBlockSnapshot(composites[0]);

    const changedText = ["caption (no longer a list item)", "> [!note]", "> body", "- two"].join("\n");
    const outcome = moveCompositeBlock(changedText, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    expect(outcome.lines).toEqual(changedText.split("\n"));
  });

  it("note edited so the snapshot's line range is now out of bounds yields range-invalid, not a throw or a wrong move", () => {
    const originalText = ["- caption", "> [!note]", "> body", "trailing", "- two"].join("\n");
    const { composites } = pipeline(originalText);
    const snapshot = buildCompositeBlockSnapshot(composites[0]);

    const shrunkText = "- caption";
    const outcome = moveCompositeBlock(shrunkText, { snapshot, direction: "down" }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines).toEqual(shrunkText.split("\n"));
  });
});

describe("compositeMoveReasonText: avoids delete-worded reason.* keys for the three colliding reasons", () => {
  it("nested-in-list, composite-boundary-changed, and range-invalid map to distinct compositeMove* keys, not the shared delete-worded ones", () => {
    const en = createTranslator("en");
    expect(compositeMoveReasonText(en, "nested-in-list")).toBe(en("reason.compositeMoveNestedInList"));
    expect(compositeMoveReasonText(en, "composite-boundary-changed")).toBe(
      en("reason.compositeMoveBoundaryChanged")
    );
    expect(compositeMoveReasonText(en, "range-invalid")).toBe(en("reason.compositeMoveRangeInvalid"));
  });

  it("every other NoCompositeMoveReason value falls through to the ordinary reason.<value> pattern", () => {
    const en = createTranslator("en");
    expect(compositeMoveReasonText(en, "unsafe-indent")).toBe(en("reason.unsafe-indent"));
    expect(compositeMoveReasonText(en, "no-adjacent-compatible-unit")).toBe(
      en("reason.no-adjacent-compatible-unit")
    );
    expect(compositeMoveReasonText(en, "different-parent-or-depth")).toBe(
      en("reason.different-parent-or-depth")
    );
    expect(compositeMoveReasonText(en, "no-target")).toBe(en("reason.no-target"));
  });

  it("the delete-worded reason.nested-in-list / reason.composite-boundary-changed / reason.range-invalid keys are untouched (still say 'deleted'/'deletion')", () => {
    // Confirms this ticket did NOT edit delete's existing i18n text (an
    // explicit constraint) — the collision is avoided by NOT reusing these
    // keys for move, not by neutralizing their wording.
    const en = createTranslator("en");
    expect(en("reason.nested-in-list")).toContain("deleted");
    expect(en("reason.composite-boundary-changed")).toContain("deletion");
    expect(en("reason.range-invalid")).toContain("deletion");
  });
});

describe("i18n: reason.<key> mapping for every NoCompositeMoveReason, en + ja", () => {
  const allReasons: NoCompositeMoveReason[] = [
    "nested-in-list",
    "unsafe-indent",
    "no-adjacent-compatible-unit",
    "different-parent-or-depth",
    "composite-boundary-changed",
    "range-invalid",
    "no-target",
  ];

  it("every reason, via compositeMoveReasonText's own mapping, resolves to a non-empty, distinct-per-locale string in both en and ja", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    for (const reason of allReasons) {
      const enText = compositeMoveReasonText(en, reason);
      const jaText = compositeMoveReasonText(ja, reason);
      expect(enText?.length ?? 0).toBeGreaterThan(0);
      expect(jaText?.length ?? 0).toBeGreaterThan(0);
      expect(enText).not.toBe(jaText);
    }
  });

  it("the three move-specific reason.compositeMove* keys never mention 'delete'/'deletion' in English", () => {
    const en = createTranslator("en");
    expect(en("reason.compositeMoveNestedInList").toLowerCase()).not.toContain("delet");
    expect(en("reason.compositeMoveBoundaryChanged").toLowerCase()).not.toContain("delet");
    expect(en("reason.compositeMoveRangeInvalid").toLowerCase()).not.toContain("delet");
  });
});

describe("i18n: move menu item keys, en + ja", () => {
  it("tree.menu.compositeMoveUp / compositeMoveDown exist and differ per locale", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("tree.menu.compositeMoveUp").length).toBeGreaterThan(0);
    expect(en("tree.menu.compositeMoveDown").length).toBeGreaterThan(0);
    expect(ja("tree.menu.compositeMoveUp")).not.toBe(en("tree.menu.compositeMoveUp"));
    expect(ja("tree.menu.compositeMoveDown")).not.toBe(en("tree.menu.compositeMoveDown"));
    expect(en("tree.menu.compositeMoveUp")).not.toBe(en("tree.menu.compositeMoveDown"));
  });
});
