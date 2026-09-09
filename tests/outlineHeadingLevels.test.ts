import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { buildOutlineTree, OutlineTreeNode } from "../src/tree/buildOutlineTree";
import {
  collectOutlineHeadingLevels,
  planHeadingLevelFold,
} from "../src/tree/outlineHeadingLevels";

function labelOf(node: OutlineTreeNode): string {
  if (node.kind === "section") return node.headingText;
  if (node.kind === "list") return node.text;
  return node.label;
}

function idOf(nodes: OutlineTreeNode[], label: string): string {
  for (const node of nodes) {
    if (labelOf(node) === label) return node.id;
    const deeper = tryId(node.children, label);
    if (deeper) return deeper;
  }
  const deeper = tryId(nodes, label);
  if (!deeper) throw new Error(`no node labelled ${label}`);
  return deeper;
}

function tryId(nodes: OutlineTreeNode[], label: string): string | null {
  for (const node of nodes) {
    if (labelOf(node) === label) return node.id;
    const deeper = tryId(node.children, label);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * 26048-FEAT-001: the level projection behind the bulk collapse/expand
 * buttons. Pure, so unlike the bar's own DOM wiring (covered by
 * tests/headingLevelFoldBarUiWiring.test.ts's static source checks) this
 * can be asserted for real.
 */
describe("collectOutlineHeadingLevels", () => {
  it("returns one group per heading level present, in ascending level order", () => {
    const doc = parseDocument("### Deep\nbody\n# Top\nbody\n## Mid\nbody\n");
    const tree = buildOutlineTree(doc, {});
    expect(collectOutlineHeadingLevels(tree, doc, new Set()).map((g) => g.level)).toEqual([
      1, 2, 3,
    ]);
  });

  it("has no group for a level the note doesn't use", () => {
    const doc = parseDocument("# Top\nbody\n### Deep\nbody\n");
    const tree = buildOutlineTree(doc, {});
    expect(collectOutlineHeadingLevels(tree, doc, new Set()).map((g) => g.level)).toEqual([
      1, 3,
    ]);
  });

  it("collects every heading at a level, however deeply nested", () => {
    const doc = parseDocument("# A\n## A1\nbody\n# B\n## B1\nbody\n");
    const tree = buildOutlineTree(doc, {});
    const groups = collectOutlineHeadingLevels(tree, doc, new Set());
    const h2 = groups.find((g) => g.level === 2);
    expect(h2?.foldableIds).toEqual([idOf(tree, "A1"), idOf(tree, "B1")]);
  });

  it("counts a heading whose body is only a code block as foldable, per canCollapseOutlineNode", () => {
    const doc = parseDocument("## Artefacts\n```dataviewjs\ndv.table()\n```\n");
    const tree = buildOutlineTree(doc, {});
    const [h2] = collectOutlineHeadingLevels(tree, doc, new Set());
    expect(h2.foldableIds).toHaveLength(1);
  });

  it("keeps a level with nothing foldable as a group with an empty foldableIds — the disabled-button case", () => {
    const doc = parseDocument("# Top\nbody\n## Empty\n");
    const tree = buildOutlineTree(doc, {});
    const groups = collectOutlineHeadingLevels(tree, doc, new Set());
    const h2 = groups.find((g) => g.level === 2);
    expect(h2).toBeDefined();
    expect(h2?.foldableIds).toEqual([]);
  });

  it("ignores list nodes — a level button is about headings only", () => {
    const doc = parseDocument("# Top\n- item\n  - nested\n");
    const tree = buildOutlineTree(doc, { includeLists: true });
    // Guard the guard: if the option name ever drifts, this test would
    // otherwise pass trivially on a heading-only tree.
    expect(tryId(tree, "item")).not.toBeNull();
    const groups = collectOutlineHeadingLevels(tree, doc, new Set());
    expect(groups.map((g) => g.level)).toEqual([1]);
    expect(groups[0].foldableIds).toEqual([idOf(tree, "Top")]);
  });

  it("anyExpanded is true while some foldable heading at the level is expanded", () => {
    const doc = parseDocument("# A\nbody\n# B\nbody\n");
    const tree = buildOutlineTree(doc, {});
    const collapsed = new Set([idOf(tree, "A")]);
    const [h1] = collectOutlineHeadingLevels(tree, doc, collapsed);
    expect(h1.anyExpanded).toBe(true);
  });

  it("anyExpanded is false once every foldable heading at the level is collapsed", () => {
    const doc = parseDocument("# A\nbody\n# B\nbody\n");
    const tree = buildOutlineTree(doc, {});
    const collapsed = new Set([idOf(tree, "A"), idOf(tree, "B")]);
    const [h1] = collectOutlineHeadingLevels(tree, doc, collapsed);
    expect(h1.anyExpanded).toBe(false);
  });

  it("an unfoldable heading never keeps anyExpanded true — otherwise the button could only ever collapse", () => {
    // "Empty" has nothing to fold, so it is never in collapsedIds. If it
    // were counted, anyExpanded would stay true forever and the toggle
    // would never reach its expand branch.
    const doc = parseDocument("## Real\nbody\n## Empty\n");
    const tree = buildOutlineTree(doc, {});
    const collapsed = new Set([idOf(tree, "Real")]);
    const [h2] = collectOutlineHeadingLevels(tree, doc, collapsed);
    expect(h2.anyExpanded).toBe(false);
  });

  it("tolerates a null document — every level present, nothing foldable but nodes with children", () => {
    const doc = parseDocument("# A\n## B\nbody\n");
    const tree = buildOutlineTree(doc, {});
    const groups = collectOutlineHeadingLevels(tree, null, new Set());
    expect(groups.map((g) => g.level)).toEqual([1, 2]);
    // A has a child, so it is foldable regardless of the document; B's
    // foldability can only be answered from the document, which is absent.
    expect(groups[0].foldableIds).toEqual([idOf(tree, "A")]);
    expect(groups[1].foldableIds).toEqual([]);
  });
});

describe("planHeadingLevelFold", () => {
  it("collapses every foldable heading when any is expanded", () => {
    const doc = parseDocument("# A\nbody\n# B\nbody\n");
    const tree = buildOutlineTree(doc, {});
    const [h1] = collectOutlineHeadingLevels(tree, doc, new Set([idOf(tree, "A")]));
    expect(planHeadingLevelFold(h1)).toEqual([
      { nodeId: idOf(tree, "A"), collapsed: true },
      { nodeId: idOf(tree, "B"), collapsed: true },
    ]);
  });

  it("expands every heading when none is expanded — the second click", () => {
    const doc = parseDocument("# A\nbody\n# B\nbody\n");
    const tree = buildOutlineTree(doc, {});
    const collapsed = new Set([idOf(tree, "A"), idOf(tree, "B")]);
    const [h1] = collectOutlineHeadingLevels(tree, doc, collapsed);
    expect(planHeadingLevelFold(h1)).toEqual([
      { nodeId: idOf(tree, "A"), collapsed: false },
      { nodeId: idOf(tree, "B"), collapsed: false },
    ]);
  });

  it("round-trips: collapse then expand returns every heading to expanded", () => {
    const doc = parseDocument("# A\nbody\n# B\nbody\n");
    const tree = buildOutlineTree(doc, {});
    const collapsedIds = new Set<string>();
    const apply = (): void => {
      const [group] = collectOutlineHeadingLevels(tree, doc, collapsedIds);
      for (const { nodeId, collapsed } of planHeadingLevelFold(group)) {
        if (collapsed) collapsedIds.add(nodeId);
        else collapsedIds.delete(nodeId);
      }
    };
    apply();
    expect(collapsedIds.size).toBe(2);
    apply();
    expect(collapsedIds.size).toBe(0);
  });

  it("plans nothing for a level with nothing to fold", () => {
    const doc = parseDocument("# Top\nbody\n## Empty\n");
    const tree = buildOutlineTree(doc, {});
    const h2 = collectOutlineHeadingLevels(tree, doc, new Set()).find((g) => g.level === 2);
    expect(planHeadingLevelFold(h2!)).toEqual([]);
  });
});
