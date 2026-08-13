/**
 * Phase 5C-1 ticket 4-2 (2026-08-14): resolves the full swap TARGET for a
 * CompositeBlock move, given that ticket 4-1's
 * parser/compositeBlocks.ts#evaluateCompositeBlockMovability has already
 * confirmed a move in that direction is eligible.
 *
 * Responsibility split (by design, per this ticket's approval):
 *   - evaluateCompositeBlockMovability (4-1) is the JUDGE: "may this
 *     composite move in this direction", with an explainable rejection
 *     reason when not.
 *   - findCompositeMoveTarget (this file, 4-2) is the RESOLVER: "given that
 *     it may, what is the exact LineRange to swap it with".
 * This module calls evaluateCompositeBlockMovability itself, as the very
 * first thing it does, and returns `null` immediately when it says
 * `eligible: false` — it never re-derives an equivalent judgment
 * independently (that would risk drifting out of sync with 4-1's own
 * condition list over time). The actual adjacency scan this module needs
 * to build the full target (not just a yes/no answer) reuses ticket 4-1's
 * OWN exported primitives (parser/compositeBlocks.ts's `skipBlankLines` and
 * `findAdjacentAnchorNode`) rather than a second, independently-written
 * implementation — see those functions' own doc comments for why they were
 * exported. Re-running the same scan a second time (once inside
 * evaluateCompositeBlockMovability, once again here) is deliberate, not
 * wasteful: it mirrors this whole codebase's established "never guess,
 * always re-verify against current ground truth" policy (e.g.
 * edit/deleteCompositeBlock.ts's own re-parse/re-scan/re-match pipeline).
 *
 * ---- Composite-widening ----
 *
 * Phase 5C's CompositeBlock model is deliberately "atomic": a callout,
 * blockquote, fenced-code, or table member is never decomposed or
 * partially edited — see model/compositeBlock.ts's own top doc comment.
 * When the resolved adjacent anchor list item turns out to itself be
 * ANOTHER CompositeBlock's own `members[0]`, swapping just that ONE list
 * item's own (single) line would silently tear that composite apart,
 * leaving its callout/blockquote member orphaned in the wrong position.
 * findCompositeMoveTarget therefore always widens such a target to that
 * OTHER composite's own full `range` — never a member's own narrower
 * range — before returning it. A plain (non-composite) adjacent list item
 * is returned using its own `range` as-is (which, for a multi-line list
 * item with nested children, already spans its whole subtree — see
 * model/block.ts's BaseBlockNode doc comment — no separate widening step
 * is needed for that case).
 *
 * ---- What this module does NOT do ----
 *
 * No doc.lines mutation, no move/moveBlock.ts#swapBlocks call, no command
 * wiring, no Notice, no drag & drop integration — this ticket resolves
 * WHICH range to swap with, nothing more. Actually performing the swap
 * (including blank-line/gap preservation, re-parse, and full no-op-on-
 * failure semantics) is ticket 4-3's job.
 */
import { LineRange, ParsedDocument } from "../model/block";
import { ComplexBlockScanResult } from "../model/complexBlock";
import { CompositeBlockInfo } from "../model/compositeBlock";
import { evaluateCompositeBlockMovability, findAdjacentAnchorNode, skipBlankLines } from "../parser/compositeBlocks";

/** "up" | "down" — re-exported locally to avoid a dependency on move/findMoveTarget.ts's own MoveDirection for this narrower, composite-specific API. */
export type CompositeMoveDirection = "up" | "down";

/**
 * The resolved swap target for a CompositeBlock move.
 *
 *   - `range`: the FULL LineRange to swap with — either the plain adjacent
 *     list item's own range, or (composite-widening) the whole adjacent
 *     CompositeBlock's own range. Reuses model/block.ts's LineRange
 *     (0-based, both ends inclusive) rather than introducing a new range
 *     type — the same convention CompositeBlockInfo.range,
 *     CompositeBlockMember.range, and every edit/move module in this
 *     codebase already share.
 *   - `anchorNodeId`: the adjacent ListBlockNode's own id — the SAME node
 *     findAdjacentAnchorNode resolved, regardless of whether `kind` ends up
 *     "list-item" or "composite". Useful for a future caller (ticket 4-3)
 *     that wants to re-verify this exact node still exists/still anchors
 *     the same composite (if any) at the moment it actually applies the
 *     swap, mirroring CompositeBlockSnapshot's own re-verification style.
 *   - `kind`: "list-item" when the target is a plain (non-composite)
 *     adjacent list item; "composite" when composite-widening occurred.
 *   - `compositeId`: present only when `kind === "composite"` — the
 *     widened-to CompositeBlock's own id.
 */
export interface CompositeMoveTarget {
  range: LineRange;
  anchorNodeId: string;
  kind: "list-item" | "composite";
  compositeId?: string;
}

/**
 * Resolves the swap target for moving `composite` in `direction`, or
 * `null` when no safe target can be determined. Steps:
 *
 *   1. Defer entirely to evaluateCompositeBlockMovability (ticket 4-1) for
 *      eligibility. `eligible: false` (any reason) -> `null`, immediately,
 *      with no further work — see this module's top doc comment for why
 *      this judgment is never re-derived independently here.
 *   2. Re-run the SAME adjacency scan 4-1 itself performed
 *      (skipBlankLines + findAdjacentAnchorNode, both imported from
 *      parser/compositeBlocks.ts) to obtain the actual adjacent
 *      ListBlockNode — `eligible: true` guarantees this succeeds, but the
 *      result is still defensively null-checked rather than assumed (`!`),
 *      matching this codebase's style of never trusting an invariant it
 *      does not itself just re-verify.
 *   3. Defense-in-depth: refuse (return `null`) if the resolved anchor
 *      turns out to be one of `composite`'s OWN members — structurally
 *      unreachable, since the scan in step 2 starts strictly outside
 *      `composite.range`, but checked explicitly anyway (mirrors
 *      evaluateCompositeBlockDeletability/Movability's own "checked anyway
 *      as defense-in-depth" style for structurally-unreachable branches).
 *   4. Resolve composite ownership of the anchor: does the anchor's own id
 *      equal `members[0].id` of some OTHER entry in `allComposites`? A
 *      list node can be the `members[0]` of at most ONE CompositeBlock by
 *      construction (matchCompositeBlocks's own `consumed` set — see that
 *      function's doc comment), so this is expected to find at most one
 *      match; if it somehow finds more than one (a hand-built/inconsistent
 *      `allComposites` input, never producible by a real
 *      matchCompositeBlocks call), this is treated as an unresolvable
 *      ambiguity and rejected (`null`) rather than guessed — per this
 *      ticket's explicit "推測せず null を返す" requirement.
 *   5. No owning composite found -> `kind: "list-item"`, `range` = the
 *      anchor's own range. Exactly one owning composite found ->
 *      composite-widening: `kind: "composite"`, `range` = that composite's
 *      own full range, `compositeId` = its id.
 */
export function findCompositeMoveTarget(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  composite: CompositeBlockInfo,
  direction: CompositeMoveDirection,
  allComposites: CompositeBlockInfo[]
): CompositeMoveTarget | null {
  const movability = evaluateCompositeBlockMovability(doc, complexScan, composite, direction, allComposites);
  if (!movability.eligible) {
    return null;
  }

  const boundaryLine = direction === "up" ? composite.range.startLine - 1 : composite.range.endLine + 1;
  const k = skipBlankLines(doc, boundaryLine, direction);
  if (k === null) {
    // Structurally unreachable given eligible === true — defensive only.
    return null;
  }

  const anchor = findAdjacentAnchorNode(doc, allComposites, k, direction);
  if (!anchor) {
    // Structurally unreachable given eligible === true — defensive only.
    return null;
  }

  // Defense-in-depth: never target a member of the composite being moved
  // (see this function's own doc comment, step 3).
  if (composite.members.some((m) => m.id === anchor.id)) {
    return null;
  }

  const owningComposites = allComposites.filter(
    (c) => c.id !== composite.id && c.members[0]?.id === anchor.id
  );
  if (owningComposites.length > 1) {
    // Ambiguous ownership — never producible by a real matchCompositeBlocks
    // call (see this function's own doc comment, step 4), but refused
    // rather than guessed.
    return null;
  }

  const owningComposite = owningComposites[0];
  if (owningComposite) {
    return {
      range: { startLine: owningComposite.range.startLine, endLine: owningComposite.range.endLine },
      anchorNodeId: anchor.id,
      kind: "composite",
      compositeId: owningComposite.id,
    };
  }

  return {
    range: { startLine: anchor.range.startLine, endLine: anchor.range.endLine },
    anchorNodeId: anchor.id,
    kind: "list-item",
  };
}
