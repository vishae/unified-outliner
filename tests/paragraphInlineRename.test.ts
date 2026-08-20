import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5T-8A ("paragraph のダブルクリック動作を Partial Edit 起動から inline
 * rename へ統一する"): covers the NEW resolve+open+commit contract for
 * paragraph inline rename in view/OutlineTreeView.ts —
 * beginParagraphRenameForNode's own resolution logic, beginRename's new
 * "paragraph" kind branch, and commitRename's new applyParagraphEdit
 * dispatch branch.
 *
 * OutlineTreeView extends Obsidian's ItemView, which cannot be constructed
 * in vitest ("obsidian" is a types-only package here), so — same convention
 * as tests/paragraphOutlineTreeUiWiring.test.ts,
 * tests/paragraphPartialEditLaunchUiWiring.test.ts, and
 * tests/selectionFollowUiWiring.test.ts — this file inspects the raw
 * source text of view/OutlineTreeView.ts rather than instantiating the view
 * and dispatching real DOM events.
 *
 * Deliberately SEPARATE from tests/paragraphPartialEditLaunchUiWiring.test.ts
 * (which stays scoped to the pointerdown double-click DETECTION wiring —
 * which branch attaches which listener, what it delegates to — and was
 * updated in place for this ticket's one-line destination change) and from
 * tests/paragraphOutlineTreeUiWiring.test.ts (which covers the pre-existing,
 * untouched "段落を編集…" context menu / openParagraphPartialEditFromTree
 * resolve+activate contract, F2, and Paragraph Partial Edit's own load/apply
 * logic) — this file is the new one scoped to the NEW resolve/open/commit
 * logic this ticket actually adds.
 *
 * applyParagraphEdit's own pure re-resolution/rejection behavior (identity
 * checks, blank-line rejection, multi-line splice) is already directly
 * unit-tested in tests/paragraphPartialEdit.test.ts and is NOT re-tested
 * here — this file only tests that view/OutlineTreeView.ts's new paragraph
 * rename wiring reuses that existing, already-tested function rather than
 * reimplementing anything.
 */
describe("OutlineTreeView.ts paragraph inline rename (Phase 5T-8A)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

  function methodBody(signature: string): string {
    const start = viewTs.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }\n", start);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  it("applyParagraphEdit is imported from edit/paragraphPartialEdit.ts — the exact same function view/PartialEditView.ts's own Apply flow already uses — no new write primitive was introduced", () => {
    expect(viewTs).toContain('import { applyParagraphEdit } from "../edit/paragraphPartialEdit";');
  });

  describe("beginParagraphRenameForNode", () => {
    function body(): string {
      return methodBody("private beginParagraphRenameForNode(nodeId: string): void {");
    }

    it("guards on isOutlineParagraphNode(treeNode) via this.nodeById — never accepts a section/list/composite/complex-member id", () => {
      const b = body();
      expect(b).toContain("const treeNode = this.nodeById.get(nodeId);");
      expect(b).toContain("if (!treeNode || !isOutlineParagraphNode(treeNode)) return;");
    });

    it("resolves via this.currentDoc/this.currentComplexScan (the last refresh()'s own live state), never a fresh parseDocument(view.editor.getValue()) call — matching showParagraphMoveMenu's/handleParagraphDragStart's own established convention for Tree-triggered paragraph anchor construction", () => {
      const b = body();
      expect(b).toContain("const doc = this.currentDoc;");
      expect(b).toContain("const complexScan = this.currentComplexScan;");
      expect(b).not.toContain("parseDocument(");
    });

    it("uses the exact same resolveParagraphFromTreeHint + buildParagraphMoveAnchor pair as showParagraphMoveMenu/handleParagraphDragStart — no new resolution logic", () => {
      const b = body();
      expect(b).toContain("const target = resolveParagraphFromTreeHint(");
      expect(b).toContain("rangeStart: treeNode.rangeStart");
      expect(b).toContain("rangeEnd: treeNode.rangeEnd");
      expect(b).toContain("parentId: treeNode.parentId");
      expect(b).toContain("const anchor = buildParagraphMoveAnchor(doc, target);");
    });

    it("no-ops silently (no Notice/this.notify call) on every failure mode — missing doc/complexScan, unresolved hint, unresolved anchor, or missing rowSelfEl/innerEl", () => {
      const b = body();
      expect(b).not.toContain("this.notify(");
      expect(b).toContain("if (!doc || !complexScan) return;");
      expect(b).toContain("if (!target) return;");
      expect(b).toContain("if (!anchor) return;");
      expect(b).toContain("if (!rowSelfEl || !innerEl) return;");
    });

    it("does NOT consult this.readOnlyNodeIds — every paragraph node is unconditionally read-only (collectReadOnlyOutlineNodeIds), so that check would always be true and would make this method a permanent no-op; eligibility is instead governed entirely by isOutlineParagraphNode + a successful anchor resolution", () => {
      const b = body();
      expect(b).not.toContain("this.readOnlyNodeIds");
    });

    it("re-locates rowSelfEl/innerEl by the row's stable unified-outliner-row-<id> DOM id, same convention as beginRenameForNode", () => {
      const b = body();
      expect(b).toContain('`#${CSS.escape("unified-outliner-row-" + nodeId)}`');
      expect(b).toContain('.querySelector<HTMLElement>(".tree-item-inner")');
    });

    it("delegates to beginRename with kind \"paragraph\" and the resolved anchor — never constructs its own textarea/DOM, never calls applyLineEditOutcome/applyParagraphEdit directly itself", () => {
      const b = body();
      expect(b).toContain('this.beginRename(nodeId, "paragraph", innerEl, rowSelfEl, anchor);');
      expect(b).not.toContain("createEl(\"textarea\"");
      expect(b).not.toContain("applyLineEditOutcome(");
      expect(b).not.toContain("applyParagraphEdit(");
    });
  });

  describe("beginRename's paragraph branch", () => {
    function body(): string {
      return methodBody("private beginRename(");
    }

    it("kind is typed \"section\" | \"list\" | \"paragraph\", with an optional paragraphSnapshot parameter (deliberately NOT named paragraphAnchor — see tests/paragraphOutlineTreeUiWiring.test.ts's pre-existing 'this file never references paragraphAnchor' assertion, an older Phase 5T-1/5T-4A architectural-boundary check this ticket does not need to invalidate)", () => {
      expect(viewTs).toContain(
        'kind: "section" | "list" | "paragraph",\n    innerEl: HTMLElement,\n    rowSelfEl: HTMLElement,\n    paragraphSnapshot?: ParagraphMoveAnchor'
      );
      expect(viewTs).not.toContain("paragraphAnchor");
    });

    it("the pre-existing section/list snapshot-construction code (parseDocument(view.editor.getValue()), doc.nodes.get, isSectionNode type-check, SectionRenameSnapshot/ListRenameSnapshot construction) is still present, unmodified, inside an `else` branch — kind \"paragraph\" never reaches it", () => {
      const b = body();
      expect(b).toContain('if (kind === "paragraph") {');
      expect(b).toContain("} else {");
      expect(b).toContain("const view = this.activeMarkdownView.get();");
      expect(b).toContain("const doc = parseDocument(view.editor.getValue());");
      expect(b).toContain("const node = doc.nodes.get(nodeId);");
      expect(b).toContain('if ((kind === "section") !== isSectionNode(node)) {');
      expect(b).toContain("initialText = section.headingText;");
      expect(b).toContain("initialText = listItemDisplayText(doc, item);");
    });

    it("the paragraph branch uses paragraphSnapshot.originalText as initialText and paragraphSnapshot itself as snapshot — never re-derives text from doc.nodes (a paragraph has no entry there)", () => {
      const b = body();
      const paragraphBranchStart = b.indexOf('if (kind === "paragraph") {');
      const paragraphBranchEnd = b.indexOf("} else {", paragraphBranchStart);
      const paragraphBranch = b.slice(paragraphBranchStart, paragraphBranchEnd);
      expect(paragraphBranch).toContain("initialText = paragraphSnapshot.originalText;");
      expect(paragraphBranch).toContain("snapshot = paragraphSnapshot;");
      expect(paragraphBranch).not.toContain("doc.nodes.get");
    });

    it("the paragraph branch defensively rejects a missing paragraphSnapshot (structurally unreachable given beginParagraphRenameForNode's own contract, but never trusted blindly) without touching the DOM", () => {
      const b = body();
      const paragraphBranchStart = b.indexOf('if (kind === "paragraph") {');
      const paragraphBranchEnd = b.indexOf("} else {", paragraphBranchStart);
      const paragraphBranch = b.slice(paragraphBranchStart, paragraphBranchEnd);
      expect(paragraphBranch).toContain("if (!paragraphSnapshot) {");
      expect(paragraphBranch).not.toContain("innerEl.empty()");
    });

    it("everything from innerEl.empty() onward (textarea construction, keydown/input/blur/click wiring, the final this.renameState assignment) is shared/unchanged code reached by ALL THREE kinds — not duplicated per kind", () => {
      const b = body();
      const sharedIdx = b.indexOf("innerEl.empty();");
      expect(sharedIdx).toBeGreaterThan(-1);
      const sharedTail = b.slice(sharedIdx);
      // Exactly one textarea is ever created per beginRename call, regardless of kind.
      expect(sharedTail.split('innerEl.createEl("textarea"').length - 1).toBe(1);
      expect(sharedTail).toContain("this.renameState = { nodeId, kind, inputEl, rowSelfEl, snapshot };");
    });

    it("the \"already renaming this exact node -> refocus\" and \"different row already renaming -> cancel first\" guards run BEFORE the kind branch, so they apply uniformly to paragraph rename too", () => {
      const b = body();
      const guardIdx = b.indexOf("if (this.renameState && this.renameState.nodeId === nodeId) {");
      const cancelIdx = b.indexOf("if (this.renameState) this.cancelRename();");
      const kindBranchIdx = b.indexOf('if (kind === "paragraph") {');
      expect(guardIdx).toBeGreaterThan(-1);
      expect(cancelIdx).toBeGreaterThan(guardIdx);
      expect(kindBranchIdx).toBeGreaterThan(cancelIdx);
    });
  });

  describe("commitRename's paragraph branch", () => {
    function body(): string {
      return methodBody("private commitRename(): void {");
    }

    it("dispatches to applyParagraphEdit(doc, state.snapshot, rawValue) when state.kind is neither \"section\" nor \"list\" — a plain 3-way ternary, section/list branches textually unchanged", () => {
      const b = body();
      expect(b).toContain('state.kind === "section"');
      expect(b).toContain(
        "renameSection(doc, state.nodeId, state.snapshot as SectionRenameSnapshot, rawValue)"
      );
      expect(b).toContain('state.kind === "list"');
      expect(b).toContain(
        "renameListItem(doc, state.nodeId, state.snapshot as ListRenameSnapshot, rawValue)"
      );
      expect(b).toContain(
        "applyParagraphEdit(doc, state.snapshot as ParagraphMoveAnchor, rawValue)"
      );
    });

    it("the outcome (whichever branch produced it) is still passed through the single shared applyLineEditOutcome call — no separate write path for paragraph", () => {
      const b = body();
      const outcomeIdx = b.indexOf("const outcome =");
      const applyIdx = b.indexOf("const changed = applyLineEditOutcome(", outcomeIdx);
      expect(applyIdx).toBeGreaterThan(outcomeIdx);
      const applyCallOccurrences = b.split("applyLineEditOutcome(").length - 1;
      expect(applyCallOccurrences).toBe(1);
    });

    it("always re-parses the editor's CURRENT content fresh (parseDocument(editor.getValue())) before building the outcome for any kind, including paragraph — applyParagraphEdit's own re-resolution then re-verifies against this same fresh doc, never a stale snapshot", () => {
      const b = body();
      const parseIdx = b.indexOf("const doc = parseDocument(editor.getValue());");
      const outcomeIdx = b.indexOf("const outcome =");
      expect(parseIdx).toBeGreaterThan(-1);
      expect(outcomeIdx).toBeGreaterThan(parseIdx);
    });
  });

  it("renameState's snapshot type includes ParagraphMoveAnchor alongside SectionRenameSnapshot/ListRenameSnapshot, and kind includes \"paragraph\" — appears exactly twice (the field declaration and the local `let snapshot`/`let initialText` pairing inside beginRename)", () => {
    const occurrences = viewTs.split(
      "SectionRenameSnapshot | ListRenameSnapshot | ParagraphMoveAnchor"
    ).length - 1;
    expect(occurrences).toBe(2);
    expect(viewTs).toContain('kind: "section" | "list" | "paragraph";');
  });

  it("the paragraph context menu (\"段落を編集…\", showParagraphMoveMenu) and F2 (handleTreeKeyDown's F2 case) are UNCHANGED by this ticket — both still resolve/activate Paragraph Partial Edit, never inline rename", () => {
    expect(viewTs).toContain(
      '.onClick(() =>\n          void this.plugin.activatePartialEditViewForParagraph(target.range.startLine)\n        )'
    );
    const f2CaseIdx = viewTs.indexOf('case "F2": {');
    const f2CaseEnd = viewTs.indexOf("\n    }\n  };", f2CaseIdx);
    const f2Body = viewTs.slice(f2CaseIdx, f2CaseEnd);
    expect(f2Body).toContain("this.openParagraphPartialEditFromTree(this.selectedId)");
    expect(f2Body).not.toContain("beginParagraphRenameForNode");
  });

  it("Paragraph Partial Edit Pane itself (view/PartialEditView.ts's own load/apply logic, main.ts#activatePartialEditViewForParagraph) is not referenced or modified by any of the new paragraph-rename code — openParagraphPartialEditFromTree's own body is untouched", () => {
    const b = methodBody("private openParagraphPartialEditFromTree(nodeId: string): void {");
    expect(b).toContain("void this.plugin.activatePartialEditViewForParagraph(target.range.startLine);");
    expect(b).not.toContain("beginRename");
    expect(b).not.toContain("beginParagraphRenameForNode");
  });

  it("D&D wiring (handleDragStart/handleParagraphDragStart/computeDropMode/runRelocateCommand), the `draggable` attribute assignments, and every dragstart/dragover/drop/dragend listener are textually untouched by this ticket — Phase 5T-8A only changes which action a paragraph double-click triggers, never D&D judgment/movement logic", () => {
    expect(viewTs).toContain("private handleDragStart(evt: DragEvent, sectionId: string, itemEl: HTMLElement): void {");
    expect(viewTs).toContain("private computeDropMode(evt: DragEvent, el: HTMLElement): DropMode {");
    expect(viewTs).toContain("private runRelocateCommand(sourceId: string, targetId: string, mode: DropMode): void {");
    expect(viewTs).toContain("private handleParagraphDragStart(");
    expect(viewTs).toContain('selfEl.setAttribute("draggable", "true");');
    expect(viewTs).toContain('dragHandleEl?.setAttribute("draggable", "true");');
  });

  it("cancelRename's own doc comment/behavior (never calls applyLineEditOutcome/editor.replaceRange, always a plain renderTree()) is untouched — a cancelled paragraph rename is exactly as safe as a cancelled heading/list rename", () => {
    const b = methodBody("private cancelRename(): void {");
    expect(b).not.toContain("applyLineEditOutcome");
    expect(b).not.toContain("editor.replaceRange");
    expect(b).toContain("this.renderTree();");
  });
});
