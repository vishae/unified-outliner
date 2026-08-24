import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * UXP-03b (2026-08-15, "Partial Edit Pane Placement Follow-up"): main.ts's
 * activatePartialEditView is a method of UnifiedOutlinerPlugin, which
 * extends Obsidian's Plugin class — "obsidian" is a types-only package in
 * this repo, so UnifiedOutlinerPlugin cannot be constructed in vitest and
 * activatePartialEditView cannot be called directly. This is the same
 * static-source-text approach tests/commandTable.test.ts and
 * tests/outlineTreeSidebarPlacementUiWiring.test.ts already use for this
 * same constraint. The real placement-decision LOGIC
 * (hasOutlineTreeLeafInLeftSidebar) is unit-tested directly with real
 * assertions in tests/outlineTreeLeafPlacement.test.ts — this file only
 * confirms main.ts's own call site wires that logic in at the right place
 * and doesn't accidentally touch anything UXP-03b was told not to.
 */
describe("main.ts activatePartialEditView (static source check, UXP-03b)", () => {
  const mainTs = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf-8");

  function getActivatePartialEditViewBody(): string {
    const start = mainTs.indexOf("async activatePartialEditView(");
    if (start === -1) {
      throw new Error(
        "activatePartialEditView() not found in src/main.ts — has it been renamed or removed?"
      );
    }
    const end = mainTs.indexOf("\n  }", start);
    if (end === -1 || end <= start) {
      throw new Error(
        "Could not find activatePartialEditView()'s closing brace — its shape may have changed; update this test's bounding logic."
      );
    }
    return mainTs.slice(start, end);
  }

  it("activatePartialEditView() exists in src/main.ts", () => {
    expect(mainTs).toContain("async activatePartialEditView(");
  });

  it("the existing-leaf reuse path (existing.length > 0) appears before the placement decision", () => {
    const body = getActivatePartialEditViewBody();
    const reuseIndex = body.indexOf("existing.length > 0");
    const placementIndex = body.indexOf("hasOutlineTreeLeafInLeftSidebar(");
    expect(reuseIndex).toBeGreaterThan(-1);
    expect(placementIndex).toBeGreaterThan(-1);
    expect(reuseIndex).toBeLessThan(placementIndex);
  });

  it("the popout path (options?.openInNewWindow) appears before the placement decision and never calls hasOutlineTreeLeafInLeftSidebar itself", () => {
    const body = getActivatePartialEditViewBody();
    const popoutStart = body.indexOf("if (options?.openInNewWindow)");
    // UXP-03c widened the reuse condition from the single-line
    // `existing.length > 0` to a multi-line `existing.length > 0 && ...`
    // check — search on the still-stable `} else if (` prefix instead of
    // the now-gone single-line literal.
    const popoutEnd = body.indexOf("} else if (", popoutStart);
    const placementIndex = body.indexOf("hasOutlineTreeLeafInLeftSidebar(");
    expect(popoutStart).toBeGreaterThan(-1);
    expect(popoutEnd).toBeGreaterThan(popoutStart);
    expect(popoutStart).toBeLessThan(placementIndex);
    const popoutBody = body.slice(popoutStart, popoutEnd);
    expect(popoutBody).not.toContain("hasOutlineTreeLeafInLeftSidebar");
    expect(popoutBody).not.toContain("getLeftLeaf");
  });

  it("the new-leaf branch chooses getRightLeaf(false) when hasOutlineTreeLeafInLeftSidebar is true, and getRightLeaf(true) otherwise", () => {
    const body = getActivatePartialEditViewBody();
    expect(body).toContain("workspace.getRightLeaf(false)");
    expect(body).toContain("workspace.getRightLeaf(true)");
    expect(body).toContain("openWithoutSplit");
  });

  it("does not reference settings.outlineTreeSidebarPosition anywhere in this method", () => {
    const body = getActivatePartialEditViewBody();
    expect(body).not.toContain("outlineTreeSidebarPosition");
  });

  it("does not call getLeftLeaf for the new Partial Edit leaf", () => {
    const body = getActivatePartialEditViewBody();
    expect(body).not.toContain("getLeftLeaf");
  });

  it("does not bulk-detach or duplicate any leaf, and moveLeafToPopout is still only used by the pre-existing popout path", () => {
    const body = getActivatePartialEditViewBody();
    expect(body).not.toContain("detachLeavesOfType");
    expect(body).not.toContain("moveLeafToPopout(leaf)".repeat(2)); // sanity: no accidental double-move
    // moveLeafToPopout is expected exactly once, as part of the pre-existing
    // popout reuse path (unrelated to UXP-03b/UXP-03c) — not a new call
    // either ticket added.
    const moveLeafToPopoutCount = body.split("moveLeafToPopout").length - 1;
    expect(moveLeafToPopoutCount).toBe(1);
  });

  it("UXP-03c: reuses existing[0] only when it does NOT share a tab group with an open Outline Tree leaf, and detaches it (once, via the instance method — not the bulk detachLeavesOfType) otherwise, before falling through to the same placement decision", () => {
    const body = getActivatePartialEditViewBody();
    const reuseConditionIndex = body.indexOf("} else if (");
    const sharesTabGroupIndex = body.indexOf("!partialEditLeafSharesTabGroupWithOutlineTree(");
    const placementIndex = body.indexOf("hasOutlineTreeLeafInLeftSidebar(");
    const detachIndex = body.indexOf("existing[0].detach()");
    expect(sharesTabGroupIndex).toBeGreaterThan(-1);
    expect(reuseConditionIndex).toBeGreaterThan(-1);
    expect(reuseConditionIndex).toBeLessThan(sharesTabGroupIndex);
    // The reuse condition (with its staleness check) must be decided
    // before the detach-and-fall-through branch, which itself must
    // precede the placement decision it falls through to.
    expect(sharesTabGroupIndex).toBeLessThan(detachIndex);
    expect(detachIndex).toBeLessThan(placementIndex);
    // Exactly one instance-level detach() call in this method — never the
    // Workspace-level bulk detachLeavesOfType.
    const detachCallCount = body.split(".detach()").length - 1;
    expect(detachCallCount).toBe(1);
  });

  it("imports partialEditLeafSharesTabGroupWithOutlineTree alongside hasOutlineTreeLeafInLeftSidebar from outlineTreeLeafPlacement", () => {
    expect(mainTs).toContain("partialEditLeafSharesTabGroupWithOutlineTree");
    expect(mainTs).toContain('from "./view/outlineTreeLeafPlacement"');
  });
});
