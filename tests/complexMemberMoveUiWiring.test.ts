/**
 * Phase 5D-3B ("Composite Member Move Menu Parity"): tests for the
 * OutlineTreeView.ts UI wiring this ticket added to showComplexMemberMenu
 * (renamed from showComplexMemberPartialEditMenu) — move up/down items,
 * independently gated by evaluateStandaloneComplexBlockMovability called
 * with `allowComposedMember: true`, added alongside the pre-existing
 * (Phase 5D-0.4) unconditional "Open in Partial Edit" items.
 *
 * ---- Scope / what this file deliberately does NOT test -----------------
 *
 * Same testing-boundary rationale as
 * tests/standaloneComplexBlockMoveUiWiring.test.ts (see that file's own
 * top doc comment, which this file mirrors closely): "obsidian" is a
 * types-only package here, so no ItemView/Menu is ever instantiated. This
 * file instead reproduces showComplexMemberMenu's exact decision sequence
 * for its Move items:
 *
 *   resolve target ComplexBlockInfo by id (from a fresh complexScan) ->
 *   evaluateStandaloneComplexBlockMovability("up"/"down", ..., true) ->
 *   (iff eligible) show that direction's item.
 *
 * Real menu-item appearance, Notice() calls, and the actual DOM
 * contextmenu dispatch are NOT exercised here and require manual
 * real-device verification instead — same precedent as every other
 * *UiWiring.test.ts file in this suite.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { evaluateStandaloneComplexBlockMovability, matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";
import { createTranslator } from "../src/i18n";

function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

function memberOf(
  composites: ReturnType<typeof matchCompositeBlocks>,
  complexScan: ComplexBlockScanResult,
  compositeIndex = 0
): ComplexBlockInfo {
  const composite = composites[compositeIndex];
  if (!composite) throw new Error(`no composite at index ${compositeIndex}`);
  // The current DEFAULT_COMPOSITE_BLOCK_RULES (image-ocr / image-quote) both
  // have a 2-element kindSequence with the callout/blockquote as the LAST
  // member — see this file's own doc comment and
  // parser/compositeBlocks.ts's own comments for why this makes Move up
  // naturally, structurally blocked (never a hardcoded rejection) for every
  // composite member under the current rule set.
  const memberId = composite.members[composite.members.length - 1].id;
  const found = complexScan.blocks.find((b) => b.id === memberId);
  if (!found) throw new Error("composite member not found in complexScan.blocks");
  return found;
}

/** Reproduces showComplexMemberMenu's exact decision: does the move-up/move-down item appear for this member? */
function wouldShowComplexMemberMoveMenuItem(
  doc: ReturnType<typeof parseDocument>,
  complexScan: ComplexBlockScanResult,
  target: ComplexBlockInfo,
  direction: "up" | "down",
  composites: ReturnType<typeof matchCompositeBlocks>
): boolean {
  return evaluateStandaloneComplexBlockMovability(doc, complexScan, target, direction, composites, true)
    .eligible;
}

describe("showComplexMemberMenu's move-item gate: Move down eligible when a genuine standalone sibling follows", () => {
  it("callout member, standalone callout sibling follows in the same (top-level) parent: move-down gates true", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const member = memberOf(composites, complexScan);
    expect(member.kind).toBe("callout");
    expect(wouldShowComplexMemberMoveMenuItem(doc, complexScan, member, "down", composites)).toBe(true);
  });

  it("blockquote member, standalone blockquote sibling follows: move-down gates true", () => {
    const text = ["- ![[scan.png]]", "> quoted transcription", "", "> another standalone quote"].join(
      "\n"
    );
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const member = memberOf(composites, complexScan);
    expect(member.kind).toBe("blockquote");
    expect(wouldShowComplexMemberMoveMenuItem(doc, complexScan, member, "down", composites)).toBe(true);
  });
});

describe("showComplexMemberMenu's move-item gate: Move up is naturally (never hardcoded) blocked in the normal 2-member composite case", () => {
  it("callout member: move-up gates false with reason no-adjacent-compatible-unit, because its own anchor list item is not itself a complex-block candidate", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const member = memberOf(composites, complexScan);
    const movability = evaluateStandaloneComplexBlockMovability(
      doc,
      complexScan,
      member,
      "up",
      composites,
      true
    );
    expect(movability.eligible).toBe(false);
    expect(movability).not.toHaveProperty("reason", "composite-member");
    if (!movability.eligible) {
      expect(movability.reason).toBe("no-adjacent-compatible-unit");
    }
    expect(wouldShowComplexMemberMoveMenuItem(doc, complexScan, member, "up", composites)).toBe(false);
  });

  it("blockquote member: move-up gates false the same way", () => {
    const text = ["- ![[scan.png]]", "> quoted transcription", "", "> another standalone quote"].join(
      "\n"
    );
    const { doc, complexScan, composites } = pipeline(text);
    const member = memberOf(composites, complexScan);
    expect(wouldShowComplexMemberMoveMenuItem(doc, complexScan, member, "up", composites)).toBe(false);
  });
});

describe("allowComposedMember is opt-in: without it (default false), the same member is still rejected with 'composite-member'", () => {
  it("omitting the 6th argument reproduces the pre-5D-3B rejection for the exact same member/direction that gates true with allowComposedMember: true", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const member = memberOf(composites, complexScan);

    // With the opt-in: eligible (already asserted above by name, re-asserted here for contrast).
    expect(
      evaluateStandaloneComplexBlockMovability(doc, complexScan, member, "down", composites, true).eligible
    ).toBe(true);

    // Without the opt-in (default false): still rejected, reason unchanged.
    const withoutOptIn = evaluateStandaloneComplexBlockMovability(
      doc,
      complexScan,
      member,
      "down",
      composites
    );
    expect(withoutOptIn.eligible).toBe(false);
    if (!withoutOptIn.eligible) {
      expect(withoutOptIn.reason).toBe("composite-member");
    }

    // Explicit false behaves identically to omitting the argument.
    const explicitFalse = evaluateStandaloneComplexBlockMovability(
      doc,
      complexScan,
      member,
      "down",
      composites,
      false
    );
    expect(explicitFalse).toEqual(withoutOptIn);
  });
});

describe("the adjacent CANDIDATE side stays standalone-only even with allowComposedMember: true", () => {
  it("a member whose only 'adjacent' neighbor is ANOTHER composite's member (not a standalone block) still gates false in that direction", () => {
    const text = [
      "- ![[scan-1.png]]",
      "> [!ocr]",
      "> body one",
      "",
      "- ![[scan-2.png]]",
      "> [!ocr]",
      "> body two",
    ].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(2);
    const firstMember = memberOf(composites, complexScan, 0);
    // The next thing after the first composite's member is a blank line,
    // then the SECOND composite's own anchor list item — not a complex
    // block at all (a "list" node) — so this remains
    // "no-adjacent-compatible-unit", exactly as the candidate-side
    // standalone-only restriction (isStandaloneComplexBlockMoveCandidate)
    // requires, unaffected by allowComposedMember.
    expect(
      wouldShowComplexMemberMoveMenuItem(doc, complexScan, firstMember, "down", composites)
    ).toBe(false);
  });
});

describe("i18n: showComplexMemberMenu's move items reuse the existing standalone move keys (no new i18n key was added for this ticket)", () => {
  it("tree.menu.standaloneMoveUp / standaloneMoveDown resolve to non-empty text in both en and ja", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("tree.menu.standaloneMoveUp").length).toBeGreaterThan(0);
    expect(en("tree.menu.standaloneMoveDown").length).toBeGreaterThan(0);
    expect(ja("tree.menu.standaloneMoveUp").length).toBeGreaterThan(0);
    expect(ja("tree.menu.standaloneMoveDown").length).toBeGreaterThan(0);
  });
});
