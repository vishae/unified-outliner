/**
 * Phase 5D-0.4 ("Enable Partial Edit for supported composite-member
 * callouts and blockquotes"): tests for the OutlineTreeView.ts UI wiring
 * this ticket added — showComplexMemberPartialEditMenu and the new
 * renderNode context-menu branch condition that attaches it:
 *   isComplexMember && !node.isStandalone &&
 *   (node.complexKind === "callout" || node.complexKind === "blockquote")
 *
 * Same testing-boundary rationale as
 * tests/standaloneComplexBlockUiWiring.test.ts (see that file's own top doc
 * comment): "obsidian" is a types-only package here, so no ItemView/Menu is
 * ever instantiated. showComplexMemberPartialEditMenu itself has no
 * conditional logic (always exactly two items whenever reached at all), so
 * what matters is the ONE real decision point upstream of it: the branch
 * condition reproduced here directly against real OutlineTreeNode values
 * from the real buildOutlineTree pipeline.
 *
 * Real menu-item appearance and DOM contextmenu dispatch are NOT exercised
 * here and require manual desktop verification instead (see this ticket's
 * own report for the real-device pass on iPad).
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
  isOutlineCompositeNode,
  isOutlineListNode,
  isOutlineParagraphNode,
  OutlineTreeComplexMemberNode,
  OutlineTreeNode,
} from "../src/tree/buildOutlineTree";
import { createTranslator } from "../src/i18n";

/**
 * Reproduces renderNode's exact context-menu-attachment condition for the
 * new composite-member Partial Edit menu.
 */
function wouldAttachComplexMemberMenu(node: OutlineTreeNode): boolean {
  return (
    isOutlineComplexMemberNode(node) &&
    !node.isStandalone &&
    (node.complexKind === "callout" || node.complexKind === "blockquote")
  );
}

function buildCompositeTree(text: string, includeLists = true) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
  const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
  const tree = buildOutlineTree(doc, {
    includeLists,
    composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
    t: createTranslator("en"),
  });
  return { doc, complexScan, infos, tree };
}

describe("renderNode's composite-member menu attachment condition", () => {
  it("a supported composite-member callout satisfies the condition", () => {
    const text = ["- ![[scan-001.png]]", "> [!ocr]", "> body text"].join("\n");
    const { tree } = buildCompositeTree(text);
    const flat = flattenOutlineTree(tree);
    const memberRow = flat.find(
      (n) => isOutlineComplexMemberNode(n) && n.complexKind === "callout"
    );
    expect(memberRow).toBeDefined();
    expect((memberRow as OutlineTreeComplexMemberNode).isStandalone).toBe(false);
    expect(wouldAttachComplexMemberMenu(memberRow!)).toBe(true);
  });

  it("a supported composite-member blockquote satisfies the condition", () => {
    const text = ["- ![[scan-002.png]]", "> quoted transcription"].join("\n");
    const { tree } = buildCompositeTree(text);
    const flat = flattenOutlineTree(tree);
    const memberRow = flat.find(
      (n) => isOutlineComplexMemberNode(n) && n.complexKind === "blockquote"
    );
    expect(memberRow).toBeDefined();
    expect((memberRow as OutlineTreeComplexMemberNode).isStandalone).toBe(false);
    expect(wouldAttachComplexMemberMenu(memberRow!)).toBe(true);
  });

  it("a STANDALONE callout/blockquote does not satisfy this (new) condition — it keeps using showStandaloneComplexBlockMenu instead, unchanged, no double-menu regression", () => {
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
    expect(standaloneRow!.isStandalone).toBe(true);
    expect(wouldAttachComplexMemberMenu(standaloneRow!)).toBe(false);
  });

  it("the CompositeBlock parent node itself never satisfies the condition (not a complex-member node at all)", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
    const { tree } = buildCompositeTree(text);
    const flat = flattenOutlineTree(tree);
    const compositeParent = flat.find(isOutlineCompositeNode);
    expect(compositeParent).toBeDefined();
    expect(wouldAttachComplexMemberMenu(compositeParent!)).toBe(false);
  });

  it("the member list item row never satisfies the condition (it is a normal 'list' node, not 'complex-member')", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body"].join("\n");
    const { tree } = buildCompositeTree(text);
    const flat = flattenOutlineTree(tree);
    const listMember = flat.find(isOutlineListNode);
    expect(listMember).toBeDefined();
    expect(wouldAttachComplexMemberMenu(listMember!)).toBe(false);
  });

  it("a paragraph inside the note is never projected as a complex-member row and never satisfies the condition, even when paragraph display is enabled", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "a trailing paragraph"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      paragraphs: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const flat = flattenOutlineTree(tree);
    const paragraphRow = flat.find(isOutlineParagraphNode);
    expect(paragraphRow).toBeDefined();
    expect(wouldAttachComplexMemberMenu(paragraphRow!)).toBe(false);
  });

  it("a fenced-code or table complexKind never satisfies the condition, even hypothetically (defensive — no shipped rule currently produces one as a second member)", () => {
    const fakeFencedMember: OutlineTreeComplexMemberNode = {
      kind: "complex-member",
      id: "fenced-0",
      complexKind: "fenced-code",
      label: "code",
      isStandalone: false,
      line: 0,
      children: [],
    };
    const fakeTableMember: OutlineTreeComplexMemberNode = {
      kind: "complex-member",
      id: "table-0",
      complexKind: "table",
      label: "table",
      isStandalone: false,
      line: 0,
      children: [],
    };
    expect(wouldAttachComplexMemberMenu(fakeFencedMember)).toBe(false);
    expect(wouldAttachComplexMemberMenu(fakeTableMember)).toBe(false);
  });

  it("no OutlineTreeNode kind other than a non-standalone callout/blockquote complex-member ever satisfies the condition", () => {
    const text = ["# H", "- ![[scan.png]]", "> [!ocr]", "> body", "> [!note] standalone"].join(
      "\n"
    );
    const { tree } = buildCompositeTree(text);
    const flat = flattenOutlineTree(tree);
    const nonTargetNodes = flat.filter(
      (n) => !(isOutlineComplexMemberNode(n) && !n.isStandalone)
    );
    expect(nonTargetNodes.length).toBeGreaterThan(0);
    for (const n of nonTargetNodes) {
      expect(wouldAttachComplexMemberMenu(n)).toBe(false);
    }
  });
});

describe("i18n: the composite-member menu reuses the existing keys (no new i18n key was added for this ticket)", () => {
  it("tree.menu.openPartialEditPane / openPartialEditPaneNewWindow resolve to non-empty text in both en and ja", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("tree.menu.openPartialEditPane").length).toBeGreaterThan(0);
    expect(ja("tree.menu.openPartialEditPane").length).toBeGreaterThan(0);
    expect(en("tree.menu.openPartialEditPaneNewWindow").length).toBeGreaterThan(0);
    expect(ja("tree.menu.openPartialEditPaneNewWindow").length).toBeGreaterThan(0);
  });
});
