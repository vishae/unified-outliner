/**
 * Phase 5C-4 (2026-08-14, "Standalone Callout / Blockquote の Partial Edit
 * Popout 完成と元ノート同一性の安全化"): unit tests for
 * view/partialEditSourceNoteCheck.ts's checkPartialEditSourceNote — the
 * pure, Obsidian-free comparison PartialEditView.applyEdit uses as an
 * ADDITIONAL, path-based safety valve, layered in front of (never a
 * replacement for) edit/partialEdit.ts's own content-based conflict
 * detection.
 *
 * ---- Scope / what this file deliberately does NOT test -----------------
 *
 * PartialEditView.applyEdit itself cannot be exercised directly in vitest
 * ("obsidian" is a types-only package in this repo — see every other
 * *UiWiring.test.ts file's own top doc comment for this project-wide
 * constraint), so the full "path matches AND content also conflicts" /
 * "path matches AND content is unchanged, Apply succeeds" combinations can
 * only be exercised end-to-end on a real Obsidian instance — see this
 * ticket's own real-device checklist. What CAN be verified here, in full:
 * (1) checkPartialEditSourceNote's own three-way result for every
 * loadedPath/currentPath combination that matters, and (2) via a bounded
 * static source-text check on PartialEditView.ts (mirroring
 * tests/commandTable.test.ts's own established pattern), that applyEdit
 * calls this check BEFORE its existing content-based conflict path — i.e.
 * that the ordering this ticket's approval requires ("path一致は
 * content conflict検知の代替ではない" — path is an earlier, additional
 * gate, not a replacement) is actually what the code does, not just what
 * the doc comments claim.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkPartialEditSourceNote } from "../src/view/partialEditSourceNoteCheck";

describe("checkPartialEditSourceNote", () => {
  it("returns 'ok' when both paths are the same non-empty string", () => {
    expect(checkPartialEditSourceNote("notes/foo.md", "notes/foo.md")).toBe("ok");
  });

  it("returns 'changed' when both paths are non-empty but differ", () => {
    expect(checkPartialEditSourceNote("notes/foo.md", "notes/bar.md")).toBe("changed");
  });

  it("returns 'unknown' when loadedPath is null", () => {
    expect(checkPartialEditSourceNote(null, "notes/foo.md")).toBe("unknown");
  });

  it("returns 'unknown' when currentPath is null", () => {
    expect(checkPartialEditSourceNote("notes/foo.md", null)).toBe("unknown");
  });

  it("returns 'unknown' when both paths are null", () => {
    expect(checkPartialEditSourceNote(null, null)).toBe("unknown");
  });

  it("treats an empty string the same as null (fails safe as 'unknown', never as a spurious match)", () => {
    expect(checkPartialEditSourceNote("", "")).toBe("unknown");
    expect(checkPartialEditSourceNote("", "notes/foo.md")).toBe("unknown");
    expect(checkPartialEditSourceNote("notes/foo.md", "")).toBe("unknown");
  });

  it("is case- and byte-sensitive (no path normalization is performed)", () => {
    expect(checkPartialEditSourceNote("Notes/Foo.md", "notes/foo.md")).toBe("changed");
  });
});

describe("PartialEditView.applyEdit: source-note check runs before the content-based conflict check (static ordering pin)", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../src/view/PartialEditView.ts"),
    "utf-8"
  );

  it("applyEdit calls checkPartialEditSourceNote strictly before parseDocument/applySubtreeEdit", () => {
    const start = source.indexOf("private applyEdit(): boolean {");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("\n  private updateDirtyState", start);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);

    const sourceCheckIndex = body.indexOf("checkPartialEditSourceNote(");
    const parseDocumentIndex = body.indexOf("parseDocument(editor.getValue())");
    const applySubtreeEditIndex = body.indexOf("applySubtreeEdit(");

    expect(sourceCheckIndex).toBeGreaterThan(-1);
    expect(parseDocumentIndex).toBeGreaterThan(-1);
    expect(applySubtreeEditIndex).toBeGreaterThan(-1);
    expect(sourceCheckIndex).toBeLessThan(parseDocumentIndex);
    expect(sourceCheckIndex).toBeLessThan(applySubtreeEditIndex);
  });

  it("both new reason keys are referenced (path-mismatch and path-unavailable are distinguished, never collapsed into one message)", () => {
    expect(source).toContain('"reason.partialEditSourceNoteChanged"');
    expect(source).toContain('"reason.partialEditSourceNoteUnknown"');
  });
});
