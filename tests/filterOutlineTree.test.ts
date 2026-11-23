import { describe, expect, it } from "vitest";
import { filterOutlineTree, normalizeOutlineSearchQuery } from "../src/tree/filterOutlineTree";
import type { OutlineTreeNode } from "../src/tree/buildOutlineTree";

function h(id: string, headingText: string, children: OutlineTreeNode[] = []): OutlineTreeNode {
  return { kind: "section", id, headingText, headingLevel: 2, line: 0, children };
}
function li(id: string, text = "", children: OutlineTreeNode[] = []): OutlineTreeNode {
  return { kind: "list", id, text, children } as unknown as OutlineTreeNode;
}
function comp(id: string, children: OutlineTreeNode[]): OutlineTreeNode {
  return { kind: "composite", id, label: "List + Paragraph", children } as unknown as OutlineTreeNode;
}
function para(id: string): OutlineTreeNode {
  return { kind: "paragraph", id, children: [] } as unknown as OutlineTreeNode;
}

const tree: OutlineTreeNode[] = [
  h("work", "Work", [h("tasks", "Work Tasks", [li("l1", "buy milk")]), h("shut", "Shutdown")]),
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

  it("hides a match's non-matching children", () => {
    const out = filterOutlineTree(tree, "work").tree;
    expect(ids(out)).toEqual([["work", ["tasks"]]]);
    expect(out[0].children[0].children).toEqual([]);
  });

  it("matches list items, keeping parent headings and parent items", () => {
    const listTree: OutlineTreeNode[] = [
      h("a", "Errands", [li("p", "Shops", [li("c", "Buy MILK"), li("d", "bread")]), para("x")]),
      h("b", "Other", [comp("k", [li("m", "milk run"), para("y")])]),
    ];
    const { tree: out, matchIds } = filterOutlineTree(listTree, "milk");
    expect(ids(out)).toEqual([
      ["a", [["p", ["c"]]]],
      ["b", [["k", ["m"]]]],
    ]);
    expect(matchIds).toEqual(new Set(["c", "m"]));
  });

  it("never matches composite labels or paragraphs themselves", () => {
    const t: OutlineTreeNode[] = [h("a", "A", [comp("k", [para("y")])])];
    expect(filterOutlineTree(t, "paragraph").tree).toEqual([]);
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
