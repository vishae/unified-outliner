# Phase 5T-2S: Outline Tree と本文の表示・構造不一致に関する調査記録

- 対象: `unified-outliner-public`
- 基準コミット: `26a04e09bebcbdf74b6376473a74eb8ce2901654`（5T-2R）
- 本ドキュメントの位置づけ（Phase 5T-2S-A で確定）: これは GUI 操作・実機確認を含まない、**コード読解のみによる調査結果**を固定し、次回以降の**手動検証**に引き渡すための文書である。本ドキュメント自身、および本フェーズにおいて、本番ソースコード（`src/parser/parseDocument.ts` を含む）・テストコード・CSS・manifest・build artifact のいずれも変更していない。GUI 操作・`computer_request_access` を含む実機確認の代行・再試行も、本フェーズでは一切行っていない。

## 1. 作業ツリー状態

`git status --short` は以下のみを示す。

```
?? docs/phase5t2s_tree-body-consistency-investigation.md
```

`tests/debug.test.ts` は、このパスには存在しない。前段の調査で、同一ファイルシステム内 `rename()` により `_to_delete/debug.test.ts.txt`（gitignore 済みディレクトリ内、拡張子変更済み）へ退避済みであり、`_to_delete/` はコミット対象からも `git status` の表示からも除外されている。この退避作業・権限問題そのものの解決は本フェーズのスコープ外であり、今回新たな削除・移動・権限回復作業は行っていない。

## 2. `tests/debug.test.ts` について（記録のみ、今回はこれ以上手を付けない）

- 現在、未追跡（untracked）であり、`_to_delete/debug.test.ts.txt` という形でコミット対象外の場所にある。今後もこのファイルおよびその内容をコミットしてはならない。
- 内容は `expect(true).toBe(true)` のみの、製品テストとして意味を持たないプレースホルダである。このような無意味な内容のファイルは、そもそも test 実行対象（vitest の discovery glob）に含めるべきではない ── 現状は拡張子を `.txt` に変えたことで既にその状態になっている。
- 今後、同種の調査用スクラッチファイルを作る場合は、リポジトリ内ではなく、リポジトリ外の一時ディレクトリに作成することを基本方針とする。
- リリース／マージ／完了判定の際は、`git status --short` が clean であることを必ず明示する運用とする（「clean かどうか」自体を判定項目として明記する、という意味であり、今回このために `.gitignore` を変更したわけではない）。
- `.gitignore` の追加変更は行っていない。`debug.test.ts` の削除・移動・device-bridge 権限問題の解決作業は、今回のスコープ外として扱う。

## 3. 調査済みのコード経路（読解のみ、完了）

`src/view/OutlineTreeView.ts` および関連ファイルを読解し、body 更新と Tree 再描画の関係を確認した。

- `refresh()`（609–762行付近）: 呼び出し毎に必ず `view.editor.getValue()` を新規に読み、`parseDocument` → `scanComplexBlocks` → `buildOutlineTree` を経て `currentDoc`／`currentComplexScan`／`currentTree`／`nodeById`／`highlightedId`／`selectedId` 等を単一の同期関数内で再計算する。関数内に `await` はない。
- `dispatchAndApplyParagraphMove`（2884行付近、context menu・D&D 共通の実処理）と `dispatchAndApply`（3061行付近、section/list 移動）は、`changed===true` の場合に `this.refresh()` を同期呼び出しする、同一の契約を持つ。
- `editor.setValue()` は `src/view/OutlineTreeView.ts`／`src/main.ts`／`src/commands/*.ts` のいずれにも存在しない（grep でゼロ件）。すべての本文書き換えは `applyLineEditOutcome.ts` 内の `editor.replaceRange(...)` を経由する。
- CM6 fold sync（`handleCm6FoldEffect`、4230行付近）も `plugin.refreshOutlineTreeViews()` を経由して同じ `refresh()` を直接呼ぶ。
- `ActiveMarkdownViewTracker`（`src/view/activeMarkdownViewTracker.ts`）は Source Mode と Reading Mode を区別しない。`MarkdownView` インスタンスはモード切替をまたいで同一であり、`.editor.getValue()`／`.editor.replaceRange()` はどちらのモードでも同じ下層ドキュメントに対して機能する。
- `onOpen()`（495行付近）は末尾で必ず `this.refresh()` を呼ぶ ── Tree ビューの閉じ直しは常に新鮮な再構築を強制する。
- `applyLineEditOutcome` は新旧行が完全一致する場合「真の no-op」として早期リターンし、この場合 `refresh()` は呼ばれない（Tree／選択状態は変化しないままであり、意図された挙動）。
- 5T-2R で確認済みの事実として、`handleDragStart`／`handleParagraphDragStart` の `dataTransfer.setData("text/plain", ...)` の変更（実 ID → 空文字列）は、context menu 経由の段落移動（`dispatchAndApplyParagraphMove`）の本文更新経路（`applyLineEditOutcome`／`editor.replaceRange`）を一切変更していない ── これらは完全に独立したコードパスである。

## 4. コード上で棄却・低優先となった仮説（Phase 5T-2S-A 時点の暫定固定結論）

以下は、上記コード調査の結果として固定する暫定結論である。これらはコード読解のみに基づくものであり、実機での上書きが可能な暫定結論として扱う。

- `refresh()` は呼び出しごとに `editor.getValue()` を同期的に取得する。
- `refresh()` 内に `await` がなく、単純な非同期 `refresh` の前後逆転（古い結果が新しい結果を上書きする）という仮説は支持されない。
- paragraph move と section/list move は、成功後の `refresh` 契約を共有する（同一の更新契約であり、段落移動固有の遅延バグという仮説は支持されない）。
- plugin 内に `editor.setValue()` は存在しない。
- context menu paragraph move は `DataTransfer` に依存しない（ドラッグ操作ではなくクリックハンドラからの同期呼び出しであるため、そもそも `DataTransfer` を経由しない）。
- 5T-2R の payload 空文字列化（`dataTransfer.setData` の変更）は、context menu move の本文更新経路を変更しない（完全に独立したコードパスである）。
- stale Tree の原因として「古い非同期 `refresh` 結果が新しい結果を上書きする」という仮説は、低優先とする（コード上、原理的に起こり得ない構造であるため）。
- 再現しない限り、本番コードを推測で修正しない。

## 5. 実機でのみ判断できる仮説（未確定・コードからは確定できない）

以下は、コード読解だけでは確定も反証もできず、手動での実機観察によってのみ判断できる仮説である。**いずれも「仮説」であり、確定した事実ではない。**

- **Reading View（プレビュー）の HTML 再描画遅延**: プログラム的な `editor.replaceRange()` 呼び出しに対して、Obsidian 自身の Reading View の再描画が追随するタイミングが遅れている可能性。これは 5T-2R の実機観察から着想した作業仮説であり、コード上の証拠によって支持も反証もされていない。
- **active leaf / active view の見かけ上のずれ**: `ActiveMarkdownViewTracker` が実際の画面表示と異なる view を指してしまう可能性。context menu 経由の同期呼び出しについてはコード上棚上げできるが、D&D 経由の経路や、Obsidian 側のタイミングに依存する部分は未検証である。
- **fold / selection / highlight による視覚的な錯覚**: 構造そのものは正しいにもかかわらず、フォールド状態や選択・ハイライトの表示のみが古く見えている可能性。

## 6. 手動検証手順（次回以降、利用者自身が実施する）

本フェーズでは以下の手順を**実施していない**。次回以降、利用者自身の手動操作によって検証するための手順である。

### 6.1 共通前提

- Method Vault を開く。
- Unified Outliner プラグインを無効化 → 有効化する。
- 設定 `showParagraphsInOutline` をオンにする（確認済みの現在の設定値は有効だが、検証開始時に再確認する）。
- `phase5t2s-tree-body-consistency-fixture.md`（Method Vault 内、恒久検証用フィクスチャノート）を開く。
- 操作のたびに、Source Mode と Reading View のどちらで確認しているかを明確に区別して記録する。
- 操作前後で、本文の行順序と Tree の表示順序を比較する。
- 不一致があった場合は、本文が古いのか、Tree が古いのか、highlight/selection だけが古いのかを区別する。

### 6.2 最優先の手動確認

次の各操作を、**Source Mode と Reading View の両方**で実施する。各操作は最低 3 回でよい。**不一致が一度でも起きた場合のみ**、その操作をさらに合計 10 回まで反復する。

1. 段落コンテキストメニューの「上へ移動」
2. 段落コンテキストメニューの「下へ移動」
3. 段落 D&D の上方向スワップ
4. 段落 D&D の下方向スワップ
5. 段落 ↔ コールアウトの D&D
6. 本文カーソル起点の Move block

## 7. 不一致が再現した場合に記録すべき情報（Claude への報告テンプレート）

不一致が観測された場合、以下の項目を記録し、次回 Claude に渡す際の報告テンプレートとして使うこと。

- 検証日時
- Obsidian のモード（Source Mode / Reading View）
- 操作種別（上記 6.2 の 1〜6 のいずれか、または別操作）
- 操作前の本文の行順序
- 操作後の本文の行順序
- 操作後の Tree の表示順序
- Tree と本文のどちらが古いか（あるいは両方一致しているが highlight/selection のみずれているか）
- 選択/highlight だけの問題か、構造そのものの表示の問題か
- ノートを切り替えて戻る、Tree ビューを閉じて開き直す、プラグインを無効化→有効化する、のいずれかで回復するか
- 可能であればスクリーンショット
- 再現回数 / 試行回数
- 不一致発生の直前に実施した操作

## 8. 不一致が再現しなかった場合の受入基準

- Source Mode と Reading View の両方で、6.2 の各操作を 3 回以上実施した。
- Tree の表示順序と本文の行順序に不一致がない。
- context menu move、D&D、本文カーソル起点の Move block のいずれも既存動作から回帰していない。
- ノートを切り替えて戻った後も、古い Tree が残っていない。
- Tree ビューを閉じて開き直した後、本文と表示が一致している。

この場合の記録は「不一致は確認されなかった」という**観測事実のみ**にとどめ、「バグが存在しない」と断定してはならない。

## 9. Phase 5T-2S-B: 段落 D&D の drop indicator 表示位置の修正（別種の指摘・対応済み）

利用者による実機での手動確認（動画2件）の結果、以下の2点が報告された。これは §5 で扱っていた「Tree/本文の構造不一致」とは異なる、段落 D&D の**表示上**の指摘である。

1. 段落を、隣接していない遠い位置のブロックへドラッグしても移動できない。
2. 段落を隣接するブロック（例: 直下の callout）の下に移動しようとした際、青い区切り線が移動先ブロックの下ではなく、ドラッグ中の段落自身のすぐ下（＝現在位置）に出てしまう。見た目上「移動しない」というサインに見えてしまう。

### (1) について: 仕様通りであり対応不要

`resolveParagraphDropDirection`（`src/edit/paragraphTreeMove.ts`）は、対象がソースの直接の隣接兄弟（上または下）でない場合、常に `"not-adjacent"` として拒否する。段落 D&D は隣接要素との swap 専用として設計されており（design doc §3「任意位置への挿入に見えるUIは採用しない」）、Phase 5T-2S の禁止事項（非隣接insert・任意位置insert）にも合致する。したがって①は仕様通りの正常な挙動であり、修正は行っていない。

### (2) について: 原因確認と修正実施

`handleParagraphDragOver`（`src/view/OutlineTreeView.ts`）は、修正前は次のようになっていた。

- 有効性判定に使った生の hover ゾーン（`zone`、境界を越えたことを検知するための判定用の値）を、そのまま表示用の indicator クラス（`before`/`after`）としても使っていた。
- 段落 D&D は隣接2要素の swap しかないため、判定用ゾーンと最終的な着地位置は常に反対側になる。例えば「下の隣接兄弟をターゲットとする移動」は `zone === "before"`（対象の上半分）でのみ有効判定されるが、実際に段落が着地するのはその対象の**下**である。生のゾーンをそのまま表示に使うと、線は常にドラッグ元の段落自身に接する境界（＝現在位置）に描かれてしまい、利用者からは「移動先」ではなく「元の位置」に見える結果となっていた。

この観察結果を受け、利用者から明示的に「今までの挙動とは関係なくこの問題は解消してほしい」との指示があったため、Phase 5T-2S-B として次の最小修正を実施した。

- `handleParagraphDragOver` の最後で、表示用の indicator を `zone`（判定用の生ゾーン）ではなく、`resolution.direction`（実際の移動方向）から導出した着地側のエッジ（`direction==="down"` なら対象の下端 `"after"`、`"up"` なら対象の上端 `"before"`）で描画するように変更した。
- 有効性判定（`resolveParagraphDropDirection` への `zone` の受け渡し）は変更していない。`handleParagraphDrop`／`moveParagraphFromAnchor` の実行ロジックも変更していない。表示位置のみの修正である。
- `src/parser/parseDocument.ts` の diff はゼロである。D&D の対象範囲（隣接swapのみ）は変更していない。

### 検証結果

- `npx tsc -noEmit -skipLibCheck`: エラーなし。
- `npx vitest run`: 68 ファイル / 1156 テストすべて成功。
- `npm run lint`: エラーなし（既存の無関係な warning 3件のみ、他フェーズから継続）。
- `npm run build`: 成功。
- ソースでビルドした `main.js`／`manifest.json`／`styles.css` の SHA-256 と、Method Vault にデプロイ済みの同ファイルの SHA-256 が完全一致することを確認した。

### 注記

本修正は、§0〜§8 で扱っている「Tree と本文の構造不一致」調査の対象ではない、段落 D&D の drop indicator という**別種・独立した表示上の不具合**への対応である。§5 に記載した3つの実機限定仮説（Reading View 再描画遅延・active leaf のずれ・fold/selection の錯覚）の検証状況には影響しない。引き続き §6 の手動検証（構造不一致の再現テスト）は次回以降の課題として残っている。
