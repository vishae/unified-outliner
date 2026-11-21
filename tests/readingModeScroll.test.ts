import { describe, expect, it, vi } from "vitest";
import {
  computeReadingScrollCorrection,
  findSectionForLine,
  ReadingLineRevealer,
} from "../src/view/readingModeScroll";

const el = {} as HTMLElement;

describe("findSectionForLine", () => {
  const sections = [
    { start: { line: 0 }, lines: 3, el },
    { start: { line: 3 }, lines: 1, el },
    { start: { line: 4 }, lines: 5, el },
  ];
  it("finds the section containing the line", () => {
    expect(findSectionForLine(sections, 0)).toBe(sections[0]);
    expect(findSectionForLine(sections, 3)).toBe(sections[1]);
    expect(findSectionForLine(sections, 8)).toBe(sections[2]);
  });
  it("returns null past the end or with no start line", () => {
    expect(findSectionForLine(sections, 9)).toBeNull();
    expect(findSectionForLine([{ lines: 2, el }], 0)).toBeNull();
  });
});

describe("computeReadingScrollCorrection", () => {
  it("scrolls by the distance from the offset line", () => {
    expect(computeReadingScrollCorrection(130, 100, 0)).toBe(30);
    expect(computeReadingScrollCorrection(90, 100, 0)).toBe(-10);
    expect(computeReadingScrollCorrection(130, 100, 55)).toBe(-25);
  });
  it("does nothing within the tolerance", () => {
    expect(computeReadingScrollCorrection(101, 100, 0)).toBe(0);
    expect(computeReadingScrollCorrection(157, 100, 55)).toBe(0);
  });
});

describe("ReadingLineRevealer.reveal", () => {
  function view(mode: string, previewMode: object) {
    return { getMode: () => mode, previewMode } as never;
  }

  it("declines outside Reading mode", () => {
    const applyScroll = vi.fn();
    expect(new ReadingLineRevealer().reveal(view("source", { applyScroll }), 4)).toBe(false);
    expect(applyScroll).not.toHaveBeenCalled();
  });

  it("waits for the render through applyScrollDelayed when the renderer is there", () => {
    const applyScrollDelayed = vi.fn();
    const renderer = { sections: [], previewEl: el, applyScroll: vi.fn(), applyScrollDelayed };
    expect(
      new ReadingLineRevealer().reveal(view("preview", { applyScroll: vi.fn(), renderer }), 7)
    ).toBe(true);
    expect(applyScrollDelayed).toHaveBeenCalledWith(7, {}, expect.any(Function));
  });

  it("falls back to the public applyScroll when the renderer internals are missing", () => {
    const applyScroll = vi.fn();
    expect(new ReadingLineRevealer().reveal(view("preview", { applyScroll }), 7)).toBe(true);
    expect(applyScroll).toHaveBeenCalledWith(7);
  });
});
