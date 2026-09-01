# Phase 5D-4A: CompositeBlock Atomic Move Review

## 0. 本文書の構成についての注意

本文書は2つの異なる性質の内容を含む。**§1「監査で確認した事実」は、既存コード・既存テストを実際に読み込んで確認した現行仕様である。** これに対し **§3「将来の一体 Drag and Drop に向けた設計前提（将来案）」は、まだコード化されていない、確定していない検討事項である。** 両者を混同しないこと。§3のいかなる項目も、現行の実装仕様として扱ってはならない。

## 1. 監査で確認した事実

対象: CompositeBlock（List + Callout / List + Quote）の既存の一体 Move up/down。監査は読み取り専用で行い、production code の変更は一切行っていない。

### 1.1 実装は judge / resolver / executor の3層構造で完結している

| 層 | 実装 | 責務 |
|---|---|---|
| judge | `src/parser/compositeBlocks.ts#evaluateCompositeBlockMovability` | 指定方向へのswapが安全か否かを判定する（nested-in-list／unsafe-indent／no-adjacent-compatible-unit／different-parent-or-depthの4条件） |
| resolver | `src/move/findCompositeMoveTarget.ts#findCompositeMoveTarget` | judgeの許可を前提に、swap相手の正確なLineRangeを解決する（composite-widening含む） |
| executor | `src/edit/moveCompositeBlock.ts#moveCompositeBlock` | textを再parse・再scan・再matchし、judge/resolverを再実行してから`move/moveBlock.ts#swapBlocks`を実行する |

judgeの条件4（`parentId`・`depth`・`indentColumns`の一致）が事実上の同一セクション制約として機能しており、セクション見出しをまたぐswapは発生しない。

UIエントリポイントは2系統存在し、いずれも最終的に同一の`buildCompositeBlockSnapshot → moveCompositeBlock`パイプラインへ収束する。

| エントリポイント | 起点 |
|---|---|
| Treeの親ノード右クリックメニュー | `showCompositeCommandMenu` → `dispatchAndApplyCompositeMove`（`src/view/OutlineTreeView.ts`） |
| 本文エディタのカーソル/選択駆動コマンド | `main.ts#moveCurrentCompositeBlock`（`move/resolveCompositeSelectionTarget.ts`でカーソル/選択を単一のCompositeBlockへ解決してから同じパイプラインに入る） |

### 1.2 member単位のMove・Drag and Dropとの関係

**CompositeBlock一体Moveは、隣接swapのみで実装されている。非隣接移動は実装されていない。**

**CompositeBlock一体のDrag and Dropは実装されていない。** `src/view/OutlineTreeView.ts`のドラッグセッション状態は`dragSourceId`（section/list）・`paragraphDragSession`（Phase 5T-2）・`calloutDragSession`（Phase 5D-3C、standalone/composite-member callout・blockquote D&D）の3フィールドのみで、`compositeDragSession`に相当するフィールドは存在しない。

**一体Moveとmember単位Move/D&Dは、別操作単位として扱われている。** Tree行のcontextmenu配線（`renderNode`）は、composite親行・standalone complex-member行・composite-member callout/blockquote行・paragraph行を相互排他的な分岐として実装しており、それぞれ専用のメニューメソッドを持つ。一体Moveの対象（composite親のrange全体）とmember単位Moveの対象（単一memberのrange）は異なるDOM行から起動される。

### 1.3 Partial Editとの関係

whole-CompositeBlock Partial Edit（`src/edit/compositeBlockPartialEdit.ts`）は、extract時・apply時の両方で毎回独立して`parseDocument → scanComplexBlocks → matchCompositeBlocks`を再実行し、対象の再特定を`snapshotMatches`（ruleId・sectionId・aggregate range・各memberのkind/id/rangeによる内容一致）で行う。IDでの照合は行わない。

Partial Editペインを開いた後、そのcompositeが一体Moveで移動された場合、composite自身の絶対range（startLine/endLine）が変化する。したがって、ペインを開いた時点のsnapshotとの`range`比較が一致しなくなり、Apply時に`snapshotMatches`が失敗して`"snapshot-mismatch"`として拒否される（本文は変更されない）。この挙動は本チケットで、実際の`moveCompositeBlock`出力を用いた連鎖テストにより確認済みである（§2のCを参照）。

### 1.4 ルールマッチング・再投影（List+Callout / List+Quote）

`matchCompositeBlocks`（`src/parser/compositeBlocks.ts`）は完全にステートレスな再導出関数である。candidate収集からrule優先順位付きマッチングまでを毎回ゼロから行い、`composite-N`というIDは呼び出しごとに連番で再割当されるのみで、いかなる呼び出し元もこのIDを再parse間で信頼しない。

一体Moveは`swapBlocks`により、composite自身の連続したrangeをバイト単位でそのまま入れ替える。移動後のテキストは内容として加工されていないため、次回のparse時に同じアルゴリズムが同じruleIdで再度そのcompositeを認識する。これは脆弱な「再投影」ステップではなく、状態を持たない決定的な認識アルゴリズムが（位置は変わったが内容は不変な）テキストに対して再実行されるだけである。

### 1.5 raw rangeの完全性

`CompositeBlockSnapshot`（`buildCompositeBlockSnapshot`）が保持するのは構造的な識別情報（ruleId・sectionId・aggregate range・各memberのkind/id/range）のみであり、memberの生テキストそのものは保持・再構築しない。実際の入れ替えを担う`swapBlocks`は`doc.lines`（生テキスト行の配列）上で2つの連続スライスを交換するのみで、再シリアライズ・再フォーマットを一切行わない。list marker・先頭indent・callout/blockquoteの`>`プレフィックス・callout種別/title・fold marker（`+`/`-`）・本文・composite範囲内の空行・内部にネストされたlistは、いずれも「一切触れられない」ことによってバイト単位で保存される。この事実は本チケットで、fold markerと内部ネストlistを含む実際のswapを通じたテストにより確認済みである（§2のAを参照）。

### 1.6 既知の制約（現行仕様のまとめ）

- CompositeBlock一体Moveは隣接swapのみであり、**非隣接移動は未実装**である。
- **CompositeBlock一体のDrag and Drop自体が未実装**である（メニュー/コマンドパレット経由の一体Moveのみが提供されている）。
- **一体Moveとmember単位Move/D&Dは別操作単位**であり、対象行・ドラッグセッション状態のいずれの面でも独立している。
- 一体Moveの対象はcomposite全体のrangeに限られ、member単位の部分的な移動はできない。

## 2. テスト受入証跡化（本チケットで追加したテスト）

監査結論のうち、raw range preservation・section境界拒否・Move後のstale Partial Editのfail-closedの3点について、既存テストの手薄な部分を補うテストを追加した。詳細は完了報告（本文書とは別に提出）の表を参照。productionコードの変更は行っていない。

- A: `tests/moveCompositeBlock.test.ts` — fold marker・内部ネストlistの保存を、実際のswapを通じて個別に検証
- B: `tests/moveCompositeBlock.test.ts` — executor層でのsection境界（見出し隣接）拒否を検証
- C: `tests/compositeBlockPartialEdit.test.ts` — 実際の`moveCompositeBlock`出力を`applyCompositeBlockEdit`へ連鎖させ、snapshot-mismatchによるfail-closedを検証

## 3. 将来の一体 Drag and Drop に向けた設計前提（将来案・未確定）

**本節は、まだコード化されていない検討事項の覚え書きである。現行の実装仕様ではなく、受入基準でもない。将来、独立したチケットとして着手する際の出発点として記録するに留める。**

- 将来の一体D&Dは**独立したチケット**として扱い、既存の隣接swap（`moveCompositeBlock`のswapBlocksベースexecutor）と、非隣接移動のための新規executor（実装されるとすれば、`paragraphNonAdjacentMove.ts`型のinsertBlockAtベースになる見込み）を、**同一のexecutorへ統合しない**方針を検討している。
- 既存の`CompositeBlockSnapshot`をsource側の再特定にそのまま再利用できるのではないか、という見立てがあるが、未検証である。
- drop-target側には、member行・composite内部への直接dropを許可しない新規フィルタが必要になるのではないか、という見立てがあるが、具体的な設計は未着手である。
- 第三者compositeの境界保護（`findCompositeMoveTarget`のcomposite-widening相当の仕組み）をD&D側にも引き継ぐ必要があるのではないか、という見立てがあるが、未設計である。
- before/after/insideの扱いについては、CompositeBlockが常にatomicである以上「inside」は成立しないのではないか、という見立てがあるが、これも未確定である。
- ドラッグセッション状態として、`calloutDragSession`と同型の新規フィールドが必要になる可能性があるが、未実装である。

これらはいずれも**検討の出発点であり、確定した設計でも受入基準でもない**。実装に着手する際は、改めて監査・設計提案・承認のプロセスを経ること。

## 4. 参照

- `src/parser/compositeBlocks.ts`（judge: `evaluateCompositeBlockMovability`, `matchCompositeBlocks`）
- `src/move/findCompositeMoveTarget.ts`（resolver）
- `src/edit/moveCompositeBlock.ts`（executor）
- `src/edit/deleteCompositeBlock.ts`（`CompositeBlockSnapshot`, `buildCompositeBlockSnapshot`）
- `src/edit/compositeBlockPartialEdit.ts`（whole-Composite Partial Edit）
- `src/move/resolveCompositeSelectionTarget.ts`（editor command経路のカーソル/選択解決）
- `src/view/OutlineTreeView.ts`（`showCompositeCommandMenu`, `dispatchAndApplyCompositeMove`）
- `main.ts`（`moveCurrentCompositeBlock`）
