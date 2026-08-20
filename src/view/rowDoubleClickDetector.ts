/**
 * Phase 5T-7C ("Outline Tree の native dblclick 依存をやめ、pointerdown ベース
 * の独立二重クリック検出へ置き換える"): pure, Obsidian/DOM-runtime-free
 * decision logic for detecting a "double click" on an Outline Tree row via
 * `pointerdown` timing/coordinates, instead of relying on the browser's own
 * native `dblclick` event.
 *
 * Background (see docs/phase5t7b_dblclick_reliability_audit.md and
 * docs/phase5t7c_pointerdown_doubleclick_design.md for the full
 * investigation): every non-composite/complex-member row is
 * `draggable="true"` on desktop (Phase 3A/4A/UXP-01/5T-2), with no minimum
 * pointer-movement guard before the browser may interpret a press+tiny-move
 * as the start of a native HTML5 drag. Real-device testing (both left- and
 * right-docked Outline Tree sidebars, heading/list/paragraph rows alike)
 * confirmed that ordinary double-click attempts were intermittently
 * swallowed at the browser level before either `click` or `dblclick` ever
 * fired — with no JS exception, matching the reported "nothing happens"
 * symptom. `pointerdown` is not subject to this: it fires unconditionally
 * on every press, whether or not the browser goes on to start a native
 * drag for that same gesture, so tracking IT instead — rather than the
 * native `dblclick` event — gives a detection path that cannot be silently
 * swallowed by drag-gesture recognition.
 *
 * This module is intentionally free of any Obsidian or DOM-global
 * dependency (no `window`, no `Date.now()`, no imported Obsidian types) so
 * it can be unit-tested directly, the same convention
 * view/outlineTreeLeafPlacement.ts already established for this kind of
 * pure view-adjacent helper.
 */

/** Two clicks starting more than this many milliseconds apart are two separate single clicks, never a double click. */
export const DOUBLE_CLICK_TIME_THRESHOLD_MS = 400;

/** Two clicks whose pointerdown coordinates differ by more than this many CSS pixels (Euclidean distance) are treated as unrelated presses, never a double click. */
export const DOUBLE_CLICK_DISTANCE_THRESHOLD_PX = 6;

/**
 * One row's `pointerdown` observation, as needed by `isDoubleClickPointerDown`.
 * `time`/`x`/`y` are always supplied by the caller (e.g. from
 * `PointerEvent.timeStamp`/`clientX`/`clientY`) — this module never reads
 * the clock or the DOM itself, so it stays trivially unit-testable.
 */
export interface RowPointerDownRecord {
  /** The logical Outline Tree node id the pointerdown landed on. */
  nodeId: string;
  /** A monotonically increasing timestamp, in milliseconds (e.g. `PointerEvent.timeStamp`). */
  time: number;
  x: number;
  y: number;
}

/**
 * Pure decision function: given the CURRENT row pointerdown and the
 * PREVIOUS one recorded on the view instance (or `null` if there wasn't
 * one, or it was already consumed), decides whether this pair constitutes
 * a "double click" on the same logical row.
 *
 * All three conditions must hold: same `nodeId`, a non-negative time delta
 * within `DOUBLE_CLICK_TIME_THRESHOLD_MS`, and a pointer displacement within
 * `DOUBLE_CLICK_DISTANCE_THRESHOLD_PX`. A negative time delta (the "current"
 * event is somehow older than the "previous" one — should never happen in
 * practice, since callers always pass the most recent observation as
 * `current`, but is checked explicitly rather than assumed) is treated as
 * "not a double click" rather than throwing.
 */
export function isDoubleClickPointerDown(
  current: RowPointerDownRecord,
  previous: RowPointerDownRecord | null
): boolean {
  if (!previous) return false;
  if (previous.nodeId !== current.nodeId) return false;
  const dt = current.time - previous.time;
  if (dt < 0 || dt > DOUBLE_CLICK_TIME_THRESHOLD_MS) return false;
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const distanceSq = dx * dx + dy * dy;
  return distanceSq <= DOUBLE_CLICK_DISTANCE_THRESHOLD_PX * DOUBLE_CLICK_DISTANCE_THRESHOLD_PX;
}

/**
 * Minimal structural type both a real DOM `Node`/`Element` and a plain test
 * double satisfy — mirrors the `LeafRootLike` pattern in
 * view/outlineTreeLeafPlacement.ts (typed structurally so this module never
 * needs to import "obsidian" or lib.dom types as a hard dependency).
 */
export interface ContainsCheckable {
  contains(node: unknown): boolean;
}

/**
 * Hit-target gate: decides whether a `pointerdown` should even be
 * CONSIDERED a row-body double-click candidate at all, independent of
 * timing. This is the pointerdown-based equivalent of the old native
 * `dblclick` listener's own `if (collapseEl.contains(evt.target)) return;`
 * guard, extended per this ticket's explicit "許可しない領域" contract to
 * also exclude the drag handle (previously NOT excluded for section/list —
 * the old dblclick listener only ever excluded collapseEl — this is a
 * deliberate, ticket-mandated tightening, not an accidental behavior
 * change) and non-primary-button/non-primary-pointer presses (right-click
 * and auxiliary-button presses are the context menu's own territory, never
 * a double-click candidate).
 *
 * `dragHandleEl` is `null` for every row that has no drag handle at all
 * (paragraph rows, and any read-only row) — in that case this check simply
 * never excludes on that basis, matching how the pre-5T-7C code never
 * needed a drag-handle exclusion for paragraph specifically (see
 * openParagraphPartialEditFromTree's own call site — paragraph rows never
 * get a `dragHandleEl` element to begin with).
 */
export function isEligibleRowBodyPointerDown(params: {
  target: unknown;
  button: number;
  isPrimary: boolean;
  collapseEl: ContainsCheckable;
  dragHandleEl: ContainsCheckable | null;
}): boolean {
  if (params.button !== 0 || !params.isPrimary) return false;
  if (params.collapseEl.contains(params.target)) return false;
  if (params.dragHandleEl && params.dragHandleEl.contains(params.target)) return false;
  return true;
}
