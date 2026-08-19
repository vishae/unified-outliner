# Phase 5T-4D: Tree paragraph → Partial Edit の設計・監査

作成日: 2026-08-19
対象リポジトリ: `unified-outliner-public`
基準コミット: `05f391b`（5T-3A 実機受入記録）・`7eca336`（5T-3A 実装）・`70e1ec8`（5T-3D）・`7e9e7c1`（5T-2S）・`6ecafa0`（5P-4）、および Phase 5P-1〜5P-3 の paragraph foundation 関連コミット

本ドキュメントは、Phase 5T-4D チケットの指示に基づく設計・監査のみを目的とする。本番コード（`src/`・`tests/`・`styles.css`・`manifest.json`・ビルド成果物）は一切変更しない。`parseDocument.ts` も変更しない。GUI 自動操作・実機確認代行も行っていない。

## 0. 目的

Outline Tree 上の paragraph node から、既存の paragraph Partial Edit（Phase 5P-2）を安全に起動し、本文中の同じ paragraph だけを編集できる最小機能について、実装可否・安全契約・UI 方針・テスト方針を固定することを目的とする。Tree から起動しても、Markdown 本文を唯一の正とする原則を崩してはならない。

## 1. 絶対に維持する原則の確認

チケット §2 に列挙された原則は、以下のとおりいずれも本設計の対象外であり、変更しない。

- Markdown 本文が唯一の正である。
- `parseDocument.ts` を変更しない。
- paragraph を `ParsedDocument.nodes` に追加しない。
- paragraph Tree node は read-only・leaf・fold 不可のままである。
- Tree view id（`tree-paragraph:N`）と scan-local id（`paragraph-N`）を永続 identity として使用しない。
- paragraph Tree row の range / parentId / depth は再解決のヒントに限る。
- 保存時は現行本文から paragraph を再解決する。
- 解決不能・曖昧一致・構造変化・内容変化があれば安全に拒否する。
- Tree と本文を別モデルとして永続同期しない。
- 既存 section/list の inline rename 契約を paragraph に機械的に流用しない。
- 既存 paragraph move（5T-1）・D&D 隣接swap（5T-2）・非隣接move（5T-3A）を回帰させない。
- 5T-2S の Tree/body 一致性受入範囲を壊さない。
- paragraph ↔ list のクロスモデル move は対象外のままである。

これらは §3 以降の監査・設計案のいずれによっても変更を要求しない。§4 で確定する保存契約は、既存の 5P-2 契約をそのまま再利用することで、これらの原則を自動的に満たす設計になっている（詳細は §3-1・§4 を参照）。

## 2. 既存原則の明示的な見直しについて

5P（`docs/phase5p_paragraph-block-foundation-plan.md` §12）の完了範囲確定時点では、「Tree 起点の move / drag & drop / context menu edit を意図的に未対応とすること」が明記されていた。また 5T-1 のチケット文言は、実装（`src/view/OutlineTreeView.ts` の `showParagraphMoveMenu` doc comment）内に次のとおり引用されている。

> 「no delete, no rename, no Partial Edit/hoist entry point of any kind（ticket §1: paragraph stays read-only; Tree 起点の Partial Edit is never added）」

本チケット（5T-4D）は、この「Tree 起点の Partial Edit は追加しない」という従来の非目標を、利用者自身の明示的な指示によって初めて見直すものである。本ドキュメントはこの見直しを前提として書かれているが、見直しの対象はあくまで「Tree から既存 Partial Edit を起動できるようにするか」という一点のみであり、§1 に列挙した安全原則そのものは見直しの対象ではない。


## 3. 監査結果

### 3-1. 既存 paragraph 編集経路（Phase 5P-2）

#### 3-1-1. カーソル位置からの対象解決 — `resolver/resolveParagraphAtCursor.ts`

`resolveParagraphAtCursor(doc, cursorLine, complexBlocks?)` は、Obsidian/DOM に一切依存しない純粋関数である。`cursorLine` を含む `ComplexBlockInfo` を `scanComplexBlocks` の結果（省略時は内部で再スキャン）から探し、次の条件をすべて満たす場合のみ paragraph として解決する。

- `cursorLine` が `doc.lines` の範囲内であること（範囲外は `out-of-range`）。
- その行を含む候補が1件以上存在すること（0件は `no-paragraph`）。
- 候補の中に paragraph 以外の kind（callout / blockquote / fenced-code / table / thematic-break）が1件でも含まれていないこと（含まれていれば `no-paragraph` — 非 paragraph kind が常に優先される、`parser/complexBlocks.ts` のマージ優先順位どおり）。
- 候補が複数件（同一行を複数の paragraph 候補が主張する状態）でないこと（複数なら `boundary-ambiguous`）。
- 唯一の候補の `editability` が `"supported"` であること（そうでなければ `boundary-ambiguous`）。

成功時は `complexBlockId` / `rangeStart` / `rangeEnd` / `parentId` / `depth` / `text` / `preview` を持つ `ResolvedParagraphAtCursor` を返す。list item の子となる paragraph（Phase 5P-1 の字下げ判定を満たすもの）も明示的に解決対象に含まれる — この resolver は「Move block の最小安全単位」とは独立した別の問いに答えるものであり、Move block の list スコープ制限（`move/resolveMoveTarget.ts`）とは無関係であることがコード自身のコメントで明言されている。

#### 3-1-2. Apply 時の再解決と書き戻し — `edit/paragraphPartialEdit.ts`

`applyParagraphEdit(doc, anchor, newText)` は、`ParagraphEditAnchor`（`complexBlockId` / `parentId` / `depth` / `originalText`）を、呼び出し側が新たに再パースした CURRENT な `doc` に対して、3段階で再検証する。

1. **id 一致**: 同じ `complexBlockId` を持ち `kind === "paragraph"` かつ `editability === "supported"` な block が現在のスキャンに存在すること。存在しなければ `resolve-failed`（削除・分割・結合・非対応化のいずれか）。
2. **構造一致**: 一致した block の `parentId` が anchor の `parentId` と一致し、かつ `complexBlockDepth(doc, block.parentId)` が anchor の `depth` と一致すること。不一致なら `identity-changed`（テキストは同じでも見出し挿入等で構造上の位置が変わった場合）。
3. **内容一致**: 再抽出したテキストが anchor の `originalText` と byte-for-byte 一致すること。不一致なら `content-changed`（対象 paragraph 自体の内容が Pane 読み込み後に変わった場合）。

3段階すべてが一致した場合のみ、`newText` を対象 paragraph の range に対してのみ splice する。前後の行には一切触れない。この3段階再検証契約は、Tree 起点であっても body-editor 起点であっても完全に同一であり、5T-4A で新規に変更する必要は一切ない。

#### 3-1-3. `PartialEditView.ts` の paragraph 分岐

`nodeId`（section/list/standalone callout・blockquote 用）と `paragraphAnchor`（paragraph 用）は排他的に管理され、常にどちらか一方のみが非 null である（`loadNodeInternal`・`loadParagraphInternal` は互いをクリアする）。

- **起動**: 唯一の公開エントリポイントは `requestLoadParagraphAtCursor(cursorLine)` である。未保存編集がない場合は即座に `loadParagraphInternal(cursorLine)` を呼ぶ。未保存編集がある場合は既存の `DiscardChangesModal`（Apply / Discard / Cancel）を表示し、選択に応じて分岐する — これは section/list 用の `requestLoadNode` と完全に同じガード・同じモーダルの再利用である。
- **`loadParagraphInternal(cursorLine)`**: `this.activeMarkdownView.get()` で得た現在の MarkdownView から `editor.getValue()` を取得して再パースし、`resolveParagraphAtCursor(doc, cursorLine)` を呼ぶ。解決に失敗すれば Notice を表示して何もロードしない。成功すれば `paragraphAnchor` / `originalText` / `label`（`preview`）/ `sourcePath` を設定し、`ancestors` / `directChildren` / `siblingState` は空のまま（breadcrumb・Subtree Navigator・Sibling前後移動は paragraph では非表示のまま）。
- **表示**: paragraph 読み込み時は breadcrumb・Subtree Navigator・Sibling前後移動のいずれも表示されない（5P-2 の既存承認スコープどおり）。タイトルは `partialEdit.kindParagraph` 接頭辞 + `preview`。
- **保存（Apply）**: `applyEdit()` 内で `this.paragraphAnchor` が非 null の場合、`applyParagraphEdit(doc, this.paragraphAnchor, this.textareaEl.value)` を呼び、失敗理由を Notice で表示して終了するか、成功時は `applyLineEditOutcome` で最小差分の `replaceRange` を実行する。適用後は `paragraphAnchor` を新しい `originalText` で再アンカーし直す（id/parentId/depth はそのまま、`originalText` だけ更新）ので、同一 Pane セッション内での2回目以降の Apply も安全に動作する。
- **キャンセル（Cancel）**: `cancelEdit()` はテキストエリアを `originalText` に戻すだけで、本文には一切触れない。
- **閉じる（Close）**: `onClose()` は未保存編集があっても自動保存しない（Cancel と同様に本文へは触れない）。DOM を破棄するのみ。
- **Apply 前チェックの追加安全弁**: `checkPartialEditSourceNote(this.sourcePath, view.file?.path ?? null)` が、内容ベースの一致確認より前に、Pane 読み込み時のノートパスと Apply 時点で実際にアクティブなノートのパスを比較する。popout window で別ノートに切り替えた後に Apply する事故を防ぐためのパスベースの安全弁であり、内容ベースの一致確認を置き換えるものではない。paragraph 分岐・node 分岐の両方で共通に効く。


#### 3-1-4. `main.ts` の呼び出し順

- `openParagraphPartialEditForCursor(editor)`（body-editor コマンド「Edit paragraph at cursor」のエントリポイント）: 複数カーソルを拒否 → `resolveParagraphAtCursor` で先に解決 → 解決できなければ Notice を出して Pane を一切開かない → 解決できた場合のみ `activatePartialEditViewForParagraph(cursor.line)` を呼ぶ。
- `activatePartialEditViewForParagraph(cursorLine, options?)`: Pane の leaf を開く／既存 leaf を再利用する／`revealLeaf` するという、リーフ管理だけを担当する独立メソッドである。自身では再解決を一切行わず、`leaf.view.requestLoadParagraphAtCursor(cursorLine)` に委譲するだけである。section/list 用の `activatePartialEditView(nodeId, options?)` とは意図的に完全独立した実装（コードの共有はしない）であり、これは 5P-2 チケット自身が既存基盤のリファクタリングを禁じていたためである。
- **重要な発見**: `activatePartialEditViewForParagraph` 自体には複数カーソルチェックが存在しない。複数カーソルチェックは呼び出し元の `openParagraphPartialEditForCursor`（body-editor コマンドの側）にのみ存在する。Tree からの起動は body-editor のカーソル状態と無関係に、ある1つの paragraph の開始行番号を直接渡すだけなので、この複数カーソルチェックが存在しないことは問題にならない（§4 で詳述）。

#### 3-1-5. Undo・refresh・カーソル復帰の結論

- **1 Apply = 1 本文編集 = 1 Undo**: paragraph 分岐・node 分岐のいずれも `commands/applyLineEditOutcome.ts` の共通処理を経由する。この関数は新旧 `lines` 配列の差分を最小の `replaceRange` に落とし込み、カーソルを再配置する — 本プラグインの他のすべてのコマンド（move・indent・delete・insert・rename 等）と同一の「1回の意味のある編集 = 1回の undo ステップ」という規約に完全に従う。5T-4A で新たに undo 関連のコードを書く必要はない。
- **Tree 側の自動 refresh**: `PartialEditView` は Apply 成功後、`OutlineTreeView.refresh()` を直接呼び出してはいない。しかし `OutlineTreeView.refresh()` 自体は editor-change・active-leaf-change・file-open 等のイベントで自動的に発火する既存の仕組みを持つ（`view/OutlineTreeView.ts` のコメントに明記）。`applyLineEditOutcome` が実行する `editor.replaceRange` は当然 editor-change イベントを発火させるため、Tree は Apply 後、既存の仕組みだけで自動的に再描画される。新しい refresh 呼び出しをこのために追加する必要はない。
- **カーソル・selection・highlightedId の復帰**: `OutlineTreeView` は `this.plugin.activeMarkdownView`（`PartialEditView` と共有される同一のトラッカー）から得た「直近にアクティブだった MarkdownView」を基準に `highlightedId` をカーソル行から再計算する。このトラッカーは「現在フォーカスされている leaf」ではなく「直近の実 MarkdownView」を追跡する設計（`activatePartialEditView`/`activatePartialEditViewForParagraph` 冒頭の `this.activeMarkdownView.get()` ウォームアップ呼び出しのコメントに明記）であるため、Partial Edit Pane がアクティブな leaf になっても Tree 側の highlightedId 解決は本文ノートを基準にしたまま動作し続ける。paragraph Tree row 自体は `tree-paragraph:N` という表示専用の非永続 id であり、Apply 前後で対象 paragraph の総数・順序が変わらない通常の「テキスト置換のみ」の編集（§4 参照）であれば、同じ ordinal に同じ paragraph が再び割り当てられるため、見た目上の行の位置は安定する。paragraph row 自体は selection の永続的な対象ではなく（read-only leaf、fold 不可、id は毎 refresh で再構築）、この点は 5T-4A でも変更を要しない。

#### 3-1-6. 境界条件（callout / blockquote / fenced-code / table）

`resolveParagraphAtCursor` のマージ優先順位（`parser/complexBlocks.ts`: callout > blockquote > (fenced-code, table, thematic-break) > paragraph）により、非 paragraph kind が同一行を主張していれば常にそちらが優先され、`no-paragraph` として安全に拒否される。したがって、callout/blockquote の内部行や、閉じていない fenced-code の内部行、table の行、thematic-break の行を対象に Partial Edit が誤って開かれることはない。この挙動は Tree 起点でも body-editor 起点でも同一である。

#### 3-1-7. list item 内 paragraph

`resolveParagraphAtCursor` は list item の子となる paragraph（Phase 5P-1 の字下げ判定を満たすもの）を明示的な解決対象としている。Tree 側でも `tree/buildOutlineTree.ts` の `groupParagraphBlocks` は `parentId` によって汎用的にグルーピングしており、list item を親とする paragraph も他の paragraph と全く同じコードパス（同一の `showParagraphMoveMenu` ハンドラ、同一の `isOutlineParagraphNode` 判定）で右クリックメニューが機能する。list item 内 paragraph だけを特別扱いする必要はない。


### 3-2. Tree 起点の接続

#### 3-2-1. 既存の paragraph context menu — `OutlineTreeView.ts#showParagraphMoveMenu`

paragraph Tree row の右クリックメニューは、現状 `showParagraphMoveMenu(evt, nodeId)` の1メソッドのみが担当する（`renderNode` のコンテクストメニュー分岐から、`isOutlineParagraphNode(node)` の場合にのみ呼ばれる）。この既存メソッドの解決手順は次のとおりである。

1. `this.nodeById.get(nodeId)` で Tree node（`OutlineTreeParagraphNode`）を取得し、`isOutlineParagraphNode` でない、あるいは `this.currentDoc`/`this.currentComplexScan`（refresh() 時点のキャッシュ）が無ければ何もしない。
2. Tree node 自身の `rangeStart` / `rangeEnd` / `parentId` を「ヒント」として `resolveParagraphFromTreeHint`（`edit/paragraphTreeMove.ts`）に渡し、現在のスキャンから対応する生きた `ComplexBlockInfo` を再解決する。Tree node 自身の `id`（`tree-paragraph:N`）は一切信頼しない — これは 5T-1 の実機バグ（表示専用の view id と scan-local id を混同していた）を修正した 5T-1R の教訓がコード自身に明記されている。
3. 再解決できた `target: ComplexBlockInfo` から `buildParagraphMoveAnchor(doc, target)` で `ParagraphMoveAnchor` を構築する（`complexBlockId` / `parentId` / `depth` / `originalText` / `rangeStart` / `rangeEnd`）。
4. 上下移動・非隣接移動の各項目は、この `anchor`（および非隣接move用の `siblingGroup`）が実際に構築できた場合にのみメニューへ追加される。1件も追加できる項目が無ければメニュー自体を一切表示しない（空メニューを出さない）。

#### 3-2-2. 「段落を編集…」に必要な最小データ

上記 3-2-1 の手順2で再解決された `target: ComplexBlockInfo` は、`target.range.startLine` を持つ。この値は `resolver/resolveParagraphAtCursor.ts` が要求する「対象 paragraph 内の任意の1行」という入力形式（`cursorLine: number`）とまったく同じ形をしている。

したがって、「段落を編集…」の起動に必要な最小データは、**新しい型もアンカーも必要とせず、`target.range.startLine` という単なる行番号1個だけである**。この行番号を、既存の `main.ts#activatePartialEditViewForParagraph(cursorLine)` にそのまま渡せば、Pane 側は `requestLoadParagraphAtCursor` → `loadParagraphInternal` → `resolveParagraphAtCursor` という既存の再解決チェーンを、Tree 起点かどうかを一切区別せずに、独立してもう一度実行する。これは 3-2-1 の Tree 側ヒント再解決と合わせて「Tree ヒント再解決 → Partial Edit 側の独立した再解決」という二重の安全確認になる。

この設計の要点は、**Tree row から渡すのは一時的な行番号ヒントだけであり、それを Pane 側が現行本文から独立に再解決する**という、チケット §5 が要求する契約を、既存コードの変更なしにそのまま満たせるという点である。

#### 3-2-3. Tree selection と editor focus の責務分離

既存の paragraph move（上下移動・非隣接move）は、成功後に `editor.scrollIntoView` でカーソル位置をスクロールに反映させるのみで、Tree 側の選択状態を直接操作するコードは持たない（`dispatchAndApplyParagraphMove`/`dispatchAndApplyParagraphNonAdjacentMove` の実装、および `showStandaloneComplexBlockMenu` 系コメントに明記された「Tree 行選択は維持されればよいが、維持されなくても不具合とはしない」という既存の受入基準）。「段落を編集…」についても同じ非保証の扱いを踏襲する。Pane を開く行為そのものは Tree の選択状態を書き換えない。

#### 3-2-4. Partial Edit 表示中の Tree refresh・保存/キャンセル/失敗時の Tree 状態

3-1-5 で述べたとおり、`OutlineTreeView` の `highlightedId` は共有トラッカー経由で本文ノートのカーソル位置から都度再計算されるため、Partial Edit Pane が開いている間・Apply した瞬間・Cancel した瞬間・失敗した瞬間のいずれであっても、Tree 側は「今の本文の状態」を反映するように自動的に振る舞う。Apply 失敗時・Cancel 時・Close 時はいずれも本文が変化しないため、Tree の表示内容も変化しない（disagree する状態は起こり得ない）。paragraph row 自体が「選択され続ける」ことを保証する仕組みは既存の move 系コマンドにも無く、本機能もこれを新たに保証しない。

### 3-3. section/list 編集との比較

- **inline rename**（見出し・list item のラベル直接編集）: 対象はノードの「ラベル1行」のみであり、本文全体の書き戻しではない。編集契約（型変更検知・改行禁止等）が section/list 固有の構造（heading level・list marker）に強く依存しており、paragraph には「ラベル」という概念自体が存在しない。paragraph に流用できる部分は無い。
- **section/list の既存 Partial Edit**（`edit/partialEdit.ts` の `extractSubtreeText`/`applySubtreeEdit`）: `nodeId` のみを鍵とした id ベースの再解決（id 一致 + 内容一致のみ、`parentId`/`depth` の再検証は行わない）。これは section/list の id が `ParsedDocument.nodes` 上で十分に安定しているためであり、paragraph には persistent な id が存在しないため、この契約をそのまま流用することはできない（`edit/paragraphPartialEdit.ts` 冒頭のコメントに明記されている既存の設計判断）。
- **standalone callout/blockquote の既存 Partial Edit**（`showStandaloneComplexBlockMenu` の「Open in Partial Edit」項目）: これは paragraph の先例として最も近い。この項目は常時表示（movability に関係なく無条件）であり、`this.plugin.activatePartialEditView(nodeId)` を直接呼ぶだけである。callout/blockquote は Markdown 構文（`>`, `>[!...]`）自体が識別子として機能するため、id ベースの再解決だけで十分安全とされている。paragraph はこの構文的な保証を持たないため、id ベースの `activatePartialEditView(nodeId)` ではなく、cursorLine ベースの `activatePartialEditViewForParagraph(cursorLine)` を使う必要がある — これが paragraph と callout/blockquote の唯一の本質的な違いである。
- **delete/insert UI**: paragraph の削除・挿入は本チケットの対象外であり、比較の対象にならない。


## 4. 設計案比較

### 4-1. 三案の概要

- **案A（Tree context menu → 既存 Partial Edit）**: paragraph を右クリックし「段落を編集…」を選ぶと、既存の Partial Edit UI が開く。§3-2-2 で述べたとおり、Tree 側で再解決した paragraph の `range.startLine` を、既存の `activatePartialEditViewForParagraph(cursorLine)` にそのまま渡すだけで実現できる。
- **案B（Tree row の inline edit）**: paragraph Tree row 自体を textarea/input に置き換える。Enter / Escape / blur / IME / 複数行入力 / Markdown 改行 / Tree refresh との競合 / focus 移動を、Tree 行という DOM 制約の強い場所で新たに扱う必要がある。
- **案C（Tree row ダブルクリックまたは F2 → Partial Edit）**: 編集 UI 自体は案Aと同じ Partial Edit のままにし、起動操作だけを右クリックメニューから「ダブルクリック」または「F2」に簡略化する。

### 4-2. 比較表

| 観点 | 案A: 右クリック→Partial Edit | 案B: Tree row inline edit | 案C: ダブルクリック/F2→Partial Edit |
| --- | --- | --- | --- |
| Markdown 本文への書き戻し安全性 | 既存の3段階再解決（id/構造/内容）をそのまま再利用。新規の書き戻しコードが不要 | 新しい書き戻し経路が必要になり、3段階再解決を新規に作り込むか、既存経路を無理に流用することになり安全性の検証範囲が広がる | 案Aと同じ（起動操作のみが異なる） |
| stale target の防止 | Tree ヒント再解決 → Partial Edit 側の独立再解決という二重の安全確認が既存コードのまま成立する | 同様の二重確認を新規に設計する必要がある | 案Aと同じ |
| IME と複数行編集 | 既存の `<textarea>` がそのまま IME・複数行を扱う（5P-2 で既に動作確認済みの範囲） | Tree row の限られた DOM 領域で IME・複数行入力・折り返しを新規に扱う必要があり、komplexity が高い | 案Aと同じ |
| キーボード操作 | 既存の Apply/Cancel ボタンと Pane 内のキー操作をそのまま流用 | Enter（確定か改行か曖昧）・Escape（キャンセルか IME 変換確定か曖昧）等、新規の判定ロジックが必要 | 案Aに加えて、F2 のキーバインド設計のみ追加 |
| モバイル適性 | 既存 Partial Edit Pane は section/list で既にモバイル対応済みの想定 | 長押しメニューとの整合、Tree row 内 textarea のタップ操作等、モバイル特有の考慮が新規に必要 | ダブルクリック相当のタップ操作をモバイルでどう扱うかは別途検討が必要（長押しメニュー経由に倒せば案Aと同等になる） |
| selection / focus 管理 | Pane 側は既存のまま。Tree 側は §3-2-3 のとおり非保証のまま踏襲でよい | Tree row とテキストエリアの focus 管理を新規に作る必要がある | 案Aと同じ |
| Tree refresh との競合 | 既存の editor-change 起点の自動 refresh が §3-1-5 のとおりそのまま機能する | 編集中に Tree が refresh されると、進行中の inline edit をどう保護するかという新しい競合状態が生まれる | 案Aと同じ |
| 既存コード再利用性 | 既存モジュール（`resolveParagraphAtCursor`・`applyParagraphEdit`・`PartialEditView`・`activatePartialEditViewForParagraph`）を100%再利用。新規コードは Tree 側のメニュー項目1つと呼び出し1行のみ | 既存 Partial Edit 資産をほとんど再利用できない | 案Aと完全に同じ再利用性（起動操作のみが差分） |
| テスト容易性 | 既存の `resolveParagraphAtCursor`/`applyParagraphEdit` の単体テストは無改修で有効。新規テストは「Tree メニュー項目からの呼び出し」という薄い配線テストのみで足りる | 新しい inline edit の状態遷移全体を新規にテストする必要があり、テスト設計コストが高い | 案Aと同じ薄い配線テストに加えて、ダブルクリック/F2 の別経路テストが必要 |
| 実機受入の容易性 | 既存 5P-2 の実機挙動（body-editor 起点）が既に確認済みであるため、Tree 起点でも同一 Pane が同一契約で動くことの確認のみで済む | IME・モバイル・focus 競合等、実機でしか顕在化しない問題が多く、確認範囲が広い | 案Aと同程度だが、ダブルクリックが既存の「選択」操作と衝突しないかの確認が追加で必要 |
| 将来の inline edit への移行可能性 | 将来 案B を採用する場合でも、Partial Edit という「安全な書き戻し経路」自体は変更なしで温存できる | 最初から inline edit を作るため、後から Partial Edit 型に戻すのは手戻りが大きい | 案Aと同じ（起動方法だけを後から変更すればよい） |
| 推奨可否 | **第一候補として推奨** | **今回は非推奨**（チケット §4 の原則どおり） | **将来候補**（起動操作の簡略化のみを検討する余地を残す） |

### 4-3. 結論

チケット §4 の原則（案Aを第一候補、案Cを将来候補、案Bを非推奨候補として評価する）のとおり、監査の結果もこれを裏付ける。案Aは新規実装コストが最小であり（Tree 側メニュー項目1件の追加のみ）、既存の安全な書き戻し経路を寸分も変更せずに再利用できる。案Cは起動操作をダブルクリック/F2に変える価値はあるが、選択操作との衝突確認等、追加の検討が必要なため将来候補とする。案Bは新しい書き戻し経路・新しい focus/IME/refresh 競合処理を要し、既存の安全性検証済み資産をほとんど再利用できないため、今回は明確に非推奨とする。


## 5. 固定すべき保存契約

### 5-1. 起動時

- Tree row から取得するのは、§3-2-2 で確定したとおり、対象 paragraph の `range.startLine`（現在のスキャンで再解決された `ComplexBlockInfo` 由来）という一時的な行番号ヒントだけである。`ParagraphMoveAnchor` のような専用の型を新たに作る必要はない。
- 編集開始時は、既存の `activatePartialEditViewForParagraph(cursorLine)` → `requestLoadParagraphAtCursor` → `loadParagraphInternal` の経路が、現行本文（アクティブな MarkdownView の `editor.getValue()`）を改めて再パースし、`resolveParagraphAtCursor` で独立に再解決する。Tree row の表示テキストや Tree 側の再解決結果を対象同定にそのまま使うことはない。
- Tree 側のヒント再解決（`resolveParagraphFromTreeHint`）に失敗した場合は、既存の `showParagraphMoveMenu` の規約どおり、メニュー項目自体を表示しない（右クリックしても「段落を編集…」が出ない）。
- Pane 側の再解決（`resolveParagraphAtCursor`）に失敗した場合は、既存の `loadParagraphInternal` の規約どおり、Notice を表示して Pane には何もロードしない。Tree 側の右クリック直後から Pane を開くまでの間に本文が変わった場合でも、この二段構えにより安全側に倒れる。

### 5-2. 保存時

- Apply 時に信頼するのは Pane 読み込み時の snapshot（`paragraphAnchor`）だけではない。`applyParagraphEdit` が Apply の直前に現行本文から改めて再解決し、3段階（id / 構造 / 内容）の一致を要求する（§3-1-2）。
- 対象 paragraph の内容・親・深さ・境界が変わっていれば、`resolve-failed` / `identity-changed` / `content-changed` のいずれかとして本文を一切変更せずに拒否する。
- 一意に再解決できない場合は本文を変更しない。この挙動は Tree 起点・body-editor 起点で完全に同一である。
- 保存は既存の `applyParagraphEdit` + `applyLineEditOutcome` の経路に一本化する。5T-4A で新しい書き戻し関数を作らない。
- 1 Apply = 1 本文編集 = 1 Undo は §3-1-5 のとおり、既存の `applyLineEditOutcome` によって自動的に満たされる。
- 成功時のみ Tree が refresh される（§3-1-5 のとおり、既存の editor-change 起点の自動 refresh をそのまま利用する）。
- 失敗時・キャンセル時・Close 時は本文を変更しない（§3-1-3 のとおり既存の Cancel/Close の挙動そのまま）。

### 5-3. 編集内容 — 初回実装で許可する範囲と、多行入力についての監査結果

チケット §5 の指示どおり、初回実装で許すのは paragraph の本文テキストの置換だけとする。以下は初回実装で禁止する。

- paragraph を複数 paragraph へ分割すること。
- 複数 paragraph を結合すること。
- section / list item / callout / blockquote への構造変換。
- parent / depth の変更。
- list marker / indentation の変更。
- Markdown block boundary の生成・削除。
- rename として別の保存経路を作ること。

**多行入力についての監査結果**: `tests/paragraphPartialEdit.test.ts` の既存テスト「a multi-line paragraph can grow or shrink in line count on Apply」が示すとおり、空行を含まない複数行（例: `"Now it is\ntwo lines."`）への置換は、5P-2 の時点で既に意図的にサポートされ、テストで固定された既存契約である。これは Markdown の通常の paragraph 構文（折り返しのある複数行が1つの paragraph を構成する）に対応するものであり、「分割」ではない。5T-4A はこの既存契約をそのまま継承し、変更しない。

一方で、**テキストエリアに空行を含む入力をした場合（構造的には新しい paragraph が生まれる入力）を防止するバリデーションは、現行の `applyParagraphEdit` には存在しない**。これは body-editor 起点の既存コマンド「Edit paragraph at cursor」でも今日から起こり得る挙動であり、Tree 起点の追加によって新たに生まれるリスクではない。ただし、チケット §5 が明示的に「paragraph を複数 paragraph へ分割すること」を禁止事項として列挙している以上、この既存の隙間をどう扱うかは §6 の利用者判断事項として提起する。5T-4D の設計時点では、新しいバリデーションを追加提案するに留め、実装（5T-4A）はしない。

### 5-4. 複数カーソルガードについて

body-editor 起点の `openParagraphPartialEditForCursor` は `editor.listSelections().length > 1` を拒否するが、これは「本文編集中のカーソルが複数ある状態から、どのカーソルを基準に paragraph を解決すべきか」という曖昧さを避けるためのガードである。Tree 起点の起動（`activatePartialEditViewForParagraph` を直接呼ぶ想定）は、Tree 側で既に一意に再解決された1つの paragraph の `range.startLine` を渡すだけであり、本文編集中のカーソル選択状態とは無関係である。したがって、Tree 起点の呼び出しにこの複数カーソルガードを追加で設ける必要はない。これは実装上の省略ではなく、意味的にガードが不要なケースであるという結論である。


## 6. Method Vault 設計レビュー用ノート

利用者が GUI 上で判断しやすいよう、案A/B/C の比較・推奨起動方法・想定される成功/拒否例・利用者判断用の質問をまとめた設計レビュー用ノートを、Method Vault の `Method/unified-outliner/phase5t4-tree-paragraph-partial-edit-design-review.md` として作成する（§8 参照）。通常ノートと区別できるよう、他フェーズのレビュー用ノートと同じ命名規則（`phase<N>-<内容>-design-review.md`）に従う。

## 7. 利用者判断事項

5T-4A（実装フェーズ）の着手前に、利用者に判断していただきたい事項は以下の4件である。

1. **起動方法**: §4 の比較のとおり案Aを第一候補として推奨するが、この理解でよいか。案C（ダブルクリック/F2）を将来検討する前提で、まずは案Aのみを 5T-4A のスコープとしてよいか。
2. **メニュー項目の配置**: 「段落を編集…」を、既存の `showParagraphMoveMenu`（現在は上下移動・非隣接移動のみを扱っているメニュー）に追加項目として加える形でよいか。あるいは項目追加に伴い、このメソッド名・メニューの呼称（例: 「段落メニュー」等）を変更すべきか。
3. **多行・空行入力のバリデーション**: §5-3 で述べたとおり、現行の `applyParagraphEdit` はテキストエリアへの空行を含む入力（構造的には paragraph の分割に相当する）を防止するバリデーションを持たない。これは Tree 起点の追加以前から存在する既存の隙間だが、チケット §5 の禁止事項（分割の禁止）を厳密に守るなら、5T-4A で新しいバリデーション（例: Apply 前に `newText` が空行を含む場合は拒否する）を追加すべきか。それとも、この隙間は現状のまま許容し、将来の別チケットで扱うか。
4. **メニュー項目の表示条件**: 標準の callout/blockquote の「Open in Partial Edit」は常時表示（無条件）である。paragraph の「段落を編集…」も同様に、Tree ヒント再解決さえ成功すれば常時表示としてよいか（現在の上下移動/非隣接移動項目のような eligibility 判定は不要という理解でよいか）。


## 8. 結論・推奨のまとめ

- 起動方法は案A（Tree context menu → 既存 Partial Edit）を推奨する。既存の `activatePartialEditViewForParagraph(cursorLine)` を、Tree 側で再解決した paragraph の `range.startLine` を渡してそのまま呼び出すだけで実現でき、新しいアンカー型・新しい書き戻し関数・新しい再解決ロジックのいずれも不要である。
- 保存契約（起動時・保存時・編集内容）は、既存の 5P-2 契約（`resolveParagraphAtCursor` / `applyParagraphEdit` / `PartialEditView` の paragraph 分岐）をそのまま再利用する。5T-4A で変更が必要な既存モジュールは無い。
- 5T-4A で新規に追加が必要なコードは、`src/view/OutlineTreeView.ts` への Tree メニュー項目1件の追加（および対応する呼び出し1行）と、対応する i18n ラベルのみと見込まれる。ただし、これは次フェーズ（5T-4A）の実装スコープの見積もりであり、本ドキュメントの範囲では実装しない。
- §7 の4件の利用者判断事項について回答をいただいた後、5T-4A のチケットを起票して実装に着手する想定である。

## 9. 完了条件の確認

- 本ドキュメント自体（`docs/phase5t4_tree_paragraph_partial_edit_design.md`）を新設した。
- `docs/phase5p_paragraph-block-foundation-plan.md` に本ドキュメントへの後続リンクを最小限追記する。
- `docs/phase5t_tree-interaction-move-design.md` に本ドキュメントへの後続リンクを最小限追記する。
- 統合ロードマップ（`docs/統合実装ロードマップ_2026-08-05.md`）の status/参照を更新する。
- Method Vault に設計レビュー用ノートを作成する（§6 参照）。
- `src/`・`tests/`・`styles.css`・`manifest.json`・ビルド成果物は変更していない。
- `parseDocument.ts` は変更していない。
- 単独コミットとする。
