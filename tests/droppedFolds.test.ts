import { describe, expect, it } from "vitest";
import { findDroppedFolds } from "../src/tree/droppedFolds";

const rows = [
  { line: 0, identity: "h:Work" },
  { line: 4, identity: "h:Work Tasks" },
  { line: 9, identity: "h:Completed" },
  { line: 12, identity: "l:item" },
];

describe("findDroppedFolds (26048-BUG-002)", () => {
  it("returns saved folds the editor no longer has", () => {
    const saved = new Set(["h:Work Tasks", "h:Completed"]);
    expect(findDroppedFolds(rows, saved, new Set([4]))).toEqual(["h:Completed"]);
  });

  it("returns nothing while every saved fold is still in the editor", () => {
    const saved = new Set(["h:Work Tasks", "l:item"]);
    expect(findDroppedFolds(rows, saved, new Set([4, 12]))).toEqual([]);
  });

  it("never adds a fold the editor has but the tree has not saved", () => {
    expect(findDroppedFolds(rows, new Set(), new Set([0, 4]))).toEqual([]);
  });

  it("ignores saved identities with no row in the note", () => {
    expect(findDroppedFolds(rows, new Set(["h:Gone"]), new Set())).toEqual([]);
  });
});
