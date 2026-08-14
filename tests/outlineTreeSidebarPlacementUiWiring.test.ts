import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * UXP-03 (2026-08-15, "Configurable Outline Tree Sidebar Placement"):
 * main.ts's activateOutlineTreeView is a method of UnifiedOutlinerPlugin,
 * which extends Obsidian's Plugin class. "obsidian" is a types-only
 * package in this repo (node_modules/obsidian/package.json has
 * `"main": ""` — no runtime implementation), so UnifiedOutlinerPlugin
 * cannot be constructed in vitest and activateOutlineTreeView cannot be
 * called directly — the same constraint already documented in
 * tests/commandTable.test.ts and
 * tests/standaloneComplexBlockPopoutUiWiring.test.ts for this same file
 * and for OutlineTreeView.ts/PartialEditView.ts respectively.
 *
 * Instead, this file does the same lightweight STATIC TEXT check on
 * src/main.ts's own source that those two precedents use: it extracts
 * activateOutlineTreeView's method body (bounded the same way
 * commandTable.test.ts bounds getCommandSpecs()'s) and asserts that (a)
 * the new-leaf path reads settings.outlineTreeSidebarPosition and branches
 * between getLeftLeaf(false)/getRightLeaf(false), and (b) the existing-
 * leaf reuse path (getLeavesOfType + revealLeaf) still appears BEFORE that
 * branch and does not itself reference outlineTreeSidebarPosition — the
 * ticket's own explicit requirement that changing the setting must never
 * detach, move, or duplicate an already-open leaf. This cannot substitute
 * for real-device verification of the actual leaf placement (see this
 * ticket's own verification note), but it is a real regression guard
 * against the reuse-vs-new-leaf ordering being accidentally inverted, or
 * the branch being silently dropped, in a future edit.
 */
describe("main.ts activateOutlineTreeView (static source check, UXP-03)", () => {
  const mainTs = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf-8");

  function getActivateOutlineTreeViewBody(): string {
    const start = mainTs.indexOf("async activateOutlineTreeView(): Promise<void> {");
    if (start === -1) {
      throw new Error(
        "activateOutlineTreeView() not found in src/main.ts — has it been renamed or removed?"
      );
    }
    const end = mainTs.indexOf("\n  }", start);
    if (end === -1 || end <= start) {
      throw new Error(
        "Could not find activateOutlineTreeView()'s closing brace — its shape may have changed; update this test's bounding logic."
      );
    }
    return mainTs.slice(start, end);
  }

  it("activateOutlineTreeView() exists in src/main.ts", () => {
    expect(mainTs).toContain("async activateOutlineTreeView(): Promise<void> {");
  });

  it("the existing-leaf reuse path (getLeavesOfType + revealLeaf) appears before the setting is ever read", () => {
    const body = getActivateOutlineTreeViewBody();
    const reuseIndex = body.indexOf("getLeavesOfType(OUTLINE_TREE_VIEW_TYPE)");
    const settingReadIndex = body.indexOf("settings.outlineTreeSidebarPosition");
    expect(reuseIndex).toBeGreaterThan(-1);
    expect(settingReadIndex).toBeGreaterThan(-1);
    expect(reuseIndex).toBeLessThan(settingReadIndex);
  });

  it("the new-leaf path branches between getLeftLeaf(false) and getRightLeaf(false) based on the setting", () => {
    const body = getActivateOutlineTreeViewBody();
    expect(body).toContain('settings.outlineTreeSidebarPosition === "left"');
    expect(body).toContain("workspace.getLeftLeaf(false)");
    expect(body).toContain("workspace.getRightLeaf(false)");
  });

  it("the existing-leaf reuse branch (the code path taken when existing.length > 0) does not itself reference outlineTreeSidebarPosition", () => {
    const body = getActivateOutlineTreeViewBody();
    const reuseBranchStart = body.indexOf("if (existing.length > 0)");
    const reuseBranchEnd = body.indexOf("\n    }", reuseBranchStart);
    expect(reuseBranchStart).toBeGreaterThan(-1);
    expect(reuseBranchEnd).toBeGreaterThan(reuseBranchStart);
    const reuseBranchBody = body.slice(reuseBranchStart, reuseBranchEnd);
    expect(reuseBranchBody).not.toContain("outlineTreeSidebarPosition");
    expect(reuseBranchBody).not.toContain("detachLeavesOfType");
  });

  it("selects the left/right-specific 'could not open' Notice key matching the branch taken", () => {
    const body = getActivateOutlineTreeViewBody();
    expect(body).toContain("notice.couldNotOpenLeftSidebar");
    expect(body).toContain("notice.couldNotOpenRightSidebar");
  });
});
