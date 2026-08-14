import { describe, expect, it } from "vitest";
import { hasOutlineTreeLeafInLeftSidebar, LeafRootLike } from "../src/view/outlineTreeLeafPlacement";

/**
 * UXP-03b (2026-08-15, "Partial Edit Pane Placement Follow-up"):
 * hasOutlineTreeLeafInLeftSidebar is deliberately Obsidian-runtime-free
 * (see its own doc comment) — these tests use plain mock objects
 * satisfying LeafRootLike structurally, the same "split the pure half out
 * so it's directly testable" pattern settingsDefaults.ts established for
 * settings.ts.
 */
describe("hasOutlineTreeLeafInLeftSidebar (UXP-03b)", () => {
  const leftSplit = { name: "leftSplit" };
  const rightSplit = { name: "rightSplit" };
  const mainAreaRoot = { name: "mainArea" };
  const popoutRoot = { name: "popout" };

  function leafWithRoot(root: unknown): LeafRootLike {
    return { getRoot: () => root };
  }

  it("returns true when the single leaf's root is leftSplit", () => {
    expect(hasOutlineTreeLeafInLeftSidebar([leafWithRoot(leftSplit)], leftSplit)).toBe(true);
  });

  it("returns false when the single leaf's root is rightSplit", () => {
    expect(hasOutlineTreeLeafInLeftSidebar([leafWithRoot(rightSplit)], leftSplit)).toBe(false);
  });

  it("returns false when the single leaf's root is the main area", () => {
    expect(hasOutlineTreeLeafInLeftSidebar([leafWithRoot(mainAreaRoot)], leftSplit)).toBe(false);
  });

  it("returns false when the single leaf's root is a popout window", () => {
    expect(hasOutlineTreeLeafInLeftSidebar([leafWithRoot(popoutRoot)], leftSplit)).toBe(false);
  });

  it("returns false when there is no Outline Tree leaf at all (empty array)", () => {
    expect(hasOutlineTreeLeafInLeftSidebar([], leftSplit)).toBe(false);
  });

  it("returns true when leaves exist in both leftSplit and rightSplit", () => {
    expect(
      hasOutlineTreeLeafInLeftSidebar([leafWithRoot(rightSplit), leafWithRoot(leftSplit)], leftSplit)
    ).toBe(true);
  });

  it("returns true with multiple leaves as long as at least one is in leftSplit", () => {
    expect(
      hasOutlineTreeLeafInLeftSidebar(
        [leafWithRoot(mainAreaRoot), leafWithRoot(popoutRoot), leafWithRoot(leftSplit), leafWithRoot(rightSplit)],
        leftSplit
      )
    ).toBe(true);
  });

  it("returns false without throwing when every leaf's root is an unrecognized value", () => {
    expect(() =>
      hasOutlineTreeLeafInLeftSidebar([leafWithRoot(undefined), leafWithRoot(null)], leftSplit)
    ).not.toThrow();
    expect(hasOutlineTreeLeafInLeftSidebar([leafWithRoot(undefined), leafWithRoot(null)], leftSplit)).toBe(
      false
    );
  });

  it("returns false without throwing when leftSplit itself is undefined (e.g. mobile drawer instead of a sidedock)", () => {
    expect(() => hasOutlineTreeLeafInLeftSidebar([leafWithRoot(rightSplit)], undefined)).not.toThrow();
    expect(hasOutlineTreeLeafInLeftSidebar([leafWithRoot(rightSplit)], undefined)).toBe(false);
  });
});
