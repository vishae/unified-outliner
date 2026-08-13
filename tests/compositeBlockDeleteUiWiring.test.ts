/**
 * Phase 5C-1 ticket 3b (2026-08-13): tests for the OutlineTreeView.ts UI
 * wiring introduced in this ticket — showCompositeCommandMenu's menu
 * show/hide decision, dispatchAndApplyCompositeDelete's snapshot-based
 * dispatch, and the reason.* / menu / modal i18n keys this ticket added.
 *
 * ---- Scope / what this file deliberately does NOT test -----------------
 *
 * view/OutlineTreeView.ts, view/ConfirmCompositeDeleteModal.ts, and
 * view/HeadingLevelModal.ts all import `Menu`/`Modal`/`Notice`/`Platform`/
 * `App`/`Editor` from "obsidian". In this project "obsidian" is a
 * TYPES-ONLY package (node_modules/obsidian/package.json has `"main": ""`
 * — no runtime module ships at all), and none of this codebase's 42
 * pre-existing test files ever imports or instantiates an ItemView/Modal
 * subclass for exactly that reason: there is no real (or fake) Menu/Modal
 * implementation to run against, and hand-writing one here would test a
 * mock's behavior, not Obsidian's — which would not actually verify menu
 * visibility, Cancel/Delete button wiring, Enter/focus behavior, Notice
 * calls, or applyLineEditOutcome/refresh() call counts against real
 * Obsidian API behavior.
 *
 * So, consistent with this project's existing testing boundary (pure
 * functions only; Obsidian glue is manually verified — see
 * tests/deleteCompositeBlock.test.ts and tests/compositeBlockDeletability
 * .test.ts for the same split on tickets 1/2), this file instead tests the
 * exact PURE decision points showCompositeCommandMenu/
 * dispatchAndApplyCompositeDelete are built from, reproducing their call
 * sequence verbatim:
 *
 *   showCompositeCommandMenu:
 *     resolve composite by id -> evaluateCompositeBlockDeletability ->
 *     (iff deletable) buildCompositeBlockSnapshot
 *
 *   dispatchAndApplyCompositeDelete:
 *     deleteCompositeBlock(currentText, { snapshot }, rules)
 *
 * The following are NOT exercised here and are called out in this
 * ticket's completion report as requiring manual desktop/iPad
 * verification instead: whether the "Delete extended block" menu item
 * actually appears/is absent in a real Obsidian Menu, Cancel vs. Delete
 * button click wiring in ConfirmCompositeDeleteModal, Modal Enter-key/
 * initial-focus behavior, mobile long-press gesture timing on a real
 * touchscreen, Notice() being shown to the user, exact
 * applyLineEditOutcome/refresh() call counts, and Obsidian's own Undo
 * granularity for the resulting editor.replaceRange call.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { evaluateCompositeBlockDeletability, matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import {
  buildCompositeBlockSnapshot,
  deleteCompositeBlock,
  NoCompositeDeleteReason,
} from "../src/edit/deleteCompositeBlock";
import { createTranslator } from "../src/i18n";

function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

/** Reproduces showCompositeCommandMenu's exact decision: does a menu item appear for this composite id? */
function wouldShowDeleteMenuItem(
  text: string,
  compositeId: string,
  rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES
): boolean {
  const { doc, complexScan, composites } = pipeline(text, rules);
  const composite = composites.find((c) => c.id === compositeId);
  if (!composite) return false;
  return evaluateCompositeBlockDeletability(doc, complexScan, composite).deletable;
}

const FENCED_CODE_RULE: CompositeBlockRule[] = [
  { id: "caption-fenced-code", kindSequence: ["single-line-list", "fenced-code"], prefix: "" },
];
const TABLE_RULE: CompositeBlockRule[] = [
  { id: "caption-table", kindSequence: ["single-line-list", "table"], prefix: "" },
];

describe("showCompositeCommandMenu's menu-item gate: deletable composites of each kind", () => {
  it("callout composite: gate is true", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(wouldShowDeleteMenuItem(text, composites[0].id)).toBe(true);
  });

  it("blockquote composite: gate is true", () => {
    const text = ["- source", "> plain quote"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(wouldShowDeleteMenuItem(text, composites[0].id)).toBe(true);
  });

  it("fenced-code composite: gate is true", () => {
    const text = ["- snippet", "```", "console.log(1)", "```"].join("\n");
    const { composites } = pipeline(text, FENCED_CODE_RULE);
    expect(composites).toHaveLength(1);
    expect(wouldShowDeleteMenuItem(text, composites[0].id, FENCED_CODE_RULE)).toBe(true);
  });

  it("Mermaid fenced-code composite: gate is true", () => {
    const text = ["- diagram", "```mermaid", "graph TD; A-->B", "```"].join("\n");
    const { composites } = pipeline(text, FENCED_CODE_RULE);
    expect(composites).toHaveLength(1);
    expect(wouldShowDeleteMenuItem(text, composites[0].id, FENCED_CODE_RULE)).toBe(true);
  });

  it("table composite: gate is true", () => {
    const text = ["- data", "| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");
    const { composites } = pipeline(text, TABLE_RULE);
    expect(composites).toHaveLength(1);
    expect(wouldShowDeleteMenuItem(text, composites[0].id, TABLE_RULE)).toBe(true);
  });
});

describe("showCompositeCommandMenu's menu-item gate: absent for non-deletable composites", () => {
  it("nested-in-list: gate is false", () => {
    const text = ["- outer", "  - inner", "> [!note]", "> body"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(wouldShowDeleteMenuItem(text, composites[0].id)).toBe(false);
  });

  it("unsafe (mixed tab/space) indent on the anchor list item: gate is false", () => {
    const text = [" \t- flagged", "> [!note]", "> body"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    expect(wouldShowDeleteMenuItem(text, composites[0].id)).toBe(false);
  });

  it("unresolvable composite id (note changed since the Tree last rendered): gate is false, not a throw", () => {
    const text = ["- source", "> plain quote"].join("\n");
    expect(wouldShowDeleteMenuItem(text, "composite-does-not-exist")).toBe(false);
  });
});

describe("showCompositeCommandMenu never builds a snapshot when the gate is false", () => {
  it("nested-in-list composite: no snapshot is constructed (mirrors the real method returning early)", () => {
    const text = ["- outer", "  - inner", "> [!note]", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const composite = composites[0];
    const deletability = evaluateCompositeBlockDeletability(doc, complexScan, composite);
    expect(deletability.deletable).toBe(false);
    // showCompositeCommandMenu's real code returns before ever calling
    // buildCompositeBlockSnapshot in this branch — nothing further to
    // assert here beyond the gate itself, captured for documentation.
  });
});

describe("dispatchAndApplyCompositeDelete's dispatch: snapshot flows through unchanged text to a real delete", () => {
  it("passes the snapshot straight through to deleteCompositeBlock and it deletes the composite", () => {
    const text = ["# Section", "", "- caption", "> [!note]", "> body", "", "trailing"].join("\n");
    const { composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const snapshot = buildCompositeBlockSnapshot(composites[0]);

    // Exactly what dispatchAndApplyCompositeDelete does: read the editor's
    // CURRENT text (here, still `text` — nothing changed since the menu
    // was built) and hand the snapshot through.
    const outcome = deleteCompositeBlock(text, { snapshot }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# Section", "", "", "trailing"]);
  });
});

describe("dispatchAndApplyCompositeDelete's dispatch: mid-flow text change is safely rejected", () => {
  it("note edited between menu-build and Delete click yields composite-boundary-changed and untouched lines", () => {
    const originalText = ["- caption", "> [!note]", "> body"].join("\n");
    const { composites } = pipeline(originalText);
    const snapshot = buildCompositeBlockSnapshot(composites[0]);

    // Simulates the confirmation modal's "fetch the LATEST editor content"
    // step finding the note changed since the snapshot was captured — here,
    // the anchor list item's own marker was edited away (same line count,
    // so range-invalid does not fire first) so it no longer recognizes as
    // a single-line-list member at all, and matchCompositeBlocks no longer
    // produces a composite there for snapshotMatches to find.
    const changedText = ["caption (no longer a list item)", "> [!note]", "> body"].join("\n");
    const outcome = deleteCompositeBlock(changedText, { snapshot }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("composite-boundary-changed");
    // Never says "deleted" when nothing was deleted: lines come back
    // byte-identical to the CURRENT (changed) text, never the stale
    // snapshot's text and never partially edited.
    expect(outcome.lines).toEqual(changedText.split("\n"));
  });

  it("note edited so the snapshot's line range is now out of bounds yields range-invalid, not a throw or a wrong deletion", () => {
    const originalText = ["- caption", "> [!note]", "> body", "trailing"].join("\n");
    const { composites } = pipeline(originalText);
    const snapshot = buildCompositeBlockSnapshot(composites[0]);

    // The note shrank (e.g. the user deleted everything after the
    // composite AND some of the composite itself) before Delete was
    // clicked.
    const shrunkText = "- caption";
    const outcome = deleteCompositeBlock(shrunkText, { snapshot }, DEFAULT_COMPOSITE_BLOCK_RULES);

    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("range-invalid");
    expect(outcome.lines).toEqual(shrunkText.split("\n"));
  });
});

describe("i18n: reason.<key> mapping for every NoCompositeDeleteReason, en + ja", () => {
  const allReasons: NoCompositeDeleteReason[] = [
    "nested-in-list",
    "member-unsafe-indent",
    "composite-boundary-changed",
    "range-invalid",
    "member-resolve-failed",
    "member-not-supported",
    "member-has-diagnostic",
    "unsupported-member-kind",
    "ambiguous-section",
  ];

  it("every reason resolves to a non-empty, distinct-per-locale string in both en and ja", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    for (const reason of allReasons) {
      const key = `reason.${reason}` as const;
      const enText = en(key as Parameters<typeof en>[0]);
      const jaText = ja(key as Parameters<typeof ja>[0]);
      expect(enText.length).toBeGreaterThan(0);
      expect(jaText.length).toBeGreaterThan(0);
      expect(enText).not.toBe(jaText);
      // Never a raw, un-translated key falling through (createTranslator
      // returns the key itself, plainly, if the dictionary is missing an
      // entry for it — this catches that silently-broken case).
      expect(enText).not.toBe(key);
      expect(jaText).not.toBe(key);
    }
  });

  it("composite-boundary-changed's Japanese text conveys the required safety framing (note changed -> deletion aborted, not applied to the wrong content)", () => {
    const ja = createTranslator("ja");
    const text = ja("reason.composite-boundary-changed");
    expect(text).toContain("変更");
    expect(text).toContain("削除");
  });
});

describe("i18n: menu item and confirmation modal keys, en + ja", () => {
  it("tree.menu.deleteCompositeBlock exists and differs per locale", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("tree.menu.deleteCompositeBlock")).toBe("Delete extended block");
    expect(ja("tree.menu.deleteCompositeBlock")).not.toBe(en("tree.menu.deleteCompositeBlock"));
  });

  it("modal title/body/undo-note keys exist, interpolate, and differ per locale", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("modal.deleteCompositeBlockTitle").length).toBeGreaterThan(0);
    expect(ja("modal.deleteCompositeBlockTitle")).not.toBe(en("modal.deleteCompositeBlockTitle"));

    const body = en("modal.deleteCompositeBlockBody", {
      label: "Image + OCR",
      memberCount: 2,
      startLine: 3,
      endLine: 5,
    });
    expect(body).toContain("Image + OCR");
    expect(body).toContain("2");
    expect(body).toContain("3");
    expect(body).toContain("5");

    expect(en("modal.deleteCompositeBlockUndoNote").length).toBeGreaterThan(0);
    expect(ja("modal.deleteCompositeBlockUndoNote")).not.toBe(
      en("modal.deleteCompositeBlockUndoNote")
    );
  });

  it("common.delete exists and differs per locale (paired with the pre-existing common.cancel)", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("common.delete")).toBe("Delete");
    expect(ja("common.delete")).not.toBe(en("common.delete"));
    // Sanity: common.cancel already existed before this ticket — confirms
    // the modal's Cancel/Delete button pair both resolve to real strings.
    expect(en("common.cancel").length).toBeGreaterThan(0);
  });
});
