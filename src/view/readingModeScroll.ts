/**
 * 26048-BUG-001 follow-up (2026-11-22): Outline Tree jump in Reading mode.
 *
 * The first Reading-mode jump called `previewMode.applyScroll(line)` once.
 * Reading mode only renders the sections near the viewport and estimates
 * the height of the rest, so that call scrolled by estimates; when the
 * real sections above the target were then drawn, the heading drifted
 * past the top (Serena: "Completed" in Projects.md landed hidden). Obsidian's
 * own Outline pane overshoots the same way.
 *
 * This revealer:
 *  1. scrolls with the renderer's `applyScrollDelayed` (waits until the
 *     note is rendered, as Obsidian does for its own navigation), falling
 *     back to the public `applyScroll`;
 *  2. then, for a short window, measures where the target element really
 *     is and corrects the scroll so it sits `getTopOffset()` px below the
 *     top -- the Reading-mode counterpart of EditorLineRevealer's
 *     stabilizer. The window ends on user input, the next jump, or after
 *     2 s / 8 corrections.
 *
 * `renderer`, its `sections` and `applyScrollDelayed` are internal to
 * Obsidian (read from 1.15.1). Every use is guarded: if they disappear,
 * the jump degrades to the single public `applyScroll`.
 */
import type { MarkdownView } from "obsidian";
import { isReadingMode } from "./readingModeFolds";

/** The part of one rendered section the revealer needs. */
export interface PreviewSectionLike {
  start?: { line: number };
  lines: number;
  el: HTMLElement;
  shown?: boolean;
}

interface PreviewRendererLike {
  sections: PreviewSectionLike[];
  previewEl: HTMLElement;
  applyScroll(line: number, opts?: object): boolean;
  applyScrollDelayed?(line: number, opts?: object, cb?: () => void): void;
}

/** Pure: the section whose lines contain `line` (0-based), or null. */
export function findSectionForLine(
  sections: ReadonlyArray<PreviewSectionLike>,
  line: number
): PreviewSectionLike | null {
  for (const section of sections) {
    const start = section.start?.line;
    if (typeof start !== "number") continue;
    if (line >= start && line < start + Math.max(1, section.lines)) return section;
  }
  return null;
}

/**
 * Pure: how far to scroll so the target's top sits `offset` px below the
 * scroller's top. 0 when already within `tolerance` px.
 */
export function computeReadingScrollCorrection(
  targetTop: number,
  scrollerTop: number,
  offset: number,
  tolerance = 2
): number {
  const delta = targetTop - scrollerTop - offset;
  return Math.abs(delta) <= tolerance ? 0 : delta;
}

function rendererOf(view: MarkdownView): PreviewRendererLike | null {
  const renderer = (view.previewMode as unknown as { renderer?: Partial<PreviewRendererLike> })
    ?.renderer;
  if (
    !renderer ||
    !Array.isArray(renderer.sections) ||
    !renderer.previewEl ||
    typeof renderer.applyScroll !== "function"
  ) {
    return null;
  }
  return renderer as PreviewRendererLike;
}

/** The rendered element for `line`, or null while its section is not drawn. */
function targetElement(renderer: PreviewRendererLike, line: number): HTMLElement | null {
  const section = findSectionForLine(renderer.sections, line);
  if (!section || section.shown === false || !section.el?.isConnected) return null;
  const start = section.start?.line ?? line;
  if (line === start) {
    // A heading section's el is a wrapper div; measure the heading itself
    // so its own top margin does not count as space above it.
    const first = section.el.firstElementChild as HTMLElement | null;
    return first ?? section.el;
  }
  // List items carry their line relative to the section start.
  const item = section.el.querySelector<HTMLElement>(`[data-line="${line - start}"]`);
  return item ?? section.el;
}

export class ReadingLineRevealer {
  constructor(private readonly getTopOffset: () => number = () => 0) {}

  private cancelSettle: (() => void) | null = null;

  /** Bumped per jump, so a late callback from an older jump does nothing. */
  private generation = 0;

  /** Ends any active settle window (call from the owning view's onClose). */
  cancel(): void {
    this.generation++;
    this.cancelSettle?.();
  }

  /**
   * Scroll a Reading-mode view so `line` (0-based) sits at the top, less
   * the jump offset. Returns false (and does nothing) when the view is not
   * in Reading mode.
   */
  reveal(view: MarkdownView, line: number): boolean {
    if (!isReadingMode(view)) return false;
    this.cancel();
    const generation = ++this.generation;
    const target = Math.max(0, line);
    const renderer = rendererOf(view);
    if (!renderer) {
      const preview = view.previewMode;
      if (!preview || typeof preview.applyScroll !== "function") return false;
      preview.applyScroll(target);
      return true;
    }
    try {
      if (typeof renderer.applyScrollDelayed === "function") {
        renderer.applyScrollDelayed(target, {}, () => {
          if (generation === this.generation) this.settle(renderer, target);
        });
      } else {
        renderer.applyScroll(target);
        this.settle(renderer, target);
      }
    } catch {
      view.previewMode?.applyScroll?.(target);
    }
    return true;
  }

  private settle(renderer: PreviewRendererLike, line: number): void {
    this.cancelSettle?.();
    const SETTLE_MS = 2000;
    const MAX_CORRECTIONS = 8;
    const scroller = renderer.previewEl;
    let active = true;
    let corrections = 0;
    let rafId: number | null = null;

    const correct = (): void => {
      rafId = null;
      if (!active) return;
      const el = targetElement(renderer, line);
      if (!el) {
        // Not drawn yet: let Obsidian's estimate bring it into range; the
        // resize that follows schedules the next check.
        if (corrections >= MAX_CORRECTIONS) return cancel();
        corrections++;
        try {
          renderer.applyScroll(line);
        } catch {
          return cancel();
        }
        return schedule();
      }
      const delta = computeReadingScrollCorrection(
        el.getBoundingClientRect().top,
        scroller.getBoundingClientRect().top,
        this.getTopOffset()
      );
      if (delta === 0) return;
      if (corrections >= MAX_CORRECTIONS) return cancel();
      corrections++;
      scroller.scrollTop += delta;
      // Scrolling draws new sections, whose real heights can move the
      // target again; check once more next frame.
      schedule();
    };
    const schedule = (): void => {
      if (!active || rafId !== null) return;
      rafId = window.requestAnimationFrame(correct);
    };

    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      correct();
    });
    const observed = scroller.firstElementChild ?? scroller;
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
    observer?.observe(observed);
    const userEvents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    const onUserInput = (): void => cancel();
    for (const type of userEvents) {
      scroller.addEventListener(type, onUserInput, { passive: true, capture: true });
    }
    const timeoutId = window.setTimeout(() => cancel(), SETTLE_MS);
    const cancel = (): void => {
      if (!active) return;
      active = false;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = null;
      window.clearTimeout(timeoutId);
      observer?.disconnect();
      for (const type of userEvents) {
        scroller.removeEventListener(type, onUserInput, { capture: true });
      }
      if (this.cancelSettle === cancel) this.cancelSettle = null;
    };
    this.cancelSettle = cancel;
  }
}
