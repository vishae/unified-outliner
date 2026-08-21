import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5T-11A follow-up (real-device feedback, 2026-08-21): pressing Enter
 * in an inline rename box with UNCHANGED text used to reach commitRename()
 * anyway and silently leave the box open (a true no-op, per
 * applyLineEditOutcome's own no-op guard) instead of closing it — the exact
 * "opened it, didn't touch anything" case the blur handler already
 * special-cased by comparing inputEl.value against initialText and routing
 * to cancelRename() instead. This file pins that the keydown Enter handler
 * now applies the identical check.
 *
 * Static-source-text style, matching the other *UiWiring/*Teardown test
 * files in this suite (an Obsidian ItemView subclass cannot be constructed
 * in vitest, since "obsidian" is a types-only package here).
 */

const viewTs = readFileSync(
  path.join(__dirname, "..", "src", "view", "OutlineTreeView.ts"),
  "utf8"
);

function extractKeydownHandler(): string {
  const start = viewTs.indexOf('inputEl.addEventListener("keydown", (evt) => {');
  expect(start).toBeGreaterThan(-1);
  const end = viewTs.indexOf('inputEl.addEventListener("input", resizeRenameTextareaToContent);', start);
  expect(end).toBeGreaterThan(start);
  return viewTs.slice(start, end);
}

describe("Phase 5T-11A follow-up: Enter with unchanged rename text closes the box", () => {
  it("the Enter branch compares inputEl.value against initialText and calls cancelRename() when unchanged, commitRename() otherwise", () => {
    const body = extractKeydownHandler();
    const enterBranchStart = body.indexOf('evt.key === "Enter"');
    expect(enterBranchStart).toBeGreaterThan(-1);
    const enterBranchEnd = body.indexOf('else if (evt.key === "Escape")');
    expect(enterBranchEnd).toBeGreaterThan(enterBranchStart);
    const enterBranch = body.slice(enterBranchStart, enterBranchEnd);

    expect(enterBranch).toContain("evt.preventDefault();");
    expect(enterBranch).toContain("if (inputEl.value === initialText) {");
    expect(enterBranch).toContain("this.cancelRename();");
    expect(enterBranch).toContain("} else {");
    expect(enterBranch).toContain("this.commitRename();");

    const checkIdx = enterBranch.indexOf("if (inputEl.value === initialText) {");
    const commitIdx = enterBranch.indexOf("this.commitRename();");
    expect(checkIdx).toBeLessThan(commitIdx);
  });

  it("evt.preventDefault() still runs unconditionally for Enter (both changed and unchanged cases), preserving the pre-existing native-newline suppression", () => {
    const body = extractKeydownHandler();
    const enterBranchStart = body.indexOf('evt.key === "Enter"');
    const enterBranchEnd = body.indexOf('else if (evt.key === "Escape")');
    const enterBranch = body.slice(enterBranchStart, enterBranchEnd);
    const preventDefaultIdx = enterBranch.indexOf("evt.preventDefault();");
    const ifIdx = enterBranch.indexOf("if (inputEl.value === initialText) {");
    expect(preventDefaultIdx).toBeGreaterThan(-1);
    expect(preventDefaultIdx).toBeLessThan(ifIdx);
  });
});
