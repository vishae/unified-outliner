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
    expect(body).toContain("this.plugin.settings.jumpScrollOffset");
    expect(body).toContain("cm.scrollDOM.scrollTop = Math.max(0, cm.scrollDOM.scrollTop + drift);");
  });

  it("corrects by a measured on-screen delta, not an absolute scrollTop from block.top", () => {
    // block.top is relative to the top of the DOCUMENT; the scroller's own
    // top is elsewhere, because Obsidian gives .cm-content a large top
    // padding. Subtracting the two coordinate spaces added that padding to
    // every downward jump.
    const body = settle();
    expect(body).toContain("const lineViewportY = cm.documentTop + cm.lineBlockAt(pos).top;");
    expect(body).toContain("const scrollerViewportY = cm.scrollDOM.getBoundingClientRect().top;");
    expect(body).toContain("lineViewportY - scrollerViewportY - this.plugin.settings.jumpScrollOffset");
    expect(body).not.toContain("cm.lineBlockAt(pos).top - this.plugin.settings.jumpScrollOffset");
  });

  it("watches the editor's rendered height instead of guessing at a duration", () => {
    const body = settle();
    expect(body).toContain("observer.observe(cm.contentDOM);");
    expect(body).not.toContain("framesLeft");
    expect(body).not.toContain("deadline");
  });

  it("uses the editor window's own ResizeObserver, not the global one", () => {
    // A constructor from another realm observes nothing — and in a popout
    // the editor's window is not this one.
    const body = settle();
    expect(body).toContain(".ResizeObserver;");
    expect(body).toContain("new ResizeObserverCtor(");
  });

  it("stops after a quiet period and under a hard cap, so nothing is held indefinitely", () => {
    const body = settle();
    expect(body).toContain("const QUIET_MS = 1200;");
    expect(body).toContain("const HARD_CAP_MS = 8000;");
    expect(body).toContain("quietTimer = win.setTimeout(finish, QUIET_MS);");
    expect(body).toContain("win.performance.now() > hardCap");
  });

  it("corrects on a frame rather than inside the observer callback", () => {
    const body = settle();
    const observerStart = body.indexOf("new ResizeObserverCtor(");
    const raf = body.indexOf("win.requestAnimationFrame(", observerStart);
    expect(raf).toBeGreaterThan(observerStart);
    expect(body).toContain("if (this.jumpScrollSettleHandle !== null) return;");
  });

  it("stops when the document changes under it", () => {
    const body = settle();
    expect(body).toContain("const startDoc = cm.state.doc;");
    expect(body).toContain("cm.state.doc !== startDoc");
  });

  it("detects the user from real input events, not from scrollTop moving", () => {
    // CM6 re-applies its own pending scroll target across measure cycles,
    // which is indistinguishable from a user scroll if you only watch
    // scrollTop — and that made an earlier version abort exactly when it
    // was needed.
    const body = settle();
    expect(body).toContain('const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;');
    expect(body).toContain("cm.scrollDOM.addEventListener(name, abort, options);");
    expect(body).toContain("const options = { capture: true, passive: true } as const;");
    expect(body).not.toContain("lastWritten");
  });

  it("disconnects the observer, clears the timer and removes the listeners on every exit", () => {
    const body = settle();
    expect(body).toContain("observer.disconnect();");
    expect(body).toContain("cm.scrollDOM.removeEventListener(name, abort, options);");
    expect(body).toContain("if (quietTimer !== null) win.clearTimeout(quietTimer);");
    const cancel = slice("private cancelJumpScrollSettle(): void {", "\n  /**");
    expect(cancel).toContain("this.jumpScrollSettleCleanup?.();");
  });

  it("tolerates sub-pixel differences rather than writing every frame", () => {
    const body = settle();
    expect(body).toContain("if (Math.abs(drift) > 1) {");
  });

  it("cancels a previous settle before starting a new one, so two jumps never race", () => {
    const body = settle();
    expect(body.indexOf("this.cancelJumpScrollSettle();")).toBeGreaterThan(-1);
    expect(body.indexOf("this.cancelJumpScrollSettle();")).toBeLessThan(body.indexOf("const startDoc"));
  });

  it("requests and cancels the frame on the EDITOR's window, which in a popout is not activeWindow", () => {
    const body = settle();
    expect(body).toContain("const win = cm.dom.win;");
    expect(body).toContain("win.requestAnimationFrame(");
    const cancel = slice("private cancelJumpScrollSettle(): void {", "\n  /**");
    expect(cancel).toContain("this.jumpScrollSettleWin?.cancelAnimationFrame(this.jumpScrollSettleHandle);");
    expect(cancel).not.toContain("activeWindow");
  });

  it("onClose cancels a settle in flight", () => {
    const body = slice("async onClose(): Promise<void> {", "refresh(): void {");
    expect(body).toContain("this.cancelJumpScrollSettle();");
  });
});
