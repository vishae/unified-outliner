/**
 * 26048-BUG-001: Outline Tree support for Reading mode.
 *
 * Source and Live Preview fold through CodeMirror 6 (see
 * OutlineTreeView.syncFoldsToBodyEditor and createCm6FoldSyncExtension).
 * Reading mode has no CodeMirror view the user can see, so neither path
 * reaches it. This module covers the three Reading-mode cases:
 *
 *  - Jump: `MarkdownPreviewView.applyScroll(line)` -- public API.
 *  - Tree -> note folds: the preview's `getFoldInfo()` / `applyFoldInfo()`.
 *    NOT in the public typings. Obsidian (1.15.1) uses this same pair
 *    itself when switching modes: it saves the outgoing mode's folds to
 *    `app.foldManager` and applies them to the incoming mode, so folds set
 *    here carry over to Source / Live Preview.
 *  - Note -> tree folds: clicking a heading's fold arrow in Reading mode
 *    calls the preview's internal `onFoldChange()`, debounced 500 ms into
 *    `MarkdownView.onMarkdownFold()`. There is no public event, so that
 *    prototype method is wrapped (installReadingModeFoldListener).
 *
 * Every internal call is guarded: if an Obsidian update renames or removes
 * one, the feature it backs silently does nothing rather than throwing.
 * Serena accepted that trade on 2026-11-21 -- a personal fork, so a silent
 * loss is acceptable.
 */
import type { MarkdownView } from "obsidian";

/** Obsidian's internal fold record: 0-based line ranges plus the note's line count. */
export interface PreviewFoldInfo {
  folds: Array<{ from: number; to: number }>;
  lines: number;
}

interface PreviewModeWithFolds {
  applyScroll(line: number): void;
  getFoldInfo(): PreviewFoldInfo | null;
  applyFoldInfo(info: PreviewFoldInfo): void;
}

/** One requested fold change, in the parser's 0-based lines. */
export interface ReadingFoldRequest {
  startLine: number;
  endLine: number;
  collapsed: boolean;
}

export function isReadingMode(view: MarkdownView | null | undefined): boolean {
  return !!view && typeof view.getMode === "function" && view.getMode() === "preview";
}

function previewWithFolds(view: MarkdownView): PreviewModeWithFolds | null {
  const preview = (view as unknown as { previewMode?: Partial<PreviewModeWithFolds> })
    .previewMode;
  if (
    !preview ||
    typeof preview.getFoldInfo !== "function" ||
    typeof preview.applyFoldInfo !== "function"
  ) {
    return null;
  }
  return preview as PreviewModeWithFolds;
}

/** Scroll the rendered note so `line` (0-based) is at the top. Public API. */
export function scrollReadingViewToLine(view: MarkdownView, line: number): boolean {
  if (!isReadingMode(view)) return false;
  const preview = view.previewMode;
  if (!preview || typeof preview.applyScroll !== "function") return false;
  preview.applyScroll(Math.max(0, line));
  return true;
}

/**
 * Pure: the fold record after applying `requests` to `current`. A
 * collapsed request adds (or replaces) the fold starting at its heading
 * line; an expanded request removes it. Obsidian's preview keys folds on
 * `from` alone, so `to` only needs to be plausible.
 */
export function mergeReadingFolds(
  current: PreviewFoldInfo,
  requests: ReadonlyArray<ReadingFoldRequest>
): PreviewFoldInfo {
  const byFrom = new Map<number, { from: number; to: number }>();
  for (const fold of current.folds) byFrom.set(fold.from, { ...fold });
  for (const req of requests) {
    if (req.endLine <= req.startLine) continue;
    if (req.collapsed) {
      byFrom.set(req.startLine, { from: req.startLine, to: req.endLine });
    } else {
      byFrom.delete(req.startLine);
    }
  }
  const folds = [...byFrom.values()].sort((a, b) => a.from - b.from);
  return { folds, lines: current.lines };
}

/**
 * Set by applyTreeFoldsToReadingView while it changes the preview's folds,
 * so the listener does not echo the tree's own change back into the tree
 * (the Reading-mode counterpart of outlineTreeFoldOrigin).
 */
let applyingFromTree = false;

/** Fold or unfold sections in a Reading-mode view. Returns false if it could not. */
export function applyTreeFoldsToReadingView(
  view: MarkdownView,
  requests: ReadonlyArray<ReadingFoldRequest>
): boolean {
  if (!isReadingMode(view) || requests.length === 0) return false;
  const preview = previewWithFolds(view);
  if (!preview) return false;
  try {
    const current = preview.getFoldInfo() ?? {
      folds: [],
      lines: view.getViewData().split("\n").length,
    };
    applyingFromTree = true;
    preview.applyFoldInfo(mergeReadingFolds(current, requests));
    return true;
  } catch {
    return false;
  } finally {
    applyingFromTree = false;
  }
}

/** The heading lines (0-based) currently folded in a Reading-mode view, or null. */
export function readFoldedLines(view: MarkdownView): Set<number> | null {
  if (!isReadingMode(view)) return null;
  const preview = previewWithFolds(view);
  if (!preview) return null;
  try {
    const info = preview.getFoldInfo();
    return new Set((info?.folds ?? []).map((f) => f.from));
  } catch {
    return null;
  }
}

/**
 * Wrap `onMarkdownFold` on the given prototype (MarkdownView.prototype,
 * passed in by main.ts so this module needs no runtime import of
 * "obsidian") so `onFold` runs after a fold made in the note itself while
 * in Reading mode. Returns the uninstaller, which restores the original
 * method. Does nothing (and returns a no-op) if the method is missing.
 */
export function installReadingModeFoldListener(
  markdownViewPrototype: object,
  onFold: (view: MarkdownView) => void
): () => void {
  const proto = markdownViewPrototype as {
    onMarkdownFold?: (this: MarkdownView, ...args: unknown[]) => unknown;
  };
  const original = proto.onMarkdownFold;
  if (typeof original !== "function") return () => {};
  const wrapped = function (this: MarkdownView, ...args: unknown[]): unknown {
    const result = original.apply(this, args);
    if (!applyingFromTree && isReadingMode(this)) {
      try {
        onFold(this);
      } catch {
        // Display-only sync; never let it break Obsidian's own fold save.
      }
    }
    return result;
  };
  proto.onMarkdownFold = wrapped;
  return () => {
    if (proto.onMarkdownFold === wrapped) proto.onMarkdownFold = original;
  };
}
