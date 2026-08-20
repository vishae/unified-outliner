# Phase 5T-8A: paragraph のダブルクリック動作を Partial Edit 起動から inline rename へ統一する

作成日: 2026-08-20

## 0. 背景

Phase 5T-7B（設計監査）→ 分離テスト（利用者による実機切り分け）→ Phase 5T-7C（pointerdown
ベースの独立二重クリック検出への置き換え）→ 実機受入（コミット `0399cc4`）により、Outline Tree
行のダブルクリックが heading/list/paragraph すべてで安定して機能するようになった。

その上で、利用者から次の意図が示された。

- heading のダブルクリック → inline rename（既存どおり）
- list のダブルクリック → inline rename（既存どおり）
- paragraph のダブルクリック → inline rename（**新規**。5T-7A/5T-7C までは Paragraph Partial
  Edit Pane の起動だった）
- paragraph Partial Edit Pane はダブルクリックでは開かない
- Paragraph Partial Edit の機能自体は削除しない — context menu（「段落を編集…」）／F2／editor
  側の編集という既存の明示的導線からは引き続き利用できる

本フェーズは、この意図どおりに paragraph のダブルクリック時の遷移先だけを変更する。5T-7C の
pointerdown ベース独立二重クリック検出・D&D・Partial Edit Pane 本体には一切触れない。

ベースコミット: `343f9b8` / `c2e4ad0` / `9923a18` / `c0f91a3` / `8bc2b5d` / `2198dc0` /
`62404e3` / `3189671` / `e4b4e5d` / `0399cc4`。

## 1. 実装前確認（§2 の回答）

実装に先立ち、以下をコードの直接監査により確認した。

1. **`beginRenameForNode` は paragraph node を受け入れられるか** — 受け入れられない。
   `node.kind !== "section" && node.kind !== "list"` で即座に return するガードがあり、また
   `beginRename` 自身も `kind: "section" | "list"` に型で縛られ、`doc.nodes.get(nodeId)` +
   `isSectionNode`/`isListNode` 判定を行う。paragraph は `doc.nodes`（BlockNode の集合）に
   一切存在しない（`ComplexBlockInfo` 由来）ため、既存の経路をそのまま流用することはできない。
2. **paragraph を渡した場合に heading/list 用の構造編集へ誤って入らないか** — 入らない。
   `renameSection`/`renameListItem`（`edit/renameBlock.ts`）は `doc.nodes.get(nodeId)` +
   `isSectionNode`/`isListNode` で解決するため、paragraph の id（`doc.nodes` に存在しない）を
   渡しても構造的に解決不能であり、そもそも呼び出し自体が発生しないよう設計する（後述）。
3. **paragraph 本文の source 再解決が rename 保存時にも安全に行われるか** — 行われる。
   `edit/paragraphPartialEdit.ts#applyParagraphEdit` を commit 時にそのまま再利用する。この
   関数は Paragraph Partial Edit の Apply が既に使っている、`complexBlockId`/`parentId`/
   `depth`/本文内容の4段階再解決チェック（resolve-failed / identity-changed / content-changed
   / blank-line-not-allowed）を備えた既存の安全なプリミティブであり、新しい書き込みロジックは
   一切追加しない。
4. **paragraph が複数行の場合の rename 表示・保存結果は何か** — `applyParagraphEdit` は複数行
   （ハードラップ）paragraph の伸縮を既に安全にサポートしている（空白行の混入のみを、段落分割を
   防ぐために拒否する）。ただし、rename 入力欄は heading/list と同一の既存 UI をそのまま再利用
   するため、Enter キーは常に確定（コミット）に割り当てられており、新しい改行をタイプ入力する
   ことはできない（既存の改行は初期値としてそのまま保持され、削除は可能）。この制限は明示的な
   既知の制約として §6 に記載する。
5. **空 paragraph、空白だけの paragraph、末尾 paragraph で安全か** — 安全である。
   `parser/complexBlocks.ts#scanParagraphBlocks` の `isCandidate` は空行・空白のみの行を候補
   から除外するため、空/空白のみの paragraph はそもそも Tree 上の paragraph ノードとして出現
   しない。末尾 paragraph は `applyParagraphEdit` のスライス処理がそのまま安全に対応済み
   （末尾側のスライスが空配列になるだけ）。rename 入力を全消去した場合は `applyParagraphEdit`
   が空行として拒否する（`blank-line-not-allowed`）。
6. **callout / blockquote / code fence / table / list 内 paragraph、CompositeBlock member
   等の readOnly 範囲を誤って rename 対象にしないか** — しない。`OutlineTreeParagraphNode` は
   `tree/buildOutlineTree.ts#groupParagraphBlocks` が `editability === "supported"` の
   paragraph のみから生成しており、callout/blockquote/code fence/table 内部の行は
   `mergeBlockRangesSafely` の種別優先度（callout > blockquote > (fenced-code, table,
   thematic-break) > paragraph）により、そもそも `kind: "paragraph"` の `editability:
   "supported"` な `ComplexBlockInfo` として現れない。CompositeBlock member は別 kind
   （`"composite"`/`"complex-member"`）であり `isOutlineParagraphNode` に一致しない。したがって
   Tree 上で `isOutlineParagraphNode(node)` が真になる時点で、これらは構造的に除外済みである。
7. **Paragraph Partial Edit が扱う paragraph と、Tree inline rename が扱える paragraph の対象
   範囲が一致するか** — 完全に一致する。両者とも、既存の
   `resolveParagraphFromTreeHint`（`edit/paragraphTreeMove.ts`）+
   `buildParagraphMoveAnchor` の組み合わせ（showParagraphMoveMenu/handleParagraphDragStart が
   既に使っているのと全く同じペア）で解決するため、新しい解決ロジックは一切追加していない。

## 2. 採用方針

**方針A（既存 `beginRename`/`beginRenameForNode`/`commitRename`/`cancelRename` の枠組みを
最小拡張）を採用した。**

- `beginRename` の `kind` を `"section" | "list"` から `"section" | "list" | "paragraph"` へ
  拡張し、`paragraphSnapshot?: ParagraphMoveAnchor` という追加の任意引数を設けた。
  section/list 用の既存スナップショット構築コード（`parseDocument`/`doc.nodes.get`/
  `isSectionNode` 判定/`SectionRenameSnapshot`・`ListRenameSnapshot` 構築）は1行も変更して
  いない（`else` 分岐へそのまま温存）。
- `innerEl.empty()` 以降のテキストエリア構築・keydown/input/blur/click の配線・
  `this.renameState` への代入は、3種別すべてで完全に共有（kind非依存）のまま。これが
  「既存 inline rename UI を再利用すること」の実装である。
- 新規メソッド `beginParagraphRenameForNode(nodeId)` を追加し、
  `resolveParagraphFromTreeHint` + `buildParagraphMoveAnchor`（`this.currentDoc`/
  `this.currentComplexScan` 起点 — showParagraphMoveMenu/handleParagraphDragStart と同一の
  既存慣習）で anchor を解決し、`beginRename(nodeId, "paragraph", innerEl, rowSelfEl, anchor)`
  へ委譲する。`beginRenameForNode` 自体（heading/list 専用）は無変更。
- `commitRename` の outcome 算出を2分岐→3分岐に拡張し、`state.kind === "paragraph"` の場合は
  `applyParagraphEdit(doc, state.snapshot, rawValue)` を呼ぶ。section/list の既存2分岐は
  文字列として無変更。
- renderNode のパラグラフ pointerdown 分岐（`else if (isParagraph)`）は、
  `onDoubleClick` コールバックの委譲先を `openParagraphPartialEditFromTree` から
  `beginParagraphRenameForNode` へ1行変更しただけで、5T-7C の検出機構
  （`handleRowPointerDownForDoubleClick`／`setTimeout(0)` 遅延／hit-target 判定）はすべて
  無変更のまま流用している。

## 3. paragraph inline rename の対象・対象外

初期スコープは安全側に限定した。

**対象**

- Tree で通常 paragraph として表示される単独 paragraph（section 直下・top-level・list item
  子いずれも含む — 既存の paragraph Tree 表示対象と完全一致）
- 同一 paragraph block の表示テキストのみの編集（複数行のハードラップも含む）

**対象外**（今回は一切実装しない）

- CompositeBlock 内部の member paragraph（既存の readOnly 契約により Tree にも表示されない）
- callout / blockquote / code fence / table 内部構造を壊す編集（構造的に到達不能）
- section / list 境界の変更
- paragraph の複数ブロック化・削除・新規挿入・複数 paragraph の統合／分割
  （`applyParagraphEdit` の blank-line 拒否により防止）
- Tree Partial Edit（別ペイン）自体の設計変更
- Markdown 構造を再解釈する rename
- モバイル用の新規編集 UI（paragraph rename は heading/list と同じ、モバイル専用の別導線は
  追加していない）

## 4. paragraph double click の最終遷移先と役割分担

- **ダブルクリック**: paragraph 本文のクイックな inline rename（本フェーズで新規）
- **F2**: Paragraph Partial Edit Pane を開く（`handleTreeKeyDown` の F2 分岐、無変更）
- **context menu「段落を編集…」**（`showParagraphMoveMenu`）: Paragraph Partial Edit Pane を
  開く（無変更）
- **本文（body editor）側の編集**: 従来どおりの通常のテキスト編集（無変更）

Paragraph Partial Edit Pane 自体（`view/PartialEditView.ts`・
`main.ts#activatePartialEditViewForParagraph`・`openParagraphPartialEditFromTree`）は削除も
変更もしていない。

## 5. source 再解決・保存・no-op 契約

- **開始時**: `beginParagraphRenameForNode` が `this.currentDoc`/`this.currentComplexScan`
  （直近の refresh() が保持する既存の Tree 状態）を起点に、`resolveParagraphFromTreeHint` +
  `buildParagraphMoveAnchor` で anchor を再解決する。解決できない場合（対象外・再解決不能・
  曖昧一致）は Notice を出さず無条件に no-op とする（ダブルクリックには元々「開く」以外の見た目
  変化がないため、失敗時に通常表示のまま何も起きないのは自己説明的であり、Partial Edit の
  ような明示的失敗 Notice は不要と判断した）。
- **保存時（Enter / blur-with-change）**: `commitRename` がエディタの現在内容を
  `parseDocument` で必ず再パースし、`applyParagraphEdit` がその新鮮な `doc` に対して
  `complexBlockId`/`parentId`/`depth`/本文内容の4段階を独立に再検証してから初めて
  `lines` を書き換える。Partial Edit の Apply と全く同じ再解決契約であり、新しい書き込み経路は
  一切追加していない。
- **キャンセル時（Escape / blur-without-change）**: `cancelRename` は無変更 —
  `applyLineEditOutcome`/`editor.replaceRange` を一切呼ばず、`renderTree()` のみで表示を戻す。
  本文には一切書き込まれない。

## 6. Undo / Redo 契約

`commitRename` はどの kind でも `applyLineEditOutcome` を1回だけ呼ぶ、単一の共有経路を通る。
`applyLineEditOutcome` 内部の `editor.replaceRange()` 呼び出しは1回のみであり、Phase
5C-1A/1B「inline rename の安全復帰措置」で既に実機確認済みの「1回の `replaceRange` は必ず
独立した1つの Undo/Redo 単位になる」という性質がそのまま適用される。paragraph rename 専用の
追加の Undo/Redo 配線は不要であり、追加していない。

## 7. 既知の制約

- rename 入力欄（textarea）の Enter キーは既存の heading/list rename 契約どおり常に確定
  （コミット）であり、複数行 paragraph に新しい改行をタイプ入力することはできない。既存の
  改行を含む初期テキストの表示・部分編集・削除は可能。将来、複数行編集そのものを強化したい
  場合は、Enter の意味を変える（Shift+Enter を改行、Enter を確定にする等）専用の設計判断が
  別途必要になる — 本フェーズのスコープ外。
- rename 入力を全消去すると `blank-line-not-allowed` で拒否され、本文は変更されない
  （空 paragraph を作ることによる意図しない段落分割を防ぐため）。

## 8. テスト

- `tests/paragraphInlineRename.test.ts`（新規）: `beginParagraphRenameForNode` の解決ロジック
  （`this.currentDoc`/`this.currentComplexScan` 起点、resolveParagraphFromTreeHint +
  buildParagraphMoveAnchor の再利用、readOnlyNodeIds を参照しないこと、失敗時の無条件 no-op）、
  `beginRename` の paragraph 分岐（section/list 分岐の無変更、paragraphSnapshot の扱い）、
  `commitRename` の3分岐化、D&D／`parseDocument.ts`／Partial Edit Pane 本体の無変更確認。
- `tests/paragraphPartialEditLaunchUiWiring.test.ts`（更新）: paragraph pointerdown 分岐の
  委譲先が `beginParagraphRenameForNode` になったことの確認、`openParagraphPartialEditFromTree`
  の呼び出し箇所が F2 のみ（1箇所）になったことの確認。
- `tests/paragraphOutlineTreeUiWiring.test.ts`（更新）: 同様の1件を更新。F2／context menu
  関連のテストは無変更のまま全通過。

`applyParagraphEdit` 自体の純粋な再解決/拒否ロジックは既存の `tests/paragraphPartialEdit.test.ts`
で既にテスト済みであり、本フェーズでは再テストしていない（既存の関数を再利用しているだけである
ことをテストで示すに留めた）。

## 9. 品質ゲート

- `npx tsc --noEmit`: 成功（エラーなし）
- `npx vitest run`: 75ファイル / 1313件全通過
- `npm run lint`: エラーなし（`src/settings.ts` の既存・本フェーズ無関係の警告3件のみ）
- `npm run build`: 成功
- `git diff -- src/parser/parseDocument.ts styles.css`: 差分なし（0行）
