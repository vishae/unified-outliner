/**
 * Phase 5T-9A: tests for the OutlineTreeView.ts UI wiring introduced in
 * this ticket — showParagraphMoveMenu's delete-item show/hide decision
 * (edit/deleteParagraph.ts#isInScopeParagraphParent), and the
 * tree.menu.deleteParagraph / modal.deleteParagraph* / reason.paragraphDelete*
 * i18n keys this ticket added. Modeled directly on
 * tests/compositeBlockDeleteUiWiring.test.ts's own split — see that file's
 * top doc comment for the full rationale on why view/OutlineTreeView.ts and
 * view/ConfirmParagraphDeleteModal.ts themselves are NOT imported or
 * instantiated here (this project's "obsidian" package is types-only; no
 * runtime Menu/Modal implementation exists to test against). This file
 * instead tests the exact PURE decision point
 * showParagraphMoveMenu's own delete-item gate is built from.
 *
 * NOT exercised here, and called out in this ticket's completion report as
 * requiring manual desktop/iPad verification instead: whether "Delete
 * paragraph" actually appears/is absent in a real Obsidian Menu, Cancel vs.
 * Delete button click wiring in ConfirmParagraphDeleteModal, Modal
 * Enter-key/initial-focus behavior, mobile long-press gesture timing,
 * Notice() being shown to the user, exact applyLineEditOutcome/refresh()
 * call counts, post-delete Tree selection/highlight visually landing on
 * the expected row, and Obsidian's own Undo/Redo granularity for the
 * resulting editor.replaceRange call.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { isInScopeParagraphParent, NoParagraphDeleteReason } from "../src/edit/deleteParagraph";
import { createTranslator } from "../src/i18n";

describe("showParagraphMoveMenu's delete-item gate (isInScopeParagraphParent)", () => {
  it("top-level paragraph (no enclosing section): in scope", () => {
    const text = "A";
    const doc = parseDocument(text);
    expect(isInScopeParagraphParent(doc, null)).toBe(true);
  });

  it("section-direct paragraph: in scope", () => {
    const text = ["# H", "A"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const info = scan.blocks.find((b) => b.kind === "paragraph")!;
    expect(isInScopeParagraphParent(doc, info.parentId)).toBe(true);
  });

  it("list-item-child paragraph: in scope (Phase 5P-5, 'list item 子 paragraph の Tree insert/delete 解禁' — widened from this phase's original exclusion)", () => {
    const text = ["- item", "  continuation paragraph"].join("\n");
    const doc = parseDocument(text);
    const scan = scanComplexBlocks(doc);
    const info = scan.blocks.find((b) => b.kind === "paragraph")!;
    expect(info).toBeDefined();
    expect(isInScopeParagraphParent(doc, info.parentId)).toBe(true);
  });

  it("unresolvable parentId (note changed since the Tree last rendered): gate is false, not a throw", () => {
    const doc = parseDocument("A");
    expect(isInScopeParagraphParent(doc, "section-does-not-exist")).toBe(false);
  });
});

describe("i18n: reason.paragraphDelete* mapping, en + ja", () => {
  const allReasons: NoParagraphDeleteReason[] = [
    "resolve-failed",
    "identity-changed",
    "content-changed",
    "ambiguous-match",
    "list-item-parent",
    "composite-member",
  ];

  it("every dedicated key resolves to a non-empty, distinct-per-locale string in both en and ja", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    const dedicatedKeys = [
      "reason.paragraphDeleteResolveFailed",
      "reason.paragraphDeleteIdentityChanged",
      "reason.paragraphDeleteContentChanged",
      "reason.paragraphDeleteAmbiguous",
      "reason.paragraphDeleteListItemParent",
      "reason.paragraphDeleteCompositeMember",
    ] as const;
    for (const key of dedicatedKeys) {
      const enText = en(key);
      const jaText = ja(key);
      expect(enText.length).toBeGreaterThan(0);
      expect(jaText.length).toBeGreaterThan(0);
      expect(enText).not.toBe(jaText);
      expect(enText).not.toBe(key);
      expect(jaText).not.toBe(key);
    }
    // Sanity: the reason union this test's own dedicatedKeys list must stay
    // in sync with — a change to one without the other should be caught by
    // this length check.
    expect(dedicatedKeys).toHaveLength(allReasons.length);
  });
});

describe("i18n: menu item and confirmation modal keys, en + ja", () => {
  it("tree.menu.deleteParagraph exists and differs per locale", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("tree.menu.deleteParagraph")).toBe("Delete paragraph");
    expect(ja("tree.menu.deleteParagraph")).not.toBe(en("tree.menu.deleteParagraph"));
  });

  it("modal title/body/undo-note keys exist, interpolate, and differ per locale", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("modal.deleteParagraphTitle").length).toBeGreaterThan(0);
    expect(ja("modal.deleteParagraphTitle")).not.toBe(en("modal.deleteParagraphTitle"));

    const body = en("modal.deleteParagraphBody", {
      label: "Some paragraph text",
      startLine: 3,
      endLine: 3,
    });
    expect(body).toContain("Some paragraph text");
    expect(body).toContain("3");

    expect(en("modal.deleteParagraphUndoNote").length).toBeGreaterThan(0);
    expect(ja("modal.deleteParagraphUndoNote")).not.toBe(en("modal.deleteParagraphUndoNote"));
  });

  it("common.delete/common.cancel (pre-existing, reused verbatim) still resolve — the paragraph delete modal depends on them", () => {
    const en = createTranslator("en");
    expect(en("common.delete")).toBe("Delete");
    expect(en("common.cancel")).toBe("Cancel");
  });
});
