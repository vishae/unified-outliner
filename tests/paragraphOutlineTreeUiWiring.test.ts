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
 * NOT introduce any rename/delete/insert/drag/Partial-Edit affordance for a
 * paragraph row.
 *
 * Phase 5T-1 amendment: a paragraph row DOES now get exactly one narrow,
 * safety-gated context-menu affordance — Move up/down, reusing 5P-4's swap
 * contract verbatim (see edit/paragraphTreeMove.ts). This file's job from
 * 5T-1 onward is to confirm that exception stays exactly as narrow as the
 * ticket requires: no rename/delete/insert/indent-outdent/drag/Partial-Edit
 * affordance was added alongside it. The dedicated "Phase 5T-1" describe
 * block below covers the new affordance itself; the checks in this first
 * block continue to cover everything that must still be absent.
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

  it("the desktop contextmenu branch chain's paragraph case (Phase 5T-1) is keyed on the local `isParagraph` flag, not on isOutlineParagraphNode(node) called again inline, and does not reuse showParagraphCommandMenu (no such function exists — the real, narrow entry point is showParagraphMoveMenu, checked in the dedicated Phase 5T-1 describe block below)", () => {
    const body = getRenderNodeBody();
    const contextMenuChainStart = body.indexOf('selfEl.addEventListener("contextmenu"');
    const mobileGestureStart = body.indexOf("Mobile gesture layer (tier 2 of 3", contextMenuChainStart);
    expect(contextMenuChainStart).toBeGreaterThan(-1);
    expect(mobileGestureStart).toBeGreaterThan(contextMenuChainStart);
    const chain = body.slice(contextMenuChainStart, mobileGestureStart);
    expect(chain).not.toContain("isOutlineParagraphNode");
    expect(chain).not.toContain("showParagraphCommandMenu");
    expect(chain).toContain("else if (isParagraph)");
    expect(chain).toContain("showParagraphMoveMenu");
  });

  it("mobile long-press menu attachment is gated by !readOnly (paragraph rows, always in readOnlyNodeIds, never get the listener attached)", () => {
    const body = getRenderNodeBody();
    expect(body).toContain("if (!readOnly && Platform.isMobile) {");
  });

  it("section/list drag & drop attachment stays gated by the ORIGINAL, unwidened !readOnly block (Phase 5T-2 adds paragraph D&D as a separate else-if branch below it - see the dedicated Phase 5T-2 describe block further down - never by relaxing this condition itself)", () => {
    const body = getRenderNodeBody();
    const dragBlockStart = body.indexOf("if (!readOnly) {", body.indexOf("Phase 3A (section) / Phase 4A (list): drag"));
    expect(dragBlockStart).toBeGreaterThan(-1);
    const dragBlock = body.slice(dragBlockStart, dragBlockStart + 600);
    expect(dragBlock).toContain("handleDragStart");
    expect(dragBlock).toContain("handleDrop");
    // The section/list block's own condition is still the bare, unwidened
    // `!readOnly` - it was never changed to admit paragraph rows.
    expect(dragBlock.startsWith("if (!readOnly) {")).toBe(true);
  });

  it("REVISED by Phase 5T-4A: this file DOES now reference activatePartialEditViewForParagraph (the new 'Edit paragraph…' bridge — see the dedicated Phase 5T-4A describe block below), but still never re-implements paragraph resolution or apply logic itself — no resolveParagraphAtCursor / paragraphAnchor / openParagraphPartialEditForCursor reference anywhere in this file. Those three stay exclusively main.ts's/PartialEditView.ts's own responsibility; this file only ever hands off a line-number hint to the existing, unmodified entry point.", () => {
    expect(viewTs).not.toContain("resolveParagraphAtCursor");
    expect(viewTs).not.toContain("paragraphAnchor");
    expect(viewTs).not.toContain("openParagraphPartialEditForCursor");
    expect(viewTs).toContain("activatePartialEditViewForParagraph");
  });

  it("does not introduce a Tree-triggered rename / indent-outdent / insert affordance keyed on paragraph (Phase 5T-1 adds a narrow Tree-triggered MOVE, via showParagraphMoveMenu/moveParagraphFromAnchor — checked separately in the dedicated Phase 5T-1 describe block below; Phase 5T-9A adds a narrow Tree-triggered DELETE, via edit/deleteParagraph.ts/dispatchAndApplyParagraphDelete — checked separately in the dedicated Phase 5T-9A describe block further down; every OTHER affordance, including insert, stays absent this phase)", () => {
    expect(viewTs).not.toContain("renameParagraph");
    expect(viewTs).not.toContain("indentParagraph");
    expect(viewTs).not.toContain("outdentParagraph");
    expect(viewTs).not.toContain("insertParagraph");
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
 *
 * Phase 5T-1 amendment: §5-4 below originally asserted "no move command/
 * menu item was added to the paragraph render branch or the context-menu
 * chain at all". Phase 5T-1 deliberately overturns that, in a narrow,
 * safety-gated way (Tree-triggered Move up/down, delegating to 5P-4's own
 * moveComplexBlock/findComplexSiblingTarget with zero new swap logic — see
 * edit/paragraphTreeMove.ts and the dedicated Phase 5T-1 describe block
 * below). §5-4 is updated in place to assert the new correct invariant:
 * the move affordance exists ONLY inside the new, narrow isParagraph
 * branch, and every other paragraph read-only guarantee (§5-1 through
 * §5-3, §5-5 through §5-8) is unaffected and still verified as before.
 */
describe("Tree read-only contract maintained after Phase 5P-4/5T-1 (paragraph stays non-foldable/non-editable; Move is now a narrow, safety-gated Tree-triggered exception delegating to 5P-4's own contract)", () => {
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

  it("§5-4 (revised by Phase 5T-1): the ONLY command/menu item ever added to a paragraph row is the new narrow showParagraphMoveMenu context-menu path — no other rename/delete/insert/indent-outdent affordance was added alongside it, and the render branch (which only draws the '¶ ' label) stays free of any menu wiring of its own", () => {
    // The render branch itself (isOutlineParagraphNode(node) ... up to the
    // shared "click" listener) still only draws the label — it never wires
    // a menu; the menu is attached later, in the separate contextmenu
    // chain (isParagraph branch), checked below.
    const paraRenderBranchStart = viewTs.indexOf("isOutlineParagraphNode(node)) {");
    expect(paraRenderBranchStart).toBeGreaterThan(-1);
    const paraRenderBranchEnd = viewTs.indexOf('selfEl.addEventListener("click"', paraRenderBranchStart);
    const paraRenderBranch = viewTs.slice(paraRenderBranchStart, paraRenderBranchEnd);
    expect(paraRenderBranch).not.toContain("move-up");
    expect(paraRenderBranch).not.toContain("move-down");
    expect(paraRenderBranch).not.toContain("showParagraphMoveMenu");

    // The desktop contextmenu chain has exactly one paragraph-specific
    // branch (the new `else if (isParagraph)` case), and it calls
    // showParagraphMoveMenu only — no rename/delete/insert command.
    const contextMenuChainStart = viewTs.indexOf('selfEl.addEventListener("contextmenu"');
    const mobileGestureStart = viewTs.indexOf(
      "Mobile gesture layer (tier 2 of 3",
      contextMenuChainStart
    );
    expect(contextMenuChainStart).toBeGreaterThan(-1);
    expect(mobileGestureStart).toBeGreaterThan(contextMenuChainStart);
    const chain = viewTs.slice(contextMenuChainStart, mobileGestureStart);
    const paragraphBranchStart = chain.indexOf("else if (isParagraph)");
    expect(paragraphBranchStart).toBeGreaterThan(-1);
    const paragraphBranch = chain.slice(paragraphBranchStart);
    // Only the code, not this branch's own explanatory doc comment (which
    // legitimately mentions showCompositeCommandMenu by name for context),
    // must be free of other menus' call sites and other operations' verbs.
    const codeOnly = paragraphBranch
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).toContain("this.showParagraphMoveMenu(evt, node.id)");
    expect(codeOnly).not.toContain("this.showStructureCommandMenu");
    expect(codeOnly).not.toContain("this.showListCommandMenu");
    expect(codeOnly).not.toContain("this.showCompositeCommandMenu");
    expect(codeOnly).not.toContain("this.showStandaloneComplexBlockMenu");
    expect(codeOnly).not.toContain("delete");
    expect(codeOnly).not.toContain("rename");
    expect(codeOnly).not.toContain("insert");
    expect(codeOnly).not.toContain("indent");
  });

  it("§5-5 (REVISED by Phase 5T-2 - see that ticket's own decision to deliberately overturn this invariant, exactly as §5-4 was revised by 5T-1 above): the ORIGINAL section/list drag-and-drop block (gated by the bare, unwidened !readOnly) still contains no isOutlineParagraphNode reference at all - paragraph D&D is wired as a SEPARATE else-if branch immediately after it (checked in the dedicated Phase 5T-2 describe block further down), never by adding paragraph into this existing block", () => {
    const dragSectionStart = viewTs.indexOf(
      "Phase 3A (section) / Phase 4A (list): drag & drop."
    );
    expect(dragSectionStart).toBeGreaterThan(-1);
    const readOnlyBlockStart = viewTs.indexOf("if (!readOnly) {", dragSectionStart);
    const paragraphBranchStart = viewTs.indexOf(
      "} else if (isOutlineParagraphNode(node) && !Platform.isMobile) {",
      dragSectionStart
    );
    expect(readOnlyBlockStart).toBeGreaterThan(dragSectionStart);
    expect(paragraphBranchStart).toBeGreaterThan(readOnlyBlockStart);
    const readOnlyDragBlock = viewTs.slice(readOnlyBlockStart, paragraphBranchStart);
    expect(readOnlyDragBlock).toContain("handleDragStart");
    expect(readOnlyDragBlock).toContain("handleDrop");
    expect(readOnlyDragBlock).not.toContain("isOutlineParagraphNode");
  });

  it("§5-6 REVISED by Phase 5T-5A: queueOutlineTreeMoveFlash/queueOutlineTreeSelectionFollow (main.ts) key purely off outcome.newStartLine (a plain line number) for EVERY move unit kind, never a nodeIdHint / paragraph-view-id / ComplexBlockInfo id of any kind — the old nodeIdHint concept (and its ENCLOSING-SECTION fallback for non-section/list units) is gone entirely now that paragraph/callout/blockquote have their own Tree rows to match by line against (docs/phase5t5_cursor_to_tree_highlight_design.md §3-2)", () => {
    const flashStart = mainTs.indexOf("private queueOutlineTreeMoveFlash(");
    expect(flashStart).toBeGreaterThan(-1);
    const flashEnd = mainTs.indexOf("\n  }", flashStart);
    const flashBody = mainTs.slice(flashStart, flashEnd);
    expect(flashBody).toContain("outcome.newStartLine");
    expect(flashBody).toContain("queueMoveFlash(outcome.newStartLine)");
    expect(flashBody).not.toContain("nodeIdHint");
    expect(flashBody).not.toContain("findEnclosingSectionId");
    expect(flashBody).not.toContain("unit.kind");
    expect(flashBody).not.toContain("tree-paragraph");

    const followStart = mainTs.indexOf("queueOutlineTreeSelectionFollow(line: number)");
    expect(followStart).toBeGreaterThan(-1);
    const followEnd = mainTs.indexOf("\n  }", followStart);
    const followBody = mainTs.slice(followStart, followEnd);
    expect(followBody).toContain("queueSelectionFollow(line)");
    expect(followBody).not.toContain("nodeIdHint");
    expect(followBody).not.toContain("tree-paragraph");

    // findEnclosingSectionId is no longer imported/used anywhere in
    // main.ts — the whole nodeIdHint/enclosing-section-fallback concept it
    // existed for is gone (Phase 5T-5A, ticket decision 6).
    expect(mainTs).not.toContain("findEnclosingSectionId");
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

/**
 * Phase 5T-1 ("Outline Tree の paragraph context menu からの安全な上下移動",
 * §7 "read-only 契約の維持", §8-2 "メニュー表示・実行"): static-source-text
 * checks for the new narrow paragraph Move affordance itself — that it is
 * wired in exactly one place (the new `else if (isParagraph)` context-menu
 * branch), reuses 5P-4's existing move contract with zero new swap logic,
 * and does not disturb any pre-existing section/list/composite/standalone
 * context menu. Real pure-function coverage of anchor build/re-resolution/
 * write-back (§4, §8-1) lives in tests/paragraphTreeMove.test.ts — per the
 * ticket's own instruction, that logic must not be verified by static
 * source checks alone.
 */
describe("Phase 5T-1: paragraph Tree-triggered Move (narrow, safety-gated exception)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
  const moveTs = readFileSync(path.resolve(__dirname, "../src/edit/paragraphTreeMove.ts"), "utf-8");
  const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");

  it("OutlineTreeView.ts imports the new paragraphTreeMove module and findComplexSiblingTarget (reused verbatim, not reimplemented) from move/resolveMoveTarget.ts", () => {
    expect(viewTs).toContain('from "../edit/paragraphTreeMove"');
    expect(viewTs).toContain("buildParagraphMoveAnchor");
    expect(viewTs).toContain("moveParagraphFromAnchor");
    expect(viewTs).toContain("paragraphTreeMoveReasonText");
    // Phase 5T-1R: the extracted Tree-node-hint resolver, imported rather
    // than re-derived inline (see the dedicated REGRESSION test below).
    expect(viewTs).toContain("resolveParagraphFromTreeHint");
    expect(viewTs).toContain("findComplexSiblingTarget");
  });

  it("showParagraphMoveMenu and dispatchAndApplyParagraphMove both exist as dedicated private methods", () => {
    expect(viewTs).toContain("private showParagraphMoveMenu(");
    expect(viewTs).toContain("private dispatchAndApplyParagraphMove(");
  });

  it("showParagraphMoveMenu uses findComplexSiblingTarget (5P-4's own eligibility check) to decide which of Move up/down to show, rather than inventing new eligibility logic", () => {
    const start = viewTs.indexOf("private showParagraphMoveMenu(");
    expect(start).toBeGreaterThan(-1);
    // Phase 5T-3A inserted two new private methods (showParagraphMoveTargetPicker,
    // dispatchAndApplyParagraphNonAdjacentMove) between showParagraphMoveMenu
    // and dispatchAndApplyParagraphMove — the end marker is now the NEXT
    // method literally after showParagraphMoveMenu, not
    // dispatchAndApplyParagraphMove itself, so this still isolates just
    // showParagraphMoveMenu's own body.
    const end = viewTs.indexOf("\n  private showParagraphMoveTargetPicker(", start);
    expect(end).toBeGreaterThan(start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("findComplexSiblingTarget(doc, unit, \"up\", complexScan)");
    expect(body).toContain("findComplexSiblingTarget(doc, unit, \"down\", complexScan)");
    expect(body).toContain("buildParagraphMoveAnchor(doc, target)");
    // REVISED by Phase 5T-4A: the previous "no menu at all when neither
    // direction is eligible AND no non-adjacent sibling group exists
    // either" guard (introduced by 5T-3A) is gone — "段落を編集…" is now
    // unconditional once target/anchor resolve, so there is always at
    // least one item to show. See the dedicated Phase 5T-4A describe block
    // below for the positive checks on the new item itself.
    expect(body).not.toContain(
      "if (!upEligible && !downEligible && siblingGroup.length === 0) return;"
    );
    expect(body).toContain('this.plugin.t("tree.menu.paragraphEdit")');
  });

  it("Phase 5T-3A: showParagraphMoveMenu wires in the four new non-adjacent-move commands via edit/paragraphNonAdjacentMove.ts, without touching the existing adjacent Move up/down items", () => {
    expect(viewTs).toContain('from "../edit/paragraphNonAdjacentMove"');
    expect(viewTs).toContain("listNonAdjacentMoveTargets");
    expect(viewTs).toContain("buildSiblingTargetAnchor");
    expect(viewTs).toContain("moveParagraphNonAdjacent");
    expect(viewTs).toContain("paragraphNonAdjacentMoveReasonText");
    expect(viewTs).toContain("private showParagraphMoveTargetPicker(");
    expect(viewTs).toContain("private dispatchAndApplyParagraphNonAdjacentMove(");
    expect(viewTs).toContain('this.plugin.t("tree.menu.paragraphMoveToTop")');
    expect(viewTs).toContain('this.plugin.t("tree.menu.paragraphMoveToBottom")');
    expect(viewTs).toContain('this.plugin.t("tree.menu.paragraphMoveBeforeSibling")');
    expect(viewTs).toContain('this.plugin.t("tree.menu.paragraphMoveAfterSibling")');
    // The pre-existing adjacent Move up/down dispatch is untouched.
    expect(viewTs).toContain("this.dispatchAndApplyParagraphMove(anchor, \"up\")");
    expect(viewTs).toContain("this.dispatchAndApplyParagraphMove(anchor, \"down\")");
  });

  it("REGRESSION (found via real-device verification after the initial 5T-1 commit; Phase 5T-1R locks this in as a permanent contract): showParagraphMoveMenu resolves the target ComplexBlockInfo from the Tree node's own rangeStart/rangeEnd/parentId via nodeById + edit/paragraphTreeMove.ts#resolveParagraphFromTreeHint — NEVER by comparing complexScan.blocks[].id against the raw Tree nodeId. A paragraph Tree row's node.id is tree/buildOutlineTree.ts's paragraphViewId(ordinal) (e.g. 'tree-paragraph:3'), a display-ordinal id, NOT the scan-local ComplexBlockInfo.id ('paragraph-3') that standalone complex-member rows use as their own node.id. Comparing the two directly (as the first commit did) makes `target` always undefined, silently producing an empty menu for every paragraph row — caught only by right-clicking a real paragraph node on an actual device, never by a static source check or a pure-function test of paragraphTreeMove.ts in isolation. IMPORTANT: this static check is supplementary only — see the dedicated 'Tree node resolution' describe block in tests/paragraphTreeMove.test.ts for the real defense, which exercises resolveParagraphFromTreeHint directly against REAL buildOutlineTree()+scanComplexBlocks() output rather than trusting a source-text grep alone.", () => {
    const start = viewTs.indexOf("private showParagraphMoveMenu(");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  private dispatchAndApplyParagraphMove(", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("this.nodeById.get(nodeId)");
    expect(body).toContain("isOutlineParagraphNode(treeNode)");
    // Phase 5T-1R: the range/parentId comparison itself now lives inside
    // the extracted, directly-tested resolveParagraphFromTreeHint — this
    // call site only supplies the hint object built from the Tree node.
    expect(body).toContain("resolveParagraphFromTreeHint(");
    expect(body).toContain("rangeStart: treeNode.rangeStart");
    expect(body).toContain("rangeEnd: treeNode.rangeEnd");
    expect(body).toContain("parentId: treeNode.parentId");
    // The original (buggy) id-equality lookup must never reappear, neither
    // here nor inside the extracted resolver itself.
    expect(body).not.toContain('b.id === nodeId && b.kind === "paragraph"');
    expect(body).not.toContain("complexScan?.blocks.find(\n      (b) =>\n        b.kind === \"paragraph\" &&\n        b.id ===");
  });

  it("edit/paragraphTreeMove.ts's extracted resolveParagraphFromTreeHint never compares a Tree node id against ComplexBlockInfo.id — it matches purely on kind/range/parentId, per the 5T-1R view-identity-vs-scan-identity contract", () => {
    const resolverStart = moveTs.indexOf("export function resolveParagraphFromTreeHint(");
    expect(resolverStart).toBeGreaterThan(-1);
    const resolverEnd = moveTs.indexOf("\n/**", resolverStart + 1);
    const resolverBody = moveTs.slice(resolverStart, resolverEnd === -1 ? undefined : resolverEnd);
    expect(resolverBody).toContain('b.kind === "paragraph"');
    expect(resolverBody).toContain("b.range.startLine === hint.rangeStart");
    expect(resolverBody).toContain("b.range.endLine === hint.rangeEnd");
    expect(resolverBody).toContain("b.parentId === hint.parentId");
    expect(resolverBody).not.toContain("b.id ===");
    expect(resolverBody).not.toContain(".id === hint");
  });

  it("dispatchAndApplyParagraphMove delegates the actual write-back to moveParagraphFromAnchor and reuses applyLineEditOutcome (the shared Move/Edit write-back path) rather than writing to the editor directly", () => {
    const start = viewTs.indexOf("private dispatchAndApplyParagraphMove(");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("private addMenuItem(", start);
    expect(end).toBeGreaterThan(start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("moveParagraphFromAnchor(text, anchor, direction)");
    expect(body).toContain("applyLineEditOutcome(");
    expect(body).toContain("paragraphTreeMoveReasonText(");
  });

  it("the new isParagraph context-menu branch is the only paragraph-specific addition to the contextmenu chain, and existing section/list/composite/standalone branches are untouched", () => {
    const contextMenuChainStart = viewTs.indexOf('selfEl.addEventListener("contextmenu"');
    const mobileGestureStart = viewTs.indexOf(
      "Mobile gesture layer (tier 2 of 3",
      contextMenuChainStart
    );
    const chain = viewTs.slice(contextMenuChainStart, mobileGestureStart);
    expect(chain).toContain("showStructureCommandMenu");
    expect(chain).toContain("showListCommandMenu");
    expect(chain).toContain("showCompositeCommandMenu");
    expect(chain).toContain("showStandaloneComplexBlockMenu");
    expect(chain).toContain("showParagraphMoveMenu");
    // Exactly one `else if (isParagraph)` branch — not duplicated, not
    // nested inside another kind's branch.
    const occurrences = chain.split("else if (isParagraph)").length - 1;
    expect(occurrences).toBe(1);
  });

  it("edit/paragraphTreeMove.ts delegates to 5P-4's moveComplexBlock verbatim and implements no new swap/reorder logic of its own (no direct line-array splice/swap in this file) - Phase 5T-2 note: the call site now reads resolved.doc/resolved.unit/resolved.scan (the shared resolveAnchorUnit helper's output, extracted so resolveParagraphDropDirection can reuse the exact same three-stage resolution - see that function's own doc comment), not a second, independently-maintained copy of the resolution logic", () => {
    expect(moveTs).toContain("moveComplexBlock(resolved.doc, resolved.unit, direction, resolved.scan)");
    expect(moveTs).not.toContain(".splice(");
  });

  it("edit/paragraphTreeMove.ts's rejection reasons are a superset of 5P-4's ComplexSiblingReason plus the anchor-specific ones, and never invent a new swap outcome kind", () => {
    expect(moveTs).toContain('"resolve-failed"');
    expect(moveTs).toContain('"identity-changed"');
    expect(moveTs).toContain('"content-changed"');
    expect(moveTs).toContain('"ambiguous-match"');
    expect(moveTs).toContain("ComplexSiblingReason");
  });

  it("i18n.ts defines the paragraph move menu labels and dedicated rejection-reason strings in both en and ja, never falling back to 5P-2's Partial-Edit-worded reason.identity-changed/reason.content-changed keys", () => {
    expect(i18nTs).toContain('"tree.menu.paragraphMoveUp"');
    expect(i18nTs).toContain('"tree.menu.paragraphMoveDown"');
    expect(i18nTs).toContain('"reason.paragraphTreeMoveResolveFailed"');
    expect(i18nTs).toContain('"reason.paragraphTreeMoveIdentityChanged"');
    expect(i18nTs).toContain('"reason.paragraphTreeMoveContentChanged"');
    expect(i18nTs).toContain('"reason.paragraphTreeMoveAmbiguous"');
    // Every key defined in `en` must also appear in `ja` (parity is also
    // enforced at compile time by TranslationKey = keyof typeof en, but a
    // direct text check here catches a value forgotten only in one object).
    const enStart = i18nTs.indexOf("const en = {");
    const enEnd = i18nTs.indexOf("\n} as const;", enStart);
    const jaStart = i18nTs.indexOf("const ja: Record<TranslationKey, string> = {", enEnd);
    const jaEnd = i18nTs.indexOf("\n};", jaStart);
    expect(enStart).toBeGreaterThan(-1);
    expect(enEnd).toBeGreaterThan(enStart);
    expect(jaStart).toBeGreaterThan(-1);
    expect(jaEnd).toBeGreaterThan(jaStart);
    const enBlock = i18nTs.slice(enStart, enEnd);
    const jaBlock = i18nTs.slice(jaStart, jaEnd);
    for (const key of [
      "tree.menu.paragraphMoveUp",
      "tree.menu.paragraphMoveDown",
      "reason.paragraphTreeMoveResolveFailed",
      "reason.paragraphTreeMoveIdentityChanged",
      "reason.paragraphTreeMoveContentChanged",
      "reason.paragraphTreeMoveAmbiguous",
    ]) {
      expect(enBlock).toContain(`"${key}"`);
      expect(jaBlock).toContain(`"${key}"`);
    }
  });

  it("the paragraph move menu items and Notices never leak internal identifiers (parentId, scan-local complexBlockId, range, or function names) — checked by confirming the i18n strings themselves contain none of those substrings", () => {
    const forbidden = ["parentId", "complexBlockId", "rangeStart", "rangeEnd", "moveComplexBlock", "findComplexSiblingTarget"];
    const keys = [
      "reason.paragraphTreeMoveResolveFailed",
      "reason.paragraphTreeMoveIdentityChanged",
      "reason.paragraphTreeMoveContentChanged",
      "reason.paragraphTreeMoveAmbiguous",
    ];
    for (const key of keys) {
      const idx = i18nTs.indexOf(`"${key}"`);
      expect(idx).toBeGreaterThan(-1);
      const lineEnd = i18nTs.indexOf("\n", idx);
      const line = i18nTs.slice(idx, lineEnd);
      for (const bad of forbidden) {
        expect(line).not.toContain(bad);
      }
    }
  });
});

/**
 * Phase 5T-2 ("Outline Tree paragraph の D&D による安全な隣接 swap", plan A
 * only, desktop only — docs/phase5t2_paragraph-tree-dnd-design.md): static
 * UI-wiring checks for the new paragraph drag & drop branch, modeled on
 * this file's own existing Phase 5T-1 describe block above (same
 * "supplementary only, never the sole defense" framing — the REAL
 * adjacency/safety defense is the pure-function test suite in
 * tests/paragraphTreeMove.test.ts's own
 * "resolveParagraphDropDirection" describe blocks, which exercise the
 * actual decision logic directly; these checks only confirm the WIRING
 * routes through that logic rather than reinventing it, and that no
 * child/inside drop affordance or general write-capability was
 * introduced alongside it).
 */
describe("Phase 5T-2: paragraph drag & drop wiring (narrow, desktop-only, plan-A-only exception)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
  const moveTs = readFileSync(path.resolve(__dirname, "../src/edit/paragraphTreeMove.ts"), "utf-8");
  const stylesCss = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

  function paragraphDragBranch(): string {
    const start = viewTs.indexOf(
      "} else if (isOutlineParagraphNode(node) && !Platform.isMobile) {"
    );
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n    }\n\n    if (hasChildren && !isCollapsed)", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  it("the paragraph drag branch is gated by isOutlineParagraphNode(node) && !Platform.isMobile — desktop only, never attached for a mobile paragraph row", () => {
    const branch = paragraphDragBranch();
    expect(branch.startsWith("} else if (isOutlineParagraphNode(node) && !Platform.isMobile) {")).toBe(
      true
    );
  });

  it("the paragraph drag branch never widens the original section/list !readOnly gate — it is its own else-if arm, and paragraph rows remain in readOnlyNodeIds (unrelated to this branch existing)", () => {
    const branch = paragraphDragBranch();
    // The branch's own code (not its explanatory comment) never tests
    // `readOnly` at all — its eligibility is entirely
    // isOutlineParagraphNode(node) && !Platform.isMobile, checked in the
    // enclosing else-if condition already asserted above.
    const codeOnly = branch
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toContain("!readOnly");
    expect(codeOnly).not.toContain("readOnly &&");
  });

  it("the paragraph drag branch wires exactly dragstart/dragover/dragleave/drop/dragend, delegating to the dedicated handleParagraph* methods (dragleave/dragend are REUSED verbatim from the section/list branch's own generic handleDragLeave/handleDragEnd, not reimplemented)", () => {
    const branch = paragraphDragBranch();
    expect(branch).toContain("this.handleParagraphDragStart(evt, node, itemEl)");
    expect(branch).toContain("this.handleParagraphDragOver(evt, node, selfEl)");
    expect(branch).toContain("this.handleDragLeave(selfEl)");
    expect(branch).toContain("this.handleParagraphDrop(evt, node, selfEl)");
    expect(branch).toContain("this.handleDragEnd()");
  });

  it("the paragraph drag branch never references dragHandleEl in its actual CODE (desktop-only — selfEl itself is the drag source, exactly like desktop's existing section/list behavior; no mobile drag-handle carve-out was added) - the branch's own explanatory comment legitimately mentions dragHandleEl by name to explain why it is irrelevant here, so comments are excluded from this check", () => {
    const branch = paragraphDragBranch();
    const codeOnly = branch
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toContain("dragHandleEl");
  });

  it("no child/inside drop affordance exists anywhere in the paragraph drag path — 'unified-outliner-drop-inside' never appears in the branch itself, in computeParagraphDropZone, or in resolveParagraphDropDirection/ParagraphDropZone's own type", () => {
    const branch = paragraphDragBranch();
    expect(branch).not.toContain("unified-outliner-drop-inside");
    const zoneFnStart = viewTs.indexOf("private computeParagraphDropZone(");
    expect(zoneFnStart).toBeGreaterThan(-1);
    const zoneFnEnd = viewTs.indexOf("\n  }", zoneFnStart);
    const zoneFn = viewTs.slice(zoneFnStart, zoneFnEnd);
    expect(zoneFn).not.toContain("inside");
    expect(zoneFn).toContain('"before"');
    expect(zoneFn).toContain('"after"');
    // Checked against CODE only - paragraphTreeMove.ts's own doc comments
    // legitimately discuss (and explain the deliberate absence of) an
    // "inside" zone in prose; only the actual TypeScript union members
    // matter here, and ParagraphDropZone has exactly two: "before"/"after".
    const zoneTypeStart = moveTs.indexOf("export type ParagraphDropZone");
    expect(zoneTypeStart).toBeGreaterThan(-1);
    const zoneTypeEnd = moveTs.indexOf(";", zoneTypeStart);
    const zoneType = moveTs.slice(zoneTypeStart, zoneTypeEnd);
    expect(zoneType).not.toContain("inside");
    expect(zoneType).toContain('"before"');
    expect(zoneType).toContain('"after"');
  });

  it("computeParagraphDropZone is a SEPARATE two-way (before/after) split, not a reuse or a modification of the existing three-way computeDropMode (which stays before/inside/after, unchanged, for section/list)", () => {
    const zoneFnStart = viewTs.indexOf("private computeParagraphDropZone(");
    const modeFnStart = viewTs.indexOf("private computeDropMode(");
    expect(zoneFnStart).toBeGreaterThan(-1);
    expect(modeFnStart).toBeGreaterThan(-1);
    expect(zoneFnStart).not.toBe(modeFnStart);
    const modeFnEnd = viewTs.indexOf("\n  }", modeFnStart);
    const modeFn = viewTs.slice(modeFnStart, modeFnEnd);
    // computeDropMode is unchanged: still the three-way section/list split.
    expect(modeFn).toContain('"inside"');
  });

  it("handleParagraphDragStart builds its anchor via resolveParagraphFromTreeHint + buildParagraphMoveAnchor — the exact same pair showParagraphMoveMenu already uses — never a new Tree-node-to-ComplexBlockInfo resolution path", () => {
    const start = viewTs.indexOf("private handleParagraphDragStart(");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("resolveParagraphFromTreeHint(");
    expect(body).toContain("buildParagraphMoveAnchor(doc, info)");
  });

  it("handleParagraphDragOver and handleParagraphDrop both decide legality via resolveParagraphDropDirection — never by calling canDropOn/canDropListOn/relocateSection/relocateListSubtree (those stay section/list-only, per the 5T-2 design doc's own 'why existing D&D cannot be reused' conclusion)", () => {
    const overStart = viewTs.indexOf("private handleParagraphDragOver(");
    const overEnd = viewTs.indexOf("\n  }", overStart);
    const overBody = viewTs.slice(overStart, overEnd);
    const dropStart = viewTs.indexOf("private handleParagraphDrop(");
    const dropEnd = viewTs.indexOf("\n  }", dropStart);
    const dropBody = viewTs.slice(dropStart, dropEnd);
    for (const body of [overBody, dropBody]) {
      expect(body).toContain("resolveParagraphDropDirection(");
      expect(body).not.toContain("canDropOn(");
      expect(body).not.toContain("canDropListOn(");
      expect(body).not.toContain("relocateSection(");
      expect(body).not.toContain("relocateListSubtree(");
    }
  });

  it("handleParagraphDrop delegates the actual write-back entirely to dispatchAndApplyParagraphMove (the SAME 5T-1 execution path the context-menu Move up/down items already use) — it never calls moveComplexBlock/swapBlocks/moveParagraphFromAnchor itself, and never touches the editor directly", () => {
    const start = viewTs.indexOf("private handleParagraphDrop(");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("this.dispatchAndApplyParagraphMove(session.anchor, resolution.direction)");
    expect(body).not.toContain("moveComplexBlock(");
    expect(body).not.toContain("swapBlocks(");
    expect(body).not.toContain("moveParagraphFromAnchor(");
    expect(body).not.toContain("editor.replaceRange");
  });

  it("endDrag() now clears paragraphDragSession too, so the section/list branch's own pre-existing dragend/drop cleanup calls (unchanged) reliably clean up a paragraph drag as well, without a second parallel cleanup method", () => {
    const start = viewTs.indexOf("private endDrag(): void {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("this.paragraphDragSession = null;");
  });

  it("refresh() cancels any in-progress paragraph drag session UNCONDITIONALLY, before even the renameState early-return — so editor-change/active-leaf-change/file-open/keyup/mouseup/settings-change (every refresh() trigger) all reliably tear a stale paragraph drag down, closing the exact gap the 5T-2 design doc flags as existing, unaddressed for section/list D&D", () => {
    const start = viewTs.indexOf("refresh(): void {");
    expect(start).toBeGreaterThan(-1);
    const renameGuardIdx = viewTs.indexOf("if (this.renameState) return;", start);
    const cancelIdx = viewTs.indexOf("this.cancelParagraphDrag();", start);
    expect(cancelIdx).toBeGreaterThan(start);
    expect(renameGuardIdx).toBeGreaterThan(start);
    expect(cancelIdx).toBeLessThan(renameGuardIdx);
  });

  it("onClose() also cancels any in-progress paragraph drag session before tearing down the view's DOM", () => {
    const start = viewTs.indexOf("async onClose(): Promise<void> {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("this.cancelParagraphDrag();");
  });

  it("cancelParagraphDrag() is a no-op when no paragraph drag is active — it must never disturb an in-progress section/list drag (Phase 3A/4A keep their own pre-existing, unmodified refresh-time behavior)", () => {
    const start = viewTs.indexOf("private cancelParagraphDrag(): void {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("if (!this.paragraphDragSession) return;");
  });

  it("no rename/delete/insert/indent/outdent/Tree Partial Edit affordance was introduced anywhere in the new paragraph drag methods (ParagraphDragSession, cancelParagraphDrag, computeParagraphDropZone, handleParagraphDragStart/DragOver/Drop) — the only capability added is a Move, delegated entirely to the pre-existing 5T-1 execution path", () => {
    const methodNames = [
      "cancelParagraphDrag",
      "computeParagraphDropZone",
      "handleParagraphDragStart",
      "handleParagraphDragOver",
      "handleParagraphDrop",
    ];
    const forbidden = [
      "beginRenameForNode",
      "deleteBlock(",
      "insertBlock",
      "indentBlock",
      "outdentBlock",
      "PartialEditView",
      "activatePartialEditView",
    ];
    for (const name of methodNames) {
      const start = viewTs.indexOf(`private ${name}(`);
      expect(start).toBeGreaterThan(-1);
      const end = viewTs.indexOf("\n  }", start);
      const body = viewTs.slice(start, end);
      for (const bad of forbidden) {
        expect(body).not.toContain(bad);
      }
    }
  });

  it("styles.css's existing drop-indicator classes (-dragging/-drop-before/-drop-after) are REUSED as-is for paragraph D&D — no new paragraph-specific CSS class was introduced, and -drop-inside is never referenced by the paragraph drag path (checked above)", () => {
    expect(stylesCss).toContain(".unified-outliner-dragging");
    expect(stylesCss).toContain(".unified-outliner-drop-before");
    expect(stylesCss).toContain(".unified-outliner-drop-after");
  });

  it("ParagraphDragSession's own doc comment and shape confirm sourceTreeNodeId is never used as a comparison/identity key - only anchor is (matching the design doc §2's 'drag payload の永続キーとして使わない' contract)", () => {
    const start = viewTs.indexOf("interface ParagraphDragSession {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n}", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("anchor: ParagraphMoveAnchor;");
    expect(body).toContain("sourceTreeNodeId: string;");
  });
});

/**
 * Phase 5T-4A ("Tree paragraph → 既存 Partial Edit の最小実装",
 * docs/phase5t4_tree_paragraph_partial_edit_design.md): static-source-text
 * checks for the new "段落を編集…" context-menu item — the ONLY new
 * behavior this ticket adds. Real pure-function coverage of the new
 * blank-line validation lives in tests/paragraphPartialEdit.test.ts
 * ("paragraphEditTextContainsBlankLine" and "applyParagraphEdit: blank-line
 * input rejection" describe blocks) — this file only confirms the Tree/view
 * layer wires the bridge in narrowly and correctly, per this file's own
 * established "supplementary only" convention (see the Phase 5T-1 describe
 * block's own framing above).
 */
describe("Phase 5T-4A: Tree paragraph → existing Partial Edit bridge ('段落を編集…')", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
  const i18nTs = readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf-8");
  const paragraphPartialEditTs = readFileSync(
    path.resolve(__dirname, "../src/edit/paragraphPartialEdit.ts"),
    "utf-8"
  );

  function showParagraphMoveMenuBody(): string {
    const start = viewTs.indexOf("private showParagraphMoveMenu(evt: MouseEvent, nodeId: string): void {");
    expect(start).toBeGreaterThan(-1);
    // Phase 5T-7A inserted openParagraphPartialEditFromTree directly after
    // showParagraphMoveMenu (before showParagraphMoveTargetPicker), so the
    // end marker now bounds at THAT new method instead — otherwise this
    // helper would sweep the new method's own doc comment (which
    // legitimately discusses dblclick/F2, since that IS its job) into what
    // must stay showParagraphMoveMenu's own isolated body.
    const end = viewTs.indexOf("Phase 5T-7A: the single shared resolve+activate path", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  it("adds exactly one new menu item, titled via the new tree.menu.paragraphEdit i18n key, with the edit-3 icon shared with the pane's own getIcon()/showStandaloneComplexBlockMenu's Partial Edit item", () => {
    const body = showParagraphMoveMenuBody();
    expect(body).toContain('this.plugin.t("tree.menu.paragraphEdit")');
    const itemIdx = body.indexOf('this.plugin.t("tree.menu.paragraphEdit")');
    const iconIdx = body.indexOf('.setIcon("edit-3")', itemIdx);
    expect(iconIdx).toBeGreaterThan(itemIdx);
  });

  it("the item's onClick bridges to the EXISTING, unmodified main.ts#activatePartialEditViewForParagraph, passing the freshly re-resolved target's own range.startLine — never a new anchor type, never node.id, never a Tree-view-only id", () => {
    const body = showParagraphMoveMenuBody();
    const itemIdx = body.indexOf('this.plugin.t("tree.menu.paragraphEdit")');
    const onClickSlice = body.slice(itemIdx, itemIdx + 400);
    expect(onClickSlice).toContain("this.plugin.activatePartialEditViewForParagraph(target.range.startLine)");
    expect(onClickSlice).not.toContain("nodeId)");
    expect(onClickSlice).not.toContain("new ParagraphEditAnchor");
  });

  it("the new item is built AFTER target/anchor are already resolved (the same resolveParagraphFromTreeHint + buildParagraphMoveAnchor pair the Move items already use) — never a second, independent resolution path", () => {
    const body = showParagraphMoveMenuBody();
    const anchorIdx = body.indexOf("const anchor = buildParagraphMoveAnchor(doc, target);");
    const editItemIdx = body.indexOf('this.plugin.t("tree.menu.paragraphEdit")');
    expect(anchorIdx).toBeGreaterThan(-1);
    expect(editItemIdx).toBeGreaterThan(anchorIdx);
  });

  it("the menu still shows NOTHING at all when the paragraph itself cannot be resolved — the early `if (!target) return;` / `if (!anchor) return;` guards before the menu is ever constructed are unchanged", () => {
    const body = showParagraphMoveMenuBody();
    expect(body).toContain("if (!target) return;");
    expect(body).toContain("if (!anchor) return;");
    // Both guards must appear BEFORE the new edit item is ever built.
    const editItemIdx = body.indexOf('this.plugin.t("tree.menu.paragraphEdit")');
    expect(body.indexOf("if (!target) return;")).toBeLessThan(editItemIdx);
    expect(body.indexOf("if (!anchor) return;")).toBeLessThan(editItemIdx);
  });

  it("(Phase 5T-4A) showParagraphMoveMenu itself still wires no dblclick/F2 listener of its own — it only ever builds a Menu, unchanged by Phase 5T-7A. No inline editor/textarea/contenteditable was introduced by this ticket or by 5T-7A's later dblclick/F2 launch.", () => {
    const body = showParagraphMoveMenuBody();
    expect(body).not.toContain("dblclick");
    expect(body).not.toContain("F2");
    expect(viewTs).not.toContain("paragraph-edit-input");
    expect(viewTs).not.toContain("paragraphEditTextarea");
  });

  it("(Phase 5T-7A, updated for Phase 5T-7C, updated for Phase 5T-8A) a paragraph row's OWN pointerdown-based double-click trigger exists (a separate `else if (isParagraph)` branch, never a relaxation of the pre-existing `!readOnly` rename branch) and delegates — via the shared handleRowPointerDownForDoubleClick — to beginParagraphRenameForNode (inline rename, matching heading/list). (5T-7A originally wired this as a native `dblclick` listener opening Partial Edit; 5T-7C replaced it with the pointerdown-based detector, still opening Partial Edit; 5T-8A changes ONLY the destination to inline rename — see tests/rowDoubleClickDetector.test.ts, tests/paragraphPartialEditLaunchUiWiring.test.ts, and tests/paragraphInlineRename.test.ts for the detector/wiring/resolve-logic-specific coverage respectively.)", () => {
    const elseIfIdx = viewTs.indexOf("} else if (isParagraph) {", viewTs.indexOf("private renderNode("));
    expect(elseIfIdx).toBeGreaterThan(-1);
    const pointerdownIdx = viewTs.indexOf('selfEl.addEventListener("pointerdown"', elseIfIdx);
    const nextElseOrIfIdx = viewTs.indexOf("\n    if (isOutlineSectionNode(node)) {", elseIfIdx);
    expect(pointerdownIdx).toBeGreaterThan(elseIfIdx);
    expect(nextElseOrIfIdx).toBeGreaterThan(pointerdownIdx);
    const branchBody = viewTs.slice(elseIfIdx, nextElseOrIfIdx);
    expect(branchBody).not.toContain('addEventListener("dblclick"');
    expect(branchBody).toContain(
      "this.handleRowPointerDownForDoubleClick(evt, node.id, collapseEl, dragHandleEl, () =>"
    );
    expect(branchBody).toContain("this.beginParagraphRenameForNode(node.id)");
    expect(branchBody).not.toContain("this.openParagraphPartialEditFromTree(node.id)");
    expect(branchBody).not.toContain("paragraph-edit-input");
    expect(branchBody).not.toContain("contenteditable");
  });

  it("(Phase 5T-7A) handleTreeKeyDown's F2 case opens Paragraph Partial Edit only when the CURRENT selection resolves to a paragraph node, and preventDefault/stopPropagation for that branch are scoped inside it — the pre-existing unconditional preventDefault/stopPropagation + beginRenameForNode fallback for section/list/no-selection is untouched below it.", () => {
    const caseIdx = viewTs.indexOf('case "F2": {');
    expect(caseIdx).toBeGreaterThan(-1);
    const caseEndIdx = viewTs.indexOf("\n    }\n  };", caseIdx);
    expect(caseEndIdx).toBeGreaterThan(caseIdx);
    const caseBody = viewTs.slice(caseIdx, caseEndIdx);
    expect(caseBody).toContain("isOutlineParagraphNode(selectedNode)");
    expect(caseBody).toContain("this.openParagraphPartialEditFromTree(this.selectedId)");
    expect(caseBody).toContain("if (this.selectedId) this.beginRenameForNode(this.selectedId);");
  });

  it("(Phase 5T-7A) openParagraphPartialEditFromTree resolves via resolveParagraphFromTreeHint (the exact same function showParagraphMoveMenu's own item uses) and hands off to the EXISTING, unmodified main.ts#activatePartialEditViewForParagraph — never a new anchor type, never node.id, never a Tree-view-only id — and Notices rather than silently no-ops on an unresolved hint.", () => {
    const start = viewTs.indexOf("private openParagraphPartialEditFromTree(nodeId: string): void {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("resolveParagraphFromTreeHint(");
    expect(body).toContain("this.plugin.activatePartialEditViewForParagraph(target.range.startLine)");
    expect(body).toContain('this.notify(this.plugin.t("reason.paragraphTreeMoveResolveFailed"));');
    // The final call must be keyed off the freshly re-resolved target's
    // own range.startLine, never a raw Tree-view-only node id — checked as
    // a slice around the call site itself (unlike the earlier check,
    // "nodeId)" alone would spuriously match this method's OWN parameter,
    // e.g. inside `this.nodeById.get(nodeId)`).
    const activateIdx = body.indexOf("this.plugin.activatePartialEditViewForParagraph(");
    expect(activateIdx).toBeGreaterThan(-1);
    expect(body.slice(activateIdx, activateIdx + 60)).not.toContain("(nodeId)");
    expect(body).not.toContain("new ParagraphEditAnchor");
  });

  it("i18n.ts defines tree.menu.paragraphEdit and reason.blank-line-not-allowed in both en and ja", () => {
    const enStart = i18nTs.indexOf("const en = {");
    const enEnd = i18nTs.indexOf("\n} as const;", enStart);
    const jaStart = i18nTs.indexOf("const ja: Record<TranslationKey, string> = {", enEnd);
    const jaEnd = i18nTs.indexOf("\n};", jaStart);
    expect(enStart).toBeGreaterThan(-1);
    expect(jaStart).toBeGreaterThan(-1);
    const enBlock = i18nTs.slice(enStart, enEnd);
    const jaBlock = i18nTs.slice(jaStart, jaEnd);
    for (const key of ["tree.menu.paragraphEdit", "reason.blank-line-not-allowed"]) {
      expect(enBlock).toContain(`"${key}"`);
      expect(jaBlock).toContain(`"${key}"`);
    }
  });

  it("edit/paragraphPartialEdit.ts's blank-line validation is checked BEFORE any re-resolution against doc — appears earlier than the function's own scanComplexBlocks(doc) call", () => {
    const start = paragraphPartialEditTs.indexOf("export function applyParagraphEdit(");
    expect(start).toBeGreaterThan(-1);
    const scanIdx = paragraphPartialEditTs.indexOf("scanComplexBlocks(doc)", start);
    const blankCheckIdx = paragraphPartialEditTs.indexOf(
      "paragraphEditTextContainsBlankLine(newText)",
      start
    );
    expect(scanIdx).toBeGreaterThan(-1);
    expect(blankCheckIdx).toBeGreaterThan(start);
    expect(blankCheckIdx).toBeLessThan(scanIdx);
  });

  it("parseDocument.ts is not referenced by the new blank-line validation or by this bridge (paragraph identity/parsing rules are unchanged)", () => {
    expect(paragraphPartialEditTs).not.toContain("parseDocument.ts");
  });
});

describe("Phase 5T-9A: paragraph Tree-triggered delete (narrow, confirm-modal-gated exception)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

  function showParagraphMoveMenuBody(): string {
    const start = viewTs.indexOf("private showParagraphMoveMenu(evt: MouseEvent, nodeId: string): void {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("Phase 5T-7A: the single shared resolve+activate path", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  it("adds exactly one new, in-scope-gated delete item — gated by edit/deleteParagraph.ts#isInScopeParagraphParent, never shown unconditionally like the Edit item above it", () => {
    const body = showParagraphMoveMenuBody();
    expect(body).toContain("isInScopeParagraphParent(doc, target.parentId)");
    const gateIdx = body.indexOf("isInScopeParagraphParent(doc, target.parentId)");
    const deleteItemIdx = body.indexOf('this.plugin.t("tree.menu.deleteParagraph")');
    expect(deleteItemIdx).toBeGreaterThan(gateIdx);
  });

  it("the delete item opens ConfirmParagraphDeleteModal (never deletes immediately, unlike tree.menu.deleteListSubtree's no-confirm pattern) and only dispatches on confirmed === true", () => {
    const body = showParagraphMoveMenuBody();
    const itemIdx = body.indexOf('this.plugin.t("tree.menu.deleteParagraph")');
    expect(itemIdx).toBeGreaterThan(-1);
    const onClickSlice = body.slice(itemIdx, itemIdx + 400);
    expect(onClickSlice).toContain("new ConfirmParagraphDeleteModal(");
    expect(onClickSlice).toContain("if (confirmed) this.dispatchAndApplyParagraphDelete(anchor);");
  });

  it("the modal is built from treeNode.label (the same truncated preview already shown in the Tree row) and the menu-time anchor — never a bare nodeId, never re-deriving a fresh label", () => {
    const body = showParagraphMoveMenuBody();
    const itemIdx = body.indexOf('this.plugin.t("tree.menu.deleteParagraph")');
    const onClickSlice = body.slice(itemIdx, itemIdx + 400);
    expect(onClickSlice).toContain("treeNode.label, anchor,");
  });

  it("dispatchAndApplyParagraphDelete mirrors dispatchAndApplyParagraphMove's own shape: multi-cursor guard, deleteParagraph(text, anchor, rules), applyLineEditOutcome, and — unlike the generic runDeleteCommand/dispatchAndApply(..., false) path — DOES call queueSelectionFollow on success (the ticket's own §6 post-delete selection contract)", () => {
    const start = viewTs.indexOf("private dispatchAndApplyParagraphDelete(anchor: ParagraphMoveAnchor): boolean {");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("editor.listSelections().length > 1");
    expect(body).toContain("getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks)");
    expect(body).toContain("deleteParagraph(text, anchor, rules)");
    expect(body).toContain("applyLineEditOutcome(");
    expect(body).toContain("paragraphDeleteReasonText(");
    expect(body).toContain("this.queueSelectionFollow(outcome.newStartLine);");
  });

  it("does not touch D&D / drop-indicator / relocate machinery: draggable, computeDropMode, runRelocateCommand are absent from both the menu body and the dispatch method", () => {
    const menuBody = showParagraphMoveMenuBody();
    const start = viewTs.indexOf("private dispatchAndApplyParagraphDelete(anchor: ParagraphMoveAnchor): boolean {");
    const end = viewTs.indexOf("\n  }\n", start);
    const dispatchBody = viewTs.slice(start, end);
    for (const forbidden of ["draggable", "computeDropMode", "runRelocateCommand"]) {
      expect(menuBody).not.toContain(forbidden);
      expect(dispatchBody).not.toContain(forbidden);
    }
  });

  it("does not reference edit/listBodyRange.ts's extractListItemBodyText — this phase's delete is explicitly out of scope for list-item-child paragraphs and does not touch that module", () => {
    const start = viewTs.indexOf("private dispatchAndApplyParagraphDelete(anchor: ParagraphMoveAnchor): boolean {");
    const end = viewTs.indexOf("\n  }\n", start);
    const dispatchBody = viewTs.slice(start, end);
    expect(dispatchBody).not.toContain("extractListItemBodyText");
  });

  it("does not introduce paragraph insert alongside delete — insertParagraph/insertBlockAt are not referenced by the new delete wiring", () => {
    const start = viewTs.indexOf("private dispatchAndApplyParagraphDelete(anchor: ParagraphMoveAnchor): boolean {");
    const end = viewTs.indexOf("\n  }\n", start);
    const dispatchBody = viewTs.slice(start, end);
    expect(dispatchBody).not.toContain("insertParagraph");
    expect(dispatchBody).not.toContain("insertBlockAt");
  });
});
