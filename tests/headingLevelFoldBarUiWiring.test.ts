import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../src/settingsDefaults";
import { createTranslator } from "../src/i18n";

/**
 * 26048-FEAT-001: static source-text checks for the heading-level fold
 * bar's wiring in view/OutlineTreeView.ts, plus real assertions on the
 * parts that are reachable without Obsidian (the setting's default, both
 * locales' strings).
 *
 * Same constraint as tests/paragraphOutlineTreeUiWiring.test.ts and
 * tests/listPrefixUiWiring.test.ts: an ItemView subclass cannot be
 * constructed under vitest, since "obsidian" is a types-only package here,
 * so the DOM half is asserted against the raw source text. The level logic
 * the bar is built from is genuinely unit-tested in
 * tests/outlineHeadingLevels.test.ts.
 */
const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

function methodBody(name: string, nextName: string): string {
  const start = viewTs.indexOf(name);
  if (start === -1) {
    throw new Error(`${name} not found in src/view/OutlineTreeView.ts — renamed or removed?`);
  }
  const end = viewTs.indexOf(nextName, start);
  if (end === -1 || end <= start) {
    throw new Error(
      `Could not find ${nextName} after ${name} — has the class's method order changed? Update this test's bounding logic.`
    );
  }
  return viewTs.slice(start, end);
}

describe("heading level fold bar wiring (static source check, 26048-FEAT-001)", () => {
  const renderBar = (): string =>
    methodBody(
      "private renderHeadingLevelBar(): void {",
      "private foldHeadingLevel(group: OutlineHeadingLevelGroup): void {"
    );

  it("renderTree() renders the bar before emptying the tree root, so a note with no headings clears it", () => {
    const body = methodBody("private renderTree(): void {", "private renderNode(");
    const barCall = body.indexOf("this.renderHeadingLevelBar();");
    const empty = body.indexOf("this.treeRootEl.empty();");
    expect(barCall).toBeGreaterThan(-1);
    expect(empty).toBeGreaterThan(barCall);
  });

  it("the bar is a sibling of treeRootEl inside contentEl, never a child of the role=tree element", () => {
    const body = renderBar();
    expect(body).toContain("this.contentEl.createDiv({");
    expect(body).toContain("this.contentEl.insertBefore(this.headingLevelBarEl, this.treeRootEl);");
    expect(body).not.toContain("this.treeRootEl.createDiv");
    expect(body).not.toContain("this.treeRootEl.createEl");
  });

  it("the setting gates the bar by removing the element entirely, not by hiding it", () => {
    const body = renderBar();
    expect(body).toContain("if (!this.plugin.settings.showHeadingLevelFoldButtons) {");
    expect(body).toContain("this.headingLevelBarEl?.remove();");
    expect(body).toContain("this.headingLevelBarEl = null;");
    expect(body).not.toContain("display: none");
    expect(body).not.toContain(".hide()");
  });

  it("a note with no heading levels gets no bar, not an empty strip", () => {
    const body = renderBar();
    expect(body).toContain("if (groups.length === 0) {");
    expect(body.split("this.headingLevelBarEl?.remove();").length - 1).toBe(2);
  });

  it("the empty-state path repaints the bar too — refresh() calls it without going through renderTree()", () => {
    const body = methodBody(
      "private renderEmptyState(message: string): void {",
      "private renderHeadingLevelBar(): void {"
    );
    expect(body).toContain("this.renderHeadingLevelBar();");
  });

  it("onOpen() drops the stale reference after emptying contentEl, so a reused view instance rebuilds the bar", () => {
    const body = methodBody("async onOpen(): Promise<void> {", "private renderEmptyState(");
    const empty = body.indexOf("this.contentEl.empty();");
    const nulled = body.indexOf("this.headingLevelBarEl = null;");
    expect(empty).toBeGreaterThan(-1);
    expect(nulled).toBeGreaterThan(empty);
  });

  it("levels come from the pure collectOutlineHeadingLevels, over the live tree, doc and collapsed set", () => {
    const body = renderBar();
    expect(body).toContain("collectOutlineHeadingLevels(");
    expect(body).toContain("this.currentTree");
    expect(body).toContain("this.currentDoc");
    expect(body).toContain("this.collapsedIds");
  });

  it("rows are real <button> elements, disabled when the level has nothing to fold", () => {
    const body = renderBar();
    expect(body).toContain('createEl("button"');
    expect(body).toContain("buttonEl.disabled = !hasSomethingToFold;");
    expect(body).toContain("const hasSomethingToFold = group.foldableIds.length > 0;");
  });

  it("a disabled level gets no click listener at all", () => {
    const body = renderBar();
    const guard = body.indexOf("if (hasSomethingToFold) {");
    const listener = body.indexOf('buttonEl.addEventListener("click"');
    expect(guard).toBeGreaterThan(-1);
    expect(listener).toBeGreaterThan(guard);
  });

  it("every button is labelled for assistive tech, in both the foldable and nothing-to-fold cases", () => {
    const body = renderBar();
    expect(body).toContain("tree.headingLevelFoldButtonTooltip");
    expect(body).toContain("tree.headingLevelFoldButtonNothingTooltip");
    expect(body).toContain('buttonEl.setAttribute(\n        "aria-label",');
  });

  it("a click goes through planHeadingLevelFold and the BATCHED setNodesCollapsed, never a per-node loop", () => {
    const body = methodBody(
      "private foldHeadingLevel(group: OutlineHeadingLevelGroup): void {",
      "private renderTree(): void {"
    );
    expect(body).toContain("const plan = planHeadingLevelFold(group);");
    expect(body).toContain("this.setNodesCollapsed(plan);");
    expect(body).not.toContain("this.setNodeCollapsed(");
    expect(body).not.toContain("for (");
  });
});

describe("batched fold write path (static source check, 26048-FEAT-001)", () => {
  const setNodesCollapsed = (): string =>
    methodBody(
      "private setNodesCollapsed(entries: Array<{ nodeId: string; collapsed: boolean }>): void {",
      "  private syncFoldsToBodyEditor("
    );

  it("setNodeCollapsed is preserved as a one-entry delegate, so its existing callers are untouched", () => {
    const body = methodBody(
      "private setNodeCollapsed(nodeId: string, collapsed: boolean): void {",
      "26048-FEAT-001: the batched form"
    );
    expect(body).toContain("this.setNodesCollapsed([{ nodeId, collapsed }]);");
  });

  it("refreshOtherOutlineTreeViews fires once, after the per-node loop rather than inside it", () => {
    const body = setNodesCollapsed();
    const loopEnd = body.indexOf("if (persistedAny) {");
    const refresh = body.indexOf("this.plugin.refreshOtherOutlineTreeViews(this);");
    expect(loopEnd).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(loopEnd);
    expect(body.split("this.plugin.refreshOtherOutlineTreeViews(this);").length - 1).toBe(1);
  });

  it("the CM6 sync is called once for the whole batch, still gated by the same single setting check", () => {
    const body = setNodesCollapsed();
    expect(body).toContain("if (this.plugin.settings.syncOutlineTreeFoldingToEditor) {");
    expect(body).toContain("this.syncFoldsToBodyEditor(entries);");
  });

  it("syncFoldsToBodyEditor dispatches ONE transaction carrying every fold effect", () => {
    const body = methodBody(
      "private syncFoldsToBodyEditor(",
      "private renderEmptyState(message: string): void {"
    );
    expect(body.split("cm.dispatch(").length - 1).toBe(1);
    expect(body).toContain("const effects: StateEffect<unknown>[] = [];");
    expect(body).toContain("effects.push((collapsed ? foldEffect : unfoldEffect).of({ from, to }));");
    expect(body).toContain("      effects,");
  });

  it("the batched dispatch still carries the Tree-origin annotation — without it every fold round-trips back", () => {
    const body = methodBody(
      "private syncFoldsToBodyEditor(",
      "private renderEmptyState(message: string): void {"
    );
    expect(body).toContain("annotations: outlineTreeFoldOrigin.of(true),");
  });

  it("the view-level guards are hoisted above the loop, and per-node guards continue rather than return", () => {
    const body = methodBody(
      "private syncFoldsToBodyEditor(",
      "private renderEmptyState(message: string): void {"
    );
    const cmLookup = body.indexOf("const cm = getEditorCmView(view.editor);");
    const loop = body.indexOf("for (const { nodeId, collapsed } of entries) {");
    expect(cmLookup).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(cmLookup);
    const loopBody = body.slice(loop);
    expect(loopBody).toContain("if (!node) continue;");
    expect(loopBody).toContain("if (node.range.endLine <= node.range.startLine) continue;");
    expect(loopBody).toContain("if (from >= to) continue;");
  });

  it("an all-skipped batch dispatches nothing", () => {
    const body = methodBody(
      "private syncFoldsToBodyEditor(",
      "private renderEmptyState(message: string): void {"
    );
    expect(body).toContain("if (effects.length === 0) return;");
  });
});

describe("heading level fold bar setting and strings (26048-FEAT-001)", () => {
  it("is off by default — the bar is opted into, not out of", () => {
    expect(DEFAULT_SETTINGS.showHeadingLevelFoldButtons).toBe(false);
  });

  it("settings.ts refreshes open views on toggle, so the bar appears without reopening the leaf", () => {
    const settingsTs = readFileSync(path.resolve(__dirname, "../src/settings.ts"), "utf-8");
    const start = settingsTs.indexOf("settings.showHeadingLevelFoldButtons.name");
    const end = settingsTs.indexOf("settings.showNoopNotices.name", start);
    const block = settingsTs.slice(start, end);
    expect(block).toContain("this.plugin.settings.showHeadingLevelFoldButtons = v;");
    expect(block).toContain("this.plugin.refreshOutlineTreeViews();");
  });

  it("every new string exists in both locales, with the level interpolated", () => {
    for (const locale of ["en", "ja"] as const) {
      const t = createTranslator(locale);
      expect(t("tree.headingLevelFoldButton", { level: 2 })).toBe("H2");
      expect(t("tree.headingLevelFoldButtonTooltip", { level: 3 })).toContain("3");
      expect(t("tree.headingLevelFoldButtonNothingTooltip", { level: 4 })).toContain("4");
      expect(t("tree.headingLevelFoldBarLabel")).not.toBe("");
      expect(t("settings.showHeadingLevelFoldButtons.name")).not.toBe("");
      expect(t("settings.showHeadingLevelFoldButtons.desc")).not.toBe("");
    }
  });

  it("the Japanese strings are actually translated, not copies of the English ones", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    for (const key of [
      "settings.showHeadingLevelFoldButtons.name",
      "settings.showHeadingLevelFoldButtons.desc",
      "tree.headingLevelFoldBarLabel",
    ] as const) {
      expect(ja(key)).not.toBe(en(key));
    }
  });
});
