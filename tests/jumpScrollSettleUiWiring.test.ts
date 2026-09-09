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
    expect(body).toContain("effects: EditorView.scrollIntoView(pos, {");
    expect(body).toContain("yMargin: this.plugin.settings.jumpScrollOffset,");
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

  it("corrects by re-issuing CM6's own scroll, never by writing scrollTop", () => {
    // CM6 re-applies its pending scroll target on every measure cycle, so
    // a hand-written scrollTop is overwritten — the two fight, CM6 wins,
    // and the jump stops responding even when repeated.
    const body = settle();
    expect(body).not.toContain("cm.scrollDOM.scrollTop =");
    expect(body).toContain("cm.dispatch({");
  });

  it("throttles and caps the re-issues rather than dispatching every frame", () => {
    const body = settle();
    expect(body).toContain("const REISSUE_INTERVAL_MS = 80;");
    expect(body).toContain("const MAX_REISSUES = 20;");
    expect(body).toContain("reissues < MAX_REISSUES && now - lastReissueAt >= REISSUE_INTERVAL_MS");
  });

  it("re-measures the line every frame — no proxy for movement", () => {
    // A ResizeObserver on the content element was tried and was the wrong
    // signal: when CM6 renders a region it had only estimated, total
    // height barely moves (no resize fires) while every line's position
    // inside it shifts. That was exactly the case still drifting.
    const body = settle();
    expect(body).toContain("win.requestAnimationFrame(step);");
    expect(body).not.toContain("ResizeObserver");
    expect(body).not.toContain("deadline");
    expect(body).not.toContain("framesLeft");
  });

  it("stops when the line has HELD STILL, not after a fixed duration", () => {
    const body = settle();
    expect(body).toContain("const STABLE_FRAMES = 30;");
    expect(body).toContain("stableFrames >= STABLE_FRAMES");
    expect(body).toContain("stableFrames = 0;");
    expect(body).toContain("stableFrames++;");
  });

  it("still has a hard cap, so nothing is held indefinitely", () => {
    const body = settle();
    expect(body).toContain("win.performance.now() + 8000;");
    expect(body).toContain("win.performance.now() > hardCap");
  });

  it("stops when the document changes under it", () => {
    const body = settle();
    expect(body).toContain("const startDoc = cm.state.doc;");
    expect(body).toContain("cm.state.doc !== startDoc");
  });

  it("detects the user from real input events, not from scrollTop moving", () => {
    const body = settle();
    expect(body).toContain('const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;');
    expect(body).toContain("const options = { capture: true, passive: true } as const;");
    expect(body).toContain("if (\n        aborted ||");
    expect(body).not.toContain("lastWritten");
  });

  it("removes its listeners on every exit path", () => {
    const body = settle();
    expect(body).toContain("cm.scrollDOM.removeEventListener(name, abort, options);");
    expect(body).toContain("this.cancelJumpScrollSettle();");
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
