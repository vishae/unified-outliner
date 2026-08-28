/**
 * Phase 5C-4 (2026-08-14, "Standalone Callout / Blockquote の Partial Edit
 * Popout 完成と元ノート同一性の安全化"): tests for the "Open in new window"
 * item this ticket added to OutlineTreeView.ts's
 * showStandaloneComplexBlockMenu, and a regression pin confirming the
 * three OTHER per-kind menu builders (showStructureCommandMenu /
 * showListCommandMenu / showCompositeCommandMenu) were not touched by this
 * ticket.
 *
 * Phase 5D-2A ("Atomic CompositeBlock Partial Edit", later) DID
 * legitimately touch showCompositeCommandMenu — it added the composite
 * PARENT node's own new "Open extended block in partial edit" entry point
 * (activatePartialEditViewForComposite). The regression pin below is
 * updated in place to assert the new, correct boundary (that addition
 * happened, but with no openInNewWindow popout variant) rather than
 * reverted — see this file's own updated doc comment on that test.
 *
 * ---- Scope / what this file deliberately does NOT test -----------------
 *
 * Same testing-boundary rationale as every other *UiWiring.test.ts file in
 * this suite (see e.g. tests/standaloneComplexBlockUiWiring.test.ts's own
 * top doc comment): "obsidian" is a types-only package in this project, so
 * no ItemView/Menu is ever instantiated here. showStandaloneComplexBlockMenu
 * itself has NO conditional logic for the new item to reproduce — it is
 * unconditionally added, exactly like the pre-existing "Open in Partial
 * Edit" item right above it (see this ticket's own approved scope: no new
 * eligibility gate) — so what this file actually verifies is a bounded,
 * static source-text check on src/view/OutlineTreeView.ts itself, mirroring
 * tests/commandTable.test.ts's own established pattern for the same
 * "cannot construct the real class in vitest" constraint. Real menu-item
 * appearance, DOM contextmenu dispatch, and the actual popout window
 * behavior are NOT exercised here and require manual desktop verification
 * instead (see this ticket's own real-device checklist).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "../src/i18n";

const SOURCE_PATH = path.resolve(__dirname, "../src/view/OutlineTreeView.ts");
const source = readFileSync(SOURCE_PATH, "utf-8");

const SIGNATURES = {
  structure: "private showStructureCommandMenu(evt: MouseEvent, sectionId: string): void {",
  list: "private showListCommandMenu(evt: MouseEvent, listId: string): void {",
  composite: "private showCompositeCommandMenu(evt: MouseEvent, compositeId: string): void {",
  standalone: "private showStandaloneComplexBlockMenu(evt: MouseEvent, nodeId: string): void {",
} as const;

/**
 * Bounds one of the four per-kind menu builder methods' own body, from its
 * signature up to (but not including) the NEXT of these four signatures
 * that appears later in the file — mirrors commandTable.test.ts's own
 * "indexOf a known start, indexOf a known end" bounding approach, adapted
 * to four sequential methods instead of one.
 *
 * Every one of these methods is preceded by its own multi-line `/** ... * /`
 * doc comment (2-space indented), which — being textually BEFORE the next
 * method's signature — would otherwise end up appended onto the END of the
 * PRECEDING method's slice (these doc comments themselves mention strings
 * like "activatePartialEditView"/"openInNewWindow" in prose, e.g.
 * showStandaloneComplexBlockMenu's own Phase 5C-4 doc comment, which would
 * make showCompositeCommandMenu's slice spuriously "contain" those strings
 * even though its own executable body never does). Trimming back to the
 * last `\n  /**` before the next signature excludes that leading comment
 * from the current method's own slice.
 */
function methodBody(name: keyof typeof SIGNATURES): string {
  const signature = SIGNATURES[name];
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(
      `${signature} not found in src/view/OutlineTreeView.ts — has it been renamed or removed?`
    );
  }
  const laterStarts = Object.values(SIGNATURES)
    .map((sig) => source.indexOf(sig, start + signature.length))
    .filter((idx) => idx !== -1);
  const nextSignatureStart = laterStarts.length > 0 ? Math.min(...laterStarts) : source.length;
  const precedingCommentStart = source.lastIndexOf("\n  /**", nextSignatureStart);
  const end =
    precedingCommentStart > start ? precedingCommentStart : nextSignatureStart;
  return source.slice(start, end);
}

describe("showStandaloneComplexBlockMenu: 'Open in new window' item (Phase 5C-4)", () => {
  it("the method exists in src/view/OutlineTreeView.ts", () => {
    expect(source).toContain(SIGNATURES.standalone);
  });

  it("unconditionally reuses tree.menu.openPartialEditPaneNewWindow and calls activatePartialEditView with openInNewWindow: true", () => {
    const body = methodBody("standalone");
    expect(body).toContain('this.plugin.t("tree.menu.openPartialEditPaneNewWindow")');
    expect(body).toContain("activatePartialEditView(nodeId, { openInNewWindow: true })");
  });

  it("still unconditionally shows the pre-existing 'Open in Partial Edit' item alongside the new one (no eligibility gate added to either)", () => {
    const body = methodBody("standalone");
    expect(body).toContain('this.plugin.t("tree.menu.openPartialEditPane")');
    expect(body).toContain("activatePartialEditView(nodeId)");
  });
});

describe("regression: the other three per-kind menu builders are unaffected by this ticket", () => {
  // Phase 5D-2A ("Atomic CompositeBlock Partial Edit") later gave
  // showCompositeCommandMenu its OWN new, single entry point —
  // activatePartialEditViewForComposite, via the "Open extended block in
  // partial edit" item — deliberately WITHOUT an "open in new window"
  // popout counterpart (the ticket added exactly one new entry point, not
  // two). This pin is updated in place (not reverted) to reflect that
  // intentional, later, explicitly-approved addition — see
  // tests/compositeBlockPartialEditUiWiring.test.ts for that ticket's own
  // full wiring coverage. What this test still pins down is the original
  // Phase 5C-4 scope boundary: no openInNewWindow popout variant, and no
  // reuse of the BARE activatePartialEditView(nodeId) entry point that
  // section/list/standalone rows use.
  it("showCompositeCommandMenu (composite rows) gained activatePartialEditViewForComposite (Phase 5D-2A) but still has no openInNewWindow popout variant and never reuses the bare activatePartialEditView(id) entry point", () => {
    const body = methodBody("composite");
    expect(body).not.toContain("openInNewWindow");
    expect(body).toContain("activatePartialEditViewForComposite");
    expect(body).not.toMatch(/activatePartialEditView\(\s*(compositeId|nodeId|snapshot)\s*\)/);
  });

  it("showStructureCommandMenu (section rows) still has its own pre-existing popout item, unchanged", () => {
    const body = methodBody("structure");
    expect(body).toContain('this.plugin.t("tree.menu.openPartialEditPaneNewWindow")');
    expect(body).toContain("activatePartialEditView(sectionId, { openInNewWindow: true })");
  });

  it("showListCommandMenu (list rows) still has its own pre-existing popout item, unchanged", () => {
    const body = methodBody("list");
    expect(body).toContain('this.plugin.t("tree.menu.editListSubtreeInNewWindow")');
    expect(body).toContain("activatePartialEditView(listId, { openInNewWindow: true })");
  });
});

describe("i18n: the reused key resolves in both locales (no new menu-label key was added for this ticket)", () => {
  it("tree.menu.openPartialEditPaneNewWindow resolves to non-empty text in en and ja", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("tree.menu.openPartialEditPaneNewWindow").length).toBeGreaterThan(0);
    expect(ja("tree.menu.openPartialEditPaneNewWindow").length).toBeGreaterThan(0);
  });
});
