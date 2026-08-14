/**
 * Phase 5C-2 (2026-08-14): tests for the OutlineTreeView.ts UI wiring this
 * ticket added for a STANDALONE (non-composite-member) callout/blockquote
 * row — showStandaloneComplexBlockMenu (a fixed, single-item "Open in
 * Partial Edit" menu) and the isStandalone-gated context-menu attachment
 * in renderNode.
 *
 * ---- Scope / what this file deliberately does NOT test -----------------
 *
 * Same testing-boundary rationale as tests/compositeBlockMoveUiWiring.test.ts
 * (see that file's own top doc comment): "obsidian" is a types-only package
 * in this project, so no ItemView/Menu is ever instantiated here.
 * showStandaloneComplexBlockMenu itself has no conditional logic to
 * reproduce (unlike showCompositeCommandMenu's delete/move-up/move-down
 * gating) — it is unconditionally a fixed one-item menu whenever it is
 * reached at all — so what this file actually verifies is the ONE real
 * decision point upstream of it: renderNode's own
 * `isComplexMember && node.isStandalone` branch condition, reproduced here
 * directly against real OutlineTreeNode values produced by the real
 * buildOutlineTree pipeline (a composite-member row must NEVER satisfy this
 * condition; a standalone row must ALWAYS satisfy it), plus that the i18n
 * key the menu item reuses (tree.menu.openPartialEditPane — no new key was
 * added for this ticket) still resolves to non-empty text in both locales.
 *
 * Real menu-item appearance, DOM contextmenu dispatch, and
 * activatePartialEditView's own downstream Notice/pane behavior are NOT
 * exercised here and require manual desktop/iPad verification instead —
 * same precedent as every other *UiWiring.test.ts file in this suite.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import {
  buildOutlineTree,
  flattenOutlineTree,
  isOutlineComplexMemberNode,
} from "../src/tree/buildOutlineTree";
import { createTranslator } from "../src/i18n";

/**
 * Reproduces renderNode's exact context-menu-attachment condition for a
 * complex-member row: `isComplexMember && node.isStandalone` (only this
 * combination wires up showStandaloneComplexBlockMenu's contextmenu
 * listener; a composite-member row — isStandalone: false — gets none, per
 * this ticket's own approved scope).
 */
function wouldAttachStandaloneMenu(node: ReturnType<typeof flattenOutlineTree>[number]): boolean {
  return isOutlineComplexMemberNode(node) && node.isStandalone;
}

describe("renderNode's standalone-menu attachment condition (isComplexMember && node.isStandalone)", () => {
  it("a standalone callout/blockquote row satisfies the condition", () => {
    const text = ["# H", "> [!note] Title", "> body"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const tree = buildOutlineTree(doc, {
      standaloneComplexBlocks: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const flat = flattenOutlineTree(tree);
    const standaloneRow = flat.find(isOutlineComplexMemberNode);
    expect(standaloneRow).toBeDefined();
    expect(wouldAttachStandaloneMenu(standaloneRow!)).toBe(true);
  });

  it("a composite-member row does NOT satisfy the condition (no menu, unchanged from before this ticket)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      t: createTranslator("en"),
    });
    const flat = flattenOutlineTree(tree);
    const memberRow = flat.find(isOutlineComplexMemberNode);
    expect(memberRow).toBeDefined();
    expect(memberRow!.isStandalone).toBe(false);
    expect(wouldAttachStandaloneMenu(memberRow!)).toBe(false);
  });

  it("no OutlineTreeNode kind other than complex-member ever satisfies the condition (sections/lists/composites are excluded by isOutlineComplexMemberNode's own type guard)", () => {
    const text = ["# H", "- item", "> [!note] standalone"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      standaloneComplexBlocks: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const flat = flattenOutlineTree(tree);
    const nonComplexMemberNodes = flat.filter((n) => !isOutlineComplexMemberNode(n));
    expect(nonComplexMemberNodes.length).toBeGreaterThan(0);
    for (const n of nonComplexMemberNodes) {
      expect(wouldAttachStandaloneMenu(n)).toBe(false);
    }
  });
});

describe("i18n: the standalone menu's reused key (no new key was added for this ticket)", () => {
  it("tree.menu.openPartialEditPane resolves to non-empty text in both en and ja", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("tree.menu.openPartialEditPane").length).toBeGreaterThan(0);
    expect(ja("tree.menu.openPartialEditPane").length).toBeGreaterThan(0);
  });
});

describe("i18n: partialEdit.kindCallout / kindBlockquote (this ticket's own new keys)", () => {
  it("resolve to non-empty, per-locale-distinct text in both en and ja", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("partialEdit.kindCallout")).toBe("Callout");
    expect(en("partialEdit.kindBlockquote")).toBe("Quote");
    expect(ja("partialEdit.kindCallout")).toBe("コールアウト");
    expect(ja("partialEdit.kindBlockquote")).toBe("引用");
    expect(en("partialEdit.kindCallout")).not.toBe(ja("partialEdit.kindCallout"));
    expect(en("partialEdit.kindBlockquote")).not.toBe(ja("partialEdit.kindBlockquote"));
  });
});
