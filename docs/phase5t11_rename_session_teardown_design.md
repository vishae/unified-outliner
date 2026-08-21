# Phase 5T-11D: Outline Tree rename session の close / blur / teardown 契約 監査（docs-only）

作成日: 2026-08-20
対象: `docs-only`。本ドキュメントはコード変更を一切伴わない設計監査であり、実装は次フェーズ
（利用者判断を経て確定するチケット）に持ち越す。

## 0. 前提・スコープ

Phase 5T-10A まで、paragraph の Tree 操作として rename（5T-8A）・move（5T-1/5T-2）・
Partial Edit（5T-4A）・delete（5T-9A）・insert（5T-10A）が最小スコープで一通り揃った。
本チケットは個別機能の追加ではなく、Outline Tree の **rename session**（`renameState` が
非 null である期間）の開始・継続・確定・キャンセル・view close・leaf 切替・note 切替・
refresh・destroy 時の契約を横断的に整理する docs-only 監査である。

対象は §2 に列挙された rename session lifecycle 関連のコードのみ。paragraph delete/insert
自体の意味論、Paragraph Partial Edit 本体、F2、D&D、`computeDropMode`、
`runRelocateCommand`、drop indicator、mobile long-press、`edit/listBodyRange.ts`、
`parser/parseDocument.ts`、`styles.css` はいずれも対象外・無変更（`git diff --stat` で
確認済み — §12）。

## 1. 現状の rename session lifecycle 全体像

### 1-1. `renameState` の型と寿命

`view/OutlineTreeView.ts` 内、`private renameState: {...} | null = null;`
（現在地: class field, `beginRename`/`beginParagraphRenameForNode` 周辺）。

```
{
  nodeId: string;
  kind: "section" | "list" | "paragraph";
  inputEl: HTMLTextAreaElement;
  rowSelfEl: HTMLElement;
  snapshot: SectionRenameSnapshot | ListRenameSnapshot | ParagraphMoveAnchor;
  pendingParagraphInsert?: boolean;
  insertOrigin?: { anchor: ParagraphMoveAnchor; position: ParagraphInsertPosition };
}
```

非 null である期間 = 「ある行のラベルが `<textarea>` に差し替わっている期間」と定義されて
おり、この不変条件はコード上厳密に保たれている（`renameState` を書き込む箇所は `beginRename`
の末尾の1箇所のみ、`null` に戻す箇所は `commitRename`/`cancelRename`/
`commitPendingParagraphInsert`/`rollbackPendingParagraphInsert` の4箇所のみ）。

`snapshot` は rename 開始時に一度だけキャプチャされ、確定（commit）時に必ず**フレッシュな
再パース**に対して再検証される — この「開始時スナップショット → 確定時に必ず再解決」という
契約自体は section/list/paragraph のいずれでも一貫しており、本チケットが疑問視する対象では
ない（この契約の再検証範囲・強度そのものについては §6 で別途触れる）。

### 1-2. 開始経路（3種、すべて `beginRename` に合流）

1. **`beginRenameForNode(nodeId)`** — section/list 専用。F2・context menu・
   heading/list insert 直後の `autoRenameAfterInsert()` から呼ばれる。
2. **`beginParagraphRenameForNode(nodeId, pendingParagraphInsert?, insertOrigin?)`** —
   paragraph 専用。paragraph row の pointerdown ベース二重クリック（5T-7C/5T-8A）と、
   paragraph insert 直後の `autoRenameAfterParagraphInsert(anchor, position)`（5T-10A）の
   2箇所から呼ばれる。
3. どちらも最終的に **`beginRename(nodeId, kind, innerEl, rowSelfEl, paragraphSnapshot?,
   pendingParagraphInsert = false, insertOrigin?)`** に委譲し、ここで初めて `<textarea>` が
   DOM に生成され、`renameState` が設定される。

`beginRename` 自身は冒頭で2つのガードを持つ:

- 同じ行への再入 → 既存の `<textarea>` に `focus()`/`select()` するだけで再構築しない。
- 別の行が rename 中 → **`this.cancelRename()` を呼んでから**新しい rename を開始する。

この2つ目のガードが、「新しい rename は常に古い rename を安全に終了させてから始まる」という
既存の重要な不変条件であり、本チケットが新たに壊す必要はない（後述の設計案はいずれもこの
不変条件を維持する前提で比較する）。

### 1-3. 終了経路（現在4つ、うち2つが 5T-10A で新設）

| 経路 | トリガー | 本文への書き込み | renameState |
|---|---|---|---|
| `commitRename()` | Enter、または blur 時に値が変化していた場合 | あり（`renameSection`/`renameListItem`/`applyParagraphEdit`、または `commitPendingParagraphInsert` へ委譲） | `null` に戻す |
| `commitPendingParagraphInsert(insertOrigin)` | `commitRename()` 内部で `pendingParagraphInsert && insertOrigin` の場合にのみ分岐 | あり（`Editor#undo()` + `insertParagraph()` 単発、または `applyParagraphEdit` によるフォールバック） | `finishRenameCommit` 経由で `null` |
| `cancelRename()` | Escape、または blur 時に値が unchanged だった場合 | なし（`pendingParagraphInsert` でない場合） | `null` に戻す |
| `rollbackPendingParagraphInsert(anchor)` | `cancelRename()` 内部で `pendingParagraphInsert && kind === "paragraph"` の場合にのみ分岐 | `Editor#undo()`（安全確認が通った場合のみ） | `null` に戻す |

**この4経路は、いずれも「rename UI から明示的にトリガーされる」場合にのみ到達する。**
本チケットが監査すべきなのは、この4経路の**外側**——view close・leaf 切替・note 切替・
refresh・destroy——で `renameState` が非 null のまま残り得るかどうかである。
## 2. `onClose()` の現状と既知ギャップ

```ts
async onClose(): Promise<void> {
  this.activeMenu?.hide();
  this.activeMenu = null;
  this.cancelParagraphDrag();
  this.contentEl.empty();
  await this.plugin.foldStateManager.flush();
}
```

`onClose()` は現在、**`this.renameState` を一切参照しない**。`cancelRename()`/
`commitRename()`/`rollbackPendingParagraphInsert()`/`commitPendingParagraphInsert()` の
いずれも呼ばれない。

対照的に、同じメソッドは `this.activeMenu`（UXP-02）と `this.paragraphDragSession`
（`cancelParagraphDrag()`、5T-2）という**他の2種類のエフェメラルなセッション状態**について
は、明示的に close 時の後始末を行っている。さらに `cancelParagraphDrag()` は
`refresh()`（発生原因を問わずあらゆる呼び出しの先頭）**と** `onClose()` の**両方**から
無条件に呼ばれる、という一貫した規律を持つ（同メソッド自身のdoc commentが明記: 「called
from refresh() (any cause) and onClose()」）。

`renameState` はこの規律の**外側**にある:

- `refresh()` は `renameState` が非 null なら**即座に return**する（「rename 中の
  `<textarea>` を無関係な refresh トリガーで壊さない」という意図的なガード — これ自体は
  正しい設計判断であり本チケットは変更を提案しない）。
- `onClose()` は `renameState` に**一切触れない**。

つまり paragraph drag session（`cancelParagraphDrag`）は「refresh でも close でも必ず
片付ける」という対称的な規律を持つのに対し、rename session（`renameState`）は「refresh
では意図的に温存し、close では何もしない」という**非対称**な扱いになっている。この非対称性
自体が、本チケットが指摘すべき構造的なギャップである。

### 2-1. `onClose()` が `renameState` に触れない場合、実際に何が起こるか

`this.contentEl.empty()` は `treeRootEl`（`contentEl` の子）以下の DOM 全体を破棄する。
`renameState.inputEl`/`renameState.rowSelfEl` は破棄される DOM 部分木の内部にある。

ブラウザの一般的な挙動として、フォーカスを保持している要素が DOM から取り除かれると、
その要素に対して `blur` イベントが（同期的に）発火する。`inputEl` にはこの `blur` に
対するリスナー（`commitRename()`/`cancelRename()` へ分岐する）が `beginRename` 内で
`addEventListener` されている。**理論上は**、`contentEl.empty()` の実行が
`inputEl` の `blur` を誘発し、それが `commitRename()`/`cancelRename()` を呼び出す、
という間接的な経路が「たまたま」機能している可能性がある。

しかし、これは本チケットの監査で **実機未検証** と結論する。理由は以下の3点。

1. `rename 対象の <textarea> が実際にフォーカスを保持しているとは限らない`。ユーザーが
   rename を開始した直後にフォーカスを本文エディタや別のペインへ移してから view を
   close した場合、`inputEl` は既にフォーカスを失っており、`blur` は発火しない
   （その場合の commit/cancel は、その時点で発火した blur によって既に処理済みのはず
   だが、5T-7C の実機検証で「beginRenameForNode が同期的に DOM/フォーカスを変更する
   ため、pointerdown ハンドラ内からの同期呼び出しが2回目の押下自身のネイティブ click
   処理と競合していた」という実例が既に一度見つかっている — フォーカス関連の暗黙的
   タイミングは、このコードベースで過去に一度、実機でしか検出できなかった不具合の
   原因になっている）。
2. `blur` が発火する**タイミング**が `contentEl.empty()` の**内部処理のどの時点か**
   （要素除去の前か後か）は、DOM 実装依存であり、Obsidian が使う Electron/Chromium の
   バージョンやAPI呼び出し方法（`empty()` は Obsidian 独自の DOM ヘルパーであり、
   `innerHTML = ""` なのか `removeChild` ループなのかで挙動が変わり得る）に依存する。
3. **たとえ `blur` が発火して `commitRename()`/`cancelRename()` が呼ばれたとしても**、
   これらのメソッドは呼び出し後に `this.refresh()` または `this.renderTree()` を
   呼ぶ。`onClose()` の実行順序次第では、これは「`contentEl.empty()` の実行中に、
   それ自身の副作用として `this.treeRootEl.empty()` を再度呼ぶ」という**再入**を
   引き起こす。`this.treeRootEl` は JS オブジェクト参照としては引き続き有効（`empty()`
   は子要素を除去するだけで参照自体を無効化しない）なため、クラッシュはしないと推測
   されるが、意味のない（画面に表示されない）DOM 再構築が close の最中に走ることになる。
   さらに `commitPendingParagraphInsert`/`rollbackPendingParagraphInsert` の
   「canRollback の場合は `this.refresh()`」分岐に入ると、`this.activeMarkdownView.get()`
   を再度呼び、`editor.undo()` すら実行し得る——view が close されている最中に
   エディタの undo 履歴を操作することが安全かどうかは、実機検証なしに断定できない。

**結論**: `onClose()` が `renameState` を明示的に扱わない現状は、「たまたま安全側に
倒れている可能性はあるが、それを保証する設計ではない」状態であり、5T-10A の
`insertParagraph.ts` トップコメントに既に記録されている既知の制約
（「`onClose()` doesn't call `cancelRename()` gap...applies identically — and
pre-existingly — to every rename kind, not just paragraph insert」）を、本チケットで
初めて正面から扱う。
## 3. blur/focus ハンドラと「暗黙の teardown ネットワーク」

`renameState` の実質的な teardown は、現状ほぼ全面的に **`blur` イベントの発火** という
暗黙の前提の上に成り立っている。`onOpen()` の `treeRootEl` 自身の `blur` ハンドラ、
`inputEl` 自身の `blur` ハンドラ、そして各行の `collapseEl`/`selfEl` の `click`
ハンドラ（`toggleCollapse`、選択行ジャンプなど）は、いずれも「rename 中の行以外を
クリックすれば、まず `inputEl` の blur が先に発火して `commitRename()`/
`cancelRename()` が完了してから、自分自身のクリック処理（`renderTree()` を含む）が
走る」という**ブラウザのフォーカス遷移順序**に暗黙に依存している。

具体的には、`renderTree()` を呼ぶ以下の箇所はいずれも `this.renameState` を明示的に
チェックしていない:

- `toggleCollapse()`（折り畳みトライアングルのクリック）
- 選択ナビゲーション系（`handleTreeKeyDown` 経由の矢印キー等）—— こちらは
  `inputEl` の `keydown` ハンドラが**すべてのキーで `evt.stopPropagation()`** する
  ため、rename 中は `treeRootEl` 自身の `keydown` に到達し得ず、実質的に安全
  （構造的に到達不能）。
- 行ジャンプ系メソッド（`jumpToLine` 周辺）

キーボード経由の到達不能性は `stopPropagation()` によって**コード上保証**されているが、
マウスクリック経由（`collapseEl`/`selfEl` の `click`）は保証がなく、**「クリックは
まず blur を誘発する」というブラウザの一般的挙動に依存した、暗黙の安全性**でしかない。
これは 5T-7C で一度、まさにこの種の「同期的な DOM/フォーカス変更のタイミング」が原因の
回帰を生んだ実績があるカテゴリのリスクであり、本チケットの監査範囲として明記する価値が
ある。ただし今回は**実装しない**ため、実機での再現テストは次フェーズに送る。

## 4. leaf 切替・note 切替時の挙動 —— 本監査で新たに判明した最重要リスク

`refresh()` は `active-leaf-change`・`file-open`・`editor-change`・`keyup`/`mouseup`
のいずれのトリガーでも、**まず `this.renameState` をチェックして非 null なら即座に
return する**。この結果、rename session は **アクティブな note そのものが切り替わっても
自動的には終了しない**。

これは §2 で述べた `onClose()` のギャップとは異なる、**より深刻な**問題である。理由は
以下の通り。

### 4-1. section/list rename の再解決契約は "id + 粗い構造チェック" のみ

`edit/renameBlock.ts#renameSection`/`renameListItem` の再解決契約は次の3点のみ:

1. `doc.nodes.get(nodeId)` が存在するか
2. `isSectionNode(node)`/型が一致するか
3. `node.headingLevel === snapshot.headingLevel`（section）、または
   `marker`/`indentColumns`/`contentColumn` が一致するか（list）

**元のテキストとのバイト単位の比較は行われない**（`edit/paragraphPartialEdit.ts#applyParagraphEdit`
が行っている「content-changed」チェックに相当するものが存在しない）。

### 4-2. `nodeId` は各 `parseDocument()` 呼び出しごとにゼロから振り直される連番

`parser/parseDocument.ts` の実装を確認したところ、section の id は `` `sec-${secSeq++}` ``、
list item の id は `` `li-${liSeq++}` `` であり、`secSeq`/`liSeq` は各 `parseDocument()`
呼び出しの**先頭でゼロから開始するローカル変数**である。つまり `"sec-2"` という id 文字列
は、**どのノートを parse したかに関わらず、そのノート内で3番目に現れた section を指すだけ**
であり、ノート間で id の一意性・対応関係は一切保証されない。

### 4-3. 具体的な再現シナリオ（未検証・要実機確認として提示）

1. Note A の Outline Tree で、3番目の見出し（`sec-2`、レベル2）を dblclick して rename
   を開始する。
2. 確定せずに、エディタの別タブ（Note B、こちらも たまたま3番目の見出しがレベル2）を
   クリックしてアクティブにする。
3. `active-leaf-change` が発火し、`this.activeMarkdownView.get()` が返す `view` は
   以降 Note B のものになる。`refresh()` は `renameState` ガードにより Tree の表示
   自体は Note A のまま更新されない。
4. この状態で（`inputEl` がまだ DOM 上に存在し、何らかの理由でまだ blur していない
   場合）Enter を押す、あるいは blur が発火して値が変化していれば、`commitRename()`
   が `parseDocument(editor.getValue())`——**Note B の内容**——に対して
   `renameSection(doc, "sec-2", { headingLevel: 2 }, rawValue)` を呼ぶ。
5. `doc.nodes.get("sec-2")` は **Note B の3番目の見出し**を返し、
   `headingLevel === 2` も一致するため、再解決は**成功**し、Note B の見出しが
   Note A 向けに入力されたテキストで**上書きされる**。

この一連の流れが実機で実際に発生するかどうかは、「タブ切り替えのクリックが `inputEl`
の blur を実際に誘発するか、誘発するとして `active-leaf-change` の発火と blur の発火の
どちらが先に処理されるか」という、ブラウザ/Electron のイベント順序に依存する。これは
本監査単独では確定できず、**実機検証が必須**の項目として明記する（§13 判断事項の一つ）。

### 4-4. paragraph 系は既に content 一致チェックを持つため、このリスクが低い

対照的に、paragraph の rename（`applyParagraphEdit`）・insert のロールバック
（`canSafelyRollbackParagraphInsert`）・insert の確定時 collapse
（`commitPendingParagraphInsert` 内の `canSafelyRollbackParagraphInsert` 呼び出し）は、
いずれも `resolveAnchorUnit`/`applyParagraphEdit` の再解決契約の一部として、
**元のテキストとのバイト単位の比較**を行っている（`anchor.originalText` との一致確認）。
そのため、Note B に偶然「id・親・深さまで一致する上に、テキストまでバイト単位で一致する」
paragraph が存在する確率は現実的にゼロに近く、§4-3 のシナリオが paragraph 側で成立する
可能性は section/list よりも大幅に低い。

**この非対称性（section/list rename には content 一致チェックが無い）は、本チケットの
スコープである「rename session lifecycle」そのものではなく、「rename の再解決契約の
強度」に関する、別種の改善余地である。本チケットの主眼（teardown 契約の整理）とは切り
分けて、§11 で別チケット候補として明記するに留め、本チケットの設計案には含めない。**

## 5. `pendingParagraphInsert` rollback と lifecycle の関係

5T-10A で新設された `rollbackPendingParagraphInsert`/`commitPendingParagraphInsert` は、
いずれも `editor.undo()` を呼ぶ**前**に `canSafelyRollbackParagraphInsert`
（内部で `resolveAnchorUnit` のバイト単位比較を含む再解決を行う）を必ず先に通す設計に
なっている（§4-4 で述べた通り）。このため、**leaf/note 切替が起きていた場合でも、
誤って別ノートの undo 履歴を操作してしまうリスクは、この安全確認によって既に防がれている**
——これは 5T-10A の実装時点で意図されたものではなく（leaf 切替は当時の設計スコープ外
だった）、副産物的に得られている保護である。

一方で、この安全確認が `false` を返した場合の挙動——`rollbackPendingParagraphInsert`
は「プレースホルダをそのまま本文に残す」、`commitPendingParagraphInsert` は「in-place
patch にフォールバックする」——は、**いずれも `this.renameState` を `null` に戻す**ため、
rename session としては正しく終了する。したがって `pendingParagraphInsert` の rollback
契約は、既存の実装のままでも「rename session の一部として正しく終了する」という要件は
満たしている。

**本チケットが整理すべきなのは、この rollback ロジック自体ではなく、「onClose() から
`cancelRename()`（延いては `rollbackPendingParagraphInsert`）に到達できていない」という
§2 のギャップの方である。** onClose() 側さえ修正すれば、pendingParagraphInsert の
rollback 契約は無修正のまま自然に close 時にも適用される（§6 の設計案 A/B の比較で
詳述）。

## 6. plugin `onunload()` との関係

`main.ts#onunload()`（プラグイン全体の無効化・Obsidian 終了時）は、2026-08-12 以降
**`detachLeavesOfType()` を意図的に呼ばない**方針になっている（コメント: 「leaving the
leaves alone is safe」）。これにより、プラグイン無効化時に Outline Tree の各 leaf が
**明示的に close されない**可能性がある——`OutlineTreeView.onClose()` がプラグイン
無効化のタイミングで確実に呼ばれるかどうかは、Obsidian 側の View/Component ライフサイクル
実装に依存し、本監査のコードリーディングだけでは確定できない。

`onunload()` 自身は `void this.foldStateManager.flush()` のみを行っており、
`renameState` には一切関与しない。仮に `onClose()` を修正しても、
「プラグイン無効化時に `onClose()` 自体が呼ばれない」経路が存在するなら、rename session
の teardown はそこでは効かないことになる——これも実機/Obsidian API 挙動の確認が必要な
未解決事項として明記する（§13）。

## 7. 既存不具合候補（まとめ）

| # | シナリオ | 現状の挙動 | 深刻度 | 検証状況 |
|---|---|---|---|---|
| 1 | rename 中に view を閉じる（タブを閉じる） | `renameState` に触れず `contentEl.empty()`。blur が誘発されるかは未検証 | 中 | 未検証（実機要） |
| 2 | paragraph insert 後、rename 未確定のまま view を閉じる | 上記1と同じ経路。安全確認込みの rollback に到達しない可能性 | 中〜高（プレースホルダが本文に永続する恐れ） | 未検証（実機要） |
| 3 | heading/list rename でも未確定 state が残るか | 残り得る（1と同じ根本原因） | 中 | 未検証（実機要） |
| 4 | leaf/note 切替中に rename が生存する | `refresh()` のガードにより意図的に継続。confirm 時に **誤って別ノートを上書きする** 可能性（section/list） | **高**（新規判明） | 未検証（実機要、再現条件はブラウザのイベント順序次第） |
| 5 | refresh 中に renameState が stale になるか | `refresh()` 自体は stale にしない（ガードで即 return）。ただし `collapseEl`/`selfEl` の click ハンドラは `renameState` 未チェックで `renderTree()` を呼び得る（§3） | 低〜中 | 未検証（実機要） |
| 6 | 既存の cancel path と onClose path の二重実行 | 現状 onClose は cancel を呼ばないため二重実行は起きないが、§6 案A/Bを入れる場合は新たに検討要 | 設計時の考慮事項 | 設計で回避可能 |
| 7 | cleanup を増やすと既存の commit path を壊す危険 | commitRename/cancelRename 自体は変更しない前提であれば低リスク | 低 | 設計で回避可能 |

## 8. 設計案の比較

### 案A: `onClose()` で常に `cancelRename()` を呼ぶ

```ts
async onClose(): Promise<void> {
  if (this.renameState) this.cancelRename();
  this.activeMenu?.hide();
  ...
}
```

- 既存の `cancelRename()`/`rollbackPendingParagraphInsert()` をそのまま再利用する
  ため、**新しいロジックを一切追加しない**。pendingParagraphInsert の安全な
  rollback（§5）も無修正のまま自動的に適用される。
- `cancelRename()` は常に「未確定の入力を破棄する」（Escape と同じ意味論）。
  「閉じたら自動保存する」という選択肢は採らない——これは
  `cancelRename()` 自身の既存の設計原則（「never calls applyLineEditOutcome,
  editor.replaceRange, or any other body-writing API」）と一致する、最も驚きの
  少ない挙動である。
- リスク: `cancelRename()`/`rollbackPendingParagraphInsert()` はいずれも末尾で
  `this.renderTree()` または `this.refresh()` を呼ぶ。`onClose()` の途中（
  `contentEl.empty()` の前）でこれを呼べば、まだ生きている DOM に対して安全に
  実行できるが、`refresh()` 分岐（pendingParagraphInsert が安全に rollback
  できた場合）は `editor.undo()` を実行する——view が閉じている最中にエディタの
  undo 履歴を操作することの安全性は実機検証が必要（§13）。

### 案B: onClose / destroy / leaf detach 専用の teardown 関数を新設し、通常
`cancelRename` とは別経路にする

```ts
private teardownRenameSession(): void {
  if (!this.renameState) return;
  // 本文・エディタには一切触れない — DOM/フィールドのクリアのみ。
  this.renameState.rowSelfEl.setAttribute("draggable", "true");
  this.renameState = null;
}

async onClose(): Promise<void> {
  this.teardownRenameSession();
  ...
}
```

- `editor.undo()`・`refresh()`・`renderTree()` をどれも呼ばない、最も保守的な
  teardown。view の残存が不確かな状況でエディタ操作をしないという点で、案Aより
  「壊れにくい」。
- pendingParagraphInsert の場合、プレースホルダ（U+200B、不可視）が rollback
  されずに本文へ**永続的に残る**——「Cancel/Escape で閉じれば消えるのに、view を
  閉じただけでは消えない」という、通常の cancel 経路との**非対称な挙動**が生まれる。
  不可視文字であるため気付きにくい形で本文に残置される点は、§2-1 表の項目2の
  深刻度を「中〜高」とした理由そのものである。
- `onClose()`/将来の leaf-detach 検知/`onunload()` など、複数の呼び出し元から
  同じ関数を安全に呼べるという拡張性がある。

### 案C: rename 種別ごとに close 時挙動を分ける（paragraph insert だけ特別扱い）

```ts
async onClose(): Promise<void> {
  if (this.renameState?.pendingParagraphInsert && this.renameState.kind === "paragraph") {
    this.rollbackPendingParagraphInsert(this.renameState.snapshot as ParagraphMoveAnchor);
  } else if (this.renameState) {
    // heading/list/既存paragraphのrenameは、DOM/フィールドのクリアのみ。
    this.renameState = null;
  }
  ...
}
```

- pendingParagraphInsert のみ「安全なら rollback」、それ以外は「何もせず破棄」と、
  種別ごとに個別のロジックを持つ。
- `rollbackPendingParagraphInsert`/`cancelRename` の呼び出し経路が increase し、
  「Escape で閉じた場合」と「view を閉じた場合」でコードパスが完全に分岐する
  ため、将来どちらかだけ修正されて挙動がずれる（drift）リスクがある。
- チケット自身の想定通り、「局所修正はしやすいが基盤統一性が低い」。

### 比較表

| 観点 | 案A | 案B | 案C |
|---|---|---|---|
| heading/list/paragraph の一貫性 | 高（既存 cancelRename を完全再利用） | 中（新規関数だが全種別に同一適用） | 低（種別で分岐） |
| pendingParagraphInsert rollback の安全性 | 高（既存の安全確認をそのまま適用） | 低〜中（常に本文に永続、安全確認自体は不要） | 高（rollback 試行）だが記述が重複 |
| Undo 履歴への影響 | あり得る（`editor.undo()` を呼ぶ可能性） | なし（一切エディタに触れない） | あり得る（pendingParagraphInsertのみ） |
| view close/note switch での後始末の確実性 | 高（既存ロジック完全再利用） | 中（安全だが不完全なrollback） | 中（実装次第で高くなり得るが重複コストが伴う） |
| 実装差分 | 最小（1〜数行） | 小（新規メソッド1つ+呼び出し） | 中（分岐ロジック新設） |
| 回帰リスク | 低〜中（既存の commit/cancel 経路を close からも呼ぶことによる副作用) | 低（新規・独立・保守的） | 中（分岐の保守負担） |
| テスト可能性 | 高（既存 cancelRename のテストが概ね流用可能） | 高（新規関数は単純で純粋に近い） | 中（分岐ごとに個別テストが必要） |
| 推奨可否 | ◎ | ○（安全最優先ならこちらも妥当） | △ |

## 9. 推奨案

**案Aを推奨する。** 理由:

1. 5T-10A の `pendingParagraphInsert` rollback は、既に「rollback 前に必ず安全確認
   （バイト単位の内容一致）を行う」という設計になっている（§5）。この安全確認機構は
   Cancel/Escape 経路のためだけに作られたものではなく、「本当にこの rename が今も
   有効な対象を指しているか」を検証する、**汎用的な安全装置**である。onClose() から
   同じ `cancelRename()` を再利用することで、この安全装置がそのまま close 時にも
   働く——案Bのように「close 時はエディタに触れない」という保守的すぎる方針を採ると、
   本来 rollback できたはずのケースまで一律で見送ることになり、かえって
   「不可視のプレースホルダが本文に永続する」という、ユーザーから見て気付きにくい
   副作用を積極的に選択することになる。
2. 案Cのように種別ごとに分岐する必要が本来ない——`cancelRename()` 自体が既に
   `pendingParagraphInsert` の有無で内部分岐しており（§1-3表）、onClose() 側は
   単に「rename 中なら cancelRename() を呼ぶ」という**呼び出し側の判断のみ**で
   済む。
3. `cancelRename()` 自身のロジックは変更しない（本チケット§3の対象外制約を厳守）。

ただし、**`editor.undo()`/`refresh()` が view close の最中に安全に実行できるかは、
本監査だけでは断定できない**（§2-1）。この点を実機で確認できなかった場合の代替として、
**案B相当の「更に保守的なフォールバック」**——「`canSafelyRollbackParagraphInsert` の
判定自体は行うが、`editor.undo()`/`refresh()` を呼ばずに DOM/フィールドのクリアだけに
留める、close 専用の軽量な派生」——を段階実装の第2段階として用意しておくことも
選択肢として提示する（§10）。

## 10. 最小実装境界（段階実装案）

実装フェーズ（本チケットの対象外）では、以下のように段階分けすることを推奨する。

- **第1段階（最小差分・案A）**: `onClose()` の先頭、`this.activeMenu?.hide()` より前
  （または直後、`cancelParagraphDrag()` と同じ並びが自然）に
  `if (this.renameState) this.cancelRename();` を追加するのみ。`cancelRename()`/
  `commitRename()`/`rollbackPendingParagraphInsert()`/`commitPendingParagraphInsert()`
  自体は一切変更しない。
- **第2段階（実機検証の結果次第）**: 第1段階を実機で検証し、「view close の最中に
  `editor.undo()`/`refresh()` を呼んでも問題ない」ことが確認できればそのまま確定。
  もし問題が見つかった場合のみ、案B相当の close 専用軽量パスへの切り替えを検討する。
- **leaf/note 切替（§4）は本チケットのスコープ外だが、同根の問題**であるため、
  第1段階と同じ teardown 呼び出しを `active-leaf-change`/`file-open` ハンドラにも
  追加する拡張を、**別チケット**として提案する（`refresh()` 自身のガードを
  `if (this.renameState) { if (noteChanged) this.cancelRename(); return; }` のように
  条件分岐する形が候補になる——ただし「note が変わった」をどう判定するか
  （`TFile` の path 比較等）は別途設計が必要であり、本チケットの成果物には含めない）。
- section/list rename の再解決契約に content 一致チェックを追加する件（§4-4）も、
  別チケット候補として記録するに留める。

## 11. 想定されるテスト方針

実装フェーズでは、以下の観点のテストを想定する（本チケットでは作成しない）。

- 既存の `tests/paragraphOutlineTreeUiWiring.test.ts`/`tests/paragraphInlineRename.test.ts`
  と同様の「ソーステキストを静的に検査する」スタイルのユニットテストで、
  `onClose()` の本文が `if (this.renameState) this.cancelRename();` を含むことを
  確認する。
- `cancelRename()`/`rollbackPendingParagraphInsert()` 自体の既存テストは無修正の
  ままで良い（呼び出し元が増えるだけで、ロジック自体は変更しないため）。
- 実機検証（Method Vault チェックリスト）として、§7 の表の項目1〜4に対応する手順
  （rename 中に view を閉じる／paragraph insert 後 rename 未確定のまま閉じる／
  leaf 切替を試す）を用意する。

## 12. `parseDocument.ts`・`styles.css`・`edit/listBodyRange.ts` 未変更の確認

本チケットは docs-only であり、コード変更を一切行っていない。`git diff --stat` で
`src/parser/parseDocument.ts`・`styles.css`・`src/edit/listBodyRange.ts` を含む
**すべてのソースファイルに diff がないこと**を確認済み（本ドキュメント自体の追加のみが
差分）。

## 13. 実機受入結果と追加判明事項（Phase 5T-11A、2026-08-22）

Phase 5T-11A（本監査の推奨案Aの実装、コミット `96f649d`／`65279b9`）について、
利用者による実機確認を複数ラウンド実施した。

### 13-1. 確認結果サマリ

- paragraph insert 直後の自動 rename 中に view を閉じた場合の rollback（§7 表の
  項目2〜4相当）: **正常に機能した**。
- 変更なしで Enter を押すと編集ボックスが閉じる追加修正（5T-11A follow-up、
  コミット `65279b9`）: **正常に機能した**。
- 既存の rename commit（Enter で確定）・delete・insert・Partial Edit・D&D の回帰:
  **異常なし**。
- heading/list/paragraph の既存 rename について、Escape を押すと変更が破棄される
  ことを確認: **正常（既存仕様どおり）**。

### 13-2. 新たに判明した重要な事実: 「タブをクリックして閉じる」操作は、
onClose() が実行される前に、既存の blur ハンドラが先に rename を確定/破棄している

利用者に、heading/list/paragraph の各 rename について「本文を変更した状態のまま
未確定で Outline Tree のタブそのものを実際に閉じる」という手順で再確認を依頼した
ところ、以下の実機報告を得た（原文）:

> 「編集中に outline tree のタブをクリックするだけで確定されてしまう。閉じる操作の
> 前にという事である。」

これは **不具合ではない**。原因は次のとおりである。

Obsidian のタブ UI で、あるタブを閉じるには、ユーザーはまず（閉じるための ×
アイコンを表示させる、あるいは右クリックメニューを開くために）そのタブ自体へ
何らかのポインタ操作を行う必要がある。この最初の操作が発生した時点で、それまで
フォーカスを保持していた rename 中の `<textarea>` から即座に `blur` が発火する
（DOM の一般的挙動）。`inputEl` の `blur` ハンドラ（2026-08-11 fix、`beginRename`
内、5T-11A より遥かに以前から存在する既存コード）は、この時点で

```
if (inputEl.value === initialText) {
  this.cancelRename();
} else {
  this.commitRename();
}
```

を同期的に実行し、`renameState` を `null` に戻してしまう。実際にタブを閉じる
操作（× アイコンへの後続のクリック）が Obsidian 側で処理されて
`OutlineTreeView.onClose()` が呼ばれるのは、その**後**である。つまり、
`onClose()` が実行される時点では、`this.renameState` は既に `null` になっており、
本チケットで追加した `if (this.renameState) this.cancelRename();` は**到達こそ
するが実質的に no-op** となる。

これは §2-1 で「理論上は」「たまたま安全側に倒れている可能性はあるが保証はない」
と記述していた仮説の一部が、実機で**部分的に裏付けられた**ことを意味する。ただし
§2-1 が想定していた「blur が commit/cancel を呼び、その結果 refresh()/renderTree()
が close の途中で再入する」という懸念は、この経路では発生しない
（blur によるcommit/cancel は close 操作の**完全に前**、textarea がまだ通常の
DOM 状態にある時点で完了しており、`contentEl.empty()` が始まる前に安全に終わって
いる）。

### 13-3. 「破棄」ではなく「確定」になる点について

§3 の契約（「view close 時に rename 中なら、常に cancel と同じ意味で破棄する」）
は、`onClose()` 自身が rename を終了させるケースについては設計どおり実装されて
いる。しかし実機で判明したとおり、タブを直接クリックして閉じるという最も一般的な
操作では、**`onClose()` が終了させる前に、既存の blur ハンドラが先に終了させて
しまう**。blur ハンドラは「変更されていれば確定・されていなければ破棄」という、
`cancelRename()` とは異なる契約（2026-08-11 fix、Finder/Explorer/VS Code の
慣習に合わせた意図的な設計）を持つため、結果として「タブを閉じる」という操作が
実際には「変更ありなら確定」という体感になる。

これは **5T-11A が意図せず壊した挙動ではない**。blur ハンドラの契約自体は
5T-11A の対象外であり、一切変更していない（コミット `96f649d`／`65279b9` の
diff は `onClose()` 内の1行追加と、Enter キーの分岐のみ）。また、この挙動は
実害という意味でもむしろ安全側である——タブを閉じただけでユーザーが入力した
内容が無条件に消えてしまうより、変更が保存される方が一般的にはデータ損失が
少ない。

### 13-4. onClose() の追加が実際に意味を持つ範囲（更新）

実機確認の結果、`onClose()` に追加した `if (this.renameState) this.cancelRename();`
が実際に非 no-op として働くのは、**rename 中の textarea に対して事前に blur が
発火しない経路で view が close される場合に限られる**とわかった。タブを直接
クリックして閉じる操作（右クリック→「タブを閉じる」を含む、いずれもタブ自体への
先行するポインタ操作を要する）では、通常このケースに該当しない。

該当し得る経路として理論上考えられるのは、たとえば以下のようなものである
（実機未検証、優先度は低いと判断）:

- プラグイン無効化・Obsidian 終了時に、フォーカス変更を伴わずに leaf が
  プログラム的に detach されるケース（§6 で述べたとおり `onunload()` は
  現在 `detachLeavesOfType()` を呼ばないため、この経路自体が実際に発生するかは
  未確認）。
- 何らかの理由で rename 中の textarea が既にフォーカスを失っている状態
  （例: 本文エディタ側を操作した後にタブを閉じた場合）で close される
  ケース——この場合はそもそも blur が既に発火済みであり、`renameState` も
  既に `null` になっているため、やはり `onClose()` の追加行は no-op となる。

結論として、5T-11A の変更は**有害ではなく、依然として正しい防御的措置**では
あるが、実機で日常的に踏まれる経路ではほとんど no-op であることが判明した。
これは実装のバグではなく、pre-existing の blur 契約（2026-08-11 fix）が
`onClose()` より先に効いてしまうという、イベント発火順序に起因する構造的な
帰結である。

### 13-5. §4（leaf/note 切替リスク）への示唆（未検証・要注意）

§4 で「高」と評価した、leaf/note 切替中の rename 生存によるクロスノート誤上書き
リスクについても、同様の blur 先行効果が働く可能性がある——別タブ/別ノートへの
切替も、まずそのタブへのポインタ操作を要するため、切替前に blur が発火し
`commitRename()`/`cancelRename()` が先に完了する可能性が考えられる。ただし
これは**本ラウンドでは検証していない**。§4 のシナリオは「本文エディタ側の別タブ
（Note B）をクリックする」という、Outline Tree 自身のタブとは異なる対象への
クリックであり、フォーカス遷移の経路が本セクションで確認したケースと同一とは
限らない。したがって §4 のリスク評価を今回の発見だけを根拠に引き下げることは
せず、引き続き実機検証が必要な別チケット候補として残す（§10 参照）。

### 13-6. 結論

5T-11A の実装（`onClose()` への `cancelRename()` 呼び出し追加、および Enter
キーの unchanged-check 追加）は、実機確認の結果、当初の設計どおり安全に動作し、
既存機能への回帰も見られなかった。ただし「タブを閉じる」という最も一般的な
close 操作では、この追加が実際に効くより前に、既存の blur 契約が rename を
確定/破棄してしまうため、本チケットが本来解決しようとした「onClose() が
renameState に触れないギャップ」は、実機での日常操作においては、追加前から
既に（blur 経由で）大部分カバーされていたことが判明した。この事実は実装の
妥当性を損なうものではなく、今後の関連チケット（leaf/note 切替、§4）の
優先度判断における参考情報として記録する。
