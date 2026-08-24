# Example outline note / サンプル アウトラインノート

This note demonstrates the block types currently supported by the Outline
Tree, so you can try rename, move, delete, and insert operations from the
Tree's context menu (right-click), F2 / double-click, and drag-and-drop.
It is organized into **Basic Blocks** and **Extended Blocks**. New
sections can be appended later following the same pattern — see
"Notes for future additions" at the end.

このノートは、Outline Tree が現在サポートしているブロック種別をまとめた
ものである。Tree のコンテキストメニュー（右クリック）、F2／ダブルクリッ
ク、ドラッグ＆ドロップから、rename・move・delete・insert を試すことが
できる。「Basic Blocks（基本ブロック）」と「Extended Blocks（拡張ブロッ
ク）」の2部構成であり、末尾の「Notes for future additions」に従えば今後
セクションを追加していける。

## Basic Blocks / 基本ブロック

### Paragraph / 段落

**Try:** double-click a paragraph to rename it inline; right-click for
"Insert paragraph before/after" and "Delete paragraph"; drag to move it
next to an adjacent block. This applies to top-level and section-direct
paragraphs only (not paragraphs nested inside a list item).

This is the first paragraph at the top level of this note.

This is a second, separate top-level paragraph — try moving one of these
two paragraphs above the other.

### Heading / 見出し

**Try:** double-click a heading (or press F2) to rename it inline;
right-click for "Insert heading before/after" and "Delete heading";
drag-and-drop, or the Tree's move commands, to reorder headings or
change their nesting.

#### Sub-heading A / 副見出し A

Body text belonging to Sub-heading A.

#### Sub-heading B / 副見出し B

Body text belonging to Sub-heading B.

##### Nested sub-heading B-1 / 入れ子副見出し B-1

Body text one level deeper, to test moving a heading in and out of a
parent section.

### List (Unordered) / リスト（記号）

**Try:** double-click or F2 to rename an item; right-click for
"Insert item before/after" and "Delete item"; drag to reorder items or
change indent level (nesting).

- First item
  - Nested item under the first item
- Second item
- Third item

### List (Ordered) / リスト（番号）

- Try the same rename / insert / delete / move operations as the
  unordered list above.

1. First item
2. Second item
   1. Nested item under the second item
3. Third item

### List (Task) / リスト（タスク）

**Try:** the same Tree operations as any other list item, and confirm
that renaming an item preserves its checked/unchecked state.

- [ ] Unchecked task
- [x] Checked task
- [ ] Another unchecked task
  - [ ] Nested task under the previous item

### Callout / コールアウト

**Try:** look at how these appear in the Outline Tree. Callout blocks
are currently shown as read-only / diagnostic nodes — rename, move,
delete, and insert from the Tree do not apply to them yet. Edit their
content directly in the body editor instead. Confirm that the
paragraph/heading/list nodes around a callout are unaffected by its
presence.

> [!note] Note callout
> This is a note-style callout.

> [!warning] Warning callout
> This is a warning-style callout.

> [!tip] Tip callout
> This is a tip-style callout, and can contain multiple lines.
> Here is a second line inside the same callout.

### Blockquote / 引用

**Try:** the same observation as for callouts above — blockquotes are
currently diagnostic-only in the Tree, with no rename/move/delete/insert
support yet.

> This is a simple blockquote.
> It can span multiple lines, like this second line.

> This is a second, separate blockquote further down the note.

## Extended Blocks / 拡張ブロック

These sections mix multiple block kinds in the same area of the note, to
confirm the Tree correctly separates and operates on each kind
independently — for example, that renaming or moving a list item does
not disturb a nearby callout or blockquote, and vice versa.

### List and Blockquote / リストと引用

- List item one
- List item two
- List item three

> A blockquote placed right after the list above. Try renaming or
> reordering the list items and confirm this blockquote's position and
> content are unaffected.

### List and Callout / リストとコールアウト

- List item one
- List item two
- List item three

> [!tip] Tip callout
> A callout placed right after the list above. Try the same checks as
> in "List and Blockquote".

## Notes for future additions / 今後の追加についてのメモ

To add a new example, append a new `###` subsection under either
**Basic Blocks** or **Extended Blocks** (or add a new `##` category for
a kind not covered here, such as a table or fenced code block), using
the same "English / 日本語" heading pattern and a short **Try:**
guidance line before the example content.

新しい例を追加する場合は、**Basic Blocks** または **Extended Blocks** の
下に新規の `###` サブセクションを追加する（あるいは、ここに含まれてい
ないブロック種別、例えば table や fenced code block のための新しい `##`
カテゴリを追加してもよい）。見出しは "English / 日本語" の形式に揃え、
例の本文の前に短い **Try:** 案内行を置くこと。
