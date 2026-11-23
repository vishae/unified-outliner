/**
 * 26048-BUG-002: the tree keeps showing a section folded after the editor
 * has dropped that fold.
 *
 * When a note is changed from outside Obsidian (an OPSA Sync rewriting a
 * table, a shell edit), CodeMirror drops any fold whose text was replaced,
 * without sending an unfoldEffect. The CM6 -> tree sync only listened for
 * fold and unfold effects, so the tree's saved state was never told.
 *
 * Fix direction (Serena, 2026-11-20): the tree follows the editor. After a
 * text change that leaves the editor with fewer folds, every heading or
 * list item the tree has saved as folded but the editor no longer folds is
 * cleared. Folds are only ever cleared here, never added.
 */

/** One tree row the check needs: its 0-based start line and fold identity. */
export interface FoldableRow {
  line: number;
  identity: string;
}

/**
 * Pure: the identities saved as folded whose row the editor no longer
 * folds. `foldedLines` holds the 0-based line each editor fold starts on.
 */
export function findDroppedFolds(
  rows: ReadonlyArray<FoldableRow>,
  savedFolded: ReadonlySet<string>,
  foldedLines: ReadonlySet<number>
): string[] {
  const dropped: string[] = [];
  for (const row of rows) {
    if (savedFolded.has(row.identity) && !foldedLines.has(row.line)) {
      dropped.push(row.identity);
    }
  }
  return dropped;
}
