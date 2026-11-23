import { describe, expect, it } from "vitest";
import { filterOutlineTree, normalizeOutlineSearchQuery } from "../src/tree/filterOutlineTree";
import type { OutlineTreeNode } from "../src/tree/buildOutlineTree";

function h(id: string, headingText: string, children: OutlineTreeNode[] = []): OutlineTreeNode {
  return { kind: "section", id, headingText, headingLevel: 2, line: 0, children };
}
function li(id: string, children: OutlineTreeNode[] = []): OutlineTreeNode {
  return { kind: "list", id, children } as unknown as OutlineTreeNode;
}

const tree: OutlineTreeNode[] = [
  h("work", "Work", [h("tasks", "Work Tasks", [li("l1")]), h("shut", "Shutdown")]),
  h("personal", "Personal", [h("ptasks", "Personal Tasks"), h("notes", "Notes", [h("s1", "Summary")])]),
];

const ids = (nodes: ReadonlyArray<OutlineTreeNode>): unknown[] =>
  nodes.map((n) => (n.children.length ? [n.id, ids(n.children)] : n.id));

describe("filterOutlineTree", () => {
  it("keeps matches with their parent headings, case-insensitive", () => {
    const { tree: out, matchIds } = filterOutlineTree(tree, "  TASKS ");
    expect(ids(out)).toEqual([
      ["work", ["tasks"]],
      ["personal", ["ptasks"]],
    ]);
    expect(matchIds).toEqual(new Set(["tasks", "ptasks"]));
  });

  it("finds a deep match and keeps every ancestor", () => {
    expect(ids(filterOutlineTree(tree, "summ").tree)).toEqual([["personal", [["notes", ["s1"]]]]]);
  });

  it("hides a match's non-matching children and all list items", () => {
    const out = filterOutlineTree(tree, "work").tree;
    expect(ids(out)).toEqual([["work", ["tasks"]]]);
    expect(out[0].children[0].children).toEqual([]);
  });

  it("returns nothing for no match or an empty query", () => {
    expect(filterOutlineTree(tree, "zzz").tree).toEqual([]);
    expect(filterOutlineTree(tree, "   ").tree).toEqual([]);
  });

  it("does not mutate the input tree", () => {
    const before = JSON.stringify(tree);
    filterOutlineTree(tree, "tasks");
    expect(JSON.stringify(tree)).toBe(before);
  });

  it("normalises the query", () => {
    expect(normalizeOutlineSearchQuery("  Foo ")).toBe("foo");
  });
});
