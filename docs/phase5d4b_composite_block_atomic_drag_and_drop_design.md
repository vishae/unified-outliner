# Phase 5D-4B: CompositeBlock Atomic Drag-and-Drop 設計文書

本文書は Phase 5D-4B「CompositeBlock Atomic Drag-and-Drop 設計・実装前監査」で確定した設計判断を記録する。Phase 5D-4C の実装は本文書の内容を実装契約として進める。

関連文書: なし（本チケットが Phase 5D-4 系列で D&D を扱う最初の設計文書である）。

## 1. 対象範囲・対象外

### 対象範囲

- CompositeBlock 親行（Tree 上の集約行）からの drag start のみ。
- 同一 section、同一 parentId、同一 depth、同一 indentColumns に属する plain list item 行、または別 CompositeBlock 親行への before/after drop。
- 隣接 drop（既存 swapBlocks 経由）と非隣接 drop（新規 insertBlockAt 経由）。
- 相手 CompositeBlock の先頭 member または親行への drop 時の widening。
- fail-closed による再解決不能時の安全な拒否。
- 既存 Undo 契約（単一 CM6 トランザクション）の維持。

### 対象外（Phase 5D-4C でも対象外）

- member 行、Composite 内部の行、paragraph 行、section 行、複数選択、nested list、callout/blockquote 内部からの CompositeBlock D&D。
- inside drop（CompositeBlock は atomic であり子スロットを持たない）。
- section 境界を越える drop。
- モバイル・タッチ・長押し D&D。


## 2. source / target / position

| 項目 | 内容 |
|---|---|
| source | CompositeBlock 親行（`isComposite`）のみ。dragstart 時に `this.currentComposites.find(c => c.id === compositeId)` → `buildCompositeBlockSnapshot(composite)` で snapshot 化する（`showCompositeCommandMenu` の既存パターンと同一）。 |
| target | 同一 section・同一 parentId・同一 depth・同一 indentColumns に属する plain list item 行、または別 CompositeBlock 親行のみ。member 行、Composite 内部、section 行、空白行、無関係な complex block、曖昧な target、自己 drop、section 境界越え、nested list は拒否対象。 |
| position | before / after のみ。inside は実装しない。indicator にも表示しない。 |

## 3. session

`compositeDragSession`（`view/OutlineTreeView.ts` 内の新規 `interface CompositeDragSession`）を追加する。

```ts
interface CompositeDragSession {
  snapshot: CompositeBlockSnapshot;
  sourceTreeNodeId: string;
}
```

既存の `dragSourceId`、`paragraphDragSession`、`calloutDragSession` と同時に有効にならない。単一のネイティブ HTML5 drag は構造的に単一 source しか持てないため排他は自動的に成立するが、`endDrag()` は 4 フィールドすべてを無条件でクリアする唯一の終了処理として維持する。`cancelCompositeDrag()`（`cancelCalloutDrag()` と同型）を新設し、`refresh()` の先頭（`cancelParagraphDrag()`・`cancelCalloutDrag()` の直後）と `onClose()` の両方から呼び出す。

paragraph 行・callout/blockquote member 行の既存 dragover/drop ハンドラは、`compositeDragSession` が張られている間は自身が参照する `paragraphDragSession`/`calloutDragSession` が常に null であるため、明示的な分岐追加なしに安全に no-op する（`if (!session) return;` の既存ガードにより自然に除外される）。これにより member 行・paragraph 行への drop 拒否が追加コードなしに保証される。

## 4. resolver

新規 `move/findCompositeBlockDropTarget.ts#resolveCompositeBlockDropTarget` を実装する。

- 隣接 drop: 既存 `move/findCompositeMoveTarget.ts#findCompositeMoveTarget`（無改造）を再利用する。
- 非隣接 drop: 新規 resolver。`move/findStandaloneComplexBlockDropTarget.ts` の構造を参考に、CompositeBlock 専用の判定順で実装する。

判定順（固定）:

1. `source.members[0]` を anchor として解決し、`nested-in-list` を確認。
2. `source.members` のうち list/single-line-list 種別のものについて `unsafeIndent` を確認（`unsafe-indent`）。
3. `insertBeforeLine` を `zone` から算出（before → `target.range.startLine`、after → `target.range.endLine + 1`）。
4. `insertBeforeLine` が `[source.range.startLine, source.range.endLine + 1]` に入る場合 `self-drop`。
5. `sameCompositeAnchorLevel(anchor, target)`（共有 helper、後述）が false の場合 `different-parent-or-depth`。
6. `insertBeforeLine` が既存いずれかの CompositeBlock の range に厳密に内包される場合 `composite-internal-boundary`。
7. 上記すべて通過 → `{ allowed: true, insertBeforeLine }`。

### parentId / depth / indentColumns 判定の共有化

`parser/compositeBlocks.ts#evaluateCompositeBlockMovability` の条件4（parentId・depth・indentColumns の一致判定）を、新規エクスポート関数 `sameCompositeAnchorLevel(a, b)` として抽出する。`evaluateCompositeBlockMovability` 自身もこの関数を呼び出す形にリファクタリングし（振る舞いは不変）、新規 resolver も同じ関数を呼び出す。これにより隣接 Move と D&D 非隣接 Move の「同一レベル」判定基準が将来乖離することを防ぐ。

nested-in-list・unsafe-indent の判定は、`move/findStandaloneComplexBlockDropTarget.ts` 自身が source の kind/editability/nested-in-list を inline で再判定している既存precedentに倣い、新規 resolver 内に小さな inline チェックとして実装する（`evaluateCompositeBlockMovability` を呼び出さない）。これは複雑な判定ロジックではなく、単一フィールドの参照であり、複製によって将来乖離するリスクが実質的にない種類のチェックである。

## 5. executor

非隣接 drop 用に新規 `edit/dropCompositeBlock.ts#dropCompositeBlock` を実装する。`edit/dropStandaloneComplexBlock.ts` の安全な構造（re-parse → re-scan → re-match → snapshot 照合 → target 再解決 → resolver → insertBlockAt）を参考にした、CompositeBlock 専用の独立実装とする。

実行直前に `parseDocument` → `scanComplexBlocks` → `matchCompositeBlocks` を再実行し、source snapshot を再照合、target hint（`range` + `parentId` のみを保持する軽量な hint）を現在のドキュメントに対して再解決する。再解決不能・snapshot mismatch・target ambiguity・resolver によるあらゆる拒否は、本文を一切変更せず `changed: false` を返す（fail closed）。

`insertBlockAt`（`move/moveBlock.ts`、無改造）のみを使用し、raw text の再シリアライズ・再フォーマットは一切行わない。

隣接 drop は既存 `edit/moveCompositeBlock.ts#moveCompositeBlock`（無改造）をそのまま使用する。

### 隣接・非隣接の判定（dispatch 層）

`view/OutlineTreeView.ts` の新規 `dispatchAndApplyCompositeDrop` が、drop 時点で以下の手順により隣接/非隣接を判定し、呼び出す executor を振り分ける。

1. 編集者の現在テキストを re-parse し、source snapshot を再照合する。
2. 再照合できた場合、`insertBeforeLine`（target/zone から算出）と source の range から `direction`（up/down）を算出する。
3. 同じ `doc`/`complexScan`/`composites` に対して既存 `findCompositeMoveTarget(doc, complexScan, resolved, direction, composites)` を呼び出す。
4. その結果の `range` が今回の drop target の `range` と完全一致する場合のみ「隣接」と判定し、`moveCompositeBlock` を呼び出す。一致しない場合（または `findCompositeMoveTarget` が `null` を返す場合）は「非隣接」と判定し、新規 `dropCompositeBlock` を呼び出す。
5. source snapshot が再照合できない場合は直接 `dropCompositeBlock` を呼び出し、その executor 自身の再検証に安全性判断を委ねる。

この判定はあくまで「どちらの executor を呼ぶか」というディスパッチ上の選択に過ぎず、判定自体の正誤が安全性に影響することはない。`moveCompositeBlock`・`dropCompositeBlock` はいずれも呼び出されるたびに完全に独立した再検証（re-parse/re-scan/re-match/re-resolve）を行うため、誤って一方が選ばれても、その executor 自身の fail-closed 契約により不正な変更が本文に加わることはない。隣接性の判定自体は既存 `findCompositeMoveTarget` の空行スキップを含む意味論をそのまま再利用しており、独自の隣接判定ロジックを新設しない。

## 6. Notice

拒否時は Notice を出さない無言拒否とする（既存3経路 — section/list、paragraph、callout/blockquote D&D — と同一の慣習）。有効な drop target にのみ before/after の drop indicator を表示し、無効な target では表示しない。

menu/command 起点の CompositeBlock Move（`dispatchAndApplyCompositeMove`、既存）における Notice 契約は変更しない。D&D 用の `dispatchAndApplyCompositeDrop` は `applyLineEditOutcome` に渡す `notify` コールバックを no-op とする、独立した新規メソッドとする。

## 7. Undo

`applyLineEditOutcome`（既存、無改造）経由で単一 CM6 トランザクションとして適用する。既存 atomic Move（Phase 5D-4A Case9 で実機検証済み）と同一機構であり、追加の Undo 実装は不要である。


## 8. 再解決・fail-closed

D&D 実行直前には、現在の本文から `parseDocument`、`scanComplexBlocks`、`matchCompositeBlocks` を再実行し、source snapshot と drop target を内容一致で再解決する。再解決不能、snapshot mismatch、target ambiguity、section/parentId/depth/indentColumns 不一致の場合は、本文を一切変更せず fail closed とする（`changed: false`、`lines` は入力と byte 一致）。

Partial Edit ペインを開いた状態で CompositeBlock D&D が成功した後の古い whole-CompositeBlock Partial Edit の Apply は、`edit/compositeBlockPartialEdit.ts` の `extractCompositeBlockText`/`applyCompositeBlockEdit` が再parse/再scan/再match して対象を内容ベースで再照合する既存契約により、自動的に snapshot mismatch として拒否される。この契約は Phase 5D-4A の実機受入（review.md）で既に検証済みであり、D&D 追加に伴う変更は一切不要である。

`ensureBlankSeparation`（`edit/paragraphNonAdjacentMove.ts`）相当の空行挿入は追加しない。CompositeBlock の認識はルールベースの anchor + 直後 member 照合（`matchCompositeBlocks`）であり、paragraph 特有の候補行ラン・ヒューリスティックの曖昧さとは性質が異なるためである。ただし、移動後に隣接する行が意図せず別の CompositeBlock member として吸収されないことを、List + Callout と List + Quote の双方で純関数テストにより検証する（後述テスト計画）。

## 9. テスト計画

### 純関数テスト

- 同一 section・同一 parentId・同一 depth・同一 indentColumns における隣接 before drop。
- 同上、隣接 after drop。
- 同上、非隣接 before drop。
- 同上、非隣接 after drop。
- List + Callout と List + Quote の双方について、source CompositeBlock の raw range が変更されないこと。
- target が他 CompositeBlock の先頭 member または親行である場合の widening（移動元・移動先とも分断されないこと）。
- member 行、Composite 内部、section 行、空白行、無関係な complex block、異なる parentId、異なる depth、異なる indentColumns、nested list、section 境界越え、自己 drop の拒否（本文無変更）。
- source snapshot mismatch、target ambiguity、target 再解決不能、Composite 再マッチ不能での fail closed（本文無変更）。
- 非隣接移動後、source/target 周辺が意図せず新しい CompositeBlock として誤認識・吸収されないこと。

### UI wiring テスト（`tests/OutlineTreeView.compositeDrag.test.ts`、静的ソース検査方式）

- CompositeBlock 親行だけに draggable とイベント配線が付与されること。
- member 行、paragraph 行、section 行、plain list 行に CompositeBlock 用 dragstart が誤配線されないこと。
- indicator が before/after だけであり inside を生成しないこと。
- `compositeDragSession` が既存3種類と排他的であること（`endDrag()` が4フィールドすべてを無条件クリア）。
- `refresh()`/`onClose()` が `cancelCompositeDrag()` を呼ぶこと。
- rename、indent、outdent、delete、member 単位 Move、member 単位 D&D、Partial Edit の既存配線が変化しないこと。

### 実機受入

同一 section 内の隣接 before/after、非隣接 before/after、List + Callout、List + Quote、他 CompositeBlock への widening、無効 target への drop 拒否、Composite 内部および callout/blockquote 内部への drop 拒否、Partial Edit stale Apply の fail-closed、Undo 一回による完全復元、既存 paragraph/callout/list D&D への回帰なしを確認する。専用の実機受入 Vault の fixture を用い、ローカル絶対パス・ログイン名・環境依存の識別子は記載しない。

## 10. 変更予定ファイル一覧

- `src/parser/compositeBlocks.ts`（既存 API 重複回避のための最小限の共有 helper 抽出 — `sameCompositeAnchorLevel` の新設とリファクタリング）
- `src/move/findCompositeBlockDropTarget.ts`（新規）
- `src/edit/dropCompositeBlock.ts`（新規）
- `src/view/OutlineTreeView.ts`（drag wiring、専用 session、dispatch）
- `tests/findCompositeBlockDropTarget.test.ts`（新規）
- `tests/dropCompositeBlock.test.ts`（新規）
- `tests/OutlineTreeView.compositeDrag.test.ts`（新規）
- `tests/outlineTreeDragPayloadSafety.test.ts`（既存、Phase 5D-4C 実装中に承認を得た例外的追随更新 — 詳細は §11）
- `docs/phase5d4c_composite_block_atomic_drag_and_drop_implementation.md`（新規、Phase 5D-4C 完了時）

`src/parser/compositeBlocks.ts` は当初の変更対象ファイル一覧に明示されていなかったが、「evaluateCompositeBlockMovability の parentId/depth/indentColumns 安全条件を複製してはならない」という制約を満たすための最小限の共有 helper 抽出としてのみ変更する（判定ロジックのコピーは行わない）。公開 API への影響は新規エクスポート関数 `sameCompositeAnchorLevel` の追加のみであり、既存の `evaluateCompositeBlockMovability`・`findCompositeMoveTarget` の外部から見える振る舞いは一切変更しない。既存テスト（`tests/compositeBlockMovability.test.ts` 等16ケース）への影響はないと見込む — Phase 5D-4C の自己監査報告で `npm test` の結果とともに確認する。

## 11. `tests/outlineTreeDragPayloadSafety.test.ts` への例外的変更（Phase 5D-4C 実装中に承認）

`tests/outlineTreeDragPayloadSafety.test.ts` は Phase 5T-2R 由来の既存ファイルであり、当初の変更対象ファイル一覧には含まれていなかった。しかし `OutlineTreeView.ts` へ `handleCompositeDragStart`（CompositeBlock 親行専用の新規 dragstart ハンドラ）と、対応する `dragend` listener を追加した結果、同ファイルが持つ2件のハードコードされた件数アサーション（`.setData(` 呼び出し箇所数、`dragend` listener 登録数）が、この新規かつ正当な第4の drag source を検出して失敗した。これは同ファイル自身のドキュメントコメントが明示する「新規 drag source 追加時にこのテストの更新を強制する」という設計上意図された挙動であり、実装の不具合ではない。

本チケットの「対象外ファイルを変更する前に報告し承認を得る」という制約に従い、実装中に `AskUserQuestion` で本状況を報告し、ユーザーの承認を得た。承認は本ファイル1件に限定され、かつ「件数を機械的に更新するだけでなく、CompositeBlock D&D が既存の drag payload safety 契約を実際に満たすことを検証する assertion を追加する」ことが明示的に要求された。

対応として、`tests/outlineTreeDragPayloadSafety.test.ts` を以下の方針で更新した。

- `.setData(` 呼び出し箇所数のアサーションを 3 → 4 に更新（新規 `handleCompositeDragStart` 分）。
- `dragend` listener 登録数のアサーションを 4 → 5 に更新（CompositeBlock 親行 branch 分）。
- `handleCompositeDragStart` が既存 `handleCalloutDragStart` と同一の空文字列 sentinel（`setData("text/plain", "")`）・`effectAllowed = "move"` を設定し、`compositeId`/`node.id` を一切 payload に含めないことを検証する新規 assertion を追加。
- CompositeBlock の dragstart 配線（`this.handleCompositeDragStart(`）がファイル全体で厳密に1箇所のみであり、かつその1箇所が `renderNode` の drag-wiring if/else-if チェーンの最終 branch（`isComposite`）の内部にのみ存在することを、位置ベースで検証する新規 assertion を追加（member 行・complex-member 行・paragraph 行・section 行・plain list 行への誤配線がないことの直接的な証明）。
- `endDrag()` が `dragSourceId`・`paragraphDragSession`・`calloutDragSession`・`compositeDragSession` の4フィールドすべてを無条件クリアすることを検証する既存 assertion を拡張。
- `cancelCompositeDrag()` が `refresh()`/`onClose()` に配線されており、かつ自身が `endDrag()`/`clearDropIndicator()` を呼ぶことを検証する新規 assertion を追加（例外・cancel 後にセッションが残留しないことの検証）。
- CompositeBlock 親行 branch 自身の drop ハンドラが `handleCompositeDropNode` への委譲前に `endDrag()` を呼ぶことを検証する新規 assertion を追加。
- 既存の section/list・paragraph・callout/blockquote 各 drag source の dragstart 配線回数が本チケット前後で変化していないことを検証する新規 assertion を追加（非回帰の直接証明）。

既存の assertion は一切削除・弱体化しておらず、件数の更新も上記の新規 assertion を伴う実質的な検証とセットでのみ行った。この節はユーザー承認の内容と、更新後に `npm test`／`npx tsc -noEmit -skipLibCheck`／`npm run lint`／`npm run build`／`git diff --check` を再実行した事実を、Phase 5D-4C 自己監査報告と対応付けて記録するためのものである。
