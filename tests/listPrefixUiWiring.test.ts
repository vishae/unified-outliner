import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * UXP-04 (2026-08-15, "Configurable List Marker Prefix Display"):
 * OutlineTreeView.ts's renderNode is a method of an Obsidian ItemView
 * subclass — "obsidian" is a types-only package in this repo, so
 * OutlineTreeView cannot be constructed in vitest and renderNode cannot be
 * called directly. Same static-source-text approach as
 * tests/commandTable.test.ts / tests/outlineTreeSidebarPlacementUiWiring.test.ts
 * for this same constraint. The actual prefix VALUE logic
 * (listPrefixText) is unit-tested with real assertions in
 * tests/buildOutlineTree.test.ts — this file only confirms
 * OutlineTreeView.ts's own rendering call site wires that value in
 * correctly and doesn't disturb the composite/complex-member/heading
 * prefix rendering it sits alongside.
 */
describe("OutlineTreeView.ts list prefix rendering (static source check, UXP-04)", () => {
  const viewTs = readFileSync(
    path.resolve(__dirname, "../src/view/OutlineTreeView.ts"),
    "utf-8"
  );

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

  it("renderNode() exists in src/view/OutlineTreeView.ts", () => {
    expect(viewTs).toContain(
      "private renderNode(node: OutlineTreeNode, parentEl: HTMLElement): void {"
    );
  });

  it("creates a dedicated unified-outliner-list-prefix span, only when node.prefix is present", () => {
    const body = getRenderNodeBody();
    expect(body).toContain("unified-outliner-list-prefix");
    // Guarded by an `if (node.prefix)` check, the same "skip entirely when
    // absent" pattern the composite/complex-member prefix spans use —
    // located specifically within the isOutlineListNode branch (checked via
    // the ordering assertion below, not by string-matching the guard
    // itself, since `if (node.prefix)` alone isn't a unique-enough string).
    const listBranchStart = body.indexOf("isOutlineListNode(node)) {");
    const prefixSpanIndex = body.indexOf("unified-outliner-list-prefix");
    expect(listBranchStart).toBeGreaterThan(-1);
    expect(prefixSpanIndex).toBeGreaterThan(listBranchStart);
  });

  it("the prefix span is created BEFORE the list label span, within the list branch", () => {
    const body = getRenderNodeBody();
    const prefixSpanIndex = body.indexOf("unified-outliner-list-prefix");
    const labelSpanIndex = body.indexOf("unified-outliner-list-label");
    expect(prefixSpanIndex).toBeGreaterThan(-1);
    expect(labelSpanIndex).toBeGreaterThan(-1);
    expect(prefixSpanIndex).toBeLessThan(labelSpanIndex);
  });

  it("no longer calls innerEl.setText for the list row (would wipe out a sibling prefix span)", () => {
    const body = getRenderNodeBody();
    const listBranchStart = body.indexOf("isOutlineListNode(node)) {");
    const compositeBranchStart = body.indexOf("isComposite) {");
    expect(listBranchStart).toBeGreaterThan(-1);
    expect(compositeBranchStart).toBeGreaterThan(listBranchStart);
    const listBranchBody = body.slice(listBranchStart, compositeBranchStart);
    expect(listBranchBody).not.toContain("innerEl.setText");
  });

  it("the list row still uses the unified-outliner-list-text ellipsis class on its own row container", () => {
    const body = getRenderNodeBody();
    expect(body).toContain("tree-item-inner unified-outliner-list-text");
  });

  it("does not disturb the existing composite/complex-member/heading prefix rendering", () => {
    const body = getRenderNodeBody();
    expect(body).toContain("unified-outliner-composite-prefix");
    expect(body).toContain("unified-outliner-complex-member-prefix");
    expect(body).toContain("unified-outliner-heading-prefix");
  });
});
