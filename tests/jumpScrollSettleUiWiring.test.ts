import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 26048-TECH-006: a jump into a note full of async-rendered widgets
 * (Dataview blocks) landed correctly and then drifted, because CM6
 * resolved the one-shot scrollIntoView against ESTIMATED heights for
 * content that had not rendered yet. The jump is now re-asserted for a few
 * frames while the layout settles.
 *
 * Static source checks, same constraint as the other *UiWiring tests here:
 * an ItemView subclass cannot be constructed under vitest ("obsidian" is a
 * types-only package), and this behaviour is layout-dependent besides.
 */
const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

function slice(from: string, to: string): string {
  const start = viewTs.indexOf(from);
  if (start === -1) throw new Error(`${from} not found — renamed or removed?`);
  const end = viewTs.indexOf(to, start);
  if (end === -1 || end <= start) {
    throw new Error(`Could not find ${to} after ${from} — update this test's bounding logic.`);
  }
  return viewTs.slice(start, end);
}

const settle = (): string =>
  slice("private settleJumpScroll(cm: EditorView, pos: number): void {", "/** Stops any in-flight settle loop");

describe("jump scroll settle (static source check, 26048-TECH-006)", () => {
  it("the one-shot dispatch is still made, and the settle loop follows it", () => {
    const body = slice("private scrollLineToTop(editor: Editor, line: number): void {", "private settleJumpScroll(");
    const dispatch = body.indexOf("effects: EditorView.scrollIntoView(pos, {");
    const settleCall = body.indexOf("this.settleJumpScroll(cm, pos);");
    expect(dispatch).toBeGreaterThan(-1);
    expect(settleCall).toBeGreaterThan(dispatch);
    expect(body).toContain("yMargin: this.plugin.settings.jumpScrollOffset,");
  });

  it("re-asserts the SAME target the offset defines, never a bare scrollIntoView repeat", () => {
    const body = settle();
    expect(body).toContain("cm.lineBlockAt(pos).top - this.plugin.settings.jumpScrollOffset");
    expect(body).toContain("cm.scrollDOM.scrollTop = target;");
    expect(body).toContain("Math.max(");
  });

  it("is bounded — a fixed frame budget, not an open-ended loop", () => {
    const body = settle();
    expect(body).toContain("let framesLeft = 8;");
    expect(body).toContain("if (framesLeft-- <= 0) return;");
  });

  it("stops when the document changes under it", () => {
    const body = settle();
    expect(body).toContain("const startDoc = cm.state.doc;");
    expect(body).toContain("if (cm.state.doc !== startDoc) return;");
  });

  it("yields to a scroll it did not perform, so it never fights the user", () => {
    const body = settle();
    expect(body).toContain("let lastWritten: number | null = null;");
    expect(body).toContain("if (lastWritten !== null && Math.abs(current - lastWritten) > 1) return;");
  });

  it("tolerates sub-pixel differences rather than writing every frame", () => {
    const body = settle();
    expect(body).toContain("if (Math.abs(current - target) > 1) {");
  });

  it("cancels a previous settle before starting a new one, so two jumps never race", () => {
    const body = settle();
    expect(body.indexOf("this.cancelJumpScrollSettle();")).toBeGreaterThan(-1);
    expect(body.indexOf("this.cancelJumpScrollSettle();")).toBeLessThan(body.indexOf("const startDoc"));
  });

  it("requests and cancels the frame on the EDITOR's window, which in a popout is not activeWindow", () => {
    const body = settle();
    expect(body).toContain("const win = cm.dom.win;");
    expect(body).toContain("win.requestAnimationFrame(step);");
    const cancel = slice("private cancelJumpScrollSettle(): void {", "\n  /**");
    expect(cancel).toContain("this.jumpScrollSettleWin?.cancelAnimationFrame(this.jumpScrollSettleHandle);");
    expect(cancel).not.toContain("activeWindow");
  });

  it("onClose cancels a settle in flight", () => {
    const body = slice("async onClose(): Promise<void> {", "refresh(): void {");
    expect(body).toContain("this.cancelJumpScrollSettle();");
  });
});
