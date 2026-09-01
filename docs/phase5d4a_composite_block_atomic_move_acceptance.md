# Phase 5D-4A CompositeBlock Atomic Move — 限定実機受入記録

関連文書: [phase5d4a_composite_block_atomic_move_review.md](./phase5d4a_composite_block_atomic_move_review.md)（監査・自動テストの記録。本文書とは独立して保持され、本受入作業による変更は一切加えていない）。

## 0. 本文書の位置づけ

本文書は、Phase 5D-4A CompositeBlock Atomic Move の実装変更を一切行わない前提のもとで、Obsidian 実機（デスクトップアプリ）上で 9 件の必須ケースを実際に操作し、その結果を記録した受入証跡である。対象 Vault は専用の実機受入 Vault（ipad-test Vault）であり、既存の研究ノートや通常利用中のノートには一切手を加えていない。実機操作専用の使い捨てフィクスチャノートを新規作成し、そのノートに対してのみ操作を行った。

全 9 ケースについて、production code の変更を一切伴わずに実機で再現・確認できたことをもって PASS と判定している。FAIL または BLOCKED は 1 件も発生しなかったため、本ticketの停止条件（1件でもFAIL/BLOCKEDが出た場合は production code を修正せず再現手順等のみ報告して停止する）は発動していない。

## 1. 対象フィクスチャノート

- パス: ipad-test Vault 内の `Test/phase5d4a-composite-move-acceptance-fixture.md`
- 性質: 本受入作業のためだけに新規作成された使い捨てノートであり、既存の研究ノートとは無関係である。
- 補足: ノートを Obsidian で開いた直後、本受入作業とは無関係な Vault 側の自動化（ファイル名とH1見出しを同期させるコミュニティプラグインと推測される）により、1行目のH1見出しがファイル名と同じ文字列に自動書き換えされたことを確認している。この書き換えは1行目のみに影響し、各Caseセクションの内容には一切影響していない。

## 2. 経路カバレッジ

チケットの要求どおり、Tree 右クリックメニュー経由と editor command 経由の双方を、それぞれ少なくとも1回ずつ実際に操作した。

| 経路 | 使用したケース |
| --- | --- |
| Tree 右クリックメニュー | Case1, Case3, Case7, Case8（Case9のUndo設定操作も含む） |
| editor command（コマンドパレット） | Case2, Case4, Case5, Case6 |

editor command 経由で実際に確認したコマンド名は次の2つである（当初"Move composite block up/down" という名称を想定していたが実在せず、以下が正しい名称であることを実機で確認済み）。

- `Unified Outliner: Move extended block up (at cursor)`
- `Unified Outliner: Move extended block down (at cursor)`

Tree 右クリックメニューの項目名は次のとおりである。

- `Move extended block up` / `Move extended block down` / `Open extended block in partial edit` / `Delete extended block`

## 3. Notice 文言の出典について

各ケースの Notice 原文は実機のスクリーンショットから書き起こしたものであり、あわせて `src/i18n.ts` の該当キーの値と突き合わせて一致を確認している（同一 reason コードに対する Notice 文言はビルド時に固定される文字列であり、実行のたびに変化するものではない）。移動が成功した場合（Case1〜3, 7の各成功操作）は Notice が一切表示されない仕様であることも、`src/view/OutlineTreeView.ts` の `dispatchAndApplyCompositeMove`（Tree経路）と `src/main.ts` の `moveCurrentCompositeBlock`（editor command経路）の実装を確認して裏付けた。両者とも `applyLineEditOutcome` に成功時コールバックを渡しておらず、`changed === true` の場合は無言でノートへ反映するのみで、拒否理由がある場合にのみ `this.notice(...)` を呼び出す構造になっている。

| reason コード | Notice 原文（英語, 既定ロケール） | 出典 |
| --- | --- | --- |
| no-adjacent-compatible-unit | "Unified Outliner: nothing recognizable to swap with in that direction." | src/i18n.ts `reason.no-adjacent-compatible-unit` |
| different-parent-or-depth | "Unified Outliner: the adjacent item is not at the same level — move skipped for safety." | src/i18n.ts `reason.different-parent-or-depth` |
| compositeMoveNestedInList | "Unified Outliner: this extended block is nested inside another list item and cannot be moved in this version." | src/i18n.ts `reason.compositeMoveNestedInList` |
| compositeMoveSelectionOutOfBounds | "Unified Outliner: the current selection extends beyond this extended block — the move was cancelled." | src/i18n.ts `reason.compositeMoveSelectionOutOfBounds` |
| compositeMoveNoTargetAtCursor | "Unified Outliner: no extended block was found at the cursor position." | src/i18n.ts `reason.compositeMoveNoTargetAtCursor` |
| compositePartialEditSnapshotMismatch | "Unified Outliner: the note changed since this extended block was selected — the edit was cancelled to avoid affecting the wrong content." | src/i18n.ts `reason.compositePartialEditSnapshotMismatch` |


## 4. ケース別記録

実施日: 2026-08-31。全ケースとも本セッション内で実機に対して実操作を行い、操作直後に `read_file` でフィクスチャノートの実際の内容を読み出して事前/事後 Markdown を確定させている。

### Case1（List+Callout の隣接Move、上・下）＋ Case9（Undo）

- 起動経路: Tree 右クリックメニュー
- 対象: `callout-one` + `[!note] Case1 callout` からなる CompositeBlock
- 判定: **PASS**（4ステップすべて期待どおり）

| ステップ | 操作 | 操作前 Markdown | 操作後 Markdown | Notice |
| --- | --- | --- | --- | --- |
| A（down） | Tree右クリック→"Move extended block down" | `- callout-one`<br>`> [!note] Case1 callout`<br>`> case1 body`<br>`- callout-zero`<br>`- callout-two` | `- callout-zero`<br>`- callout-one`<br>`> [!note] Case1 callout`<br>`> case1 body`<br>`- callout-two` | なし（成功時は無音仕様） |
| B（up） | Tree右クリック→"Move extended block up" | （Aの操作後と同一） | `- callout-one`<br>`> [!note] Case1 callout`<br>`> case1 body`<br>`- callout-zero`<br>`- callout-two` | なし |
| C（Case9用の再移動, down） | Tree右クリック→"Move extended block down" | （Bの操作後と同一） | `- callout-zero`<br>`- callout-one`<br>`> [!note] Case1 callout`<br>`> case1 body`<br>`- callout-two` | なし |
| D（Case9: Undo） | エディタにフォーカスした状態で Obsidian 標準Undo（Cmd+Z）を1回実行 | （Cの操作後と同一） | `- callout-one`<br>`> [!note] Case1 callout`<br>`> case1 body`<br>`- callout-zero`<br>`- callout-two` | なし（プラグイン独自のNoticeではなく、Obsidian標準のUndo機能） |

ステップDの操作後 Markdown はステップC実行直前の状態と完全に一致しており（`- callout-one` が先頭、`- callout-zero` がその次という並び）、Undoによる本文の正確な復元を確認した。callout本文（`case1 body`）を含め1文字の差異もない。


### Case2（List+Quote の隣接Move、上・下）

- 起動経路: editor command（コマンドパレット、カーソルは composite 本文 `case2 plain quote body` 行に置いた）
- 対象: `quote-one` + `> case2 plain quote body` からなる CompositeBlock（quote内はcallout構文ではない素の引用ブロック）
- 判定: **PASS**（2ステップとも期待どおり）

| ステップ | 操作 | 操作前 Markdown | 操作後 Markdown | Notice |
| --- | --- | --- | --- | --- |
| A（down） | コマンドパレット→"Unified Outliner: Move extended block down (at cursor)" | `- quote-zero`<br>`- quote-one`<br>`> case2 plain quote body`<br>`- quote-two` | `- quote-zero`<br>`- quote-two`<br>`- quote-one`<br>`> case2 plain quote body` | なし |
| B（up） | コマンドパレット→"Unified Outliner: Move extended block up (at cursor)" | （Aの操作後と同一） | `- quote-zero`<br>`- quote-one`<br>`> case2 plain quote body`<br>`- quote-two` | なし |

ステップB実行後、フィクスチャ新規作成時点の原本と完全に一致することを確認した。ステップA・Bを通じて `case2 plain quote body` の文字列に一切の変化はない。

### Case3（fold marker と内部nested listを含むCompositeのMove）

- 起動経路: Tree 右クリックメニュー
- 対象: `fold-one` + `> [!warning]+ Folded case3 title`（fold marker `+` 付き callout、内部に nested list を2件持つ）からなる CompositeBlock
- 判定: **PASS**

| 操作 | 操作前 Markdown | 操作後 Markdown | Notice |
| --- | --- | --- | --- |
| Tree右クリック→"Move extended block down" | `- fold-one`<br>`> [!warning]+ Folded case3 title`<br>`> case3 body`<br>`> - nested a`<br>`> - nested b`<br>`- fold-zero`<br>`- fold-two` | `- fold-zero`<br>`- fold-one`<br>`> [!warning]+ Folded case3 title`<br>`> case3 body`<br>`> - nested a`<br>`> - nested b`<br>`- fold-two` | なし |

fold marker（`[!warning]+` の `+`）および内部 nested list（`> - nested a` / `> - nested b`）の行が、`>` プレフィックスも含めて一切変化せずそのまま移動先へ持ち越されていることを確認した。これは `tests/moveCompositeBlock.test.ts` に追加した「raw range preservation」テスト群が保証する性質を実機で裏付けるものである。


### Case4（section境界に隣接したCompositeのMove拒否）

- 起動経路: editor command（コマンドパレット、カーソルは composite 本文 `case4 body` 行に置いた）
- 対象: `case4-item` + `> [!note] Case4 callout`。直後に `### Case4の直後に隣接する見出し（境界）` という見出しが隣接している。
- 期待結果: down方向のMoveは見出し（section境界）をまたげないため拒否される
- 実結果: 期待どおり拒否
- 判定: **PASS**

| 操作 | 操作前 Markdown | 操作後 Markdown | Notice |
| --- | --- | --- | --- |
| コマンドパレット→"Unified Outliner: Move extended block down (at cursor)" | `- case4-item`<br>`> [!note] Case4 callout`<br>`> case4 body`<br>`### Case4の直後に隣接する見出し（境界）` | （操作前と完全に同一。1文字も変化なし） | "Unified Outliner: nothing recognizable to swap with in that direction." |

reason コードは `no-adjacent-compatible-unit` であり、これは監査文書（review.md）で確認した「`skipBlankLines`+`findAdjacentAnchorNode` がsection見出しを絶対に飛び越えない」という判定ロジックの実機での裏付けである。本文（callout本文を含む）が1文字も変わっていないことを before/after Markdown の一致で確認した。

### Case5（nested list内のCompositeのMove拒否）

- 起動経路: editor command（コマンドパレット、カーソルは composite 本文 `case5 body` 行に置いた）
- 対象: `case5-outer` の子として nested indent された `case5-inner` の直後に置かれた `> [!note] Case5 callout` を含む CompositeBlock（このCompositeBlock自体がlist item内にネストされている）
- 期待結果: nested-in-list によりMoveは拒否される
- 実結果: 期待どおり拒否
- 判定: **PASS**

| 操作 | 操作前 Markdown | 操作後 Markdown | Notice |
| --- | --- | --- | --- |
| コマンドパレット→"Unified Outliner: Move extended block down (at cursor)" | `- case5-outer`<br>`  - case5-inner`<br>`> [!note] Case5 callout`<br>`> case5 body`<br>`- case5-sibling` | （操作前と完全に同一） | "Unified Outliner: this extended block is nested inside another list item and cannot be moved in this version." |

reason コードは `compositeMoveNestedInList`。本文が1文字も変わっていないことを確認した。


### Case6（sibling の indentColumns/親構造不一致によるMove拒否）

- 起動経路: editor command（コマンドパレット、カーソルは composite 本文 `case6 body` 行に置いた）
- 対象: `case6-one` + `> [!note] Case6 callout`。直後の `case6-two` はインデント2段のnested list item であり、親構造・indentColumnsが一致しない。
- 期待結果: `different-parent-or-depth` によりMoveは拒否される
- 実結果: 期待どおり拒否
- 判定: **PASS**

| 試行 | 操作前 Markdown | 操作後 Markdown | Notice | reason |
| --- | --- | --- | --- | --- |
| 1回目（参考、想定外） | `- case6-one`<br>`> [!note] Case6 callout`<br>`> case6 body`<br>`  - case6-two` | （同一） | "Unified Outliner: no extended block was found at the cursor position." | compositeMoveNoTargetAtCursor |
| 2回目（本採用） | （同一） | （同一） | "Unified Outliner: the adjacent item is not at the same level — move skipped for safety." | different-parent-or-depth |

1回目の試行では、直前に押下した方向キーによりカーソルが composite の範囲外に外れてしまい、意図した `different-parent-or-depth` とは異なる `compositeMoveNoTargetAtCursor` の拒否が発生した（これも実装として正しい挙動であり、実機での有効な追加証跡ではあるが、Case6が要求する拒否理由そのものではない）。カーソルを `case6 body` 行内へ再度正確にクリックし直した2回目の試行で、意図した `different-parent-or-depth` による拒否を確認した。いずれの試行でも本文は1文字も変化していない。

### Case7（composite-widening：隣接先が別CompositeBlockの場合）

- 起動経路: Tree 右クリックメニュー（`case7-first` composite の行を右クリック）
- 対象: `case7-first` + `[!note] Case7 first callout` と、隣接する `case7-second` + `[!tip] Case7 second callout` という2つの独立したCompositeBlockが直接隣接している状態
- 期待結果: 両Compositeが分断されることなく、それぞれ完全な単位のまま入れ替わる（composite-widening）
- 実結果: 期待どおり
- 判定: **PASS**

| 操作 | 操作前 Markdown | 操作後 Markdown | Notice |
| --- | --- | --- | --- |
| Tree右クリック（`case7-first`側）→"Move extended block down" | `- case7-first`<br>`> [!note] Case7 first callout`<br>`> case7 first body`<br>`- case7-second`<br>`> [!tip] Case7 second callout`<br>`> case7 second body` | `- case7-second`<br>`> [!tip] Case7 second callout`<br>`> case7 second body`<br>`- case7-first`<br>`> [!note] Case7 first callout`<br>`> case7 first body` | なし |

`case7-first` composite（noteタイプ）と `case7-second` composite（tipタイプ）の双方が、メンバーの交差混入なく、それぞれ完全な単位のまま入れ替わったことを確認した。これは監査文書（review.md）で確認した `findCompositeMoveTarget.ts` の composite-widening ロジック（隣接先が他のCompositeBlockの`members[0]`である場合の防御的チェックを含む）の実機での裏付けである。


### Case8（whole-Composite Partial Edit を開いた後の stale Apply）

- 起動経路: Tree 右クリックメニュー（Partial Edit を開く）＋ Tree 右クリックメニュー（Moveを実行）＋ Partial Edit ペインの Apply
- 対象: `case8-item` + `> [!note] Case8 callout`
- 期待結果: Partial Edit ペインを開いた後に同じComposite を Move すると、開いたままの Pane で Apply しても snapshot-mismatch として拒否され、かつ Move の結果は保持され続ける
- 実結果: 期待どおり
- 判定: **PASS**

操作手順:

1. Tree右クリック→"Open extended block in partial edit" で Partial Edit ペインを開く。ペインには当時の内容がそのまま読み込まれる: `- case8-item` / `> [!note] Case8 callout` / `> case8 body`。
2. ペインを開いたまま、Tree右クリック（同じComposite）→"Move extended block down" を実行。本文が `- case8-sibling` / `- case8-item` / `> [!note] Case8 callout` / `> case8 body` に変化したことを確認（Case8-item と case8-sibling が入れ替わった）。
3. 開いたままの Partial Edit ペイン（Move前の内容を保持したまま）の本文末尾に " EDITED-STALE" を追記し、Apply を押下。

| 項目 | 内容 |
| --- | --- |
| Apply直前のペイン内容（stale） | `- case8-item`<br>`> [!note] Case8 callout`<br>`> case8 body EDITED-STALE` |
| Apply押下後のNotice原文 | "Unified Outliner: the note changed since this extended block was selected — the edit was cancelled to avoid affecting the wrong content." |
| Apply押下後のノート本文 | `- case8-sibling`<br>`- case8-item`<br>`> [!note] Case8 callout`<br>`> case8 body`（EDITED-STALEは反映されていない） |

Notice原文は `reason.compositePartialEditSnapshotMismatch` の値と一致しており、拒否理由が snapshot-mismatch であることを確認した。Apply後もノート本文は「EDITED-STALE」という編集内容を含まず、ステップ2のMoveの結果（`case8-sibling` が先頭）がそのまま維持されていることを確認した。すなわち、stale Apply は拒否され、かつ直前のMoveの結果は失われなかった。


## 5. ケース一覧サマリー

| ケース | 内容 | 起動経路 | 判定 |
| --- | --- | --- | --- |
| Case1 | List+Callout の隣接Move（上・下） | Tree | PASS |
| Case2 | List+Quote の隣接Move（上・下） | editor command | PASS |
| Case3 | fold marker + nested list を含むCompositeのMove | Tree | PASS |
| Case4 | section境界に隣接したCompositeのMove拒否 | editor command | PASS |
| Case5 | nested list内のCompositeのMove拒否 | editor command | PASS |
| Case6 | indentColumns/親構造不一致によるMove拒否 | editor command | PASS |
| Case7 | composite-widening（隣接先が別CompositeBlock） | Tree | PASS |
| Case8 | whole-Composite Partial Editのstale Apply拒否 | Tree + Partial Edit | PASS |
| Case9 | 成功したMove直後のUndoによる正確な復元 | Tree（Case1のステップDとして実施） | PASS |

FAIL / BLOCKED は0件。したがって停止条件は発動していない。

## 6. 自動検証結果

実機受入作業の後、`unified-outliner-public` リポジトリ（公開リポジトリの作業ツリー）に対して以下を再実行した。実機受入フィクスチャノートは `ipad-test` Vault側にあり、このリポジトリのgit管理対象ではないため、以下の結果はいずれもリポジトリ内の production code・既存テストが無変更であることの確認である。

| コマンド | 結果 |
| --- | --- |
| `npm test` | 93 files / 1767 tests, all PASS |
| `npx tsc -noEmit -skipLibCheck` | exit 0（クリーン） |
| `npm run build` | exit 0（クリーン。`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`） |
| `git diff --check` | exit 0（空白関連の問題なし） |
| `git status --short` | `M tests/compositeBlockPartialEdit.test.ts` / `M tests/moveCompositeBlock.test.ts` / `?? docs/phase5d4a_composite_block_atomic_move_review.md`（前チケットまでに承認済みの差分と一致）に加え、本文書自身である `?? docs/phase5d4a_composite_block_atomic_move_acceptance.md` が新たに未追跡ファイルとして加わる。この4件以外に変更はなく、production code の変更は皆無 |


## 7. 新規・変更ファイル一覧

| ファイル | 種別 | 場所 | 備考 |
| --- | --- | --- | --- |
| `docs/phase5d4a_composite_block_atomic_move_acceptance.md` | 新規 | `unified-outliner-public` リポジトリ | 本文書自身。production codeでもtestでもない。 |
| `Test/phase5d4a-composite-move-acceptance-fixture.md` | 新規 | `ipad-test` Vault（リポジトリ外） | 実機受入専用の使い捨てフィクスチャノート。 |

上記2ファイル以外に、本チケットの実機受入作業によって変更されたファイルは存在しない。`tests/compositeBlockPartialEdit.test.ts` と `tests/moveCompositeBlock.test.ts` の変更、および `docs/phase5d4a_composite_block_atomic_move_review.md` の新規作成は、前チケット（受入証跡化A・B・C）で既に承認済みの差分であり、本チケットでの変更ではない。

## 8. git diff --stat と未コミット差分の要約

`unified-outliner-public` リポジトリの現時点の未コミット差分（本文書追加後）は次のとおりである。

```
 tests/compositeBlockPartialEdit.test.ts | 49 +++++++++++++++++++++++
 tests/moveCompositeBlock.test.ts        | 71 +++++++++++++++++++++++++++++++++
 2 files changed, 120 insertions(+)
```

未追跡ファイル（`git status --short` の `??`）:

- `docs/phase5d4a_composite_block_atomic_move_review.md`（前チケットで承認済み、監査・自動テストの記録）
- `docs/phase5d4a_composite_block_atomic_move_acceptance.md`（本文書、本チケットの成果物）

要約すると、本チケット（限定実機受入）によってリポジトリ内で新規に生じた差分は「本文書の追加」のみである。production code の変更は0件、既存テストへの変更も0件である。実機操作そのものは `ipad-test` Vault側の使い捨てフィクスチャノートに対してのみ行われており、このリポジトリのgit管理対象には含まれない。

## 9. コミット候補メッセージ（未コミット）

以下はコミット候補であり、本文書作成時点ではまだコミットを実行していない。

```
docs: add Phase 5D-4A composite atomic move real-device acceptance record

限定実機受入（9ケース、Tree/editor command両経路、ipad-test Vault）を実施し、
全ケースPASSを確認した記録をdocs/phase5d4a_composite_block_atomic_move_acceptance.mdとして追加。
production codeおよび既存テストへの変更は無し。
```

## 10. 未着手・対象外事項（再掲）

本チケットは実装変更を一切行わない実機受入であり、以下は本文書のスコープに含まれない（`docs/phase5d4a_composite_block_atomic_move_review.md` の §3 を参照）。

- CompositeBlock 単位の atomic Drag and Drop は本チケット時点でも未実装のままである。
- 隣接swap以外の non-adjacent move（離れた位置への挿入的な移動）も未実装のままである。
- 将来 atomic D&D を実装する場合は独立したチケットとして扱うべきであり、隣接swap用executor（`moveCompositeBlock.ts`）と非隣接insert用executorを単一の実装に統合すべきではないという監査文書の見立ては、本文書によって何ら変更・確定されるものではない。
