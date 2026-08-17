# Phase 5P-3D — 段落 Outline Tree 表示 設計固定文書（実装前レビュー）

作成日: 2026-08-17
状態: **設計固定（本番コード変更なし）**。本文書の承認後、実装範囲を確認したうえで Phase 5P-3 本実装へ進む。
対象リポジトリ: `/Users/kazumikaizuka/Obsidian/unified-outliner-public`
基準コミット: `5025534`（5P-0/5P-1）→ `fcd1128`（5P-1R）→ `b0b7f02`（5P-2）
関連: `docs/phase5p_paragraph-block-foundation-plan.md` §6「5P-3 — 任意 Tree 表示」（本文書は同節の確定設計であり、上位計画を差し替えるものではない）

本文書の作成にあたり、既存実装（`src/tree/buildOutlineTree.ts`、`src/tree/foldIdentity.ts`、`src/persistence/foldStateStore.ts`・`foldStateManager.ts`、`src/view/OutlineTreeView.ts`、`src/settingsDefaults.ts`・`settings.ts`、`src/model/complexBlock.ts`・`compositeBlock.ts`、`src/parser/complexBlocks.ts`・`compositeBlocks.ts`、`src/edit/deleteCompositeBlock.ts`・`moveCompositeBlock.ts`、`src/move/resolveMoveTarget.ts`）を読み取り専用で監査した。本文書中の引用はすべてこの監査に基づく。監査そのものはコードを一切変更していない。

## 1. 実装目的

設定が有効な場合に限り、通常本文の paragraph を Outline Tree に読み取り専用のナビゲーション対象として表示する。paragraph は Tree 上で選択・本文へのジャンプ・通常のキーボードナビゲーションの対象にはなるが、rename・delete・insert・drag & drop・indent/outdent・一般的な Move block・CompositeBlock 操作の対象には一切ならない。設定が既定（オフ）のままであれば、Tree の見た目・ノード数・fold 状態・選択挙動は 5P-2 完了時点から一切変化しない。

## 2. 既定オフ設定の契約

### 2-1 設定の追加方法

新設定は `showListItemsInOutline`（`src/settingsDefaults.ts`、既定オフの Tree 表示トグルの既存前例）と全く同じ形の、トップレベルの単純な boolean とする。

| 項目 | 内容 |
|---|---|
| 設定キー | `showParagraphsInOutline` |
| 型 | `boolean`（`UnifiedOutlinerSettings` のトップレベルスカラーフィールド） |
| 既定値 | `false` |
| 表示名（案） | 「本文段落も Outline Tree に表示する」 |
| 追加箇所 | `settingsDefaults.ts` の `UnifiedOutlinerSettings` インターフェースと `DEFAULT_SETTINGS` オブジェクト、`settings.ts` に `new Setting(...).addToggle(...)` を1件追加 |
| 変更反映 | `showListItemsInOutline` の `onChange` と同じ3行の型（`this.plugin.settings.showParagraphsInOutline = v` → `await this.plugin.saveSettings()` → `this.plugin.refreshOutlineTreeViews()`）をそのまま複製する |

`mergeSettings`（`settingsDefaults.ts`）はトップレベルスカラー boolean を `Object.assign({}, DEFAULT_SETTINGS, raw)` で吸収する既存の浅いマージだけで足り、既存ユーザーの保存済み `data.json` にこのキーが存在しない場合は自動的に `false` に解決される。`language` や `outlineTreeSidebarPosition` のような文字列 union フィールドには「保存値が不正な文字列だった場合」の追加バリデーションがあるが、これは union 型固有の懸念であり、単純な boolean には不要である。したがって **マイグレーションコードは一切書かない**。

`showListItemsInOutline` の既存ドキュメントコメントは「既定オフ、フルビューを望むユーザーが opt-in する」という趣旨を明示しており、本設定もこれをそのまま踏襲する。

### 2-2 責務分離

`treeKindHighlight`・`headingPrefixStyle`・`listPrefixStyle`・`compositeBlocks.*` のような既存の icon / display 系設定は、**既に Tree に存在するノードの見た目（色・接頭辞）だけを変える**設定である。これに対し `showParagraphsInOutline` は、**Tree モデルに新しい種類のノードが一つも存在するかどうか自体**を切り替える設定であり、性質が異なる。したがって既存の icon / display 設定のいずれのネスト先（`compositeBlocks` オブジェクト等）にも入れず、`showListItemsInOutline` と対等な独立したトップレベル boolean として追加する。paragraph ノードの表示ラベルに付ける既定の記号（`¶`、`docs/phase5p_paragraph-block-foundation-plan.md` §5 で既定済み）は、既存の `headingPrefixStyle`/`listPrefixStyle` とは別の設定項目として扱い、本設計では固定値 `¶`（将来的に空文字へ変更できる別設定を検討する余地は残すが、5P-3 の初期実装では新設定は追加しない）とする。

### 2-3 設定オフ時の投影方針：モデルへ投影しない方式を採用

**「設定オフでも内部ノードを生成して後段で隠す」方式は採らない。設定オフ時は paragraph を Tree モデル（`OutlineTreeNode[]`）へ一切投影しない。**

理由は次の3点である。

第一に、`tree/foldIdentity.ts` の `walk()` は `OutlineTreeNode["kind"]` に対する網羅的（exhaustive）な `switch` であり、TypeScript のコンパイラチェックにより新しい `"paragraph"` kind を追加した瞬間、この関数を含む全ての kind 網羅箇所に何らかの対応が要求される。ノードを常に生成しておいて表示だけ後段で隠す方式を採ると、fold identity・occurrence pool・選択復元など、本来 paragraph には不要なはずの経路すべてに「生成されているが見えない paragraph ノード」を通過させる必要が生じ、既存の section/list/composite/complex-member の fold identity 計算（同一スコープ内でのラベル衝突カウンタ）に paragraph が意図せず混入してこれらを汚染するリスクが生まれる。

第二に、投影しない方式であれば、設定オフ時は `buildOutlineTree()` の呼び出し側（`OutlineTreeView.refresh()`）が新しい引数・オプションを一切渡さないか、`false` を渡すだけで、既存の callout/blockquote 用 standalone 投影経路（`groupStandaloneComplexBlocks`・`isStandaloneComplexBlockEligible` 相当）に対する変更を条件分岐一つに閉じ込められる。「モデルには一切存在しないノード」であることが型レベルでも実行時レベルでも保証され、5C-2/5D-0.3 で確立された `consumedComplexBlockIds` のような既存の安全機構にも影響を与えない。

第三に、本フェーズの最優先事項である「設定オフ時、5P-2 完了時点と Tree の見た目・ノード数・fold 状態・選択挙動が変わらないこと」を、実行結果の比較ではなく **構造的に**（そもそも paragraph ノードが1つも存在しない、という事実によって）保証できる。これは 5P-2 で採用した「解決できない・確認できない場合は必ず拒否側に倒す」という本プロジェクト全体の設計原則とも一致する。

### 2-4 設定変更後の安全な再描画

`refreshOutlineTreeViews()`（既存、`headingPrefixStyle` 等と共通の再描画経路）をそのまま再利用する。設定オン→オフへ変更した場合、次の `refresh()` で `buildOutlineTree()` が paragraph 投影を行わなくなるため、paragraph ノードは Tree から消える。このとき、もし選択中のノードが paragraph であった場合は、`ensureSelection()`（既存、id 一致→highlightedId→先頭ノードの順にフォールバックする既存ロジック、変更しない）が自動的に別のノードへ選択を移す。fold 状態については 2-3 の方針により paragraph 用の fold state が一切生成・永続化されないため（§4 で詳述）、オフに戻したときに汚染された fold state を掃除する処理は不要である。

## 3. paragraph 表示ラベル規則

### 3-1 優先順位（確定）

1. `<!-- uo-title: ... -->`（**5P-3 の初期実装では不採用。理由は 3-2 参照**）
2. 段落本文の先頭行（または先頭文）を正規化した preview
3. `段落 N` フォールバック

### 3-2 `<!-- uo-title -->` を初期実装で採用しない理由（監査結果）

`src/parser/complexBlocks.ts` の `scanParagraphBlocks`（`isCandidate` 関数）を確認したところ、HTML コメント行は見出し・list marker・空行のいずれでもない限り、他の本文行と全く同じ「paragraph 候補行」として扱われる。すなわち、`<!-- uo-title: ... -->` を段落の直前行に空行を挟まずに置いた場合、この関数は両方の行を **同一の連続範囲としてまとめてしまう** ため、コメント行は段落の「タイトル」としてではなく、段落本文そのものの1行目として `resolveParagraphAtCursor`/`applyParagraphEdit` に読み込まれてしまう。これは 5P-1 で固定した境界規則、および 5P-2 が保証する「投影された範囲がそのまま Apply される」契約と正面から衝突する。

この衝突を安全に解消するには、`scanParagraphBlocks` 自体にコメント行を段落本文から除外する特別扱いを追加する必要があるが、これは 5P-1/5P-1R で既にテスト24件・11件を伴って固定済みの境界規則・Apply 契約への変更であり、5P-3D の「本番コードを変更しない」「既存の解析・Partial Edit 基盤を触らない」という制約、および 5P-1/5P-1R 自体の独立したレビューを経た確定事項を上書きすることになる。したがって **5P-3 の初期実装では `uo-title` コメントを一切読まない**。これは `docs/phase5p_paragraph-block-foundation-plan.md` §5 が「5P ではパースできれば使う」としていた前提を明示的に覆す判断であり、上位計画側の該当箇所は本文書の承認と同時に「5P-3 では見送り、入力 UI を含めて後続 Phase で改めて設計する」と更新する。

### 3-3 preview 生成規則

5P-2 の `resolveParagraphAtCursor` が既に持つ `buildPreview`（先頭行を60文字に丸めて `…` を付与する実装）を Tree ラベル生成にもそのまま再利用する。5P-2 は Partial Edit Pane のタイトル表示のために作った関数だが、Tree ラベルも「投影される段落の要約テキスト」という点で要求が同一であるため、新しい preview 生成ロジックを追加しない。

- **最大長**: 60文字（既存の `PREVIEW_MAX_LENGTH` を流用）。
- **改行・連続空白**: 先頭行のみを対象とするため複数行にまたがる改行は preview に含まれない。連続空白の正規化は既存実装の挙動をそのまま踏襲し、新規の正規化ロジックは追加しない（追加が必要と判明した場合は 5P-3 実装時に別途、既存関数への最小差分として提案する）。
- **Markdown inline 記法**: 5P-2 と同様、生の文字列をそのまま切り詰めるだけで、Markdown のレンダリング・記法除去は行わない（`*emphasis*` 等はそのまま表示される）。これは他の Tree ノード（見出しテキスト、list item テキスト）のラベル表示が同様に生 Markdown を表示している既存方針と一貫している。
- **空文字・記号のみの段落**: 先頭行が空またはラベルとして意味を持たない場合（trim 後に空文字になる、あるいは記号のみで構成される）は、優先順位3の `段落 N` フォールバックへ落とす。N は Tree 構築時にその文書内で出現した順の連番とする（scan-local id をそのまま数値表示に流用しない — id と表示用連番は別概念として扱う。理由は §4 で述べる id 非依存の原則と同じ）。
- **日本語長文・古文史料・引用符・脚注風記法**: 60文字という preview の上限は文字数ベース（バイト数ではない）であるため、日本語のような1文字あたりの情報密度が高い言語でも極端に短い/長いという偏りは生じない。引用符・脚注風記法（`[^1]` 等）を含む文字列も、単なる文字列切り詰めとして扱う限り破綻しない。実際の見え方は Method Vault の実機確認（§10）で日本語長文ノートを使って確認する。
- **ラベル生成が本文を書き換えないこと**: preview は表示専用の派生値であり、`resolveParagraphAtCursor`/`applyParagraphEdit` が扱う `text`/`originalText` には一切影響しない。Tree ラベル生成のためだけに本文を正規化した文字列を作っても、それを本文へ書き戻す経路は存在しない。
- **一貫性**: 選択・fold・ジャンプ・アクセシビリティ表示（`aria-label` 相当）はすべて同一の `OutlineTreeNode` インスタンスが持つ1つのラベル文字列を参照する設計とし、表示箇所ごとに別々の関数でラベルを再計算しない。

## 4. Tree identity と fold 方針（最重要項目）

### 4-1 監査結果の要約

`complexBlockId`（`ComplexBlockInfo.id`、例: `paragraph-3`）は `scanComplexBlocks()` の呼び出しごとに種別ごとの連番として再採番される scan-local id である（`model/complexBlock.ts` 自身のドキュメントコメントで明記）。既存の standalone complex block ノード（callout/blockquote 等、`OutlineTreeComplexMemberNode`）は、この scan-local id を **そのまま** Tree ノードの `id` として使っている（`buildStandaloneComplexNode`/`buildMemberNode` はいずれも `id: info.id` を素通しするだけで、種別＋親＋通番のような合成も、内容ハッシュも行っていない）。

一方、fold state の永続化キーは Tree ノードの `id` ではなく、**`tree/foldIdentity.ts` が計算する別概念の「内容ベースの identity 文字列」**（`${kind}:${label}` セグメントを `/` で連結し、同一スコープ内のラベル衝突を出現順の `#N` で解消したもの）である。この identity は `persistence/foldStateStore.ts` によりファイルパスをキーとして `data.json` 内に永続化される。`foldIdentity.ts` 自身のドキュメントコメントが「id は次の再パースで別の値になるため、ディスクへ保存するキーには使えない」と明言しており、この2層構造（揮発性の `id` と永続化キー専用の `identity`）自体が、5P-3 が守るべき既存の設計原則そのものである。

孤立した identity（現在の Tree のどのノードにも対応しない、ディスク上の古い identity 文字列）は **能動的に削除されることはなく、単に無視される**（`deriveCollapsedIds()` は現在のツリーの identity だけを走査し、一致しない永続化済み identity はそのまま放置される）。これは既存の許容された挙動であり、5P-3 で新たに壊すものでも、5P-3 が新たに解決を求められているものでもない。

選択状態（`selectedId`）はディスクへ永続化されず、`ensureSelection()` による「厳密な id 一致 → highlightedId → 先頭の可視ノード」というフォールバックチェーンだけで復元される。これは section/list についても「同一構造の場合に限り厳密一致がヒットする、それ以外は緩やかに縮退する」という設計であり、破局的な誤復元（別内容への選択の誤爆）は起こらない作りになっている。

### 4-2 決定：paragraph は葉ノード・fold 不可とする（初期実装の第一候補を採用）

paragraph ノードは子を持たない単位であるという構造的事実（本文中に「段落の中の段落」は存在しない）を踏まえ、**paragraph を常に葉ノード・fold 不可として扱う**ことを採用する。これにより、以下の理由から identity 問題そのものを最小化できる。

第一に、fold できないノードには、そもそも「折りたたまれているかどうか」という状態が存在しないため、`persistence/foldStateStore.ts` へ保存する識別子を一切必要としない。したがって `tree/foldIdentity.ts` の `walk()` に `"paragraph"` の `case` を追加する必要はあるが、その中身は「identity 文字列を計算して登録する」ではなく「（子を持たないので）何も登録せず通過する」で足りる。これにより、paragraph の表示・非表示や個数の変動が、section/list/composite の既存の fold identity・occurrence pool を汚染する経路が構造的に存在しなくなる。

第二に、選択状態はもともとディスクへ永続化されない揮発性の値であり、`ensureSelection()` の既存フォールバックチェーンは kind を問わず動作する。paragraph ノードの `id`（scan-local な `paragraphInfo.id` をそのまま使う）が再パースのたびに変わりうることは、section/list の `sec-N`/`li-N` が「構造が変わらない限り安定する」のと比べればずっと不安定である（段落は最も編集頻度が高いブロックであり、文書中のどこか手前で段落が1つ増減するだけで、それより後ろの `paragraph-N` の採番が総入れ替えになる）。しかし `ensureSelection()` は元々「id が一致しなければ諦めて次善の候補へ縮退する」設計であるため、この不安定さは **クラッシュや誤復元ではなく、選択が失われる（次善のノードへ移る）という安全な劣化** にとどまる。これは指示にある「同一性を確実に復元できない場合は、fold / selection を復元しない安全側の挙動を許容する」の原則にそのまま合致する。

第三に、この方針であれば、「同一内容の paragraph が複数ある場合の衝突可能性」「同一内容の paragraph が移動・分割・結合した場合の安全な扱い」は、そもそも永続化された identity を持たないため **構造的に無関係になる**。衝突・誤復元のリスクがある場所（ディスクへの保存）自体が存在しない。

### 4-3 検討した他の選択肢（不採用の理由）

| 選択肢 | 内容 | 不採用の理由 |
|---|---|---|
| 投影のたびに一時的な view identity を割り当て、fold を永続化しない | 4-2 とほぼ同義だが、fold 機構自体は温存しレンダリング時だけ抑制する案 | 4-2 の「葉ノード・fold 不可」の方がより単純で、`foldIdentity.ts` の `switch` に「何もしない case」を足すだけで済む。fold UI（折りたたみ矢印等）自体を出さないほうが、ユーザーから見て「そもそも折りたためない」ことが一貫して伝わり、誤操作の余地がない |
| range・親・内容・周辺文脈を使った非永続 fingerprint で fold 状態の復元を試みる | 5P-2 の Apply 安全契約（parentId/depth＋内容完全一致）と同種の fingerprint を fold にも適用する案 | fold できるようにすること自体のメリットが小さい（段落は子を持たないため、折りたためても得られる情報整理効果は限定的）一方、fingerprint 一致判定のロジックと、それが外れた場合のフォールバック仕様を新たに設計・実装・テストする必要があり、5P-3 の複雑度を不必要に増やす。段落数が多いノートほど fold できる価値が上がる一方、そのようなノートほど fingerprint 判定コストと衝突可能性も上がるという逆説がある |

選択のみ（fold を含まない）観点では、上記 4-1 で述べた `ensureSelection()` の既存フォールバックが「セッション内でのみ・厳密一致のみ」であるため、段落を挿入するようなカーソル無関係の編集直後に選択がしばしば先頭ノードへ縮退する体感は残る。これは実害が小さい（選択が消えるだけで誤爆はしない）ため 5P-3 の必須要件とはしないが、`view/OutlineTreeView.ts` の `applyPendingMoveFlash()` が move 直後のハイライト対象を id ではなく `line` 番号で再解決している既存の前例があるため、選択継続性を体感面でさらに改善したい場合は「選択中ノードが paragraph だった場合に限り、id 一致が外れたら直前の `line` に最も近い paragraph ノードへ再選択する」という軽量な改良を **5P-3 実装時のオプション項目**として検討する余地があることを記録しておく（本文書ではこれを必須要件にはしない）。

### 4-4 identity 設計の原則との整合性チェック

| 指示の原則 | 本設計での充足方法 |
|---|---|
| paragraph の view identity を scan-local id のみに依存させない | fold 永続化キーを一切持たないため、scan-local id は「その1回の render における DOM key・選択キー」としてのみ使われる。ディスクへ保存されるキーとしては使わない |
| paragraph identity は Markdown 本文に永続的な記号を書き込む方式にしない | `uo-title` 等の本文書き込みは行わない（3-2 で不採用と決定済み）。段落側に一切の永続マーカーを追加しない |
| 段落の位置だけ、本文だけ、scan-local id だけのいずれか一つに依存して identity を固定しない | いずれの単一シグナルにも依存する持続的 identity を **そもそも定義しない**（4-2）。これは「1つのシグナルに頼らない」ことの最も安全な特殊形である |
| 同一性を確実に復元できない場合は、fold / selection を復元しない安全側の挙動を許容する | fold は常に非対象（復元すべき状態が存在しない）。selection は既存の `ensureSelection()` の緩やかな縮退にすべて委ねる |
| 表示設定をオフに戻したとき、stale fold state が既存 section/list/complex block の fold state に衝突しないこと | paragraph 用の fold state をそもそも書き込まないため、オン→オフの切り替えで消すべき残留物が発生しない |

## 5. 親子関係・順序規則

### 5-1 投影の挿入点：既存の standalone complex block 経路を再利用する

`tree/buildOutlineTree.ts` の callout/blockquote 用 standalone 投影経路（`groupStandaloneComplexBlocks` → `resolveStandaloneGroupKey` → `buildChildren`/`buildListNode` 内の「`withLine` 配列へ積んで `line` でソートする」マージ）を、**paragraph にもそのまま再利用する**。具体的な挿入点は次の3箇所である。

1. `isStandaloneComplexBlockEligible` 相当の判定に、`kind === "paragraph" && editability === "supported"` を条件に加えた分岐を追加する（新設定がオフの場合はこの分岐自体を素通りさせ、既存の callout/blockquote 判定に一切影響を与えない）。
2. `groupStandaloneComplexBlocks` は `ComplexBlockInfo.parentId` をそのまま `resolveStandaloneGroupKey(doc, info.parentId)` に渡してグルーピングしている。paragraph の `parentId` は 5P-1/5P-1R の契約により既に「直近の section の id」「字下げ条件を満たす list item の id」「（見出しなしトップレベルの場合）`null`」のいずれかに確定しているため、**この関数を一切変更せずそのまま呼び出せる**。
3. `buildChildren`（section/トップレベル）と `buildListNode`（list item 配下）は、いずれも `standaloneByParentId?.get(...)` から得たエントリを `withLine` へ積んで `line` でソートする既存コードを持つ。paragraph 用のエントリもこの同じ配列へ積むだけで、Markdown 上の範囲順（`range.startLine` 順）で他の兄弟ノード（section の子 list・見出し、list item の子 list 等）と自然に混在した表示順になる。新しいソートロジックを追加する必要はない。

これにより、5-1 の要求である「表示順が Markdown 上の範囲順と一致すること」は、既存の「常に `line` で再ソートする」という `buildOutlineTree.ts` 自身の方針（同ファイル冒頭のドキュメントコメントに明記）をそのまま引き継ぐだけで自動的に満たされる。

### 5-2 paragraph 専用の新しい kind を導入する（`complex-member` を流用しない）

`buildStandaloneComplexNode` は現在 `kind: "complex-member"` を返すが、paragraph 用のノードは **これを流用せず、新しい `"paragraph"` kind を持つ独立した `OutlineTreeNode` バリアントとして追加する**。

理由は、`view/OutlineTreeView.ts` のコンテキストメニュー構築チェーン（`if (isOutlineSectionNode) ... else if (isOutlineListNode) ... else if (isComposite) ... else if (isComplexMember && node.isStandalone) { showStandaloneComplexBlockMenu(...) }`）に、standalone な `complex-member` ノードに対して「Partial Edit で開く」メニュー項目を出す既存の分岐が既にあるためである。もし paragraph ノードを `complex-member` kind のまま作ると、この既存分岐にそのまま合致してしまい、**5P-2 で明示的に本文カーソル起動限定とした Partial Edit 起動を、意図せず Tree からも起動可能にしてしまう**。これは指示が禁じる「Tree 表示が 5P-2 の paragraph Partial Edit 権限を意図せず広げないこと」に正面から抵触する。したがって paragraph には既存 kind のいずれとも一致しない新しい判別子を与え、上記メニュー構築チェーンのどの分岐にも合致しないようにする（6章で詳述）。

### 5-3 各投影規則の確定

| 規則 | 内容 | 根拠 |
|---|---|---|
| section 直下 paragraph | その section の子として表示する | 5-1 のグルーピング機構をそのまま適用（parentId がその section の id） |
| list item 子 paragraph | その list item の子として表示する | 同上（parentId がその list item の id）。5P-1 の字下げ列判定をそのまま利用 |
| 非字下げ paragraph | 直前の list item の子にしない | 5P-1/5P-2 で既にテスト済みの `parentId` 解決規則（`resolveParentId`）をそのまま利用。5P-3 側で新たに判定を作る必要はない |
| 見出しなしノートのトップレベル paragraph | Tree のルート直下に表示する（専用の暗黙ルートは作らない） | callout/blockquote の standalone 投影が既に見出しなしトップレベルのケースを扱っている前提（`resolveStandaloneGroupKey` が `parentId` 解決不能時に `null` を返し、既存の「トップレベル group key」バケットへ合流する）ため、これに paragraph を合流させるだけでよい。ただし、この「`null` キーのバケットがトップレベルの `buildChildren` 呼び出し側で実際に消費されているか」は 5P-3 実装時に既存挙動として再確認する（callout/blockquote には既に前例があるため低リスクと見積もるが、本文書では「要確認」として明示的に残す） |
| CompositeBlock との親子関係 | 変更しない | `consumedComplexBlockIds` は `CompositeBlockMember.id` の集合であり、`model/compositeBlock.ts` 自身のドキュメントコメントと `matchCompositeBlocks` の候補収集規則により、paragraph が composite member の候補になることは構造的にない。paragraph 側から何もしなくても、既存の「二重表示防止」機構に一切引っかからずに standalone 投影の対象になれる |
| CompositeBlock member としての投影 | しない | 5-2 で述べた通り、新しい `"paragraph"` kind を導入することで構造的に排除する |
| `ParsedDocument.nodes` への追加 | しない | 5P-1/5P-2 から継続する契約。`scanComplexBlocks()` の結果のみを Tree 構築時の入力として使う |

## 6. 許可操作・拒否操作の表

paragraph に許可する操作は、初期実装では次の4つに限定する：Tree 上での選択、本文へのジャンプ、read-only な表示、通常の Tree キーボードナビゲーション（上下移動・Enter・左右キーの葉ノードとしての no-op）。

Tree 上で paragraph をクリックした場合の挙動は、**既存の「本文先頭へジャンプ」に揃える**（`node.line` を使った既存の `jumpToLine` 呼び出しをそのまま再利用し、範囲選択や特別な挙動は導入しない）。

| # | 操作 | 監査結果 | 5P-3 での対応 |
|---|---|---|---|
| 1 | Tree 上の rename（ダブルクリック起動） | `readOnlyNodeIds` に含まれるノードには listener 自体が付かない。加えて `beginRenameForNode` は `section`/`list` のみを許可する **allowlist** であり、それ以外は即 return する | `collectReadOnlyOutlineNodeIds`（`buildOutlineTree.ts`）の判定式に `node.kind === "paragraph"` を追加する。これにより dblclick listener が付かなくなる。`beginRenameForNode` の allowlist は変更不要（既に `"paragraph"` を含まないため自動的に拒否される） |
| 2 | Tree 上の rename（F2 キー） | `beginRenameForNode` に委譲するのみ | 上記の allowlist により自動的に拒否される。変更不要 |
| 3 | Tree 上の rename（モバイル: 選択中行の再タップ） | `readOnly` 判定のみでガードされている | 上記 `readOnlyNodeIds` の変更で自動的に拒否される |
| 4 | Tree 上の delete | コンテキストメニュー経由でのみ到達可能（後述#8） | メニュー自体が構築されないため到達不能（変更不要） |
| 5 | Tree 上の insert（before/after/child） | 同上 | 同上 |
| 6 | drag & drop（開始・ドロップ先双方） | `readOnly` 判定でリスナー付与自体がガードされる。加えてドロップ可否判定（`canDropAny` 等）は `ParsedDocument.nodes.get(id)` の型（`BlockNode = ListBlockNode \| SectionBlockNode`）により構造的に `undefined` を返す | `readOnlyNodeIds` の変更（#1と同じ1行）で listener 自体が付かなくなる。加えて paragraph の id は `ParsedDocument.nodes` に一切登録されないため、万一 listener が付いた場合でも二重に安全側で拒否される |
| 7 | indent / outdent | block command dispatch（`dispatchAndApply`）経由のみ。`doc.nodes.get(id)` が `undefined` を返し安全に失敗する | メニュー・キーボードいずれからも到達経路自体が存在しないため変更不要。構造的な二重の安全網が既に存在する |
| 8 | Move block up/down（一般的な Tree 上の移動） | 同上。コンテキストメニュー構築チェーン（`if/else if` の4分岐）に paragraph 用の5番目の分岐を追加しない限り、メニュー自体が構築されない | **意図的に5番目の分岐を追加しない。** これにより paragraph 行には右クリックメニューが一切表示されなくなる。既存の Phase 5D-0.3 の「composite/complex-member 行には構造系コンテキストメニューを出さない」というコメントと同じ形で、この判断もコード上に明記する |
| 9 | CompositeBlock の edit / delete / move | メニュー到達不能（#8と同一の分岐）に加え、`matchCompositeBlocks` の候補収集規則自体が paragraph を対象外としている | 変更不要。二重に安全 |
| 10 | 既存のコンテキストメニュー全般 | #8と同一 | 5番目の分岐を追加しないことで、paragraph 行に右クリックメニューが一切表示されない |
| 11 | キーボードショートカット全般（F2以外） | Up/Down/Left/Right/Enter は kind を一切見ない、既に kind 非依存の実装 | **変更不要、かつ変更してはならない**。選択・展開/折りたたみ（葉ノードなので no-op）・Enter でのジャンプは、そのまま paragraph にも機能させる |
| 12 | Partial Edit の Tree 起点の起動 | 現在この起動経路は「section/list 用メニュー内の Open Partial Edit 系項目」「standalone complex-member 用メニュー内の Open Partial Edit 系項目」の2箇所にしかなく、いずれも #8 のメニュー構築チェーンを通る | 5-2 で述べた「新しい `"paragraph"` kind を導入し `complex-member` を流用しない」という決定と、#8 の「5番目の分岐を追加しない」という決定の **両方**により、paragraph 行から Partial Edit を起動する経路は構造的に一切生まれない。段落の Partial Edit は 5P-2 で確立した本文カーソル起点のコマンドのみが唯一の入口であり続ける |
| 13 | 行クリックによる本文ジャンプ | `readOnly` ゲートの **外側** にある、kind 非依存の既存 click listener | **変更不要、かつ変更してはならない**。paragraph 行にもこの既存 listener がそのまま付与されるようにする。将来的に rename/D&D の listener を追加する際に、誤ってこの click listener まで `!readOnly` の内側に包み込んでしまわないよう、実装時のレビュー観点として明記する |
| 14 | 行のレンダリング（ラベル・アイコン表示） | 現在の if/else-if チェーンには最終 else 節がなく、既存の4種のいずれにも合致しないノードは **空行として描画される**（未対応ではなく実バグとして顕在化する） | これは「拒否」ではなく必須の新規実装項目である。paragraph 用の描画分岐を追加し、`¶` 記号＋ラベル（§3）を表示する |

## 7. 既存 Tree / CompositeBlock / 5D との境界

Outline Tree の既存の4種類のノード（section・list・composite・complex-member）の構築ロジック・fold identity 計算・選択復元・操作系はいずれも変更しない。paragraph は 5番目の独立した kind として追加し、既存4種の `switch`/`if-else` チェーンには新しい分岐を追加するが、既存分岐そのものの中身は変更しない。CompositeBlock の member 収集規則（`matchCompositeBlocks`）・二重表示防止規則（`consumedComplexBlockIds`）は現状のまま、paragraph 側から一切手を加えない。Phase 5D（callout/blockquote 個別編集）とは無関係であり、5D 側のどのファイルにも変更を必要としない。`parser/parseDocument.ts` は 5P-0〜5P-2 と同様、本フェーズでも変更しない。

## 8. 性能評価方法

段落は最も出現頻度の高いブロック種別であり、長文の研究ノートでは数百段落規模になりうる。監査の結果、`view/OutlineTreeView.ts` の `renderTree()`/`renderNode()` は仮想化（virtualization）を一切行っておらず、`hasChildren && !isCollapsed` の場合のみ子孫の DOM を再帰的に構築する（=折りたたまれた親の配下は構築されないが、展開されている範囲は毎回フル再構築される）方式である。Tree の再描画は 150ms のデバウンスを介して editor-change 等のイベントに応じて発火する（`scheduleRefresh`）。paragraph 投影が有効な場合、可視範囲に数百の paragraph 行があると、アクティブな編集中は約150msごとにそれらの DOM 行がまるごと再構築されることになる。

5P-3D では次を性能評価の方針として確定する。

- **想定ノード数**: 見出しなしの長文ノート、または見出しの少ないノートで数百段落規模を想定する。実際の値は Method Vault の実機ノート（§10）で計測する。
- **preview 計算量**: 5P-2 の `buildPreview` は先頭行の文字列走査のみであり、段落あたり定数〜線形時間で軽量。ノード数に対して支配的なコストにはならないと見積もる。
- **仮想化の要否**: 5P-3D の時点では **導入しない**。まず上限なしの実装で Method Vault の実機ノート（数百段落規模を含む）で実測し、体感遅延（デバウンス後の再描画のもたつき）が確認された場合にのみ、表示上限またはページング/仮想化の導入を検討する。理由は、仮想化の導入は Tree の DOM 構築ロジック全体に触れる大きな変更であり、「既存 Tree の全面リファクタリングをしない」という制約と衝突するリスクが高いため、実測せずに先回りして導入することを避ける。
- **上限の要否**: 初期実装では **表示件数の上限を設けない**。ただし `buildOutlineTree.ts` 側で「投影された paragraph ノード数」を数える箇所を用意しておき、将来的に上限を導入する場合に備えて計測しやすい構造にすることを実装時の推奨事項とする（本文書では上限値そのものは決定しない — 実測前に恣意的な数値を固定すべきではないため）。
- **境界規則・親子関係・既存操作契約を性能最適化のために弱めないこと**: 本文書のいかなる性能上の決定も、§5 の親子投影規則・§6 の操作許可表を変更する理由にはならない。

## 9. テスト計画

5P-3D では本番コードを一切変更しないため、新規テストの追加も行わない（既存挙動の観察目的であっても、テストの追加はコードベースへの実コミットを伴うため、5P-3D の「原則として設計文書・テスト計画・監査報告のみ」という制約の範囲内では見送るのが妥当と判断した — 5P-3 本実装の着手時に、以下のテストマトリクスに基づいて追加する）。

| 分類 | テスト内容 | 想定手法 |
|---|---|---|
| 設定契約 | `showParagraphsInOutline` の既定値が `false`、既存 `data.json`（このキーを含まない）が `false` にマージされること | `settingsDefaults.ts` の既存テスト（`mergeSettings` のテストがあれば同じ手法）に追加 |
| 投影の有無 | 設定オフ時、`buildOutlineTree()` の出力に paragraph kind のノードが一切含まれないこと | 純粋関数のユニットテスト（実アサーション） |
| 投影規則 | section 直下・list item 子・非字下げ・見出しなしトップレベルの4パターンで、期待した親子関係・表示順になること | 純粋関数のユニットテスト。5P-2 の `tests/resolveParagraphAtCursor.test.ts` と同じ fixture パターンを再利用できる |
| CompositeBlock との非干渉 | composite member として消費された complex block が、paragraph 投影の対象にも二重に含まれないこと（もっとも、paragraph が member 候補にならないことは既存規則で保証されているため、主に回帰確認目的） | 純粋関数のユニットテスト |
| identity/fold 非依存 | paragraph ノードが `foldIdentity.ts` の identity マップに登録されない、または登録されても fold 状態の保存対象にならないこと | 純粋関数のユニットテスト |
| 操作拒否（静的配線検証） | `collectReadOnlyOutlineNodeIds` に `paragraph` の判定が追加されていること、コンテキストメニュー構築チェーンに5番目の分岐が追加されていないこと、`beginRenameForNode` の allowlist が `section`/`list` のみのままであること | 5P-2 の `tests/paragraphPartialEditViewWiring.test.ts` と同じ「静的ソーステキスト検証」パターン（`OutlineTreeView.ts`・`buildOutlineTree.ts` は Obsidian 依存のため実インスタンス化できない） |
| ジャンプ・キーボードナビゲーション | クリックで本文ジャンプが機能すること、Up/Down/Enter が kind 非依存のまま動作すること | 既存のジャンプ・ナビゲーションのユニットテスト（`tree/outlineNavigation.ts` 等）に paragraph ノードを含むケースを追加 |
| 回帰確認 | 設定オン・オフいずれの場合も、既存の section/list/composite/standalone complex block のテストが全て回帰しないこと | 既存テストスイート（現在1002件）をそのまま実行し、全件成功を確認 |

## 10. Method Vault の実機確認手順（計画）

5P-3 実装後、次の観点で Method Vault の実ノートを用いて確認する（5P-3D の時点では計画のみであり、実施は本実装後）。

1. 既定オフ状態で、既存の任意のノートを開いて Tree の見た目・ノード数・fold 状態・選択挙動が 5P-2 完了時点と一致することを確認する。
2. 設定をオンにし、見出しのあるノートで section 直下・list item 子の段落が正しい親子関係・表示順で現れることを確認する。
3. 見出しのないノート（本計画の主要な実用価値の対象）で、トップレベル段落が Tree のルート直下に表示順どおり並ぶことを確認する。
4. 段落ノードをクリックし、本文の当該段落へジャンプすること、範囲選択や意図しない副作用が起きないことを確認する。
5. 段落ノードに対して、右クリックメニューが一切表示されないこと、ダブルクリック・F2・drag が一切効かないことを確認する。
6. 設定をオン→オフへ戻し、既存の section/list/composite の fold 状態が一切影響を受けていないことを確認する。
7. 数百段落規模の長文ノート（日本語長文・史料引用・脚注風記法を含むものを用意する）で、preview ラベルの見え方が破綻しないこと、デバウンス後の再描画に体感できる遅延がないことを確認する。
8. 5P-2 の「Edit paragraph at cursor」コマンドが、Tree 表示のオン・オフいずれの場合も本文カーソル起点でのみ機能し続けること（Tree 経由での新しい起動経路が生まれていないこと）を確認する。

## 11. ロールバック方針

`showParagraphsInOutline` は既定オフの単純な boolean 設定であるため、5P-3 実装後に問題が見つかった場合、ユーザー側は設定をオフにするだけで即座に 5P-2 完了時点の Tree 挙動へ戻る（§2-3 の「モデルへ投影しない」方針により、オフ＝ paragraph ノードが存在しない状態と構造的に同一であるため）。開発側のロールバックが必要な場合も、5P-3 のコミットは 5P-2（`b0b7f02`）とは別コミットとして作成するため、`git revert` 単体で 5P-2 完了時点まで安全に戻せる設計とする。paragraph 用の永続データ（fold state 等）を一切書き込まない方針（§4）のため、ロールバック後に掃除すべき残留データも発生しない。

## 12. 5P-4 への引き継ぎ事項

5P-4（隣接交換の契約化）は、本文カーソル基準の Move block 拡張であり、Tree 表示の有無に依存しないと `docs/phase5p_paragraph-block-foundation-plan.md` §6 に既に明記されている。5P-3 で paragraph が Tree 上に現れるようになっても、Tree 上の Move block 一般化（ドラッグでの入れ替え等）は本文書の §6 で明示的に拒否対象としたままであり、5P-4 の対象にもしない。5P-4 に進む際は、5P-3 で確定した「paragraph は葉ノード・fold 不可・永続 identity を持たない」という制約が、本文カーソル起点の隣接交換コマンドの挙動（交換後に Tree 上のどのノードが選択状態になるか等）に影響しないかを改めて確認する必要がある。

## 13. 実装予定ファイル一覧・変更理由（5P-3 本実装時の見積もり、5P-3D では未着手）

| ファイル | 変更理由 |
|---|---|
| `src/settingsDefaults.ts` | `showParagraphsInOutline` フィールドと既定値 `false` の追加（§2） |
| `src/settings.ts` | 対応するトグル UI の追加（§2） |
| `src/i18n.ts` | 設定名・説明文の en/ja 追加 |
| `src/tree/buildOutlineTree.ts` | `OutlineTreeNode` union に新しい `"paragraph"` kind を追加。standalone 投影経路（§5-1）に paragraph 用の eligibility 判定とノード構築関数を追加。`collectReadOnlyOutlineNodeIds` に `paragraph` を含める（§6 #1） |
| `src/tree/foldIdentity.ts` | `walk()` の網羅的 switch に `"paragraph"` の `case` を追加（何もしない実装、§4-2） |
| `src/view/OutlineTreeView.ts` | 行レンダリングの if/else-if チェーンに paragraph 用の描画分岐を追加（§6 #14）。コンテキストメニュー構築チェーンには **意図的に分岐を追加しない**（§6 #8, #10, #12） |
| `tests/*` | §9 のテストマトリクスに沿った新規テストファイル・既存テストへの追加 |

`parser/parseDocument.ts`・`parser/complexBlocks.ts`・`model/complexBlock.ts`・`edit/paragraphPartialEdit.ts`・`resolver/resolveParagraphAtCursor.ts`・`edit/deleteCompositeBlock.ts`・`edit/moveCompositeBlock.ts`・`move/resolveMoveTarget.ts` はいずれも変更しない見込みである。

## 14. 5P-3 の明示的な非対象一覧

次は 5P-3 でも実装しない。

| 項目 | 扱い |
|---|---|
| paragraph の Tree 上での rename / delete / insert / drag | 恒久的に対象外（§6） |
| paragraph の indent / outdent | 恒久的に対象外（§6） |
| Tree 上からの一般的な Move block（ドラッグでの入れ替え含む） | 5P-4 の対象にもしない。本文カーソル起点の隣接交換のみを将来対象とする |
| paragraph の CompositeBlock member 化 | 恒久的に対象外（§5-2, §5-3） |
| `<!-- uo-title -->` の読み取り・入力 UI | 5P-3 では不採用（§3-2）。後続 Phase で `scanParagraphBlocks` 側の境界規則変更を含めて再設計する |
| Tree 上からの Partial Edit 起動 | 恒久的に対象外。5P-2 の本文カーソル起点コマンドのみを維持する（§6 #12） |
| paragraph の fold（折りたたみ） | 初期実装では対象外（§4-2） |
| 表示件数の上限・仮想化 | 実測前のため 5P-3D では未決定。実装後の計測結果を待って判断する（§8） |
| `parseDocument.ts` の変更 | 5P-0〜5P-2 から継続する非対象（§7） |
| Phase 6（BlockIndex・分類・横断検索） | 対象外。上位計画のロードマップ通り |
