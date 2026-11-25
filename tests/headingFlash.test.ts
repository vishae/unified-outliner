import { EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FLASH_CLASSES,
  FLASH_MS,
  HeadingFlasher,
  flashLineField,
  setFlashLine,
} from "../src/view/headingFlash";

// 26048-FEAT-004: a tree jump briefly highlights the line it lands on.

function decoratedLines(state: EditorState): Array<{ line: number; cls: string }> {
  const out: Array<{ line: number; cls: string }> = [];
  state.field(flashLineField).between(0, state.doc.length, (from, _to, deco) => {
    out.push({
      line: state.doc.lineAt(from).number - 1,
      cls: (deco.spec as { class: string }).class,
    });
  });
  return out;
}

describe("flashLineField", () => {
  const doc = "# A\ntext\n## B\nmore\n";
  const base = () => EditorState.create({ doc, extensions: [flashLineField] });

  it("starts empty", () => {
    expect(decoratedLines(base())).toEqual([]);
  });

  it("decorates the one line set, replacing any earlier one", () => {
    let state = base().update({ effects: setFlashLine.of({ line: 0, cls: "x" }) }).state;
    expect(decoratedLines(state)).toEqual([{ line: 0, cls: "x" }]);
    state = state.update({ effects: setFlashLine.of({ line: 2, cls: "y" }) }).state;
    expect(decoratedLines(state)).toEqual([{ line: 2, cls: "y" }]);
  });

  it("clears on null and ignores lines outside the note", () => {
    let state = base().update({ effects: setFlashLine.of({ line: 2, cls: "y" }) }).state;
    state = state.update({ effects: setFlashLine.of(null) }).state;
    expect(decoratedLines(state)).toEqual([]);
    state = state.update({ effects: setFlashLine.of({ line: 99, cls: "y" }) }).state;
    expect(decoratedLines(state)).toEqual([]);
  });

  it("follows the line when text is inserted above it", () => {
    let state = base().update({ effects: setFlashLine.of({ line: 2, cls: "y" }) }).state;
    state = state.update({ changes: { from: 0, insert: "new\n" } }).state;
    expect(decoratedLines(state)).toEqual([{ line: 3, cls: "y" }]);
  });

  it("never edits the note", () => {
    const state = base().update({ effects: setFlashLine.of({ line: 0, cls: "x" }) }).state;
    expect(state.doc.toString()).toBe(doc);
  });
});

describe("HeadingFlasher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: number) => clearTimeout(id),
      requestAnimationFrame: (fn: () => void) => setTimeout(fn, 16),
      cancelAnimationFrame: (id: number) => clearTimeout(id),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function cmView(lines = 5) {
    let state = EditorState.create({
      doc: Array.from({ length: lines }, (_, i) => `line ${i}`).join("\n"),
      extensions: [flashLineField],
    });
    const cm = {
      get state() {
        return state;
      },
      dispatch(spec: Parameters<EditorState["update"]>[0]) {
        state = state.update(spec).state;
      },
    };
    return { view: { getMode: () => "source", editor: { cm } }, current: () => decoratedLines(state) };
  }

  it("alternates classes so a repeat jump replays the fade", () => {
    const f = new HeadingFlasher();
    expect([f.nextClass(), f.nextClass(), f.nextClass()]).toEqual([
      FLASH_CLASSES[0],
      FLASH_CLASSES[1],
      FLASH_CLASSES[0],
    ]);
  });

  it("flashes the editor line and clears it after FLASH_MS", () => {
    const { view, current } = cmView();
    const f = new HeadingFlasher();
    f.flash(view as never, 3);
    expect(current()).toEqual([{ line: 3, cls: FLASH_CLASSES[0] }]);
    vi.advanceTimersByTime(FLASH_MS - 1);
    expect(current()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(current()).toEqual([]);
  });

  it("moves the flash on a new jump, never two lines at once", () => {
    const { view, current } = cmView();
    const f = new HeadingFlasher();
    f.flash(view as never, 1);
    vi.advanceTimersByTime(500);
    f.flash(view as never, 4);
    expect(current()).toEqual([{ line: 4, cls: FLASH_CLASSES[1] }]);
    vi.advanceTimersByTime(FLASH_MS);
    expect(current()).toEqual([]);
  });

  it("does nothing without the editor extension", () => {
    const view = { getMode: () => "source", editor: { cm: { state: EditorState.create({ doc: "a" }), dispatch: vi.fn() } } };
    new HeadingFlasher().flash(view as never, 0);
    expect(view.editor.cm.dispatch).not.toHaveBeenCalled();
  });

  function fakeEl() {
    const classes = new Set<string>();
    return {
      isConnected: true,
      firstElementChild: null,
      classes,
      classList: {
        add: (...c: string[]) => c.forEach((x) => classes.add(x)),
        remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
      },
      querySelector: () => null,
    };
  }

  it("flashes the rendered heading in Reading mode once its section is drawn", () => {
    const el = fakeEl();
    const sections: unknown[] = [];
    const renderer = { sections, previewEl: {}, applyScroll: () => true };
    const view = { getMode: () => "preview", editor: {}, previewMode: { renderer } };
    const f = new HeadingFlasher();
    f.flash(view as never, 4);
    expect(el.classes.size).toBe(0);
    sections.push({ start: { line: 4 }, lines: 2, el, shown: true });
    vi.advanceTimersByTime(16);
    expect([...el.classes]).toEqual([FLASH_CLASSES[0]]);
    vi.advanceTimersByTime(FLASH_MS);
    expect(el.classes.size).toBe(0);
  });

  it("cancel clears a flash in progress", () => {
    const { view, current } = cmView();
    const f = new HeadingFlasher();
    f.flash(view as never, 2);
    f.cancel();
    expect(current()).toEqual([]);
  });
});
