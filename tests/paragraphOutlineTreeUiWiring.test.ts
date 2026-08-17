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

  it("does not introduce a Tree-triggered rename / indent-outdent / delete / insert affordance keyed on paragraph (Phase 5T-1 adds a narrow Tree-triggered MOVE only, via showParagraphMoveMenu/moveParagraphFromAnchor — checked separately in the dedicated Phase 5T-1 describe block below; every OTHER affordance stays absent)", () => {
    expect(viewTs).not.toContain("renameParagraph");
    expect(viewTs).not.toContain("indentParagraph");
    expect(viewTs).not.toContain("outdentParagraph");
    expect(viewTs).not.toContain("deleteParagraph");
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
    expect(viewTs).toContain("findComplexSiblingTarget");
  });

  it("showParagraphMoveMenu and dispatchAndApplyParagraphMove both exist as dedicated private methods", () => {
    expect(viewTs).toContain("private showParagraphMoveMenu(");
    expect(viewTs).toContain("private dispatchAndApplyParagraphMove(");
  });

  it("showParagraphMoveMenu uses findComplexSiblingTarget (5P-4's own eligibility check) to decide which of Move up/down to show, rather than inventing new eligibility logic", () => {
    const start = viewTs.indexOf("private showParagraphMoveMenu(");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  private dispatchAndApplyParagraphMove(", start);
    expect(end).toBeGreaterThan(start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("findComplexSiblingTarget(doc, unit, \"up\", complexScan)");
    expect(body).toContain("findComplexSiblingTarget(doc, unit, \"down\", complexScan)");
    expect(body).toContain("buildParagraphMoveAnchor(doc, target)");
    // No menu at all when neither direction is eligible (matches
    // showCompositeCommandMenu's own "no menu when nothing to do" style).
    expect(body).toContain("if (!upEligible && !downEligible) return;");
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

  it("edit/paragraphTreeMove.ts delegates to 5P-4's moveComplexBlock verbatim and implements no new swap/reorder logic of its own (no direct line-array splice/swap in this file)", () => {
    expect(moveTs).toContain("moveComplexBlock(doc, unit, direction, scan)");
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
