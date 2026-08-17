import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5P-3 ("本文 paragraph の任意 Outline Tree 表示"): static-source-text
 * checks for view/OutlineTreeView.ts's paragraph wiring — same constraint
 * as tests/listPrefixUiWiring.test.ts / tests/commandTable.test.ts (an
 * Obsidian ItemView subclass cannot be constructed in vitest, since
 * "obsidian" is a types-only package here), so this file inspects the raw
 * source text of OutlineTreeView.ts rather than calling into it.
 *
 * The label/identity/projection VALUE logic (paragraphTreeLabel,
 * groupParagraphBlocks, OutlineTreeParagraphNode shape,
 * collectReadOnlyOutlineNodeIds) is unit-tested with real assertions in
 * tests/buildOutlineTree.test.ts and tests/foldIdentity.test.ts — this file
 * only confirms the view layer wires that projection in at the right place
 * (refresh()) and — the operation-permission guarantees §6 requires — does
 * NOT introduce any rename/delete/insert/drag/context-menu/Partial-Edit
 * affordance for a paragraph row.
 */
describe("OutlineTreeView.ts paragraph wiring (static source check, Phase 5P-3)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

  function getRenderNodeBody(): string {
    const start = viewTs.indexOf(
      "private renderNode(node: OutlineTreeNode, parentEl: HTMLElement): void {"
    );
    const end = viewTs.indexOf("private toggleCollapse(id: string): void {", start);
    if (start === -1) {
      throw new Error(
        "renderNode() not found in src/view/OutlineTreeView.ts — has it been renamed or removed?"
      );
    }
    if (end === -1 || end <= start) {
      throw new Error(
        "Could not find the method following renderNode() (toggleCollapse) — has the class's method order changed? Update this test's bounding logic."
      );
    }
    return viewTs.slice(start, end);
  }

  function getRefreshBody(): string {
    const start = viewTs.indexOf("this.currentTree = buildOutlineTree(doc, {");
    const end = viewTs.indexOf("this.nodeById = buildNodeByIdMap(this.currentTree);", start);
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(
        "Could not find refresh()'s buildOutlineTree(...) call site — has it been restructured? Update this test's bounding logic."
      );
    }
    return viewTs.slice(start, end);
  }

  it("imports isOutlineParagraphNode from tree/buildOutlineTree", () => {
    expect(viewTs).toContain("isOutlineParagraphNode");
  });

  it("refresh() passes `paragraphs` gated by settings.showParagraphsInOutline, reusing the same complexScan.blocks standaloneComplexBlocks already reads", () => {
    const body = getRefreshBody();
    expect(body).toContain("paragraphs: this.plugin.settings.showParagraphsInOutline");
    expect(body).toContain("? { blocks: complexScan.blocks }");
    expect(body).toContain(": undefined");
  });

  it("renderNode() has a dedicated isOutlineParagraphNode branch that renders a fixed '¶ ' prefix and node.label", () => {
    const body = getRenderNodeBody();
    expect(body).toContain("isOutlineParagraphNode(node)");
    expect(body).toContain('text: "¶ "');
    expect(body).toContain("unified-outliner-paragraph-label");
  });

  it("the paragraph branch never reuses the complex-member label/prefix classes (must not accidentally match the complex-member styling/behavioral assumptions)", () => {
    const body = getRenderNodeBody();
    const paraBranchStart = body.indexOf("isOutlineParagraphNode(node)) {");
    expect(paraBranchStart).toBeGreaterThan(-1);
    const paraBranchEnd = body.indexOf("selfEl.addEventListener(\"click\"", paraBranchStart);
    expect(paraBranchEnd).toBeGreaterThan(paraBranchStart);
    const paraBranch = body.slice(paraBranchStart, paraBranchEnd);
    expect(paraBranch).not.toContain("unified-outliner-complex-member-label");
    expect(paraBranch).not.toContain("unified-outliner-complex-member-prefix");
  });

  it("beginRenameForNode's kind allowlist rejects \"paragraph\" (only \"section\"/\"list\" are accepted)", () => {
    const start = viewTs.indexOf("private beginRenameForNode(nodeId: string): void {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain('node.kind !== "section" && node.kind !== "list"');
    // Defense-in-depth readOnlyNodeIds re-check (2026-08-12 amendment §E) —
    // still present and still runs for every kind, paragraph included.
    expect(body).toContain("this.readOnlyNodeIds.has(nodeId)) return;");
  });

  it("the desktop contextmenu branch chain has no paragraph-specific case — a paragraph row falls through to no context menu at all", () => {
    const body = getRenderNodeBody();
    const contextMenuChainStart = body.indexOf('selfEl.addEventListener("contextmenu"');
    const mobileGestureStart = body.indexOf("Mobile gesture layer (tier 2 of 3", contextMenuChainStart);
    expect(contextMenuChainStart).toBeGreaterThan(-1);
    expect(mobileGestureStart).toBeGreaterThan(contextMenuChainStart);
    const chain = body.slice(contextMenuChainStart, mobileGestureStart);
    expect(chain).not.toContain("isOutlineParagraphNode");
    expect(chain).not.toContain("showParagraphCommandMenu");
  });

  it("mobile long-press menu attachment is gated by !readOnly (paragraph rows, always in readOnlyNodeIds, never get the listener attached)", () => {
    const body = getRenderNodeBody();
    expect(body).toContain("if (!readOnly && Platform.isMobile) {");
  });

  it("drag & drop attachment is gated by !readOnly (paragraph rows, always in readOnlyNodeIds, are neither a drag source nor a drop target)", () => {
    const body = getRenderNodeBody();
    const dragBlockStart = body.indexOf("if (!readOnly) {", body.indexOf("Phase 3A (section) / Phase 4A (list): drag"));
    expect(dragBlockStart).toBeGreaterThan(-1);
    const dragBlock = body.slice(dragBlockStart, dragBlockStart + 600);
    expect(dragBlock).toContain("handleDragStart");
    expect(dragBlock).toContain("handleDrop");
  });

  it("does not introduce any Tree-triggered paragraph Partial Edit entry point (no resolveParagraphAtCursor / paragraphAnchor / activatePartialEditViewForParagraph reference anywhere in this file)", () => {
    expect(viewTs).not.toContain("resolveParagraphAtCursor");
    expect(viewTs).not.toContain("paragraphAnchor");
    expect(viewTs).not.toContain("activatePartialEditViewForParagraph");
    expect(viewTs).not.toContain("openParagraphPartialEditForCursor");
  });

  it("does not introduce a Move-block / indent-outdent / delete affordance keyed on paragraph (general Move support stays deferred to 5P-4)", () => {
    expect(viewTs).not.toContain("moveParagraph");
    expect(viewTs).not.toContain("indentParagraph");
    expect(viewTs).not.toContain("deleteParagraph");
  });
});
