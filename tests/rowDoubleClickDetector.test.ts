import { describe, expect, it } from "vitest";
import {
  DOUBLE_CLICK_DISTANCE_THRESHOLD_PX,
  DOUBLE_CLICK_TIME_THRESHOLD_MS,
  isDoubleClickPointerDown,
  isEligibleRowBodyPointerDown,
  RowPointerDownRecord,
} from "../src/view/rowDoubleClickDetector";

/**
 * Phase 5T-7C ("Outline Tree の native dblclick 依存をやめ、pointerdown ベー
 * スの独立二重クリック検出へ置き換える"): unit tests for the pure decision
 * logic behind the replacement detector. See rowDoubleClickDetector.ts's own
 * top doc comment for the full background — native `dblclick` was found
 * (docs/phase5t7b_dblclick_reliability_audit.md) to be intermittently
 * swallowed by this app's own always-on `draggable="true"` rows, on both
 * left- and right-docked Outline Tree sidebars alike.
 *
 * This module has zero Obsidian/DOM-global dependency (see its own doc
 * comment), so — unlike view/OutlineTreeView.ts's own tests, which can only
 * ever inspect raw source text (ItemView can't be constructed in vitest) —
 * these tests call the real functions with real inputs and assert on real
 * outputs, the same as any other tests/*.test.ts covering a pure tree/move
 * helper.
 */
describe("rowDoubleClickDetector.ts", () => {
  function record(overrides: Partial<RowPointerDownRecord> = {}): RowPointerDownRecord {
    return { nodeId: "sec-1", time: 1000, x: 100, y: 100, ...overrides };
  }

  describe("isDoubleClickPointerDown", () => {
    it("returns false when there is no previous pointerdown to pair with", () => {
      expect(isDoubleClickPointerDown(record(), null)).toBe(false);
    });

    it("returns false when the two pointerdowns target different logical rows, even with identical time/coordinates", () => {
      const previous = record({ nodeId: "sec-1" });
      const current = record({ nodeId: "sec-2" });
      expect(isDoubleClickPointerDown(current, previous)).toBe(false);
    });

    it("returns true for the same row, zero time delta, zero distance (the trivial same-instant case)", () => {
      const previous = record({ time: 1000, x: 100, y: 100 });
      const current = record({ time: 1000, x: 100, y: 100 });
      expect(isDoubleClickPointerDown(current, previous)).toBe(true);
    });

    it(`returns true at exactly the ${DOUBLE_CLICK_TIME_THRESHOLD_MS}ms time threshold (inclusive boundary)`, () => {
      const previous = record({ time: 1000 });
      const current = record({ time: 1000 + DOUBLE_CLICK_TIME_THRESHOLD_MS });
      expect(isDoubleClickPointerDown(current, previous)).toBe(true);
    });

    it(`returns false 1ms past the ${DOUBLE_CLICK_TIME_THRESHOLD_MS}ms time threshold`, () => {
      const previous = record({ time: 1000 });
      const current = record({ time: 1000 + DOUBLE_CLICK_TIME_THRESHOLD_MS + 1 });
      expect(isDoubleClickPointerDown(current, previous)).toBe(false);
    });

    it("returns false when the current pointerdown is somehow chronologically BEFORE the previous one (negative delta) — never assumed away, always rejected explicitly", () => {
      const previous = record({ time: 1000 });
      const current = record({ time: 999 });
      expect(isDoubleClickPointerDown(current, previous)).toBe(false);
    });

    it(`returns true at exactly the ${DOUBLE_CLICK_DISTANCE_THRESHOLD_PX}px straight-line distance threshold (inclusive boundary)`, () => {
      const previous = record({ x: 100, y: 100 });
      const current = record({ x: 100 + DOUBLE_CLICK_DISTANCE_THRESHOLD_PX, y: 100 });
      expect(isDoubleClickPointerDown(current, previous)).toBe(true);
    });

    it(`returns false 1px past the ${DOUBLE_CLICK_DISTANCE_THRESHOLD_PX}px distance threshold`, () => {
      const previous = record({ x: 100, y: 100 });
      const current = record({ x: 100 + DOUBLE_CLICK_DISTANCE_THRESHOLD_PX + 1, y: 100 });
      expect(isDoubleClickPointerDown(current, previous)).toBe(false);
    });

    it("measures distance as true Euclidean displacement (diagonal movement), not independently-thresholded x/y", () => {
      // dx=4, dy=4 -> distance ~5.66, within a 6px threshold.
      const withinDiagonal = isDoubleClickPointerDown(
        record({ x: 104, y: 104 }),
        record({ x: 100, y: 100 })
      );
      expect(withinDiagonal).toBe(true);
      // dx=5, dy=5 -> distance ~7.07, past a 6px threshold, even though
      // neither axis alone exceeds 6px.
      const pastDiagonal = isDoubleClickPointerDown(
        record({ x: 105, y: 105 }),
        record({ x: 100, y: 100 })
      );
      expect(pastDiagonal).toBe(false);
    });
  });

  describe("isEligibleRowBodyPointerDown", () => {
    function makeContains(result: boolean) {
      return { contains: () => result };
    }

    const eligibleBase = {
      target: {},
      button: 0,
      isPrimary: true,
      collapseEl: makeContains(false),
      dragHandleEl: makeContains(false),
    };

    it("is eligible for an ordinary primary-button press landing outside both the collapse spacer and the drag handle", () => {
      expect(isEligibleRowBodyPointerDown(eligibleBase)).toBe(true);
    });

    it("is eligible when dragHandleEl is null (paragraph rows, and any other row with no drag handle at all)", () => {
      expect(isEligibleRowBodyPointerDown({ ...eligibleBase, dragHandleEl: null })).toBe(true);
    });

    it("excludes a right-click (button 2) even when it lands squarely on eligible row-body space — right-click is the context menu's own territory", () => {
      expect(isEligibleRowBodyPointerDown({ ...eligibleBase, button: 2 })).toBe(false);
    });

    it("excludes a middle/auxiliary-button press (button 1)", () => {
      expect(isEligibleRowBodyPointerDown({ ...eligibleBase, button: 1 })).toBe(false);
    });

    it("excludes a non-primary pointer (e.g. a secondary simultaneous touch during a multi-touch gesture)", () => {
      expect(isEligibleRowBodyPointerDown({ ...eligibleBase, isPrimary: false })).toBe(false);
    });

    it("excludes a press landing on the collapse/fold spacer", () => {
      expect(isEligibleRowBodyPointerDown({ ...eligibleBase, collapseEl: makeContains(true) })).toBe(
        false
      );
    });

    it("excludes a press landing on the drag handle", () => {
      expect(
        isEligibleRowBodyPointerDown({ ...eligibleBase, dragHandleEl: makeContains(true) })
      ).toBe(false);
    });
  });
});
