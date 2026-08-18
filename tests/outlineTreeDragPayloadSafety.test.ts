import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5T-2R ("Tree D&D の外部 drop 安全化"): static-source-text checks for
 * view/OutlineTreeView.ts's DataTransfer payload policy.
 *
 * Background: a real-device pass during Phase 5T-2 proved that dropping ANY
 * Tree row (section, list, or paragraph) outside the Tree — most notably
 * onto Obsidian's body editor — is never intercepted by any Tree-side
 * dragover/drop listener (those are only attached to Tree row DOM
 * elements), so evt.preventDefault() is never called for that drop, and the
 * browser/Electron/CodeMirror's own default text/plain drop-handling runs
 * instead, inserting whatever string was written via
 * dataTransfer.setData("text/plain", ...) at dragstart as literal text into
 * the Markdown body. Before this phase both drag sources wrote the REAL
 * internal id (sectionId, or node.id such as "tree-paragraph:2") into that
 * payload, so an external drop corrupted the document with that id string.
 * This file locks in the fix: both dragstart sites now write an
 * intentionally empty "" sentinel instead, and — as this file also proves —
 * no Tree-internal decision logic has ever depended on reading the
 * DataTransfer payload back (it already used only private instance state:
 * this.dragSourceId for section/list, this.paragraphDragSession for
 * paragraph), so this is a pure payload-content change with zero behavioral
 * change to any valid Tree-internal drag/drop path.
 *
 * Same architectural constraint as tests/paragraphOutlineTreeUiWiring.test.ts
 * and tests/listPrefixUiWiring.test.ts: OutlineTreeView extends Obsidian's
 * ItemView, which cannot be constructed in vitest ("obsidian" is a
 * types-only package here), so this file inspects the raw source text of
 * OutlineTreeView.ts rather than instantiating the view and dispatching
 * real DragEvents. Within that constraint, the checks below go beyond a
 * loose substring "contains" match: they extract the exact bounded body of
 * each relevant method and assert the literal setData(...) call argument,
 * so a regression that reintroduces `sectionId` or `node.id` as the payload
 * — even if surrounded by different comments — fails the test.
 */
describe("OutlineTreeView.ts drag payload safety (static source check, Phase 5T-2R)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

  function getMethodBody(signature: string, label: string): string {
    const start = viewTs.indexOf(signature);
    if (start === -1) {
      throw new Error(`${signature} not found in src/view/OutlineTreeView.ts — has ${label} been renamed or removed?`);
    }
    // Bound the body at the next top-level "  private " or "  }" that closes
    // the method — simplest robust bound here is the next blank-line-preceded
    // closing brace at 2-space indent, but to stay resilient to reformatting
    // we instead search for the next occurrence of "\n  }\n" after start,
    // which closes the enclosing method body at the class's method
    // indentation level.
    const closeIdx = viewTs.indexOf("\n  }\n", start);
    if (closeIdx === -1) {
      throw new Error(`Could not find the closing brace for ${label} — update this test's bounding logic.`);
    }
    return viewTs.slice(start, closeIdx);
  }

  function getHandleDragStartBody(): string {
    return getMethodBody(
      "private handleDragStart(evt: DragEvent, sectionId: string, itemEl: HTMLElement): void {",
      "handleDragStart"
    );
  }

  function getHandleParagraphDragStartBody(): string {
    // handleParagraphDragStart's signature spans multiple lines in source;
    // anchor on the unique statement that assigns paragraphDragSession,
    // which only appears once and only inside this method.
    const start = viewTs.indexOf("this.paragraphDragSession = {");
    if (start === -1) {
      throw new Error(
        "this.paragraphDragSession assignment not found — has handleParagraphDragStart been restructured?"
      );
    }
    const closeIdx = viewTs.indexOf("\n  }\n", start);
    if (closeIdx === -1) {
      throw new Error("Could not find the closing brace for handleParagraphDragStart — update this test's bounding logic.");
    }
    return viewTs.slice(start, closeIdx);
  }

  it("has exactly two dataTransfer.setData(...) call sites in the whole file (section/list dragstart, paragraph dragstart) — no new drag source was added without updating this test", () => {
    const matches = viewTs.match(/\.setData\(/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("handleDragStart (section/list) writes the empty-string sentinel, never the real sectionId, as the text/plain payload", () => {
    const body = getHandleDragStartBody();
    expect(body).toContain('evt.dataTransfer.setData("text/plain", "");');
    expect(body).not.toContain('setData("text/plain", sectionId)');
    // Defense in depth: the literal identifier `sectionId` must not appear
    // anywhere inside a setData(...) call in this body.
    const setDataCalls = body.match(/\.setData\([^)]*\)/g) ?? [];
    for (const call of setDataCalls) {
      expect(call).not.toMatch(/sectionId/);
    }
  });

  it("handleDragStart (section/list) still sets effectAllowed = \"move\" unchanged", () => {
    const body = getHandleDragStartBody();
    expect(body).toContain('evt.dataTransfer.effectAllowed = "move";');
  });

  it("handleParagraphDragStart writes the empty-string sentinel, never the real node.id, as the text/plain payload", () => {
    const body = getHandleParagraphDragStartBody();
    expect(body).toContain('evt.dataTransfer.setData("text/plain", "");');
    expect(body).not.toContain('setData("text/plain", node.id)');
    const setDataCalls = body.match(/\.setData\([^)]*\)/g) ?? [];
    for (const call of setDataCalls) {
      expect(call).not.toMatch(/node\.id/);
    }
  });

  it("handleParagraphDragStart still sets effectAllowed = \"move\" unchanged", () => {
    const body = getHandleParagraphDragStartBody();
    expect(body).toContain('evt.dataTransfer.effectAllowed = "move";');
  });

  it("no setData(...) call anywhere in the file embeds a node-id-shaped or body-text-shaped literal (sec-, li-, tree-paragraph:, paragraph-, or a template/concat expression)", () => {
    const setDataCalls = viewTs.match(/\.setData\([^)]*\)/g) ?? [];
    expect(setDataCalls.length).toBeGreaterThan(0);
    for (const call of setDataCalls) {
      expect(call).not.toMatch(/sec-|li-|tree-paragraph:|paragraph-/);
      // Only a bare empty-string literal is permitted as the payload
      // argument — reject any interpolation, concatenation, or variable
      // reference, which would reintroduce a path for real content to leak.
      expect(call).toMatch(/\.setData\("text\/plain",\s*""\)/);
    }
  });

  it("never reads dataTransfer payload back anywhere in the file (no getData(...) call exists) — proves no Tree-internal decision can be driven by DataTransfer content", () => {
    expect(viewTs).not.toContain("getData");
  });

  it("handleDrop (section/list) still makes its allow/deny and source decisions from this.dragSourceId (private instance state), not from the DragEvent's DataTransfer", () => {
    const start = viewTs.indexOf("private handleDrop(evt: DragEvent, targetId: string, selfEl: HTMLElement): void {");
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("const sourceId = this.dragSourceId;");
    expect(body).toContain("this.canDropAny(doc, sourceId, targetId)");
    expect(body).not.toContain("dataTransfer");
  });

  it("handleParagraphDrop still makes its allow/deny and source decisions from this.paragraphDragSession (private instance state), not from the DragEvent's DataTransfer", () => {
    const start = viewTs.indexOf("private handleParagraphDrop(");
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("if (!session) return;");
    expect(body).not.toContain("dataTransfer");
  });

  it("endDrag() still unconditionally clears both dragSourceId and paragraphDragSession (dragend/invalid-drop/refresh/onClose cleanup contract unchanged)", () => {
    const start = viewTs.indexOf("private endDrag(): void {");
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("this.dragSourceId = null;");
    expect(body).toContain("this.paragraphDragSession = null;");
  });

  it("cancelParagraphDrag() is still wired into both refresh() (Tree refresh) and onClose() (view close) cleanup paths", () => {
    // Two call sites are documented and expected: refresh()'s own guard and
    // onClose(). A third occurrence is the method's own definition line.
    const occurrences = viewTs.match(/this\.cancelParagraphDrag\(\);/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(viewTs).toContain("private cancelParagraphDrag(): void {");
  });

  it("both the section/list row and the paragraph row still bind a dragend listener to handleDragEnd on the source element itself (native HTML5 dragend fires on the drag source regardless of where — or whether — the drop landed, so this is what guarantees cleanup even for an external drop that no Tree listener ever saw)", () => {
    const occurrences = viewTs.match(/addEventListener\("dragend", \(\) => this\.handleDragEnd\(\)\);/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

});
