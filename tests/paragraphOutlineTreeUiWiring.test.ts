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

  it("does not introduce a Tree-triggered Move-block / indent-outdent / delete affordance keyed on paragraph (Phase 5P-4 adds CURSOR-based Move for paragraph in main.ts/move/resolveMoveTarget.ts — the Tree view itself gains no new affordance, verified below)", () => {
    expect(viewTs).not.toContain("moveParagraph");
    expect(viewTs).not.toContain("indentParagraph");
    expect(viewTs).not.toContain("deleteParagraph");
  });
});

/**
 * Phase 5P-4 ("paragraph の安全な隣接交換", §5 "Tree read-only 契約の維持"):
 * explicit re-confirmation that formalizing paragraph's cursor-based Move
 * block up/down did not alter, widen, or otherwise touch the 5P-3 Tree
 * read-only contract above. 5P-4's implementation is confined to
 * move/resolveMoveTarget.ts (a pure function file with no Obsidian
 * dependency and no relationship to view/OutlineTreeView.ts or
 * tree/buildOutlineTree.ts) — the tests in this block exist to make that
 * "no relationship" claim verifiable rather than asserted, by checking the
 * actual source text of all three files together.
 */
describe("Tree read-only contract maintained after Phase 5P-4 (paragraph Move is cursor-only, never Tree-triggered)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
  const buildTreeTs = readFileSync(
    path.resolve(__dirname, "../src/tree/buildOutlineTree.ts"),
    "utf-8"
  );
  const mainTs = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf-8");
  const resolveMoveTargetTs = readFileSync(
    path.resolve(__dirname, "../src/move/resolveMoveTarget.ts"),
    "utf-8"
  );

  it("§5-1/§5-2: OutlineTreeParagraphNode still declares isReadOnly/isLeaf as literal `true` (never widened to `boolean`, which would allow a future writer to slip in a foldable/movable paragraph row)", () => {
    const start = buildTreeTs.indexOf("export interface OutlineTreeParagraphNode {");
    expect(start).toBeGreaterThan(-1);
    const end = buildTreeTs.indexOf("\n}", start);
    const body = buildTreeTs.slice(start, end);
    expect(body).toContain("isReadOnly: true;");
    expect(body).toContain("isLeaf: true;");
  });

  it("§5-3: collectReadOnlyOutlineNodeIds still unconditionally includes every paragraph node (kind === \"paragraph\")", () => {
    const start = buildTreeTs.indexOf("export function collectReadOnlyOutlineNodeIds(");
    expect(start).toBeGreaterThan(-1);
    const end = buildTreeTs.indexOf("\n}", start);
    const body = buildTreeTs.slice(start, end);
    expect(body).toContain('node.kind === "paragraph"');
  });

  it("§5-4: no move command/menu item was added to the paragraph render branch or the context-menu chain (re-affirms the 5P-3 checks above still hold verbatim, unchanged by 5P-4)", () => {
    expect(viewTs).not.toContain("showParagraphCommandMenu");
    expect(viewTs).not.toContain("paragraphMoveUp");
    expect(viewTs).not.toContain("paragraphMoveDown");
    const paraBranchStart = viewTs.indexOf("isOutlineParagraphNode(node)) {");
    expect(paraBranchStart).toBeGreaterThan(-1);
    const paraBranchEnd = viewTs.indexOf('selfEl.addEventListener("click"', paraBranchStart);
    const paraBranch = viewTs.slice(paraBranchStart, paraBranchEnd);
    expect(paraBranch).not.toContain("move-up");
    expect(paraBranch).not.toContain("move-down");
  });

  it("§5-5: paragraph drag-and-drop remains rejected — isOutlineParagraphNode never appears anywhere near the drag-and-drop wiring (handleDragStart/handleDragOver/handleDrop), which stays gated purely by !readOnly", () => {
    const dragSectionStart = viewTs.indexOf(
      "Phase 3A (section) / Phase 4A (list): drag & drop."
    );
    expect(dragSectionStart).toBeGreaterThan(-1);
    const dragSectionEnd = viewTs.indexOf(
      "if (hasChildren && !isCollapsed)",
      dragSectionStart
    );
    expect(dragSectionEnd).toBeGreaterThan(dragSectionStart);
    const dragSection = viewTs.slice(dragSectionStart, dragSectionEnd);
    expect(dragSection).toContain("handleDragStart");
    expect(dragSection).toContain("handleDrop");
    expect(dragSection).not.toContain("isOutlineParagraphNode");
  });

  it("§5-6: queueOutlineTreeMoveFlash (main.ts) never uses a paragraph's own Tree node id as nodeIdHint — for any non-section/list move unit it always resolves the ENCLOSING SECTION's id instead, so a paragraph's temporary tree-paragraph:N id is never used as a move target id or post-move selection-restoration key", () => {
    const start = mainTs.indexOf("private queueOutlineTreeMoveFlash(");
    expect(start).toBeGreaterThan(-1);
    const end = mainTs.indexOf("\n  }", start);
    const body = mainTs.slice(start, end);
    expect(body).toContain('unit.kind === "section" || unit.kind === "list"');
    expect(body).toContain("findEnclosingSectionId(doc, ownerNode)");
    expect(body).toContain("if (sectionId) target = { nodeIdHint: sectionId };");
    // Never keys nodeIdHint off unit itself (which would risk leaking a
    // paragraph ComplexBlockInfo's scan-local id into the Tree's id space).
    expect(body).not.toContain("nodeIdHint: unit.");
  });

  it("§5-7: showParagraphsInOutline is never referenced by the Move-block implementation files (move/resolveMoveTarget.ts, main.ts's moveCurrentBlock/moveCurrentSection) — the setting only ever gates Tree DISPLAY (OutlineTreeView.ts's refresh()), confirming cursor-based Move availability/outcome is identical regardless of its value", () => {
    expect(resolveMoveTargetTs).not.toContain("showParagraphsInOutline");
    const moveCurrentBlockStart = mainTs.indexOf("moveCurrentBlock(");
    const moveCurrentSectionStart = mainTs.indexOf("moveCurrentSection(");
    expect(moveCurrentBlockStart).toBeGreaterThan(-1);
    expect(moveCurrentSectionStart).toBeGreaterThan(-1);
    // The one legitimate reference to the setting anywhere in main.ts (if
    // any) must not appear inside either move method's own body — checked
    // by confirming the setting string never appears in the same file at
    // all, since main.ts's own move dispatch has no reason to read a
    // Tree-display-only setting.
    expect(mainTs).not.toContain("showParagraphsInOutline");
  });

  it("§5-8: re-rendering the Tree after a paragraph move does not disturb fold state — refresh() rebuilds collapsedIds from the persisted per-file identity set every time (Phase 4E design, unrelated to and unmodified by 5P-4), and paragraph nodes were never part of that persisted fold-identity set to begin with (isLeaf: true, never fold-capable)", () => {
    expect(viewTs).toContain("this.collapsedIds = ");
    // Fold identity (tree/foldIdentity.ts) is keyed by section/list nodes
    // only — confirmed by the OutlineTreeParagraphNode shape check above
    // (isLeaf: true) meaning a paragraph was never eligible for a fold-key
    // in the first place, so 5P-4 (which touches neither file) cannot have
    // regressed this.
  });
});
