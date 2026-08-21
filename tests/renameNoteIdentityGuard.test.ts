/**
 * Phase 5T-12A ("Outline Tree rename の cross-note write 防止"): unit tests
 * for src/edit/renameNoteIdentityGuard.ts's evaluateRenameNoteIdentity — a
 * plain, Obsidian-independent predicate, so this file needs no fixtures,
 * parsing, or mocking at all (unlike tests/insertParagraph.test.ts /
 * tests/deleteParagraph.test.ts, which exercise real parse -> scan ->
 * resolve pipelines). See tests/renameNoteIdentityGuardUiWiring.test.ts for
 * the static-source-text checks that OutlineTreeView.ts's
 * commitRename()/commitPendingParagraphInsert()/
 * rollbackPendingParagraphInsert() actually call this function before any
 * editor write/Undo.
 */
import { describe, expect, it } from "vitest";
import { evaluateRenameNoteIdentity } from "../src/edit/renameNoteIdentityGuard";

describe("evaluateRenameNoteIdentity", () => {
  it("allows the write when currentFilePath and the active view's file path match exactly", () => {
    expect(evaluateRenameNoteIdentity("Note A.md", "Note A.md")).toEqual({ allowed: true });
  });

  it("rejects with 'note-switched' when the active view's file path differs from currentFilePath", () => {
    expect(evaluateRenameNoteIdentity("Note A.md", "Note B.md")).toEqual({
      allowed: false,
      reason: "note-switched",
    });
  });

  it("rejects with 'note-switched' even when only the folder/path portion differs (same basename)", () => {
    expect(evaluateRenameNoteIdentity("folder1/Note.md", "folder2/Note.md")).toEqual({
      allowed: false,
      reason: "note-switched",
    });
  });

  it("rejects with 'no-current-file' when currentFilePath is null (no origin identity recorded)", () => {
    expect(evaluateRenameNoteIdentity(null, "Note A.md")).toEqual({
      allowed: false,
      reason: "no-current-file",
    });
  });

  it("rejects with 'no-active-view' when the active view's file path is null", () => {
    expect(evaluateRenameNoteIdentity("Note A.md", null)).toEqual({
      allowed: false,
      reason: "no-active-view",
    });
  });

  it("rejects with 'no-active-view' when the active view's file path is undefined (e.g. view.file is null)", () => {
    expect(evaluateRenameNoteIdentity("Note A.md", undefined)).toEqual({
      allowed: false,
      reason: "no-active-view",
    });
  });

  it("rejects with 'no-current-file' (checked first) when BOTH currentFilePath and the active view's file path are missing", () => {
    // currentFilePath missing is checked before activeViewFilePath, per the
    // function's own implementation order — this pins that ordering so a
    // future edit can't silently swap which reason wins.
    expect(evaluateRenameNoteIdentity(null, null)).toEqual({
      allowed: false,
      reason: "no-current-file",
    });
  });

  it("is case-sensitive and does not trim whitespace (a vault path is byte-exact)", () => {
    expect(evaluateRenameNoteIdentity("Note A.md", "note a.md")).toEqual({
      allowed: false,
      reason: "note-switched",
    });
    expect(evaluateRenameNoteIdentity("Note A.md", " Note A.md")).toEqual({
      allowed: false,
      reason: "note-switched",
    });
  });

  it("treats an empty-string currentFilePath the same as null/missing (falsy check, not a strict-null check)", () => {
    expect(evaluateRenameNoteIdentity("", "Note A.md")).toEqual({
      allowed: false,
      reason: "no-current-file",
    });
  });
});
