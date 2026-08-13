/**
 * Phase 5D-0: Obsidian-free, pure-function matching of CompositeBlockRule
 * against an already-parsed ParsedDocument (parser/parseDocument.ts) and an
 * already-computed ComplexBlockScanResult (parser/complexBlocks.ts).
 *
 * Like parser/complexBlocks.ts, this module ONLY recognizes and groups. It
 * does not move, edit, render, or fold anything, and it introduces no new
 * IDs into ParsedDocument.nodes or ComplexBlockScanResult.blocks — a
 * CompositeBlockInfo is a read-only VIEW over ids that already exist in one
 * of those two structures. See model/compositeBlock.ts's doc comment for
 * why this is a third, separate model rather than an extension of either
 * existing one.
 *
 * ---- Candidate collection ----
 *
 * Two independent candidate pools, both restricted to blocks whose
 * boundary is confidently known:
 *   - every ListBlockNode in doc.nodes (any depth) — kind
 *     "single-line-list" when it has no continuation lines and no nested
 *     child list (range.startLine === range.endLine proves both at once),
 *     otherwise plain "list". A rule's kindSequence encodes the
 *     single-line requirement directly via which of the two kinds it asks
 *     for (Phase 5D-0.3; replaces the earlier requireSingleLineList flag).
 *   - every ComplexBlockInfo in complexScan.blocks with
 *     editability === "supported" — "ambiguous"/"unsupported"/"read-only"
 *     blocks (this always excludes "paragraph", which is never
 *     "supported" — see model/complexBlock.ts) are never composite-block
 *     candidates, matching this whole plugin's "never build on an
 *     uncertain boundary" policy.
 * The two pools are merged and sorted by range.startLine into one
 * document-order candidate list.
 *
 * ---- Matching algorithm ----
 *
 * A single left-to-right pass over the sorted candidate list. At each
 * unconsumed candidate index i, try every rule in the CALLER-SUPPLIED order
 * (which doubles as priority order — see this function's own doc comment
 * below) and accept the FIRST one whose kindSequence matches starting at i,
 * subject to every one of the required conditions below. On a match, every
 * consumed candidate index is marked used (so it can never join a second
 * CompositeBlock) and the scan resumes just past the match; on no match,
 * the scan simply advances to i + 1.
 *
 * Required conditions (see
 * docs/phase5d0_basic-block-extension-and-composite-block-spec.md §3.4):
 *   1. Every member is already a confirmed candidate (see above) — no
 *      re-parsing happens here.
 *   2. The candidate kinds starting at i equal rule.kindSequence exactly,
 *      in document order.
 *   3. No blank line — in fact no gap at all — between consecutive
 *      members: member[k+1].range.startLine must equal
 *      member[k].range.endLine + 1. A rule never matches across a blank
 *      line, matching the ticket's "空行を挟む block 列は複合化しない".
 *   4. Every member resolves (via resolveMemberSectionId, below) to the
 *      SAME enclosing section id (both being null — no enclosing heading —
 *      also counts as "the same").
 *   5. Member ranges never overlap — guaranteed by construction here since
 *      a matched candidate index is immediately marked consumed and a
 *      strict start-line ordering + zero-gap-adjacency check (condition 3)
 *      already rules out overlap between the members of ONE match; across
 *      different matches, the shared `consumed` set prevents any candidate
 *      index — and therefore its range — from being reused.
 *   6. No candidate participates in more than one CompositeBlock — the
 *      `consumed` set enforces this directly.
 *   7. When multiple rules could match at the same starting candidate, only
 *      the highest-priority one (first in the caller's `rules` array) is
 *      used — enforced by trying rules in array order and stopping at the
 *      first full match.
 */
import { isListNode, LineRange, ParsedDocument } from "../model/block";
import { BlockDiagnostic, ComplexBlockScanResult } from "../model/complexBlock";
import {
  CompositeBlockDeletability,
  CompositeBlockDeleteRejectionReason,
  CompositeBlockInfo,
  CompositeBlockMember,
  CompositeBlockRejection,
  CompositeBlockRule,
  CompositeMemberKind,
} from "../model/compositeBlock";

interface Candidate {
  kind: CompositeMemberKind;
  id: string;
  startLine: number;
  endLine: number;
}

/**
 * Nearest enclosing SECTION id for a line, walking BlockNode.parentId from
 * that line's immediate owner (doc.lineToOwningNodeId — the same ground
 * truth every other scanner in this codebase already trusts, see
 * parser/complexBlocks.ts's own top doc comment) up until a "section"-typed
 * node is reached, or the chain runs out (null — legitimately "no
 * enclosing heading", e.g. content before the document's first heading).
 * Deliberately reimplemented here (rather than importing
 * move/resolveMoveTarget.ts's equivalent) to keep parser/* free of any
 * dependency on the move/ layer, which itself already depends on parser/*
 * — importing the other way would invert that layering.
 */
function resolveMemberSectionId(doc: ParsedDocument, startLine: number): string | null {
  let id: string | null = doc.lineToOwningNodeId[startLine] ?? null;
  const visited = new Set<string>();
  while (id) {
    if (visited.has(id)) return null; // defensive: never trust a cycle
    visited.add(id);
    const node = doc.nodes.get(id);
    if (!node) return null;
    if (node.type === "section") return node.id;
    id = node.parentId;
  }
  return null;
}

function collectCandidates(doc: ParsedDocument, complexScan: ComplexBlockScanResult): Candidate[] {
  const candidates: Candidate[] = [];
  for (const node of doc.nodes.values()) {
    if (isListNode(node)) {
      // Phase 5D-0.3: every ListBlockNode is classified as EITHER
      // "single-line-list" (no continuation lines, no nested child list —
      // range.startLine === range.endLine proves both at once, same as the
      // former requireSingleLineList check) OR plain "list". A rule now
      // encodes the single-line constraint directly in its kindSequence
      // (e.g. ["single-line-list", "callout"]) instead of a separate
      // boolean flag, so each list candidate can only ever match ONE of
      // the two kinds — never both.
      const kind: CompositeMemberKind =
        node.range.startLine === node.range.endLine ? "single-line-list" : "list";
      candidates.push({ kind, id: node.id, startLine: node.range.startLine, endLine: node.range.endLine });
    }
  }
  for (const block of complexScan.blocks) {
    if (block.editability !== "supported") continue;
    candidates.push({ kind: block.kind, id: block.id, startLine: block.range.startLine, endLine: block.range.endLine });
  }
  candidates.sort((a, b) => a.startLine - b.startLine);
  return candidates;
}

/**
 * Matches `rules` (tried in array order = priority order — pass only the
 * rules that should currently be considered, e.g. via
 * settingsDefaults.ts's getEnabledCompositeBlockRules) against `doc` and
 * `complexScan`. See this module's top doc comment for the full algorithm
 * and required conditions.
 */
export function matchCompositeBlocks(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  rules: CompositeBlockRule[]
): CompositeBlockInfo[] {
  const candidates = collectCandidates(doc, complexScan);
  const consumed = new Set<number>();
  const results: CompositeBlockInfo[] = [];
  let seq = 0;

  for (let i = 0; i < candidates.length; i++) {
    if (consumed.has(i)) continue;

    let matched: { rule: CompositeBlockRule; indices: number[] } | null = null;

    for (const rule of rules) {
      const len = rule.kindSequence.length;
      if (len < 2 || i + len > candidates.length) continue;

      const indices: number[] = [];
      let ok = true;
      for (let k = 0; k < len; k++) {
        const idx = i + k;
        if (consumed.has(idx)) {
          ok = false;
          break;
        }
        const cand = candidates[idx];
        if (cand.kind !== rule.kindSequence[k]) {
          ok = false;
          break;
        }
        indices.push(idx);
      }
      if (!ok) continue;

      // Condition 3: zero-gap adjacency between consecutive members.
      for (let k = 1; k < indices.length; k++) {
        const prev = candidates[indices[k - 1]];
        const curr = candidates[indices[k]];
        if (curr.startLine !== prev.endLine + 1) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      // Condition 4: every member shares one enclosing section.
      const sectionIds = indices.map((idx) => resolveMemberSectionId(doc, candidates[idx].startLine));
      if (!sectionIds.every((s) => s === sectionIds[0])) continue;

      matched = { rule, indices };
      break; // highest-priority matching rule wins (condition 7).
    }

    if (!matched) continue;

    for (const idx of matched.indices) consumed.add(idx);
    const members: CompositeBlockMember[] = matched.indices.map((idx) => {
      const c = candidates[idx];
      return { kind: c.kind, id: c.id, range: { startLine: c.startLine, endLine: c.endLine } };
    });
    results.push({
      id: `composite-${seq++}`,
      ruleId: matched.rule.id,
      range: { startLine: members[0].range.startLine, endLine: members[members.length - 1].range.endLine },
      members,
      sectionId: resolveMemberSectionId(doc, members[0].range.startLine),
    });
  }

  return results;
}

// ---- Phase 5C-1 ticket 1: CompositeBlock delete-eligibility ---------------
//
// The functions below answer a DIFFERENT question than everything above
// this line: matchCompositeBlocks only ever asks "is this a
// CompositeBlock" (recognition). evaluateCompositeBlockDeletability asks
// "may this SPECIFIC, already-recognized CompositeBlock be safely deleted
// as one unit" — a strictly narrower, independently re-checked question.
// See model/compositeBlock.ts's CompositeBlockDeletability doc comment for
// why this is a third concern (alongside "recognized" and "renderable",
// the latter being tree/buildOutlineTree.ts's isCompositeSafelyProjectable)
// that must not be blurred with either of the other two.
//
// This ticket adds NO delete implementation (no edit/deleteCompositeBlock.ts,
// no doc.lines mutation of any kind) and is not called from
// view/OutlineTreeView.ts, any context menu, or any command — it exists so
// a LATER ticket has a single, already-vetted, independently-testable
// safety gate to consult before ever touching the note's text.

/**
 * True when any diagnostic in `diagnostics` overlaps `range` AND that
 * diagnostic is about THIS block's own boundary, not merely a lower-priority
 * candidate that lost to it. Deliberately EXCLUDES `kind === "overlapping-range"`:
 * that diagnostic kind is emitted by parser/complexBlocks.ts's own
 * mergeBlockRangesSafely against the LOSING (lower-priority, downgraded)
 * candidate's range, not the winning "supported" block's — and because
 * scanParagraphBlocks is a catch-all that "does NOT exclude quote-prefixed
 * or pipe-table-row-shaped lines" (see that function's own doc comment), a
 * perfectly healthy, still-`"supported"` callout/blockquote/table has an
 * "overlapping-range" diagnostic recorded against its own range EVERY TIME
 * the paragraph scanner also produced a (losing) candidate over the same
 * lines — which is the ordinary, expected case for these three kinds, not
 * an edge case. Treating that diagnostic as disqualifying would reject
 * nearly every real callout/blockquote/table composite member, which is
 * not what "diagnosticsを持つblockを拒否する" was asking for.
 *
 * Every OTHER diagnostic kind ("unterminated-fence", "unsupported-callout-nesting",
 * "malformed-table", the boundary-crossing "ambiguous") is, by construction,
 * always pushed in the exact same branch that also downgrades THAT block's
 * own `editability` away from `"supported"` (see parser/complexBlocks.ts's
 * scanners) — so for a block that already passed the `editability ===
 * "supported"` check above, none of these should ever be found overlapping
 * it either. This function still checks independently (rather than
 * skipping the check entirely) as defense-in-depth against a future
 * scanner change that adds a new diagnostic-producing path without also
 * downgrading editability in the same step.
 */
function hasOverlappingDiagnostic(diagnostics: BlockDiagnostic[], range: LineRange): boolean {
  return diagnostics.some(
    (d) => d.kind !== "overlapping-range" && d.fromLine <= range.endLine && range.startLine <= d.toLine
  );
}

/**
 * Evaluates whether `composite` (an already-matched CompositeBlockInfo, as
 * produced by matchCompositeBlocks over the SAME `doc`/`complexScan`) may
 * be safely deleted as one unit, per Phase 5C-1 ticket 1's approved
 * condition set. Every condition below is re-derived independently from
 * `doc`/`complexScan` — this function does NOT simply trust that
 * `composite` was produced by matchCompositeBlocks (a future caller could
 * pass a stale or hand-built CompositeBlockInfo), matching this whole
 * codebase's "never guess, always re-verify against the current ground
 * truth" policy (see e.g. tree/buildOutlineTree.ts's
 * isCompositeSafelyProjectable, edit/partialEdit.ts's re-extract-and-compare
 * conflict check).
 *
 * A composite is deletable only when EVERY member independently satisfies
 * ALL of the following (checked in the order below; the FIRST failing
 * member/condition determines the single reported reason — this function
 * does not attempt to collect every violation at once, matching every
 * other rejection-reporting function in this codebase, e.g.
 * parser/complexBlocks.ts's resolveParentId):
 *
 *   1. The member itself resolves: a "list"/"single-line-list" member must
 *      resolve in `doc.nodes` to an actual ListBlockNode; a
 *      "callout"/"blockquote"/"fenced-code"/"table" member must resolve in
 *      `complexScan.blocks` to an actual ComplexBlockInfo. Otherwise:
 *      "member-resolve-failed".
 *   2. The member's KIND is one Phase 5C-1 ticket 1 supports deleting:
 *      "list"/"single-line-list" (the anchor list item itself, always
 *      deleted along with the rest of the composite) or one of "callout" /
 *      "blockquote" / "fenced-code" (including Mermaid — a fenced-code
 *      block's `infoString` never changes this evaluation) / "table".
 *      "paragraph" (always editability "read-only", never a genuine delete
 *      candidate per docs/mixed-structure-spec.md §6) and any other kind
 *      (e.g. a future "section"/"thematic-break" composite member) are
 *      rejected as "unsupported-member-kind" — deliberately explicit here
 *      rather than merely falling out of the editability check below, so a
 *      future new ComplexBlockKind is rejected by default until this
 *      function is revisited, not silently accepted.
 *   3. For a "list"/"single-line-list" member: `unsafeIndent` must be
 *      false. Not explicitly requested by this ticket's own condition
 *      list, but added as defense-in-depth for consistency with every
 *      other list-mutating module in this codebase (move/relocateListSubtree.ts,
 *      edit/partialEdit.ts's extractSubtreeText, edit/insertBlock.ts's
 *      insertChildListItem all refuse mixed tab/space indentation the same
 *      way) — flagged explicitly in this ticket's completion report as an
 *      addition beyond the literal request, not a silent scope change.
 *      Otherwise: "member-unsafe-indent".
 *   4. For a "callout"/"blockquote"/"fenced-code"/"table" member:
 *      `editability === "supported"` (excludes nested callout, unterminated
 *      fence, malformed table, boundary-ambiguous, and overlapping-range
 *      downgrades in one check — see parser/complexBlocks.ts's own
 *      editability assignment). Otherwise: "member-not-supported".
 *   5. For the same complex-kind members: no diagnostic in
 *      `complexScan.diagnostics` overlaps the member's own range (see
 *      hasOverlappingDiagnostic's doc comment for why this is checked
 *      independently of step 4 rather than assumed to be implied by it).
 *      Otherwise: "member-has-diagnostic".
 *   6. The member's resolved owner (a "list"/"single-line-list" member's
 *      BlockNode.parentId; a complex-kind member's ComplexBlockInfo.parentId)
 *      must NOT itself be a "list"-typed node — i.e. the member must sit
 *      directly under its enclosing SECTION (or under no section at all,
 *      top-of-document), never nested inside another list item's
 *      continuation. This is what "単一 section 内・トップレベル相当" means
 *      operationally, and is what excludes a CompositeBlock whose anchor
 *      list item (or a complex-kind member) is itself a nested list child —
 *      see this ticket's completion report for why this narrower first
 *      deletable set was chosen over also supporting nested-in-list
 *      composites immediately. Otherwise: "nested-in-list".
 *
 * After every member individually passes 1–6, one FINAL composite-level
 * check: every member's resolved owner (section id, or null for
 * top-of-document) must be the SAME across all members — re-deriving
 * matchCompositeBlocks's own "same enclosing section" requirement
 * independently, rather than trusting `composite.sectionId` (which was
 * computed by a different code path, at match time, potentially against a
 * stale `doc`/`complexScan` if the caller didn't pass the matching pair).
 * A disagreement here is reported as "ambiguous-section" and — unlike every
 * per-member reason above — is NOT attributed to any single
 * `offendingMemberId`, since the fault is the disagreement itself, not any
 * one member.
 */
export function evaluateCompositeBlockDeletability(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  composite: CompositeBlockInfo
): CompositeBlockDeletability {
  const ownerIds = new Set<string | null>();

  for (const member of composite.members) {
    let ownerId: string | null;

    if (member.kind === "list" || member.kind === "single-line-list") {
      const node = doc.nodes.get(member.id);
      if (!node || !isListNode(node)) {
        return { deletable: false, reason: "member-resolve-failed", offendingMemberId: member.id };
      }
      if (node.unsafeIndent) {
        return { deletable: false, reason: "member-unsafe-indent", offendingMemberId: member.id };
      }
      ownerId = node.parentId;
    } else if (
      member.kind === "callout" ||
      member.kind === "blockquote" ||
      member.kind === "fenced-code" ||
      member.kind === "table"
    ) {
      const info = complexScan.blocks.find((b) => b.id === member.id);
      if (!info) {
        return { deletable: false, reason: "member-resolve-failed", offendingMemberId: member.id };
      }
      if (info.editability !== "supported") {
        return { deletable: false, reason: "member-not-supported", offendingMemberId: member.id };
      }
      if (hasOverlappingDiagnostic(complexScan.diagnostics, info.range)) {
        return { deletable: false, reason: "member-has-diagnostic", offendingMemberId: member.id };
      }
      ownerId = info.parentId;
    } else {
      // "paragraph", "thematic-break", "section", or any future kind not
      // explicitly handled above — see condition 2's doc comment.
      return { deletable: false, reason: "unsupported-member-kind", offendingMemberId: member.id };
    }

    const ownerNode = ownerId ? doc.nodes.get(ownerId) : null;
    if (ownerNode && ownerNode.type === "list") {
      return { deletable: false, reason: "nested-in-list", offendingMemberId: member.id };
    }

    ownerIds.add(ownerId ?? null);
  }

  if (ownerIds.size !== 1) {
    return { deletable: false, reason: "ambiguous-section" };
  }

  return { deletable: true };
}

/** Human-readable (English) explanation for one CompositeBlockDeleteRejectionReason, used by describeCompositeBlockRejection below. Mirrors parser/complexBlocks.ts's inline reason strings in style (short, developer/Notice-facing, not yet localized — same as every other pre-i18n `reason` string this codebase already carries, e.g. edit/deleteBlock.ts's NoDeleteReason consumers). */
function describeDeleteRejectionReason(
  reason: CompositeBlockDeleteRejectionReason,
  offendingMemberId: string | undefined
): string {
  const member = offendingMemberId ?? "?";
  switch (reason) {
    case "member-resolve-failed":
      return `composite block member ${member} could not be resolved in the current document`;
    case "member-not-supported":
      return `composite block member ${member} is not a safely-bounded ("supported") block`;
    case "member-has-diagnostic":
      return `composite block member ${member} has an unresolved diagnostic`;
    case "member-unsafe-indent":
      return `composite block member ${member} has mixed tab/space indentation`;
    case "unsupported-member-kind":
      return `composite block member ${member} is a kind Phase 5C-1 does not support deleting (e.g. paragraph)`;
    case "nested-in-list":
      return `composite block member ${member} is nested inside another list item; deletion is limited to top-level/single-section composites in this phase`;
    case "ambiguous-section":
      return "composite block members do not agree on a single enclosing section";
  }
}

/**
 * Phase 5C-1 ticket 1 safety helper for a FUTURE caller (e.g. a Tree
 * context menu that might one day gate a "Delete composite block" item),
 * mirroring parser/complexBlocks.ts's describeComplexBlockRejection exactly
 * — same `{blocked:false}` for "this id isn't a recognized CompositeBlock
 * at all" vs. `{blocked:true, ...}` for "this id IS a recognized
 * CompositeBlock, but evaluateCompositeBlockDeletability rejects it"
 * convention. This function adds NO new runtime path into any editing
 * module (nothing in view/OutlineTreeView.ts or edit/* calls it yet); it
 * exists purely so a later ticket can distinguish the two cases above
 * before attempting any deletion.
 *
 * `composites` is typically whatever matchCompositeBlocks(doc, complexScan,
 * enabledRules) already returned for this exact `doc`/`complexScan` pair
 * (the same value view/OutlineTreeView.ts#refresh() already computes) —
 * this function does no matching of its own.
 */
export function describeCompositeBlockRejection(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  composites: CompositeBlockInfo[],
  compositeId: string
): CompositeBlockRejection {
  const composite = composites.find((c) => c.id === compositeId);
  if (!composite) return { blocked: false };

  const result = evaluateCompositeBlockDeletability(doc, complexScan, composite);
  if (result.deletable) return { blocked: false };

  return {
    blocked: true,
    ruleId: composite.ruleId,
    reason: describeDeleteRejectionReason(result.reason as CompositeBlockDeleteRejectionReason, result.offendingMemberId),
  };
}
