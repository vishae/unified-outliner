# Unified Outliner — Tree Interaction / Tree Move 設計（Phase 5T-0）

作成日: 2026-08-17
状態: **設計のみ。承認待ち。本番コード（`src/`）は一切変更していない。**
対象リポジトリ: `/Users/kazumikaizuka/Obsidian/unified-outliner-public`
基準コミット: `6ecafa0`（5P-4）・`a7e0bcf`（5P-3）・`b0b7f02`（5P-2）・`fcd1128`（5P-1R）・`5025534`（5P-0/5P-1）
関連: `docs/phase5p_paragraph-block-foundation-plan.md`（Phase 5P 全体計画・完了状態）、`docs/phase5p3d_paragraph-tree-display-design.md`（5P-3 の確定設計・read-only 契約の原典）、`docs/phase5d0_3_composite-block-outline-tree-projection-design-memo.md`（本ドキュメントが随所で参照する既存の Tree 投影・Tree 発火 move の先例）、`docs/統合実装ロードマップ_2026-08-05.md` §3.8

## 0. 前提

本チケットでは調査と設計提示のみを行う。本番機能は実装しない。5P-4（コミット `6ecafa0`）が確定させた「本文カーソル起点・同一親限定の安全な隣接交換」契約、および 5P-3（コミット `a7e0bcf`）が確定させた「Tree 上の paragraph は read-only な葉ノード」契約は、本ドキュメントのいかなる提案によっても変更されない。両契約を変更する提案がある場合は、その旨を明示し、別途承認を要求する（本ドキュメントには存在しない）。

## 1. 目的と3分類の再確認

Tree 上の paragraph に対して、将来どこまで移動操作を提供できるかを、Markdown の保存性・構造安全性・既存 Tree 契約の観点から設計する。次の3種類は難易度が全く異なるため、明確に分離して検討する。

| 分類 | 内容 | 本ドキュメントでの扱い |
|---|---|---|
| ① Tree selection と本文カーソルの同期 | Tree 上で paragraph を選択したときの本文ジャンプ、本文カーソルが paragraph 内にあるときの Tree 側ハイライト | §4 で現状調査のみ。5T-0 では変更を提案しない |
| ② context menu / キーボードによる離散的な上下移動 | 5P-4 の隣接交換契約をそのまま Tree の入口として再利用する | §5 で設計する。**5T-1 の実装候補** |
| ③ mouse drag & drop による任意位置への移動 | drop target 判定・視覚表現・cross-model 移動を伴う独立の設計課題 | §6 で比較のみ行う。**本実装は 5T-0 の対象外**、5T-2 以降へ切り出す |

## 2. 絶対に維持する原則（5P からの継承・変更なし）

- Markdown を唯一の正とする。
- `parseDocument.ts` を変更しない（本ドキュメント作成にあたり同ファイルは読むだけで、一切変更していない）。
- paragraph を `ParsedDocument.nodes` に入れない。
- paragraph を CompositeBlock / CompositeBlock member として扱わない。
- scan-local `complexBlockId` を永続 identity・fold identity・選択復元 key・drag payload の永続キーに使わない。
- paragraph の Tree fold を導入しない。
- paragraph の Tree 表示設定（`showParagraphsInOutline`）は既定オフのまま維持する。
- paragraph の追加・削除・rename・自動分割・自動結合は設計対象外とする。
- list item / subtree の移動・indent/outdent・list 跨ぎを、paragraph の単純移動として扱わない。
- section 境界を跨ぐ移動を許可しない。
- 構造が一意に確定できない場合は、本文を変更しない。
- 失敗・拒否時は no-op + 利用者向け Notice とする。
- 既存の section / list / CompositeBlock / standalone complex block の Tree 操作を回帰させない。

## 3. 現行実装の調査結果（§6 監査）

対象ファイルごとに、現状・本チケットへの影響・利用可否を報告する。

### 3.1 `src/view/OutlineTreeView.ts`

- `renderNode()` 内の右クリックメニュー分岐（1320行目付近）は `isOutlineSectionNode` → `showStructureCommandMenu`、`isOutlineListNode` → `showListCommandMenu`、`isComposite` → `showCompositeCommandMenu`、`isComplexMember && node.isStandalone` → `showStandaloneComplexBlockMenu` の4分岐であり、paragraph（`isOutlineParagraphNode`）用の分岐は存在しない。5P-4 時点でこれは確認済み（`tests/paragraphOutlineTreeUiWiring.test.ts` の静的ソースチェックで固定済み）。
- **CompositeBlock の Tree 発火 move（`showCompositeCommandMenu` → `dispatchAndApplyCompositeMove`、2299〜2878行目）は、本チケットが設計する「context menu 上下移動」の直接の先例である**。`showCompositeCommandMenu` はメニュー構築時に `this.currentComposites`（直近の `refresh()` が計算した最新の投影結果）から対象を再取得し、`evaluateCompositeBlockMovability` を up/down それぞれに対して独立に呼んで、真になった方向だけメニュー項目を出す。クリック時は `dispatchAndApplyCompositeMove` が `editor.getValue()` で **その瞬間の本文**を取得し直し、`moveCompositeBlock(text, {snapshot, direction}, rules)` という純粋関数に委譲する。この関数は内部で `parseDocument → scanComplexBlocks → matchCompositeBlocks` を再実行し、`snapshotMatches` で `snapshot`（後述）と完全一致する CompositeBlock を再探索してから初めて `swapBlocks` を呼ぶ。**Tree ノードの id は一度もこの再解決に使われない**。
- drag & drop の `dragstart`/`dragover`/`drop`/`dragend` は `if (!readOnly) { ... }` でのみ張られる（1569行目）。paragraph は常に `readOnlyNodeIds` に含まれるため、この分岐に一度も到達しない。
- キーボード操作（Up/Down/Enter）は `outlineNavigation.ts` 側の kind 非依存ロジックのみに依存しており、paragraph も他ノードと同様に選択・Enter ジャンプができる（§4 参照）。

### 3.2 `src/tree/buildOutlineTree.ts`

- `OutlineTreeParagraphNode` は `isReadOnly: true` / `isLeaf: true` をリテラル型で持つ（5P-3、5P-4 で再確認済み）。
- `collectReadOnlyOutlineNodeIds` は `node.kind === "paragraph"` を無条件で read-only 集合に含める。
- `OutlineTreeCompositeNode`（`isOutlineCompositeNode` で判別）の実装パターン——「読み取り専用の投影に、限定的な context menu だけを外側から追加する」——は、本チケットの提案（§5）が模倣すべき唯一の既存前例である。paragraph 用に新しい `kind` を増やす必要はなく、既存の `OutlineTreeParagraphNode` に手を加えずに、`OutlineTreeView.ts` 側にだけ新しい分岐を足せば済む見込みが高い(§5-4)。

### 3.3 `src/tree/outlineNavigation.ts`

- `flattenVisibleOutlineTree` / `buildNodeByIdMap` / `buildParentIdMap` / `nextVisibleId` / `prevVisibleId` はすべて `.id`/`.children` のみに依存する kind 非依存の純粋関数であり、paragraph ノードを含む Tree に対しても無改修で正しく動作する。**ここは唯一のリスクなしポイントである**（Phase 5D-0.3 設計メモ §1.4 と同じ結論）。

### 3.4 `src/move/resolveMoveTarget.ts`

- 5P-4 で `isSafeToMoveComplexBlock` の paragraph 特例を廃止し、`findComplexSiblingTarget` の `parentId` 一致フィルタのみで list item 境界安全性を保証する設計にした。この関数群は本文カーソル起点でしか呼ばれておらず、Tree ノード id・DOM state を一切参照しない、完全に Obsidian 非依存の純粋関数である。
- **5T-1（Tree context menu 上下移動）は、この既存パイプラインをそのまま呼び出すだけで実現できる**——後述するとおり、Tree 側が追加で必要とするのは「Tree ノードから、この関数群が要求する `ResolvedMoveUnit`（またはそれと同値な入力）を安全に再構築する」層だけであり、`findComplexSiblingTarget`/`moveComplexBlock` 自体には一切手を入れない（§5-3）。

### 3.5 `src/move/moveBlock.ts`

- `swapBlocks(lines, a, b)` は行範囲の入れ替えのみを行う純粋関数であり、呼び出し元が section/list/CompositeBlock/paragraph のどれであっても同一の実装を共有する。空行（gap）を保持したまま入れ替える契約は、5T-1 でも無条件に再利用できる。新しい swap ロジックを書く必要は一切ない。

### 3.6 5P-4 の `findComplexSiblingTarget` と `moveComplexBlock`

- `findComplexSiblingTarget(doc, unit, direction, scan?)` は、候補プールを `scanComplexBlocks(doc).blocks`（`ComplexBlockInfo[]`）に限定しており、`BlockNode`（list/section）を一度も対象にしていない。これが §7（paragraph ↔ list）を独立課題として切り出さざるを得ない構造的な理由である。
- `moveComplexBlock(doc, unit, direction, scan?)` は `findComplexSiblingTarget` → `swapBlocks` の2段階だけであり、`unit`（`ResolvedMoveUnit`）さえ安全に用意できれば、呼び出し元が本文カーソルであるか Tree であるかを区別しない。

### 3.7 `src/model/complexBlock.ts`

- `ComplexBlockInfo.id` の doc comment は「Stable only within a single scanComplexBlocks() call」と明記している——5P-2（`resolveParagraphAtCursor.ts`/`paragraphPartialEdit.ts`）・5P-4 のいずれも、この id を**単独の照合キーとしては使っていない**。5T-1 の設計もこの制約を踏襲する（§5-2）。

### 3.8 `src/model/compositeBlock.ts`

- `CompositeBlockSnapshot`（`edit/deleteCompositeBlock.ts`）と、それを再利用する `CompositeMoveRequest`（`edit/moveCompositeBlock.ts`）は、「Tree 表示時点の一時オブジェクトを、実行直前に本文から再構築した値と**内容で**照合し、一致したときだけ書き戻す」という、本チケットが要求する再解決方式そのものの既存実装である(§5-2 で詳述)。`CompositeBlockSnapshot.id` 自身の doc comment も「deliberately NEVER used as a matching key by snapshotMatches」と明記しており、5T-1 が踏襲すべき既存規範と完全に一致する。

### 3.9 `src/parser/complexBlocks.ts`

- `scanComplexBlocks`・`resolveParentId`・`complexBlockDepth` は既に 5P-1〜5P-4 で paragraph の range/parentId/depth を安全に再導出する唯一の権威経路として確立済みである。5T-1 が新しく必要とするスキャン・パースロジックはない。

### 3.10 `src/parser/parseDocument.ts`

- 読むだけで変更していない。section/list の権威パーサとしての役割は本ドキュメントのいかなる提案によっても変わらない。

### 3.11 `src/edit/insertBlock.ts`

- `contentColumnOf`（`parser/listContentColumn.ts` の `listItemContentColumn` の別名エクスポート）は、list item 本文開始列を計算する唯一の権威関数である。§7（paragraph ↔ list）で「インデント変換が必要になった場合にどの関数を再利用すべきか」を検討する際の参照点として調査した。5T-0 ではこれを呼び出す新規コードは書かない。

### 3.12 `src/edit/deleteCompositeBlock.ts` / `src/edit/moveCompositeBlock.ts`

- 両ファイルとも「(1) snapshot 単体の自己整合性チェック → (2) 本文を再parse・再scan・再matchして現在の実体を再探索 → (3) snapshot と内容一致するものだけ採用 → (4) 既存の安全な swap/delete プリミティブに委譲」という4段階構成を完全に共有している。5T-1 の実行経路（§5-3）は、この4段階構成を paragraph 向けに転用したものとして設計する。

### 3.13 Tree fold identity / persistence / selection restoration 関連

- `src/tree/foldIdentity.ts` は `nodeLabel`/`buildNodeIdentityMap` の内部 walk に `case "paragraph":` を明示的に持ち、「paragraph は fold identity を一切持たない」ことを 5P-3 の時点でコード上に固定済みである。
- `src/persistence/foldStateStore.ts` / `src/persistence/foldStateManager.ts` は、`"paragraph"` という文字列を一箇所も参照していない——調査の結果、paragraph が fold 永続化の対象になったことは一度もないと確認できた。
- 5T-1（paragraph は依然として fold 不可能な葉ノードのまま）はこれらのファイルに一切手を入れない設計とする。

### 3.14 既存の context menu と D&D の UI テスト

- `tests/paragraphOutlineTreeUiWiring.test.ts`（5P-3・5P-4 で拡張済み）は、Obsidian の `ItemView` を vitest 上で構築できない制約から、`OutlineTreeView.ts` の生ソーステキストを直接検査する「静的ソースチェック」方式を採る。5T-1 の実装時も同じ方式・同じファイルへの追加で、「paragraph の Tree 発火 move が許可された allow-list の外に絶対に漏れ出していないこと」を固定できる見込みである。

## 4. Tree selection と本文カーソルの同期の現状（変更を提案しない領域）

- Tree → 本文の方向（クリック・Enter によるジャンプ）は 5P-3 で確立済みであり、paragraph ノードも他ノードと全く同じ `jumpToLine` 経路を使う。読み取り専用の閲覧用ジャンプであり、5T-0 で変更を提案しない。
- 本文 → Tree の方向（カーソルが今いる行を Tree 側でハイライトする `tree/resolveHighlightedSectionId.ts`）は、`BlockNode`（section/list）のみを対象としており、`ComplexBlockInfo`/paragraph を一切参照しない。これは Phase 5D-0.3 設計メモ §1.3 が CompositeBlock について確認したのと同じ既存の構造的制約であり、paragraph 固有の欠落ではない。**本文カーソルが paragraph 内にあっても、Tree 側の「現在位置」ハイライトは何も光らない**——これは 5T-0 が新たに発生させる問題ではなく、CompositeBlock・standalone complex block を含む既存の全 `ComplexBlockKind` に共通する、5C/5D 由来の未解決事項である。5T-1（context menu 上下移動）の実装可否には影響しないため、本ドキュメントではこれ以上踏み込まず、必要であれば独立チケットとして切り出すことを推奨するに留める。

## 5. Tree context menu の上下移動（5T-1 候補）

### 5-1 許可してよい条件（すべて満たす場合のみ）

- `showParagraphsInOutline === true`
- paragraph node が現在の Tree 上で一意に解決できる
- 対応する Markdown paragraph が現行本文から再解決できる
- 5P-4 の paragraph 移動元条件（`kind === "paragraph"`・`editability === "supported"`・range/parentId/depth 確定）を満たす
- 移動先が 5P-4 と同じ allow-list 内である（paragraph↔paragraph/blockquote/callout/fenced-code/table/thematic-break。paragraph↔list・section を跨ぐ移動は 5P-4 と同様に対象外）
- 相手 block が直前または直後の隣接兄弟である
- `parentId` が完全一致する
- depth が整合する（`complexBlockDepth` により `parentId` 一致から構造的に保証される——5P-4 と同じ防御的再確認）
- section / list item 境界を越えない
- indentation の変更が必要ない（`swapBlocks` が文字を一切書き換えない設計であることから構造的に保証される——5P-4 と同じ論拠）
- 移動先が list / section を含まない
- 実行直前に本文を再パースして再検証できる

paragraph の Tree node を全般的に writable にしてはならない。paragraph は原則 read-only のまま残し、context menu の上下移動だけを、狭い allow-list の中で例外的に許可する。Rename・Delete・Insert・Indent/Outdent・Tree Partial Edit・D&D は引き続き拒否する。

### 5-2 Tree node → paragraph の安全な再解決方式（ParagraphMoveAnchor 案）

位置だけの一致、preview の一致、scan-local id の一致のどれか一つだけで対象を確定してはならない、という要求に対し、**5P-2 の `edit/paragraphPartialEdit.ts#ParagraphEditAnchor` が既に確立している3層検証を、そのまま転用する**ことを提案する。新しい照合方式を発明しない。

```ts
// 提案（未実装）: edit/paragraphPartialEdit.ts の ParagraphEditAnchor と
// 同じ4フィールド構成を、move 用に転用する案。
interface ParagraphMoveAnchor {
  complexBlockId: string;   // 層1: 安価な一次フィルタ（単独では確定させない）
  parentId: string | null;  // 層2: 構造的位置の一致
  depth: number;            // 層2: 構造的位置の一致（parentId から構造的に導出可能、5P-4 と同じ防御的再確認として明示保持）
  originalText: string;     // 層3: 内容のバイト完全一致
}
```

再解決手順（5P-2 の `applyParagraphEdit` と `moveCompositeBlock` の両方を踏襲）:

1. **層1（一次フィルタ）**: 実行直前に本文を再 parse・再 scan し、`anchor.complexBlockId` と一致する `kind === "paragraph"` の `ComplexBlockInfo` を探す。見つからない、または `editability !== "supported"` なら即座に no-op（理由: `resolve-failed` 相当）。この時点では id 一致だけであり、確定とはしない。
2. **層2（構造一致）**: 見つかった候補の `parentId`/`complexBlockDepth(doc, block.parentId)` が `anchor` のそれと一致するか確認する。不一致なら no-op（理由: `identity-changed` 相当）——「同じ id スロットに、たまたま別の paragraph が来ている」「見出しが上に挿入されて構造的位置が変わった」ケースをここで弾く。
3. **層3(内容一致)**: 候補の現在テキストを `anchor.originalText` とバイト単位で比較する。不一致なら no-op（理由: `content-changed` 相当）——「id・構造は一致するが、本文編集で中身が変わっている」ケースをここで弾く。
4. 3層すべて一致して初めて、その候補を `ResolvedMoveUnit`（`kind: "paragraph"`, `range: block.range`, `parentId: block.parentId`）として構築し、**5P-4 の既存 `moveComplexBlock(doc, unit, direction)` へそのまま渡す**——新しい swap ロジックは一切書かない。

`ParagraphMoveAnchor` は Tree 描画時（`refresh()` が `showParagraphsInOutline` 由来の投影を計算した瞬間）に、その時点で実際に確認された `ComplexBlockInfo` から構築する。**Tree ノードの `line`/`rangeStart` それ自体を照合キーにはしない**——これらは「メニューを出すかどうかの UI 上のヒント」としてのみ使い、実際の書き戻し可否判定は必ず上記4フィールドの再照合を経由する。

### 5-3 実行経路（新規 swap ロジックなし）

`edit/moveCompositeBlock.ts` の4段階構成をそのまま転用する。

1. Tree のメニュー構築時（右クリック）: `this.currentComplexScan`（直近の `refresh()` が保持する最新スキャン結果)から対象の `ComplexBlockInfo` を再取得し、5P-4 の `findComplexSiblingTarget` を up/down それぞれについて呼んで、成功する方向だけメニュー項目を表示する(`showCompositeCommandMenu` と同型のパターン)。ここで `ParagraphMoveAnchor` を構築する。
2. クリック時: `editor.getValue()` で本文を再取得し、§5-2 の3層検証を実行する新しい純粋関数（例: `edit/paragraphTreeMove.ts` のような新規ファイル、未実装）へ委譲する。
3. その関数の内部で 3 層検証 → `moveComplexBlock` 呼び出し → `LineEditOutcome` 相当の結果を返す。
4. 呼び出し元は既存の `commands/applyLineEditOutcome.ts#applyLineEditOutcome` へそのまま渡す(paragraph 用の特別な cursor 復元ロジックは不要——5P-4 で確認済みのとおり、この関数は既に kind 非依存)。

この経路の要点は、**5T-1 が新規に書くのは「Tree node → 安全な `ResolvedMoveUnit` への variance の狭い変換層」だけであり、実際の判定・書き戻しロジックは 5P-4 のテスト済みパイプラインをバイト単位で再利用する**という設計にあり、これにより 5P-4 の51件のテスト資産・回帰保証をそのまま引き継げる。

### 5-4 UI 設計方針

- `view/OutlineTreeView.ts#renderNode()` の右クリック分岐に、`isOutlineParagraphNode(node)` 専用の第5分岐を追加する(既存の4分岐と並列。既存分岐は無変更)。
- この新分岐は「上へ移動」「下へ移動」の**最大2項目のみ**を持つ、`showCompositeCommandMenu` よりもさらに狭いメニューとする。Rename・Delete・Insert・Indent/Outdent・Partial Edit・D&D の項目は一切追加しない。
- 各項目は §5-1 の全条件が真のときだけ表示する(`showCompositeCommandMenu` の「該当方向が無資格なら項目自体を出さない」方針を踏襲。無効項目をグレー表示する設計は採らない)。
- `readOnlyNodeIds`(`collectReadOnlyOutlineNodeIds`)からの paragraph の除外は行わない——read-only 属性はそのまま維持し、rename/drag/insert/delete の入口は引き続きこの集合によって塞がれたままにする。**「move だけの狭い例外」を、read-only 属性を弱めることによってではなく、`renderNode()` 側に新しい狭い分岐を追加することによって実現する**——これが 5P-3/5P-4 の契約を変更しない、という §2 の原則を満たす唯一の方法である。

### 5-5 拒否時の Notice

5P-4 の既存理由キー(`reason.no-sibling`/`reason.boundary-unknown`)、および 5P-2 の `NoParagraphApplyReason`(`resolve-failed`/`identity-changed`/`content-changed`)に相当する文言を再利用する方針とする。新規 i18n キーが何個必要になるかは実装チケットで確定するが、いずれも「内部の `parentId`・scan-local id・行範囲を露出しない」という 5P-4 の既存規範を継承する。

## 6. mouse drag & drop の比較（5T-0 の調査対象・本実装の対象外）

少なくとも次の3案を比較する。

| 案 | 意味 | 初期評価 |
|---|---|---|
| A | paragraph を同一親の直前・直後 sibling slot にだけ drop できる | 最も安全。§5 の context menu 上下移動と同じ判定ロジック(`findComplexSiblingTarget`)をそのまま再利用でき、Markdown への影響も隣接交換と同一。将来の第一候補 |
| B | paragraph を list item の子へ drop できる | list 外 paragraph を list item の子として認識させるには indent 相当の文字挿入(`contentColumnOf` 由来の列数だけ先頭空白を追加)と親変更が必要——単純な `swapBlocks` の範囲を超える。別設計 |
| C | paragraph を任意の Tree node の前後・子へ drop できる | 自由度は高いが、任意の section/list への挿入は cross-model structural edit そのものであり、`BlockNode` と `ComplexBlockInfo` の境界を越える。対象外 |

案A を将来実装候補とする場合も、少なくとも次を明示する必要がある。

- **drop target と drop zone の定義**: 「ある paragraph 行の直前/直後」を指す狭い帯状ゾーンのみを有効な drop zone とする。
- **before / after のみで child drop を許可しないこと**: 案B(list item の子への drop)は 5T-1/A の範囲外であることを UI 上も明確にする——child drop zone 自体を描画しない。
- **同一 parentId 以外の drop zone を UI 上で無効にする方法**: drag 開始時点で、ドラッグ元 paragraph の `parentId` と一致する兄弟候補だけをハイライトし、それ以外の行の drop zone は最初から生成しない(判定を drop 時まで遅延させない)。
- **同一親だが section / list / unsupported kind に関わる場合の扱い**: §5-1 の allow-list をそのまま踏襲し、list/section を跨ぐ drop zone は生成しない。
- **drop 中の視覚表現**: 挿入線ではなく「この2行が入れ替わる」ことが分かる強調表示(交換であって挿入ではないことを視覚的に誤解させない)。
- **無効 drop 時に本文が変わらないこと**: §5-2 の3層検証を、drop 実行の直前に必ずもう一度通す。
- **drag payload に paragraph の scan-local id を保存しないこと**: `ParagraphMoveAnchor` 相当(4フィールド)を payload として保持し、id 単独では確定させない、という §5-2 の規範をそのまま適用する。
- **editor-change による Tree 再描画中の drag session 中断方法**: 本文が変化した場合、進行中の drag session を即座にキャンセルし、drop 自体を発生させない(`refresh()` のたびに drag state を破棄する設計を検討する)。
- **ドロップ実行直前の再解決**: §5-2 の3層検証をそのまま適用する。
- **swap と insert の違い、および初期版では swap に限定すべき理由**: insert(単純な隣接交換ではない、複数兄弟のシフトを伴う任意位置への挿入)は、空行の所有権・順序安定性・undo 単位の設計が未確定であり、5T-0 の調査だけでは安全性を証明できない。初期版(案A)は 5P-4 と全く同じ「隣接1組だけの swap」に限定すべきである。
- **キーボード操作・アクセシビリティの代替経路**: §5 の context menu 上下移動が、そのままキーボードのみでの代替経路として機能する——D&D を実装する場合も、context menu 経路を廃止せず併存させる。

D&D による「任意位置への挿入」(複数兄弟のシフト、空行の所有、順序安定性、選択状態、undo 単位を扱う)は、単なる隣接交換ではないため、必要なら別フェーズ(例: 5T-2)へ完全に分離する。**5T-0 では実装しない。**

## 7. paragraph ↔ list の扱い(独立課題として切り出す)

paragraph ↔ list(実際の list item/サブツリーとの交換)は 5T-0 の調査対象に含めるが、本実装の対象ではない。整理した論点は次のとおり。

- **現在の `ComplexBlockInfo` と `BlockNode` のモデル差**: `findComplexSiblingTarget` の候補プールは `scanComplexBlocks(doc).blocks`(`ComplexBlockInfo[]`)のみであり、`BlockNode`(list/section、`parseDocument.ts` が権威を持つ)を一度も対象にしていない(§3.6)。両モデルを跨いだ交換には、現状存在しない新しい比較・swap 機構が必要である。
- **list item / subtree を交換単位とした場合の range 定義**: list item は子孫(ネストした list item・その子 paragraph)を伴う場合があり、「どこまでを一つの交換単位とするか」は `ListBlockNode.range` の意味(サブツリー全体か、マーカー行のみか)を再確認する必要がある。
- **list 子段落と list 外 paragraph を交換する場合の indentation 変換**: `contentColumnOf`(`edit/insertBlock.ts`/`parser/listContentColumn.ts`)を使えば列数の計算自体は可能だが、`swapBlocks` は文字を一切書き換えない設計であるため、インデント変換を伴う交換は 5P-4/5T-1 と同じ「安全に証明できるまで許可しない」原則に抵触する。新しい、文字を書き換える swap プリミティブの設計が必要になる。
- **ordered list の番号を保持するか、再採番するか**: 未検討。list item を交換した場合、`1.`/`2.` のような番号が意味的に前後するかどうかは、既存のどの move 機能にも前例がない。
- **nested list の subtree をどう扱うか**: 未検討。ネストした子リストを持つ list item を paragraph と交換する場合、子リスト全体を随伴させる必要があるが、その安全性は未証明。
- **list item の continuation paragraph と list item 本体の順序**: 5P-1/5P-4 が扱う「list item の子 paragraph」は、list item 本体(マーカー行)より後に続く継続行としてのみ存在する——これを list item 本体と独立に交換対象にすると、list item 自体の意味(マーカー+本文)が崩れる可能性がある。
- **section 内の paragraph と list subtree の兄弟交換**: `findComplexSiblingTarget` を拡張して `BlockNode` も候補に含める場合、depth/parentId の比較方法を作り直す必要がある(`complexBlockDepth` は `ComplexBlockInfo` 専用)。
- **Tree 上の list node と paragraph node の相互操作権限**: list node は現状 rename/drag/D&D が許可されている(read-only ではない)。paragraph との交換を許可すると、「一方は書き込み可能、一方は read-only」という非対称な2ノード間の操作をどう UI 上で表現するかが新たな課題になる。
- **undo / redo の原子性**: 既存の `swapBlocks` ベースの move はすべて `editor.replaceRange` 一発の単一 undo 単位である。cross-model swap でも同じ粒度を維持できるかは、実装時に確認が必要。
- **移動後の parentId / depth 再検証**: §5-2 と同じ3層検証パターンが必要になるが、`BlockNode` 側の識別(`sec-N`/`li-N`)と `ComplexBlockInfo` 側の識別(scan-local id)の異種比較が必要になる。
- **Partial Edit、fold、選択状態、Tree 再描画との連携**: list item は fold 可能・Partial Edit 対象・rename 可能である一方、paragraph はそのいずれでもない。交換後に一方の性質が他方に「引き継がれる」ことがあってはならない(交換はテキストの位置だけを入れ替え、各ブロックの性質はテキストから再導出されるべき、という 5P-4 の原則を踏襲する必要がある)。

**結論**: 現行の `BlockNode`/`ComplexBlockInfo` の二重モデルのまま、paragraph ↔ list を安全に実装することはできない、と判断する。`BlockNode` と `ComplexBlockInfo` を無理に統合してはならない(§2 の原則)。cross-model swap は将来の独立した設計課題として切り出す。

## 8. 非目標(5T-0 で実装しないこと)

- paragraph の Tree context menu 上下移動そのものの実装(設計のみ。実装は 5T-1 として別途承認を得てから)。
- mouse drag & drop の実装(調査・比較のみ)。
- paragraph ↔ list の実装(整理・課題切り出しのみ)。
- paragraph の追加・削除・rename。
- paragraph の indent/outdent。
- `parseDocument.ts` の変更。
- 5P-3/5P-4 で確定した read-only 契約・隣接交換契約の変更。

## 9. 承認が必要な論点

1. §5-2 の `ParagraphMoveAnchor`(4フィールド: `complexBlockId`/`parentId`/`depth`/`originalText`)を、5P-2 の `ParagraphEditAnchor` と同型の設計として採用してよいか。
2. §5-4 の UI 方針(`renderNode()` に paragraph 専用の第5分岐を追加し、上へ移動/下へ移動の最大2項目のみを持つ狭いメニューとする)でよいか。
3. §5-3 の実行経路(新規ファイル、例えば `edit/paragraphTreeMove.ts` を追加し、5P-4 の `moveComplexBlock` へ委譲する設計)でよいか。
4. D&D(§6)を 5T-2 として完全に別チケットへ分離する方針でよいか。
5. paragraph ↔ list(§7)を独立の設計課題として保留し、5T-1/5T-2 のいずれにも含めない方針でよいか。

## 10. 実装候補の分割(5T-1 / 5T-2)と結論表

| 操作 | 5P 完了時 | 5T-1候補 | 5T-2候補 | 今回の結論 |
|---|---|---|---|---|
| 本文カーソル上下移動 | 実装済み | 維持 | 維持 | 5P-4 |
| Tree context menu上下移動 | 未実装 | 検討 | 実装候補 | まず安全設計(§5) |
| Tree D&D隣接交換 | 未実装 | 調査 | 実装候補 | 別途判断(§6) |
| Tree D&D任意挿入 | 未実装 | 調査のみ | 対象外候補 | cross-model問題(§6) |
| paragraph ↔ list交換 | 未実装 | 調査のみ | 対象外候補 | 独立設計(§7) |
| paragraphの追加・削除 | 未実装 | 対象外 | 対象外 | 維持 |
| paragraph rename | 未実装 | 対象外 | 対象外 | 維持 |
| paragraph indent/outdent | 未実装 | 対象外 | 対象外 | 維持 |

## 11. 完了条件チェック

- [x] Phase 5P が完了として文書化されている(`docs/phase5p_paragraph-block-foundation-plan.md` 更新済み)
- [x] Tree context menu の上下移動が、5P-4 の安全契約を再利用できるか明確になっている(§5-3: `moveComplexBlock` へそのまま委譲)
- [x] Tree node から本文 paragraph への安全な解決方法が決まっている(§5-2: `ParagraphMoveAnchor` の3層検証)
- [x] paragraph の read-only 契約をどう限定改訂するか、または維持したまま例外許可するか決まっている(§5-4: 維持したまま、`renderNode()` 側に狭い例外分岐を追加)
- [x] context menu の許可操作・拒否操作が表で固定されている(§5-1、§10)
- [x] mouse D&D を context menu 移動と混同せず、別フェーズに分離している(§6、5T-2 候補)
- [x] paragraph ↔ list の cross-model move を独立課題として整理している(§7)
- [x] scan-local id、fold identity、selection identity を誤用しない設計になっている(§5-2、§3.7、§3.13)
- [x] `parseDocument.ts` を変更していない(§3.10、読むだけ)
- [x] 本番機能を実装していない(§0、§8)
- [x] 単独コミットが作られている(本ドキュメント自体のコミットを参照——完了報告に記載)

## 12. 関連ドキュメント

- `docs/phase5p_paragraph-block-foundation-plan.md` — Phase 5P 全体計画・5P-0〜5P-4 完了状態・本ドキュメントへの引き継ぎ記載。
- `docs/phase5p3d_paragraph-tree-display-design.md` — 5P-3 の確定設計。paragraph の read-only Tree 投影契約の原典。
- `docs/phase5d0_3_composite-block-outline-tree-projection-design-memo.md` — CompositeBlock の Tree 投影・Tree 発火 move の既存実装。本ドキュメント §5 の設計判断の直接の先例。
- `docs/統合実装ロードマップ_2026-08-05.md` §3.8、および本チケットで追記する新セクション — Phase 5P/5T の位置づけ。

## 13. Phase 5T-1R: 実機バグ修正の受入固定と paragraph 解決契約（追記）

Phase 5T-1 の初回実装（`0fc3b0a`）は、実機（Method Vault）での動作確認で
「paragraph Tree node を右クリックしても context menu が一切開かない」不具合
を発生させていた。原因・修正・恒久化された契約を、本ドキュメントに正式に記
録する。5T-1 の完了状態は `faadbac`（バグ修正コミット）を含めたものとして
確定する。

### 13-1. 根本原因: view identity と scan-local identity の混同

`OutlineTreeParagraphNode.id`（`tree/buildOutlineTree.ts` の
`paragraphViewId(ordinal)` が生成する `tree-paragraph:<ordinal>` という文字
列）は、Tree の **表示・DOM・イベント配線のための一時 identity** である。
`refresh()` のたびに ordinal から再構築され、ドキュメント全体での「表示順」
にのみ依存する。

これに対し `ComplexBlockInfo.id`（`parser/complexBlocks.ts` の
`scanComplexBlocks()` が1回のスキャン呼び出し内でのみ発行する
`paragraph-<n>` という文字列）は **スキャンローカルな一時 id** であり、別の
スキャン呼び出しとの間で同じ値が同じ段落を指す保証は一切ない。

Phase 5T-1 の初回実装は、`showParagraphMoveMenu` 内で
`complexScan?.blocks.find((b) => b.id === nodeId && b.kind === "paragraph")`
という比較を行っていたが、`nodeId`（Tree node の view identity）と
`b.id`（スキャンローカル id）は**そもそも別の id 空間**であり、この比較は
論理的に一致し得ない。結果として全ての paragraph 行で `target` が常に
`undefined` となり、メニューが常に空（実質的に一切開かない）状態になって
いた。

この不具合は、以下のいずれの検証手段でも検出できなかった:

- 純粋関数テスト（`buildParagraphMoveAnchor`/`moveParagraphFromAnchor` を
  直接呼ぶテスト）は、常に実在する `ComplexBlockInfo` を直接渡していたた
  め、バグのあった Tree-node-id → `ComplexBlockInfo` の解決コード自体を一
  度も経由しなかった。
- 静的ソーステキスト検査（文字列の存在確認）は、コード自体は「一見妥当そ
  う」に見えるため、id 空間の混同という論理的な誤りを検出できなかった。
- 実際に Obsidian 上で paragraph Tree node を右クリックして初めて、メニュー
  が一切開かないという症状として発覚した。

### 13-2. 恒久化された解決契約（`faadbac` で導入、5T-1R で固定）

`OutlineTreeParagraphNode.id` の許可される用途は、以下に限定される:

- DOM 上の key（`unified-outliner-row-${node.id}` 等）
- Tree 内部の一時的なイベント配線
- Tree row の表示・選択状態の表現
- `nodeById` を介した Tree node オブジェクトそのものの取得

以下の用途では **絶対に使用してはならない**:

- `ComplexBlockInfo.id` との直接比較
- parser/スキャン結果から段落を同定するための識別子
- `ParagraphMoveAnchor` の永続的な identity
- fold identity
- 選択状態の永続化キー
- drag payload の永続的な key
- 本文書き込み先を最終決定する識別子

Tree paragraph node を起点として本文の段落を操作する際は、常に以下の手順
に従う（`edit/paragraphTreeMove.ts#resolveParagraphFromTreeHint` /
`buildParagraphMoveAnchor` / `moveParagraphFromAnchor` が実装する契約。
`view/OutlineTreeView.ts#showParagraphMoveMenu` /
`#dispatchAndApplyParagraphMove` がこの契約の唯一の呼び出し元）:

1. `nodeById` を介して Tree node を取得する。
2. その node の `rangeStart`/`rangeEnd`/`parentId`（必要なら depth）を、
   あくまで**候補解決のヒント**として使う——値そのものを信頼しない。
3. エディタの現在の本文テキストを取得する。
4. `parseDocument()` / `scanComplexBlocks()` を再実行する（スキャン結果は
   常に「今」の本文に対して新規に取り直す）。
5. `kind === "paragraph"` かつ range・parentId・depth が一致するブロックを
   照合する（`resolveParagraphFromTreeHint`）。
6. `ParagraphMoveAnchor` を新規生成、または既存アンカーを3段階（id ヒント
   → parentId/depth 構造一致 → `originalText` バイト単位一致）で再検証する
   （`buildParagraphMoveAnchor`/`moveParagraphFromAnchor` の stage 1–3）。
7. `originalText` をバイト単位で比較する（同上 stage 3）。
8. 一意に解決できた場合のみ、既存の安全な move パス
   （`move/resolveMoveTarget.ts#moveComplexBlock`）に委譲する（stage 4）。
9. 曖昧さが残る場合（複数候補が一致する等）は、常に no-op とし、本文を一
   切変更しない。

この手順は、**今後 Tree 起点で本文 paragraph を操作するすべての機能**（新
規機能の追加はこのチケットの範囲外だが、将来 D&D 等を実装する際も）に対す
る標準契約として固定する。逆方向の設計（Tree node id を段落の永続 id とし
て扱う設計）は、5T 系列のいかなるフェーズでも採用しない。

なお、`OutlineTreeComplexMemberNode`（standalone callout/blockquote の
Tree node）は `id: info.id`（`ComplexBlockInfo.id` そのもの）を自身の id
として使う、という**別の、それ自体は正しい**設計になっている
（`buildStandaloneComplexNode`）。これは standalone complex-member の
Tree node と `ComplexBlockInfo` が実質的に1対1で同じ scan 呼び出し内に閉
じているためであり、paragraph の場合とは前提が異なる。両者を同一の契約
として混同しないこと。

### 13-3. 検証基盤

- 純粋関数テスト・Tree node 解決テスト・UI 配線テストの3系統をすべて実装
  し、`tests/paragraphTreeMove.test.ts` / `tests/paragraphOutlineTreeUiWiring.test.ts`
  に反映済み（詳細はテストファイル自身のコメントを参照）。
- 実機受入手順は `docs/git-push-release-runbook.md` に手順化した。今後
  「テスト・型検査・lint・build が green であること」だけを「完了」の根拠
  にしてはならない——実機（Method Vault）での確認を経てから完了報告を出す
  こと。

## 14. Phase 5T-2D: paragraph D&D の設計固定・既存経路監査（追記）

Phase 5T-2D は、Outline Tree 上の paragraph node に対する mouse drag &
drop（D&D）について、**設計・監査のみを行い、本番実装は行わない**フェー
ズとして実施した。5T-1R（`859ad17`）を前提として受け入れ、詳細な設計・
既存コード監査・比較検討・操作契約・実機検証計画は、新設した
`docs/phase5t2_paragraph-tree-dnd-design.md` に記録した。本セクションは、
その結論を要約し、当該ドキュメントへの導線とする。

### 14-1. 結論の要約

- 案A（同一 parent の隣接 sibling に対する前後 slot のみ、隣接 swap 限
  定）が、本ドキュメント §6 で既に最有力候補とされていた方針を、5T-1/
  5T-1R の実装済みコードに基づいて再確認し、なお最有力候補であると判断
  した。
- 案A の範囲に限定すれば、最小実装候補（5T-2）は構造的に安全に実装可能
  であると判断した。根拠は、drop 実行の最終的な mutation
  （`swapBlocks`）、source の安全な再解決（`resolveParagraphFromTreeHint`
  /`buildParagraphMoveAnchor`/`moveParagraphFromAnchor`）が5T-1R時点で
  既に存在し、新しい書き換えプリミティブの発明が不要なためである。
- ただし、「hover 中の drop target が、今この瞬間において自分の真の隣接
  sibling であるか」を確認するロジックは現状存在せず、新設が必要である
  （既存の `findComplexSiblingTarget` は「自分から見た最寄りの候補」を
  返すのみで、任意候補との一致確認機能を持たないため）。
- 既存の section/list D&D（`canDropAny`/`canDropOn`/`canDropListOn`/
  `dispatchAndApply`/`runRelocateCommand`）は、id 空間・構造モデル・親変
  更・書き戻し経路のいずれの観点からも paragraph には再利用できない、と
  判断した（詳細は当該ドキュメント §5 の監査表を正とする）。
- paragraph ↔ list の cross-model move、任意位置への挿入、child drop
  は、本ドキュメント §6/§7 の既存結論のとおり、引き続き対象外とする。
- 5T-2 の実装に着手する前に、Tree 再描画中の drag session の扱い、モバ
  イル対応の範囲、既存テスト（`tests/paragraphOutlineTreeUiWiring.test.ts`
  §5-5）の改訂方針について、5T-1/5T-1R と同様にユーザーの承認を得るべき
  である。

### 14-2. 参照

詳細な A/B/C 比較表、drag 開始・dragover・drop 実行の各契約、既存コード
の監査表（`OutlineTreeView.ts` の各ハンドラ、`relocateSection.ts`/
`relocateListSubtree.ts`/`resolveMoveTarget.ts`/`moveBlock.ts`、CSS、テス
ト等）、最小実装候補5T-2の可否判断、Method Vault 実機検証計画へのリンク
は、すべて `docs/phase5t2_paragraph-tree-dnd-design.md` を正とする。

本セクションの追加により、本ドキュメント自体は変更していない既存の §1〜
§13 の内容と矛盾しない——5T-2D は既存結論を上書きするのではなく、5T-1/
5T-1R の実装済みコードに基づいて再確認・深化したものである。

## 15. Phase 5T-2S / 5T-2S-B / 5T-3D: Tree/body一致性の受入と非隣接move設計調査（追記）

本セクションは 5T-2S・5T-2S-B・5T-3D の結論を要約し、以降のフェーズが
参照すべきドキュメントへの導線を残すためのものである。5T-2S-A までの
Method Vault 実機検証プロトコルおよびその結果自体は
`docs/phase5t2s_tree-body-consistency-investigation.md` を正とする。

### 15-1. 5T-2S / 5T-2S-B: 確定事実

- 段落 context menu の隣接swap、段落D&Dの隣接swap、Tree外部dropの内部ID
  漏洩修正は、いずれも実機で動作確認済み。
- 段落D&Dのdrop indicator表示位置の不具合（判定用zoneでなく実際の着地
  edgeを描画すべき）は 5T-2S-B で修正し、実機で解消を確認済み
  （`docs/phase5t2s_tree-body-consistency-investigation.md` §9）。
- §5〜§6 で計画した Source Mode / Reading View 双方での優先6操作の実機
  再現テストは、利用者による手動確認の結果、異常が観察されなかった
  （同ドキュメント §10）。ただし、これは「不具合が存在しない」ことの
  証明ではなく、あくまで今回テストした範囲内での観察結果である。
- 上記を踏まえ、Tree/body一致性は現行の受入スコープ内では許容できるも
  のとして扱う。paragraph↔list のクロスモデル移動は、引き続き別トピッ
  クとして扱う（本ドキュメント §7 の既存結論のまま）。

### 15-2. 5T-3D: 非隣接move設計調査

Tree上のparagraphノードを、同一parent/depth内の非隣接位置へ移動する
（隣接swapの繰り返しではなく、1回のcut-and-reinsertとして扱う）ための
モデル/UX/write-back/復元性の設計を調査した。本フェーズは設計・監査・
利用者向け判断材料の作成のみであり、本番コード変更・GUI自動操作・実機
検証は一切行っていない。

詳細な3案（案A: 単発cut-and-reinsert、案B: 隣接swap繰り返し、案C: 専用
コマンドUI）の比較表、既存コード（`insertBlockAt`／`resolveAnchorUnit`
／`resolveParagraphDropDirection`／`ComplexSiblingTarget` 等）の監査結
果、source/target解決契約・挿入位置契約・UI契約の設計、および利用者判
断用の Method Vault ノートへのリンクは、すべて
`docs/phase5t3_non_adjacent_paragraph_move_design.md` を正とする。

結論の要約: mutationモデルとして案A（`insertBlockAt` の再利用による単
発cut-and-reinsert）、UIモデルとして案C（専用コマンド）の組み合わせを
推奨し、案Bは undo/中間状態/複雑性の観点から非推奨とした。次フェーズ
着手前に利用者が判断すべき事項が5件残っており、実装（本番コード変更）
はまだ行っていない。


## 16. Phase 5T-4D: Tree paragraph → Partial Edit の設計・監査（追記）

5T-3D/5T-3A（非隣接move）に続き、Tree 上の paragraph node から既存の paragraph Partial Edit（Phase 5P-2）を安全に起動するための設計・監査を実施した。本フェーズも設計・監査・利用者向け判断材料の作成のみであり、本番コード変更・GUI自動操作・実機検証は一切行っていない。

監査の結果、Tree 側で既にヒント再解決済みの paragraph（`resolveParagraphFromTreeHint`）が持つ `range.startLine` を、既存の `main.ts#activatePartialEditViewForParagraph(cursorLine)` にそのまま渡すだけで、新しいアンカー型・新しい書き戻し関数を一切追加せずに実現できることが判明した。案A（Tree context menu → 既存 Partial Edit）を第一候補として推奨し、案C（ダブルクリック/F2起動）を将来候補、案B（Tree row の inline edit）を非推奨とした。詳細な監査結果・設計案比較・保存契約・利用者判断事項（4件）は `docs/phase5t4_tree_paragraph_partial_edit_design.md` を正とする。


## 17. Phase 5T-5D: 本文カーソル → Tree current-position highlight と、Tree selection follow の拡張設計・監査（追記）

5T-4D/5T-4A（Tree paragraph → Partial Edit）に続き、(1) 本文カーソル位置に連動する `highlightedId` を section/list のみから paragraph・standalone callout・standalone blockquote・fenced code・table を含む既存7種別へ拡張するための設計、(2) Tree で選択していたノードに move/edit を実行した後 `selectedId` が古い位置や誤ったノードを指したままになる不具合の根本原因監査と修復設計（selection follow）、の2点について設計・監査を実施した。本フェーズも設計・監査・利用者向け判断材料の作成のみであり、本番コード変更・GUI自動操作・実機検証は一切行っていない。

監査の結果、standalone paragraph/callout/blockquote/table へのカーソル位置は今日すでに囲みセクションへの粗いフォールバックとしてハイライトされていること（true null ではないこと）、および `selectedId` の陳腐化は paragraph 固有の問題ではなく、Tree node id が毎 refresh で振り直される表示用連番であることに起因する一般的な問題であることを、コードの直接監査によって確定した。highlightedId 拡張は案A（新規の純粋な current-position resolver）、selection follow は案C（新規の専用 selection-follow repair resolver、既存の `pendingMoveFlash` 機構と構造的に同種）をそれぞれ第一候補として推奨した。fenced-code/table は今日いかなる形でも Tree row を持たないため、対象7種別のうちこの2種別は「Tree表示済みnodeのみ対象」というスコープ制約と両立しない、という緊張関係を確認し、利用者判断事項として提示した。詳細な監査結果・設計案比較・契約・利用者判断事項（5件）は `docs/phase5t5_cursor_to_tree_highlight_design.md` を正とする。
