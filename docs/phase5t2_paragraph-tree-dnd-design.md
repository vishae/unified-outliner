# phase5t2_paragraph-tree-dnd-design

## 0. 位置づけ

本ドキュメントは Phase 5T-2D（設計・監査フェーズ、本番実装は含まない）の
成果物である。5T-1/5T-1R で確定した paragraph の view identity /
scan-local identity 契約、および range/parentId/depth に基づく再解決契約
（`docs/phase5t_tree-interaction-move-design.md` §13）を前提として受け入れ、
Outline Tree 上の paragraph node に対する mouse drag & drop（以下 D&D）を
将来実装する場合の最小スコープ・操作契約・安全条件・実装境界を、既存コー
ドの実地監査に基づいて固定する。

**本ドキュメントの範囲内でソースコードの変更は一切行っていない。**
`parseDocument.ts` も変更していない。paragraph は本ドキュメントの後も
`ParsedDocument.nodes` に一切追加されない。

対象リポジトリ: `/Users/kazumikaizuka/Obsidian/unified-outliner-public`
基準コミット: `859ad17`(5T-1R) / `faadbac`(5T-1 実機バグ修正) /
`0fc3b0a`(5T-1) / `f9b2241`(5T-0) / `6ecafa0`(5P-4)

## 1. 目的とスコープ

paragraph node の D&D が将来安全に実装可能かどうかを、既存実装の実地監査
に基づいて検討し、最小スコープ・操作意味論・安全条件・実装境界を設計とし
て固定する。

対象: paragraph node の D&D のみ。
対象外: 既存の section/list/CompositeBlock/単独 complex block の D&D 挙動
の変更（現状維持。一切変更しない）。

第一実装候補として許容してよい範囲は、次の全てを満たすものに限定する。

- ドラッグ元は paragraph node のみ。
- drop 先は「同一 `parentId` を持つ paragraph、または既に許可されている
  complex block」の「前」または「後」の slot に限定する。
- 結果は必ず**隣接1組の swap**であり、5P-4/5T-1 の隣接交換と完全に同一の
  意味論とする。任意位置への挿入は行わない。
- drop 先は、その時点で本文上の直前/直後 sibling と一致する場合のみ許可
  する。非隣接な drop 先は最初から対象外とする。
- child への drop、親変更、階層変更、インデント変更は一切許可しない。

要するに、初回の D&D は「Tree の既存の上下隣接交換（5T-1 の Move up/down）
をマウスジェスチャで起動するだけの薄いラッパー」であり、自由な位置へのド
ラッグを許すアウトライナー的な D&D ではない。

## 2. 絶対に維持する原則（5P/5T-0/5T-1/5T-1R からの継承・変更なし）

- Markdown が唯一の正であることを変更しない。
- `parseDocument.ts` を変更しない。
- paragraph を `ParsedDocument.nodes` に追加しない。
- paragraph を `CompositeBlock`、または `CompositeBlock` のメンバーとして
  扱わない。
- paragraph node は `isReadOnly: true` のまま、葉ノード・fold 不可のまま
  とする。
- `tree-paragraph:N`（view identity）を、parser id・fold id・永続的な
  selection id・drag payload の永続キーのいずれとしても使わない。
- scan-local の `complexBlockId` 単独を、再解決の唯一の鍵として使わない
  （source 側・target 側のいずれについても）。
- drag 開始から drop までの間に本文が変化していた場合、本文を一切変更し
  ない。
- 実行時には必ず現在の本文を再パースし、range/parentId/depth/
  `originalText` を再検証する。
- 既存の安全契約（`moveComplexBlock`/`findComplexSiblingTarget`/
  `swapBlocks`）を再利用する。新しい text-splice/range-rewrite プリミティ
  ブを発明しない。
- swap の許可/拒否リストは 5P-4/5T-1 と完全に一致させる。list/list
  サブツリー、section、`parentId` 不一致、depth 不一致、ネストした list
  境界、未クローズの fence、構造が曖昧なケース、インデント変更を要するケ
  ースは、すべて拒否する。
- paragraph ↔ list の cross-model move は実装しない（5T-0 §7 の結論を維
  持）。
- paragraph に rename/delete/insert/indent/outdent/Tree 経由の Partial
  Edit を追加しない。
- 既存の context menu 上下移動（5T-1）を変更しない。
- 本文カーソル起点の Move block コマンド（5P-4）を変更しない。

paragraph の read-only 性は「一般的な構造編集を禁止する」という意味であ
り、「将来のいかなる操作も永久に禁止する」という意味ではない。将来 D&D を
導入する場合も、狭く明示的な例外として、安全な隣接 swap にのみ限定して設
計する。

## 3. 案の比較（A/B/C）

| 案 | drop の意味 | 初期実装可否 | 主なリスク | 結論 |
|---|---|---|---|---|
| A | 同一 parent の隣接 sibling に対する前後 slot、隣接 swap のみ | 検討対象 | anchor・再解決・drop feedback | 最有力候補 |
| B | 同一 parent 内の任意 sibling slot への挿入 | 今回は対象外 | 複数兄弟の shift、空行所有、undo、選択追従 | 後続設計 |
| C | child drop / parent change / list 内外移動 | 対象外 | indentation、cross-model、subtree、Markdown 構造変更 | 独立課題 |

案Aであっても、現行の 5P-4 実装が扱えるのは「その時点での直前/直後
sibling との swap」のみであり、それより一般的な挿入は一切実装されていな
い。したがって、案Aの D&D の視覚的アフォーダンスが「任意位置に挿入でき
る」ように見えるもの（挿入線を任意行間に自由に表示する等）であってはなら
ない。ユーザーに誤った期待を与える UI は採用しない——挿入線ではなく「この
2行が入れ替わる」ことが分かる強調表示（5T-0 §6 の既存指針を継承）とする。

案B（任意 sibling slot への挿入）は、複数兄弟の位置シフト・空行の所有権・
undo 単位・選択状態の追従という、隣接 swap にはない設計課題を抱えるため、
5T-2 の対象外とし、後続の独立設計課題として切り出す。

案C（child drop・parent 変更・list 内外移動）は、indentation 変換・
cross-model・subtree・Markdown 構造変更を伴うため、5T-0 §7 の結論（現行の
二重モデルのままでは安全に実装できない）をそのまま継承し、独立課題とす
る。

## 4. D&D 操作契約（案Aを対象）

以下は、案Aを将来実装する場合に固定すべき契約である。実装そのものではな
い。

### 4-1. drag 開始（dragstart）

- paragraph node のみが drag の起点になる。既存の section/list node との
  「相互 D&D」（paragraph を list の drop target として認識させる等）は
  行わない——paragraph の drop target は「同一 parentId の隣接
  paragraph/許可 complex block」のみであり、section/list は対象外のまま
  とする。
- paragraph の `isReadOnly: true` はそのままで問題ない。dragstart は
  「読み取り専用ノードに対する構造編集」ではなく、「安全な隣接 swap を起
  動するジェスチャ」であるため、read-only 契約と矛盾しない。ただし、この
  例外を許可する分岐は、既存の `if (!readOnly) { ... }`（1596行目、drag
  listener 全体を一括で括っているブロック）とは**別の、paragraph 専用の
  狭い分岐**として実装する必要がある（既存のブロックを緩めて paragraph
  を通すと、rename/子ノードとしての D&D 等も同時に解禁してしまう）。
- drag payload は、view id（`tree-paragraph:N`）・scan-local id
  （`paragraph-N`）・ラベル・プレビュー文字列のいずれにも単独で依存しな
  い。dragstart の時点で `resolveParagraphFromTreeHint` +
  `buildParagraphMoveAnchor` を呼び出し、`ParagraphMoveAnchor`
  （`complexBlockId`/`parentId`/`depth`/`originalText` の4フィールド）を
  構築し、これを drag session の内部状態として保持する（HTML5
  `dataTransfer` に平文で載せる必要はない——既存の section/list D&D も
  `dataTransfer.setData` は形式的なものであり、実際の判定は
  `this.dragSourceId` 等のインスタンスフィールドで行っている。paragraph
  も同様にインスタンスフィールドで保持してよい）。
- Tree が drag session の途中で再描画された場合（`refresh()` が別の
  editor-change/active-leaf-change/keyup/mouseup 契機で発火した場合）、
  drag session を安全にキャンセルする必要がある。**既存の section/list
  D&D は、この観点のガードを一切持っていない**（`refresh()` に
  `renameState` のような drag 用ガードは存在しない。§5-11 参照）。
  paragraph の drag は、`ParagraphMoveAnchor` の `originalText` 起点の
  3層検証（5T-1R で確立）がより厳格な安全性を要求するため、既存にない
  新しい保護——例えば `refresh()` の冒頭で進行中の paragraph drag
  session を明示的に破棄する、または drop 実行時に再検証で確実に弾く
  ——のいずれかを新設する必要がある。
- editor-change・active-leaf-change・settings-change・ノード自体の消失
  （対象段落が削除された等）のいずれでも drag session をキャンセルする。
- drag 開始直後に本文が変化した場合は、drop 実行時の再検証（4-3）で必ず
  弾かれるため、dragstart 自体で本文変化を監視する必要はない——ただし
  UX として、明らかに無効になった drag は早期に視覚的キャンセルする方が
  親切である（必須要件ではない）。

### 4-2. dragover と drop zone

- 行の上半分を「before」、下半分を「after」とする（既存の
  `computeDropMode` は上/中/下の三分割で「中央 = inside」を持つが、
  paragraph には child drop zone が存在しないため、二分割の別ロジックが
  必要——既存関数を流用せず、paragraph 専用の新しい判定関数を用意する）。
- child drop zone は一切存在しない。「inside」に相当する状態を検出・表示
  しない。
- paragraph が自分自身の上にドロップされた場合は無効（no-op）。
- paragraph がその時点での直前/直後 sibling 以外の場所にドロップされた
  場合は無効。
- section/list/list-item/CompositeBlock/単独 complex block のうち、
  「現在の直前/直後 sibling である許可済み complex block」以外は、すべて
  drop 先として無効。特に list item・section は常に無効。
- 無効な drop zone は、視覚的に何も強調表示しない（既存の
  before/after/inside クラスのいずれも付与しない）——「有効そうに見える
  が実際には拒否される」UI を避ける。
- 既存の section/list drop indicator（`unified-outliner-drop-before`/
  `-after`/`-inside`）と、paragraph drag 中に表示するインジケータが同時
  に競合しないようにする。1つの `dropIndicatorEl` を共有インスタンス
  フィールドとして使う既存設計（`setDropIndicator`/`clearDropIndicator`）
  をそのまま踏襲すれば、この競合は自然に回避できる——同時に2つの
  drag session が走ることはない前提と一致する。
- `canDropOn`/`canDropListOn`/relocate 系関数とは責務を分離する。
  paragraph の drop 可否判定は、これら既存関数を呼ばず、
  `findComplexSiblingTarget` ベースの新しい判定関数
  （4-3 で述べる「hover 中の target が現在の直前/直後 sibling と一致する
  か」を確認する関数）を新設して用いる。
- HTML5 の `dragenter`/`dragleave` の chattering（子要素間を移動するたび
  に発火し、インジケータがちらつく）は、既存の
  `handleDragOver`/`handleDragLeave` が「`dropIndicatorEl === selfEl` の
  ときだけ clear する」という設計で緩和している——paragraph も同じパター
  ンを踏襲すればよい。
- Escape・dragend・無効な drop のいずれでも、drag 状態・インジケータの
  両方を確実にクリーンアップする。既存の `handleDragEnd`/`endDrag`/
  `clearDropIndicator` の実装は、drop の成否に関わらず**必ず**呼ばれる設
  計になっている（`handleDrop` は判定の前に `clearDropIndicator()` と
  `endDrag()` を呼んでいる）。paragraph も同じ「まずクリーンアップ、次に
  判定」の順序を踏襲する。
- 5T-1 の context menu 上下移動は、D&D 実装後もアクセシビリティ上の代替
  経路として維持する（キーボードのみのユーザー、D&D が使えない環境向
  け）。

### 4-3. drop 実行

- drop 先ノードは Tree の `nodeById` を通じて解決するが、これは
  「表示上どの行にドロップされたか」を特定するだけであり、実行の正当性
  はそこでは確定しない。
- source と target の両方を、**現在の本文**から range/parentId/depth を
  手掛かりに再解決する（`resolveParagraphFromTreeHint` を source・
  target の双方に適用する。target が paragraph でなく complex block の
  場合は、対応する `ComplexBlockInfo` を同様に scan-local ではなく
  range/parentId/depth で再解決する）。
- source の再解決には `ParagraphMoveAnchor` の3層検証
  （`buildParagraphMoveAnchor`/`moveParagraphFromAnchor` が内部で行う、
  5T-1R で確立した検証）をそのまま使う。
- target 側についても、scan-local id 単独を信用しない——target の
  scan-local id が dragover 時点のものと drop 時点で一致しているかだけ
  では不十分であり、`findComplexSiblingTarget(doc, sourceUnit, direction,
  scan)` を再度呼び、その戻り値が実際に hover 中の target と一致するかを
  再検証する。この「hover 中の target が今この瞬間において自分の真の隣接
  sibling であるか」を確認するロジックは、既存のどの関数にも存在しない
  ——`findComplexSiblingTarget` は「自分から見た最も近い候補」を返すのみ
  で、「候補Xが自分の隣接であるかどうか」を答える機能を持たないため、
  新設が必要である（§5 参照）。
- drop の before/after 意味論を、実際の Move up/down 方向にマッピングす
  る（before = 対象が自分の前にある方向への move、after = 逆方向）。
- 判定の結果、その瞬間の本文において 5P-4 の許可リストの範囲外であると分
  かった場合は、no-op にフォールバックする（本文を変更しない）。
- 成功時は `moveParagraphFromAnchor` または同等の既存安全経路
  （`dispatchAndApplyParagraphMove` 等）にそのまま委譲する。新しい
  text-swap/splice/range-rewrite プリミティブを発明しない。
- 拒否時は本文を完全に変更しない。必要であれば Notice を表示する
  （5T-1 の既存 Notice 文言パターンを継承し、`parentId`・scan-local id・
  関数名などの内部実装詳細を露出しない）。
- 成功・拒否のいずれであっても、drag UI 状態（`dragSourceId`/
  `draggingItemEl`/`dropIndicatorEl` 相当のフィールドと、対応する CSS
  クラス）を確実にクリーンアップする。

## 5. 既存コードの監査

| 経路 | 責務 | 再利用可否（paragraph D&D 向け） | paragraph D&D への影響 |
|---|---|---|---|
| `OutlineTreeView.ts` の `handleDragStart`（3557行目） | `dragSourceId`/`draggingItemEl` を設定し、`dataTransfer` に形式的な値を積む | **不可（別実装が必要）**。現状は `node.id` をそのまま `dragSourceId` に代入している——section/list では `node.id` が `doc.nodes` のキーと一致するため機能するが、paragraph の `node.id`（`tree-paragraph:N`）は `doc.nodes` に存在しないキーであり、この代入パターン自体が使えない | paragraph 専用の dragstart ハンドラを新設し、`ParagraphMoveAnchor` を構築して保持する必要がある |
| `canDropAny`（3567〜3579行目） | `doc.nodes.get(sourceId)` の kind に応じて `canDropOn`/`canDropListOn` を呼び分ける | **不可**。`doc.nodes.get()` に依存する時点で paragraph は必ず `undefined` になり機能しない | paragraph 専用の可否判定関数（`findComplexSiblingTarget` ベース）を新設する必要がある |
| `handleDragOver`（3596〜3606行目） | `canDropAny` の結果に応じて `preventDefault`・drop indicator 表示を行う | **部分的に再利用可**。`dropIndicatorEl` を使ったインジケータ制御の枠組みは共通化できるが、判定本体（`canDropAny`）は差し替えが必要 | 判定部分のみ差し替えて骨格を再利用する設計を推奨 |
| `handleDragLeave`/`handleDrop`/`handleDragEnd`/`endDrag`/`clearDropIndicator`/`setDropIndicator`（3607〜3653行目） | drag/drop の状態管理とクリーンアップ | **概ね再利用可**。「まずクリーンアップ、次に判定」の順序や、`dropIndicatorEl` 経由の単一インジケータ管理は paragraph にもそのまま適用できる汎用パターン | 骨格は共通化し、`handleDrop` 内の判定・実行部分のみ paragraph 専用ロジックに差し替える |
| `computeDropMode`（3657〜3663行目） | 行を上/中/下の三分割し before/inside/after を返す | **不可（別ロジックが必要）**。paragraph には child drop zone（inside）が存在しないため、二分割の別関数が必要 | 新しい二分割判定関数を新設する |
| `runRelocateCommand`/`dispatchAndApply`（3676〜3684行目、2902〜2942行目） | `doc.nodes.get(sectionId)` に依存した汎用 relocate 実行経路 | **不可**。`dispatchAndApply` は `doc.nodes.get(sectionId)` が解決できない場合に即座に失敗する設計であり、paragraph は構造的に対象外 | 5T-1 で新設された `dispatchAndApplyParagraphMove` の系譜をそのまま使う。`dispatchAndApply`/`runRelocateCommand` には一切乗せない |
| `dispatchAndApplyParagraphMove`（2727〜2763行目） | `moveParagraphFromAnchor` + `applyLineEditOutcome` に委譲する、paragraph 専用の実行経路（5T-1 で新設） | **再利用可**。D&D の drop 実行はこの既存経路にそのまま委譲すべき | D&D 実装の中核となる既存の安全な委譲先 |
| `readOnlyNodeIds`/`isReadOnly` 使用箇所（複数） | drag listener 全体（`draggable` 設定含む）を `if (!readOnly)` で一括ゲートしている（1596〜1609行目） | **要・狭い例外の新設**。paragraph は常に `readOnlyNodeIds` に含まれるため、現状は drag listener が一切張られていない | 既存のブロックを緩めるのではなく、paragraph 専用の別分岐を追加する必要がある（rename 等、他の書き込み系操作は解禁しないため） |
| `dragHandleEl` の生成（1096〜1098行目） | `if (!readOnly)` の場合のみ `dragHandleEl` を生成（モバイルでの drag 起点をハンドルに限定する、UXP-01） | **要・狭い例外の新設**。drag listener と同一の `!readOnly` ゲートで、paragraph の行には現状ハンドルが一切生成されない | モバイルで paragraph D&D を提供する場合、ハンドル生成にも同様の狭い例外が必要（デスクトップは行全体が起点になるため影響がより単純） |
| `canDropOn`/`relocateSection`（`src/move/relocateSection.ts`） | 任意（非隣接）の SectionBlockNode 間の relocate、`doc.nodes.get()` ベース | **不可**。任意ターゲットを許可する時点で「隣接 swap のみ」という paragraph の制約と根本的に異なる。加えて `doc.nodes` に依存 | 参照実装としては有用だが、コードとしての再利用はできない |
| `canDropListOn`/`relocateListSubtree`（`src/move/relocateListSubtree.ts`） | 任意ターゲットへの relocate + 再インデント処理 | **不可**。再インデントは paragraph D&D の「インデント変更は一切許可しない」という原則に反する | 再利用不可。参照上の対比材料としてのみ有用 |
| `findComplexSiblingTarget`（`src/move/resolveMoveTarget.ts` 391〜474行目） | 与えられた unit から見た、最も近い同一 parentId/同一 depth の隣接 `ComplexBlockInfo` を1件返す | **再利用可、ただし機能拡張が必要**。「自分から見た最寄りの隣接候補」は返せるが、「候補Xが自分の隣接であるか」を直接答える機能はない | drop 実行時の再検証（hover 中の target が真に隣接か）には、この関数をラップした新しい確認ロジックが必要 |
| `moveComplexBlock`（同ファイル 477〜506行目） | `findComplexSiblingTarget` の結果を `swapBlocks` に渡して実行する | **再利用可**。新しい mutation プリミティブは不要 | D&D の drop 実行は、最終的にこの関数（または `moveParagraphFromAnchor` 経由の同等の経路）に到達させればよい |
| `swapBlocks`（`src/move/moveBlock.ts` 24〜44行目） | 2つの隣接range を純粋関数として入れ替える | **再利用可**。paragraph D&D 専用の新しい swap 実装は不要 | そのまま利用 |
| drop indicator CSS（`styles.css` 207〜243行目） | `.unified-outliner-dragging`/`-drop-before`/`-drop-after`/`-drop-inside` | **`-dragging`/`-before`/`-after` は再利用可、`-inside` は使用禁止** | paragraph の drop 先には `-inside` を絶対に付与しない |
| Tree 再描画の debounce（`scheduleRefresh`、150ms、453〜456行目） | editor-change/active-leaf-change/keyup/mouseup を150msデバウンスして `refresh()` を呼ぶ | **既存の drag session 保護機構は存在しない** | `renameState` には `refresh()` 内に明示的なガード（572行目 `if (this.renameState) return;`）があるが、`dragSourceId` 系には同様のガードが一切ない——既存の section/list D&D はこの穴を抱えたまま動作している（HTML5 のネイティブ drag state がブラウザ側に保持されるため実害が出にくいと考えられるが未検証）。paragraph D&D では、`ParagraphMoveAnchor` の再検証で最終的に安全は保たれるが、UX として drag 中の再描画をどう扱うかは §4-1 で新たに検討が必要 |
| 選択状態・fold 復元との連携 | `dragSourceId`/`draggingItemEl`/`dropIndicatorEl` は選択・fold 状態と一切連動していない（相互参照なし） | 影響なし | paragraph D&D 導入によって既存の選択・fold 復元ロジックに新たな連携を追加する必要はない |
| `dragend` 時・例外時のクリーンアップ | `handleDragEnd` は常に `endDrag()`＋`clearDropIndicator()` を呼ぶ。`handleDrop` も判定前にこれらを呼ぶ（3607〜3616行目） | **再利用可** | 同じ「クリーンアップ優先」パターンを paragraph にも適用する |
| 既存 D&D テスト | `tests/relocateSection.test.ts`/`tests/relocateListSubtree.test.ts` は pure 関数のみを対象とし、UI wiring の D&D テストは存在しない | 参照可 | paragraph D&D 用の新しいテストファイルが必要になる（5T-2 実装時） |
| `tests/paragraphOutlineTreeUiWiring.test.ts` §5-5 | 「paragraph D&D は `!readOnly` ゲートにより常に拒否される」ことを静的ソース検査で固定しているテスト | **実装時に要改訂（削除ではなく更新）** | 5T-2 実装時、このテストは「paragraph D&D は狭い専用分岐でのみ許可され、child drop・非隣接drop・list/section targetは依然拒否される」ことを検証する内容へ、慎重に改訂する必要がある。テストの保護意図（任意drop・child dropを許可しない）は維持したまま書き換える |
| Method Vault の実機検証記録 | D&D 関連の既存検証ドキュメントは存在しない（`*dnd*`/`*drag*` で検索して0件） | 新設が必要 | 本チケット §7 で新規作成する |

### なぜ既存の section/list D&D をそのまま再利用できないか

4つの観点から整理する。

**id 空間の観点**: 既存の D&D は `dragstart` 時に `node.id`（Tree の
表示用 id）を直接 `dragSourceId` として保持し、`drop` 実行時に
`doc.nodes.get(dragSourceId)` へそのまま渡す。この設計が成立するのは、
section/list の Tree node id が `doc.nodes` のキーと一致するという不変
条件があるからである。paragraph の Tree node id（`tree-paragraph:N`）は
`doc.nodes` に一切存在しないキーであり、この不変条件そのものが成り立たな
い。5T-1R が固定した「view identity と scan-local identity を混同しな
い」契約は、この既存 D&D パターンとは根本的に相容れない。

**構造モデルの観点**: `canDropAny`/`canDropOn`/`canDropListOn` はいずれも
`ParsedDocument.nodes`（`BlockNode` の世界）を前提とした判定であり、
paragraph が属する `ComplexBlockInfo`（scanner の世界）を一切扱わない。
2つの世界を跨ぐ判定ロジックは現状存在せず、新設が必要である。

**親変更（parent change）の観点**: 既存の D&D（特に `relocateListSubtree`
の inside mode）は、drop 先に応じて親子関係やインデントレベルを変更する
ことを前提にしている。paragraph D&D は「親変更・インデント変更を一切許可
しない」という制約（§2）を持つため、既存の D&D 実行系（`dispatchAndApply`
経由）にそもそも接続できない。

**書き戻し経路の観点**: 既存の D&D は最終的に `dispatchAndApply` →
`relocateSection`/`relocateListSubtree` という、`doc.nodes` に依存する単
一の書き戻し経路に必ず合流する。paragraph の安全な書き戻し経路
（`dispatchAndApplyParagraphMove` → `moveParagraphFromAnchor`）は、5T-1
の時点で意図的にこの経路から完全に分離されている。D&D のためだけにこの
分離を破って合流させることは、5T-1R が固定した安全契約に反する。

## 6. 最小実装候補 5T-2 の可否判断

### 結論: 案Aの範囲に限定すれば、安全な最小実装は構造的に証明可能と判断する

根拠は次の通りである。

1. drop 実行の最終的な mutation は `swapBlocks`（既存・変更不要）に到達
   させることができ、新しい書き換えプリミティブは不要である。
2. source の安全な再解決は `resolveParagraphFromTreeHint` +
   `buildParagraphMoveAnchor` + `moveParagraphFromAnchor`（5T-1R で確立
   済み）にそのまま委譲できる。
3. 「隣接 sibling を探す」ロジック自体（`findComplexSiblingTarget`）は既
   に存在する。

ただし、次の1点は**現状存在せず、新設が必須**である。

- 「hover 中の drop target が、今この瞬間において自分の真の隣接
  sibling であるか」を確認する関数。`findComplexSiblingTarget` は
  「自分から見た最寄りの候補」を返すのみで、任意の候補との一致確認機能
  を持たない。これは新しいロジックだが、既存の `findComplexSiblingTarget`
  を呼んで得た結果と hover 中の target を比較するだけで実現できる、比較
  的小さな追加である（新しい安全性モデルの発明ではなく、既存関数の戻り
  値の使い方の追加）。

したがって、最小実装候補5T-2のスコープは次のとおりとする。

- paragraph からの dragstart のみ許可する（狭い専用分岐、既存の
  `!readOnly` ゲートは変更しない）。
- target は、現在の Markdown 上で同一 `parentId` を持つ、直前/直後
  sibling に厳密に限定する。
- target row に before/after の視覚的インジケータを表示する。
- インジケータは、真に有効な drop zone に対してのみ表示する（無効な場合
  は何も表示しない）。
- drop は完全に既存の 5T-1 の anchor・再解決・move 経路に委譲する。
- Tree 再描画は結果を正しく反映する。
- paragraph の view id を move の identity として永続化しない。
- 既存の context menu 移動はフォールバックとして維持する。
- paragraph ↔ list、任意位置への挿入、child drop は明示的に対象外のまま
  とする。

### 6-1. まだ実装に進む前に確定させるべき点（承認が必要な論点）

- 4-1 で述べた「Tree 再描画中の paragraph drag session の扱い」——
  既存の section/list D&D にも同種のガードが存在しないため、paragraph
  でも「実害が出るまで放置する」か、「新しい保護を導入する」かの判断が
  必要。
- モバイル（`dragHandleEl`）に対して paragraph D&D を提供するかどうか。
  提供する場合、UXP-01 のハンドル生成ロジックにも狭い例外が必要になる。
  デスクトップのみに限定するという判断もあり得る。
- `tests/paragraphOutlineTreeUiWiring.test.ts` §5-5 の改訂方針。

これらは実装そのものの着手前に、5T-1/5T-1R と同様にユーザーの承認を得る
べき論点として扱う。

## 7. Method Vault 実機検証計画（将来の5T-2実装向け、未実施）

別ファイル（Method Vault側）に新規作成する
`phase5t2-paragraph-tree-dnd-verification-plan.md` を正とする。本ドキュメ
ントの §9 からリンクする。

## 8. 成果物と完了条件

- [x] `docs/phase5t2_paragraph-tree-dnd-design.md`（本ファイル）を新設
- [x] `docs/phase5t_tree-interaction-move-design.md` に 5T-2D の結論と
      本ファイルへのリンクを追記
- [x] `docs/統合実装ロードマップ_2026-08-05.md` に 5T-1/5T-1R/5T-2D の
      状態を反映（フェーズ状況表が 5T-0 で止まっていたため追記）
- [x] Method Vault に D&D 実機検証計画ドキュメントを新規作成
- [x] 本番ソースコードの変更なし
- [x] `parseDocument.ts` 変更なし
- [x] 単独コミット（完了報告に記載）

## 9. 関連ドキュメント

- `docs/phase5t_tree-interaction-move-design.md` — 5T-0 の調査・5T-1/
  5T-1R の確定事項。本ドキュメントの直接の前提。
- `docs/phase5p_paragraph-block-foundation-plan.md` — Phase 5P 全体計画。
- `docs/uxp-01-ipad-drag-context-menu.md` — モバイルでの drag handle
  分離パッチ。paragraph D&D をモバイルへ拡張する場合の直接の関連資料。
- `docs/統合実装ロードマップ_2026-08-05.md` §3.10、および本チケットで
  追記する新セクション。
