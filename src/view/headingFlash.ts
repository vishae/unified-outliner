/**
 * 26048-FEAT-004: briefly highlight the line jumped to from the Outline
 * Tree, as Obsidian's own Outline pane does, so the eye finds where the
 * jump landed (Serena, 2026-11-22 / 2026-11-26).
 *
 * Source / Live Preview: a CM6 line decoration held in a StateField, so it
 * survives the line DOM being redrawn while the jump's scroll settles.
 * Reading mode: a class on the rendered heading (or list item), applied
 * once its section is drawn.
 *
 * Both fade through a CSS animation in styles.css. Consecutive flashes
 * alternate between two classes with different animation names, so a
 * second jump to the same line replays the animation. The flash is
 * display-only and never edits the note.
 */
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { MarkdownView } from "obsidian";
import { getEditorCmView } from "./editorLineReveal";
import { isReadingMode } from "./readingModeFolds";
import { rendererOf, targetElement } from "./readingModeScroll";

/** How long the highlight lasts; matches the animation in styles.css. */
export const FLASH_MS = 1500;

/** Alternated per flash so the animation restarts on a repeat jump. */
export const FLASH_CLASSES = ["unified-outliner-flash-a", "unified-outliner-flash-b"] as const;

/** Frames to wait for a Reading-mode section to be drawn after the jump. */
const READING_RETRY_FRAMES = 30;

/** Sets the flashed line (0-based) and its class, or clears it with null. */
export const setFlashLine = StateEffect.define<{ line: number; cls: string } | null>();

export const flashLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setFlashLine)) continue;
      const value = effect.value;
      if (!value || value.line < 0 || value.line >= tr.state.doc.lines) {
        next = Decoration.none;
        continue;
      }
      const from = tr.state.doc.line(value.line + 1).from;
      next = Decoration.set([Decoration.line({ class: value.cls }).range(from)]);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Registered once by the plugin (main.ts). */
export function headingFlashExtension(): Extension {
  return flashLineField;
}

/** Flashes one line at a time in the active note; a new flash replaces the last. */
export class HeadingFlasher {
  private count = 0;
  private generation = 0;
  private clearTimer: number | null = null;
  private clearCurrent: (() => void) | null = null;
  private frame: number | null = null;

  /** Next class in the alternation (exposed for tests). */
  nextClass(): string {
    return FLASH_CLASSES[this.count++ % FLASH_CLASSES.length];
  }

  flash(view: MarkdownView, line: number): void {
    this.cancel();
    const generation = ++this.generation;
    const cls = this.nextClass();
    try {
      if (isReadingMode(view)) {
        this.flashReading(view, line, cls, generation, READING_RETRY_FRAMES);
        return;
      }
      const cm = getEditorCmView(view.editor);
      if (!cm || !cm.state.field(flashLineField, false)) return;
      cm.dispatch({ effects: setFlashLine.of({ line, cls }) });
      this.scheduleClear(() => {
        if (cm.state.field(flashLineField, false)) cm.dispatch({ effects: setFlashLine.of(null) });
      });
    } catch {
      // Display-only: a failure leaves the jump itself untouched.
    }
  }

  /** Ends any flash in progress (also called from the view's onClose). */
  cancel(): void {
    this.generation++;
    if (this.frame !== null) {
      window.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    if (this.clearTimer !== null) {
      window.clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    const clear = this.clearCurrent;
    this.clearCurrent = null;
    try {
      clear?.();
    } catch {
      // The note may already be closed.
    }
  }

  private flashReading(
    view: MarkdownView,
    line: number,
    cls: string,
    generation: number,
    framesLeft: number
  ): void {
    if (generation !== this.generation) return;
    const renderer = rendererOf(view);
    const el = renderer ? targetElement(renderer, line) : null;
    if (!el) {
      if (framesLeft <= 0) return;
      this.frame = window.requestAnimationFrame(() => {
        this.frame = null;
        this.flashReading(view, line, cls, generation, framesLeft - 1);
      });
      return;
    }
    el.classList.remove(...FLASH_CLASSES);
    el.classList.add(cls);
    this.scheduleClear(() => el.classList.remove(cls));
  }

  private scheduleClear(clear: () => void): void {
    this.clearCurrent = clear;
    this.clearTimer = window.setTimeout(() => {
      this.clearTimer = null;
      this.clearCurrent = null;
      clear();
    }, FLASH_MS);
  }
}
