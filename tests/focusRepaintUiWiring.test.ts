import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The swallowed first click: focusing the Outline Tree used to rebuild the
 * whole tree, and because `focus` fires on MOUSEDOWN, the row being pressed
 * was destroyed before mouseup. The browser then saw mousedown and mouseup
 * on different elements and dispatched no `click` at all, so the first
 * click into an unfocused pane did nothing and had to be repeated.
 *
 * Same static-source-check constraint as the other *UiWiring tests here —
 * an ItemView subclass cannot be constructed under vitest, since "obsidian"
 * is a types-only package in this repo.
 */
const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

function slice(from: string, to: string): string {
  const start = viewTs.indexOf(from);
  if (start === -1) throw new Error(`${from} not found — renamed or removed?`);
  const end = viewTs.indexOf(to, start);
  if (end === -1 || end <= start) {
    throw new Error(`Could not find ${to} after ${from} — update this test's bounding logic.`);
  }
  return viewTs.slice(start, end);
}

describe("focus repaint (static source check)", () => {
  const focusHandler = (): string =>
    slice('this.registerDomEvent(this.treeRootEl, "focus"', 'this.registerDomEvent(this.treeRootEl, "blur"');
  const blurHandler = (): string =>
    slice('this.registerDomEvent(this.treeRootEl, "blur"', "this.registerEvent(");

  it("the focus handler no longer rebuilds the tree", () => {
    const body = focusHandler();
    expect(body).not.toContain("this.renderTree();");
    expect(body).toContain("this.repaintFocusState();");
  });

  it("the blur handler takes the same in-place path", () => {
    const body = blurHandler();
    expect(body).not.toContain("this.renderTree();");
    expect(body).toContain("this.repaintFocusState();");
  });

  it("focus still settles the selection before repainting", () => {
    const body = focusHandler();
    const ensure = body.indexOf("this.ensureSelection();");
    const repaint = body.indexOf("this.repaintFocusState();");
    expect(ensure).toBeGreaterThan(-1);
    expect(repaint).toBeGreaterThan(ensure);
  });

  it("mobile keeps the full rebuild, because a selected row there grows a drag handle", () => {
    const body = slice(
      "private repaintFocusState(): void {",
      "private applyFocusSelectionToDom(): void {"
    );
    expect(body).toContain("if (Platform.isMobile) {");
    expect(body).toContain("this.renderTree();");
    expect(body).toContain("this.applyFocusSelectionToDom();");
  });

  it("the in-place repaint writes exactly what renderNode writes for a selected row", () => {
    const body = slice("private applyFocusSelectionToDom(): void {", "private renderEmptyState(");
    for (const written of [
      'rowEl.classList.toggle("is-selected", isSelected);',
      'rowEl.classList.toggle("unified-outliner-selected", isSelected);',
      'rowEl.setAttribute("aria-selected", isSelected ? "true" : "false");',
    ]) {
      expect(body).toContain(written);
    }
    // renderNode's own selected-row branch, the thing this mirrors.
    expect(viewTs).toContain('(isSelected ? " is-selected unified-outliner-selected" : "")');
    expect(viewTs).toContain('selfEl.setAttribute("aria-selected", isSelected ? "true" : "false");');
  });

  it("aria-activedescendant follows the selection, and is cleared when the pane has no focus", () => {
    const body = slice("private applyFocusSelectionToDom(): void {", "private renderEmptyState(");
    expect(body).toContain("this.hasFocus && this.selectedId");
    expect(body).toContain('this.treeRootEl.setAttribute("aria-activedescendant", selectedRowId);');
    expect(body).toContain('this.treeRootEl.removeAttribute("aria-activedescendant");');
  });

  it("row ids are built the same way renderNode builds them", () => {
    const body = slice("private applyFocusSelectionToDom(): void {", "private renderEmptyState(");
    expect(body).toContain("`unified-outliner-row-${this.selectedId}`");
    expect(viewTs).toContain("selfEl.id = `unified-outliner-row-${node.id}`;");
  });
});
