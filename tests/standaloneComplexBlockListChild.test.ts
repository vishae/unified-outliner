/**
 * Phase 5C-5 (2026-08-14, "Standalone Callout / Blockquote の list 子表示"):
 * tests for the DISPLAY-ONLY fix this ticket made to
 * tree/buildOutlineTree.ts — a standalone (non-composite-member) callout/
 * blockquote whose own `parentId` resolves to a list item is now projected
 * as THAT LIST ITEM's own child, instead of being delegated all the way up
 * to its enclosing section (Phase 5C-2's original, now-superseded
 * behavior — see tests/buildOutlineTree.test.ts's own updated test for the
 * direct before/after pin on the simplest fixture).
 *
 * ---- Scope ---------------------------------------------------------------
 *
 * Every function this file exercises (buildOutlineTree,
 * flattenVisibleOutlineTree, collectReadOnlyOutlineNodeIds) is pure and
 * Obsidian-free, so this file — unlike every *UiWiring.test.ts file in this
 * suite — CAN and DOES exercise the real projection/flatten/read-only logic
 * directly, not just a reproduction of it. What it deliberately does NOT
 * cover: actual DOM fold-arrow rendering, actual contextmenu dispatch, and
 * actual Partial Edit / popout / sourcePath behavior for a list-child row —
 * those are unaffected by this ticket (see this ticket's own investigation
 * report: nodeId-based re-resolution is Tree-placement-independent) and are
 * covered by manual real-device verification instead.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockInfo, CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { isListNode } from "../src/model/block";
import {
  buildOutlineTree,
  collectReadOnlyOutlineNodeIds,
  flattenOutlineTree,
  isOutlineComplexMemberNode,
  isOutlineListNode,
  isOutlineSectionNode,
} from "../src/tree/buildOutlineTree";
import { flattenVisibleOutlineTree } from "../src/tree/outlineNavigation";
import { createTranslator } from "../src/i18n";

function treeWithStandalone(text: string, includeLists = true) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const tree = buildOutlineTree(doc, {
    includeLists,
    standaloneComplexBlocks: { blocks: complexScan.blocks },
    t: createTranslator("en"),
  });
  return { doc, complexScan, tree };
}

describe("A. Tree投影: standalone complex blocks nested under their owning list item", () => {
  it("a simple list-child callout is projected as the list item's own child", () => {
    const text = ["# H", "- item", "  > [!note] child callout", "  > body"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children).toHaveLength(1);
    const [listNode] = section.children;
    if (!isOutlineListNode(listNode)) throw new Error("expected list");
    expect(listNode.children).toHaveLength(1);
    const [child] = listNode.children;
    if (!isOutlineComplexMemberNode(child)) throw new Error("expected complex-member");
    expect(child.complexKind).toBe("callout");
    expect(child.isStandalone).toBe(true);
  });

  it("a simple list-child blockquote is projected as the list item's own child", () => {
    const text = ["# H", "- item", "  > quoted continuation"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [listNode] = section.children;
    if (!isOutlineListNode(listNode)) throw new Error("expected list");
    expect(listNode.children).toHaveLength(1);
    const [child] = listNode.children;
    if (!isOutlineComplexMemberNode(child)) throw new Error("expected complex-member");
    expect(child.complexKind).toBe("blockquote");
  });

  it("a standalone callout/blockquote OUTSIDE any list is still a section-level sibling, unchanged", () => {
    const text = ["# H", "> [!note] top-level callout", "> body"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children.map((n) => n.kind)).toEqual(["complex-member"]);
  });

  it("a block whose parentId is a SECTION (not a list item) resolves exactly as before (no behavior change)", () => {
    const text = ["# H", "body paragraph", "", "> [!note] section-owned callout", "> body"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children.map((n) => n.kind)).toEqual(["complex-member"]);
  });

  it("a complex block already consumed by a matched CompositeBlock is never ALSO shown as a list-child standalone row", () => {
    // image-ocr rule: a single-line list item (the image) immediately
    // followed by an "ocr" callout, matched as a 2-member composite — see
    // model/compositeBlock.ts's DEFAULT_COMPOSITE_BLOCK_RULES. Members are
    // section-level siblings (not list-nested — see this ticket's own
    // investigation report: image-ocr's kindSequence requires
    // "single-line-list", which by construction (range.startLine ===
    // range.endLine) can never itself own nested continuation content).
    const text = ["# H", "- ![[scan.png]]", "> [!ocr]", "> extracted text"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const infos = matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(infos).toHaveLength(1);
    const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos, complexBlocksById, rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      standaloneComplexBlocks: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    // Only the composite row itself — the callout is the composite's OWN
    // member (rendered via buildMemberNode), never a second, standalone
    // complex-member row.
    expect(section.children.map((n) => n.kind)).toEqual(["composite"]);
  });

  it("a standalone callout nested under a further-nested list item, inside a HAND-BUILT composite member's own multi-line subtree, still displays correctly under that nested list item (composite plumbing preserves pre-5C-5 visibility)", () => {
    // No built-in rule's first member kind is ever plain "list" (both
    // DEFAULT_COMPOSITE_BLOCK_RULES entries require "single-line-list",
    // which structurally precludes nested content of its own — see this
    // ticket's investigation report). model/compositeBlock.ts's own type
    // (CompositeMemberKind) and buildMemberNode's own code nonetheless
    // treat "list" and "single-line-list" uniformly, so this test hand-
    // builds a CompositeBlockInfo/CompositeBlockRule pair (mirroring the
    // established precedent in tests/standaloneComplexBlockMovability.test.ts
    // for exercising a defensive branch the real matching pipeline cannot
    // reach today) to confirm buildCompositeNode/buildMemberNode's Phase
    // 5C-5 plumbing keeps a standalone block visible even when the
    // composite's own first member is a multi-line list subtree.
    // A blank line before "sibling callout" is required — scanQuoteRuns
    // merges ANY contiguous run of `>`-prefixed lines regardless of their
    // own indentation, so without a gap this would merge into ONE run with
    // two [!type] markers mid-stream and downgrade to "unsupported" (the
    // same parser quirk documented in Phase 5C-3's own test fixtures).
    const text = [
      "# H",
      "- outer item",
      "  - nested item",
      "    > [!note] unrelated nested callout",
      "    > body",
      "",
      "> [!tip] sibling callout",
    ].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const outerItem = [...doc.nodes.values()].find(
      (n) => isListNode(n) && doc.lines[n.range.startLine].includes("outer item")
    )!;
    const siblingCallout = complexScan.blocks.find(
      (b) => b.kind === "callout" && doc.lines[b.range.startLine].includes("sibling callout")
    )!;
    expect(outerItem.range.startLine).not.toBe(outerItem.range.endLine); // genuinely multi-line, not single-line-list

    const rule: CompositeBlockRule = { id: "custom-list-callout", kindSequence: ["list", "callout"], prefix: "•" };
    const composite: CompositeBlockInfo = {
      id: "composite-0",
      ruleId: rule.id,
      range: { startLine: outerItem.range.startLine, endLine: siblingCallout.range.endLine },
      members: [
        { kind: "list", id: outerItem.id, range: outerItem.range },
        { kind: "callout", id: siblingCallout.id, range: siblingCallout.range },
      ],
      sectionId: null,
    };
    const complexBlocksById = new Map(complexScan.blocks.map((b) => [b.id, b]));
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos: [composite], complexBlocksById, rules: [rule] },
      standaloneComplexBlocks: { blocks: complexScan.blocks },
      t: createTranslator("en"),
    });
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [compositeNode] = section.children;
    if (compositeNode.kind !== "composite") throw new Error("expected composite");
    const [memberListNode] = compositeNode.children;
    if (!isOutlineListNode(memberListNode)) throw new Error("expected member list node");
    // The member list item's own nested child is the "nested item" list row,
    // which in turn owns the unrelated callout as ITS OWN child.
    const nestedListChild = memberListNode.children.find(isOutlineListNode);
    expect(nestedListChild).toBeDefined();
    expect(nestedListChild!.children).toHaveLength(1);
    const [unrelatedCallout] = nestedListChild!.children;
    if (!isOutlineComplexMemberNode(unrelatedCallout)) throw new Error("expected complex-member");
    expect(unrelatedCallout.isStandalone).toBe(true);
    expect(unrelatedCallout.label).toBe("unrelated nested callout");
  });
});

describe("B. 境界ケース", () => {
  it("a blank line between the list item's marker line and its callout continuation still resolves as a list-child (blank lines never close a list item)", () => {
    const text = ["# H", "- item", "", "  > [!note] callout after blank", "  > body"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [listNode] = section.children;
    if (!isOutlineListNode(listNode)) throw new Error("expected list");
    expect(listNode.children).toHaveLength(1);
  });

  it("a bare quoted blank line ('>') inside the list-child callout does not split it into two blocks", () => {
    const text = ["# H", "- item", "  > [!note] callout", "  >", "  > second paragraph"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [listNode] = section.children;
    if (!isOutlineListNode(listNode)) throw new Error("expected list");
    expect(listNode.children).toHaveLength(1);
  });

  it("a callout under a 2-level-nested list item attaches to the INNERMOST item, not its grandparent", () => {
    const text = ["# H", "- outer", "  - inner", "    > [!note] deep callout", "    > body"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [outerNode] = section.children;
    if (!isOutlineListNode(outerNode)) throw new Error("expected outer list");
    expect(outerNode.children).toHaveLength(1);
    const [innerNode] = outerNode.children;
    if (!isOutlineListNode(innerNode)) throw new Error("expected inner list");
    expect(innerNode.children).toHaveLength(1);
    const [calloutNode] = innerNode.children;
    if (!isOutlineComplexMemberNode(calloutNode)) throw new Error("expected complex-member");
  });

  it("a callout under a 3-level-nested list item still attaches to the innermost item", () => {
    const text = [
      "# H",
      "- l1",
      "  - l2",
      "    - l3",
      "      > [!note] very deep callout",
      "      > body",
    ].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    let node = section.children[0];
    for (let depth = 0; depth < 2; depth++) {
      if (!isOutlineListNode(node)) throw new Error(`expected list at depth ${depth}`);
      expect(node.children).toHaveLength(1);
      node = node.children[0];
    }
    if (!isOutlineListNode(node)) throw new Error("expected l3 list node");
    expect(node.children).toHaveLength(1);
    expect(isOutlineComplexMemberNode(node.children[0])).toBe(true);
  });

  it("mixed list markers (- then 1.) do not affect list-child attachment", () => {
    const text = ["# H", "1. ordered item", "   > [!note] callout under ordered item", "   > body"].join(
      "\n"
    );
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [listNode] = section.children;
    if (!isOutlineListNode(listNode)) throw new Error("expected list");
    expect(listNode.children).toHaveLength(1);
  });

  it("an unsupported complex block (embedded callout marker) under a list item is never displayed at all, even though its parentId would resolve to that list item", () => {
    const text = [
      "# H",
      "- item",
      "  > [!note] first",
      "  > [!tip] embedded second marker mid-run",
    ].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [listNode] = section.children;
    if (!isOutlineListNode(listNode)) throw new Error("expected list");
    // hasEmbeddedCalloutMarker downgrades this run to "unsupported" —
    // isStandaloneComplexBlockEligible excludes it, so it is not shown
    // anywhere (not under the list item, not delegated to the section).
    expect(listNode.children).toHaveLength(0);
  });
});

describe("C. fold / visible tree", () => {
  it("a list item that previously had no children now has children.length > 0 once it gains a standalone complex-member child", () => {
    const text = ["# H", "- item", "  > [!note] callout", "  > body"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [listNode] = section.children;
    expect(listNode.children.length).toBeGreaterThan(0);
  });

  it("collapsing the list item hides its complex-member child from flattenVisibleOutlineTree", () => {
    const text = ["# H", "- item", "  > [!note] callout", "  > body"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [listNode] = section.children;

    const expanded = flattenVisibleOutlineTree(tree, new Set());
    expect(expanded.map((n) => n.kind)).toEqual(["section", "list", "complex-member"]);

    const collapsed = flattenVisibleOutlineTree(tree, new Set([listNode.id]));
    expect(collapsed.map((n) => n.kind)).toEqual(["section", "list"]);
  });

  it("flattenOutlineTree (fold-independent) always includes the complex-member child in document order", () => {
    const text = ["# H", "- item", "  > [!note] callout", "  > body"].join("\n");
    const { tree } = treeWithStandalone(text);
    const flat = flattenOutlineTree(tree);
    expect(flat.map((n) => n.kind)).toEqual(["section", "list", "complex-member"]);
  });

  it("the list-child complex-member row is still read-only (collectReadOnlyOutlineNodeIds), and its parent list item is NOT made read-only merely by having it as a child", () => {
    const text = ["# H", "- item", "  > [!note] callout", "  > body"].join("\n");
    const { tree } = treeWithStandalone(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [listNode] = section.children;
    const [calloutNode] = listNode.children;

    const readOnlyIds = collectReadOnlyOutlineNodeIds(tree);
    expect(readOnlyIds.has(calloutNode.id)).toBe(true);
    expect(readOnlyIds.has(listNode.id)).toBe(false);
  });
});
