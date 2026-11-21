import { describe, expect, it, vi } from "vitest";

class MarkdownView {
  onMarkdownFold(): string {
    return "saved";
  }
}

import {
  applyTreeFoldsToReadingView,
  installReadingModeFoldListener,
  isReadingMode,
  mergeReadingFolds,
  readFoldedLines,
} from "../src/view/readingModeFolds";

type Fold = { from: number; to: number };

function fakeView(mode: "preview" | "source", folds: Fold[] = [], lines = 20) {
  const state = { folds: [...folds], lines };
  const preview = {
    applyScroll: vi.fn(),
    getFoldInfo: vi.fn(() => ({ folds: [...state.folds], lines: state.lines })),
    applyFoldInfo: vi.fn((info: { folds: Fold[]; lines: number }) => {
      state.folds = [...info.folds];
    }),
  };
  const view = Object.create(MarkdownView.prototype);
  Object.assign(view, {
    getMode: () => mode,
    previewMode: preview,
    getViewData: () => "x\n".repeat(lines - 1) + "x",
  });
  return { view: view as never, preview, state };
}

describe("mergeReadingFolds", () => {
  it("adds a fold for a collapsed request and keeps existing ones", () => {
    const out = mergeReadingFolds({ folds: [{ from: 10, to: 12 }], lines: 20 }, [
      { startLine: 2, endLine: 5, collapsed: true },
    ]);
    expect(out).toEqual({
      folds: [
        { from: 2, to: 5 },
        { from: 10, to: 12 },
      ],
      lines: 20,
    });
  });

  it("removes the fold starting at an expanded request's line", () => {
    const out = mergeReadingFolds(
      { folds: [{ from: 2, to: 5 }, { from: 10, to: 12 }], lines: 20 },
      [{ startLine: 2, endLine: 5, collapsed: false }]
    );
    expect(out.folds).toEqual([{ from: 10, to: 12 }]);
  });

  it("ignores a request with nothing below its heading", () => {
    const out = mergeReadingFolds({ folds: [], lines: 20 }, [
      { startLine: 4, endLine: 4, collapsed: true },
    ]);
    expect(out.folds).toEqual([]);
  });

  it("does not mutate the input", () => {
    const input = { folds: [{ from: 1, to: 3 }], lines: 9 };
    mergeReadingFolds(input, [{ startLine: 1, endLine: 3, collapsed: false }]);
    expect(input.folds).toEqual([{ from: 1, to: 3 }]);
  });
});

describe("Reading-mode view helpers", () => {
  it("only treats preview mode as Reading mode", () => {
    expect(isReadingMode(fakeView("preview").view)).toBe(true);
    expect(isReadingMode(fakeView("source").view)).toBe(false);
    expect(isReadingMode(null)).toBe(false);
  });

  it("applies tree folds through the preview's fold record", () => {
    const { view, state } = fakeView("preview", [{ from: 10, to: 12 }]);
    expect(
      applyTreeFoldsToReadingView(view, [{ startLine: 2, endLine: 5, collapsed: true }])
    ).toBe(true);
    expect(state.folds.map((f) => f.from)).toEqual([2, 10]);
    expect(readFoldedLines(view)).toEqual(new Set([2, 10]));
  });

  it("does nothing, without throwing, when Obsidian's internal calls are missing", () => {
    const { view } = fakeView("preview");
    (view as unknown as { previewMode: object }).previewMode = { applyScroll: vi.fn() };
    expect(
      applyTreeFoldsToReadingView(view, [{ startLine: 2, endLine: 5, collapsed: true }])
    ).toBe(false);
    expect(readFoldedLines(view)).toBeNull();
  });
});

describe("installReadingModeFoldListener", () => {
  it("calls back after a Reading-mode fold, keeps Obsidian's result, and uninstalls", () => {
    const original = MarkdownView.prototype.onMarkdownFold;
    const onFold = vi.fn();
    const uninstall = installReadingModeFoldListener(MarkdownView.prototype, onFold);

    const reading = fakeView("preview");
    expect((reading.view as unknown as { onMarkdownFold(): string }).onMarkdownFold()).toBe(
      "saved"
    );
    expect(onFold).toHaveBeenCalledWith(reading.view);

    const source = fakeView("source");
    (source.view as unknown as { onMarkdownFold(): string }).onMarkdownFold();
    expect(onFold).toHaveBeenCalledTimes(1);

    uninstall();
    expect(MarkdownView.prototype.onMarkdownFold).toBe(original);
  });

  it("does not echo the tree's own fold change back to the tree", () => {
    const onFold = vi.fn();
    const uninstall = installReadingModeFoldListener(MarkdownView.prototype, onFold);
    const { view, preview } = fakeView("preview");
    // Simulate Obsidian saving folds synchronously inside applyFoldInfo.
    preview.applyFoldInfo.mockImplementation(() => {
      (view as unknown as { onMarkdownFold(): void }).onMarkdownFold();
    });
    applyTreeFoldsToReadingView(view, [{ startLine: 2, endLine: 5, collapsed: true }]);
    expect(onFold).not.toHaveBeenCalled();
    uninstall();
  });

  it("swallows an error in the callback so Obsidian's save still completes", () => {
    const uninstall = installReadingModeFoldListener(MarkdownView.prototype, () => {
      throw new Error("boom");
    });
    const { view } = fakeView("preview");
    expect((view as unknown as { onMarkdownFold(): string }).onMarkdownFold()).toBe("saved");
    uninstall();
  });
});

describe("handleReadingModeFold (static source check)", () => {
  it("syncs both headings and list items from the rendered note to the tree", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const src = readFileSync(
      path.resolve(__dirname, "../src/view/OutlineTreeView.ts"),
      "utf-8"
    );
    const start = src.indexOf("export function handleReadingModeFold(");
    const end = src.indexOf("export function createCm6FoldSyncExtension(", start);
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, end);
    expect(body).toContain('if (node.kind !== "section" && node.kind !== "list") continue;');
    expect(body).toContain("const collapsed = folded.has(node.line);");
  });
});
