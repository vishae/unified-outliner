# Phase 5T-12D: Outline Tree rename 中の leaf / note switch 安全性監査（docs-only）

作成日: 2026-08-22
対象: `docs-only`。本ドキュメントはコード変更を一切伴わない設計監査であり、実装は次フェーズ
（利用者判断を経て確定するチケット）に持ち越す。

## 0. 前提・スコープ

Phase 5T-11D で「rename 中に leaf/note が切り替わった場合の誤上書きリスク」が理論上の
懸念として切り出され、Phase 5T-11A の実機受入では、Outline Tree 自身のタブを直接
クリックして閉じる経路において、既存の blur ハンドラ（2026-08-11 fix）が `onClose()`
より先に rename を確定/破棄するという事実が実機で確認された（
`docs/phase5t11_rename_session_teardown_design.md` §13）。本チケットは、この blur 先行
効果が leaf/note 切替のケースにも及ぶのかを含め、「rename 中の leaf/note switch」が
実際にどのような安全性契約の下にあるのかを、コード監査によって整理する。

対象は本ドキュメント §4 に列挙するコード（`renameState` の型、`beginRename` 系、
`commitRename`/`cancelRename`/`commitPendingParagraphInsert`/
`rollbackPendingParagraphInsert`、`ActiveMarkdownViewTracker`、`refresh()` の
`currentFilePath` 管理）に限る。paragraph delete/insert 自体の意味論、Paragraph
Partial Edit 本体、F2、D&D、`computeDropMode`、`runRelocateCommand`、drop indicator、
mobile long-press、`edit/listBodyRange.ts`、`parser/parseDocument.ts`、`styles.css`、
5T-11A の `onClose()` 実装はいずれも対象外・無変更（`git diff --stat` で確認済み —
§13）。

## 1. rename snapshot と再解決契約の比較（heading/section・list・paragraph）

### 1-1. 型定義そのものに note/file identity は一切含まれない

`edit/renameBlock.ts`:

```ts
export interface SectionRenameSnapshot {
  /** node.headingLevel, captured when the rename UI opened. */
  headingLevel: number;
}

export interface ListRenameSnapshot {
  marker: string;
  indentColumns: number;
  contentColumn: number;
}
```

`edit/paragraphTreeMove.ts`（5T-8A 以降、paragraph rename・move・insert rollback が
共通して使う `ParagraphMoveAnchor`）:

```ts
export interface ParagraphMoveAnchor {
  kind: "paragraph";
  complexBlockId: string;
  parentId: string | null;
  depth: number;
  /** Byte-for-byte "before the move" snapshot — compared verbatim at execution time. */
  originalText: string;
  rangeStart: number;
  rangeEnd: number;
}
```

`edit/paragraphPartialEdit.ts` の `ParagraphEditAnchor`（rename commit 時に実際に
使われる方）も同型（`complexBlockId`/`parentId`/`depth`/`originalText`）。

**いずれの型にも、`TFile`・ファイルパス・`Editor` インスタンスへの参照は一切存在
しない。** つまり heading/list/paragraph のどの rename も、「このスナップショットは
どのノートに対して取られたものか」という情報を、スナップショット自体には一切
持たせていない。安全性は全面的に「再解決時にどの `doc`（`ParsedDocument`）に対して
照合するか」という**呼び出し側の責任**に委ねられている。

### 1-2. 再解決の強度は heading/list と paragraph で明確に異なる

`edit/renameBlock.ts#renameSection`/`renameListItem` の再解決契約（3チェックのみ）:

1. `doc.nodes.get(nodeId)` が存在するか
2. `isSectionNode(node)`/型が一致するか
3. `node.headingLevel === snapshot.headingLevel`（section）、または
   `marker`/`indentColumns`/`contentColumn` が一致するか（list）

**元テキストとのバイト単位比較は一切行われない。**

`edit/paragraphPartialEdit.ts#applyParagraphEdit`（paragraph rename が実際に使う
関数）の再解決契約（3段階、すべて `resolveAnchorUnit`/独自実装で同型）:

1. `complexBlockId` 一致（候補特定のみ、単独では信用しない）
2. `parentId`/`depth` 一致（構造チェック）
3. **`currentText === anchor.originalText`（バイト単位比較）**

`edit/paragraphTreeMove.ts#resolveAnchorUnit`（paragraph move・insert rollback が
使う、より厳格な版）はこれに加えて**ドキュメント全体を走査した曖昧一致チェック**
（同一 `parentId`/`depth`/`originalText` を持つ候補が複数あれば `ambiguous-match` で
拒否）まで持つ。

この非対称性は 5T-11D §4-4 で既に指摘済みだが、本チケットではその**具体的な帰結**を
次節以降で掘り下げる。

## 2. workspace/leaf と rename の関係

### 2-1. `ActiveMarkdownViewTracker` はプラグイン全体で1個だけの共有キャッシュである

```ts
// main.ts
readonly activeMarkdownView = new ActiveMarkdownViewTracker(this.app);
```

`view/activeMarkdownViewTracker.ts`:

```ts
export class ActiveMarkdownViewTracker {
  private lastView: MarkdownView | null = null;
  constructor(private readonly app: App) {}

  get(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) {
      this.lastView = active;
      return active;
    }
    if (this.lastView && this.isStillOpen(this.lastView)) {
      return this.lastView;
    }
    this.lastView = null;
    return null;
  }
  ...
}
```

`OutlineTreeView` は `private get activeMarkdownView() { return this.plugin.activeMarkdownView; }`
という getter でこの**単一インスタンス**を参照する。`PartialEditView` も同じ
インスタンスを共有する。これは「直近フォーカスされていた markdown view を返す」
という**プラグイン全体でグローバルな「現在」の概念**であり、特定の Outline Tree
leaf インスタンスにも、特定の rename セッションにも、一切スコープされていない。

`get()` は呼ばれるたびに `workspace.getActiveViewOfType(MarkdownView)` を再評価
する——つまり **`beginRename` 時に返された view と、`commitRename` 時に返された
view が同一である保証はどこにもない。** 呼び出しごとに独立して「その時点の直近
アクティブ view」を返すだけである。

### 2-2. `commitRename()`/`cancelRename()`/`rollbackPendingParagraphInsert()` は
いずれも commit/cancel の瞬間に `activeMarkdownView.get()` を**改めて**呼び出す

```ts
// commitRename()
const view = this.activeMarkdownView.get();
...
const doc = parseDocument(editor.getValue());
const outcome = state.kind === "section" ? renameSection(doc, state.nodeId, ...) : ...
```

```ts
// rollbackPendingParagraphInsert(anchor)
const view = this.activeMarkdownView.get();
const canRollback = !!view && canSafelyRollbackParagraphInsert(view.editor.getValue(), anchor);
if (canRollback && view) view.editor.undo();
```

`beginRename` 時点で `this.activeMarkdownView.get()` が返していた view を**保持して
再利用する仕組みは存在しない**——commit/cancel のたびに、その瞬間の「グローバルな
直近アクティブ view」を新たに取得し直す。rename 開始からその間に別ノートへ切り替え
られていれば、ここで返る `view` は開始時とは別のノートの `MarkdownView` になり得る。

### 2-3. `refresh()` は `currentFilePath` を更新するが、rename 中は早期 return する

```ts
refresh(): void {
  this.cancelParagraphDrag();
  if (this.renameState) return;   // ← rename 中はここで即 return
  const view = this.activeMarkdownView.get();
  ...
  this.currentFilePath = view.file?.path ?? null;   // ← rename 中は更新されない
  ...
}
```

したがって `this.currentFilePath`（各 `OutlineTreeView` インスタンスが持つ
private フィールド）は、**rename 開始直前の最後の `refresh()` 呼び出し時点の
ファイルパスのまま「凍結」される**——rename 中に `active-leaf-change`/`file-open`
等がいくら発火しても、`renameState` が非 null である限り `refresh()` は先頭で
即 return するため、`currentFilePath` は書き換わらない。

**この事実は本チケットにとって重要な前提となる**: `this.currentFilePath` は、
「この Outline Tree インスタンスが rename 開始時点でどのノートを表示していたか」を、
新しいフィールドを追加せずとも、既に正確に保持している。

### 2-4. 既存の precedent: `syncFoldToBodyEditor` は既にこの照合パターンを持つ

同じ `OutlineTreeView.ts` 内、fold 同期機能（rename とは無関係の別機能）に、
まさに本チケットが必要とする形の note-identity チェックの実例が既に存在する:

```ts
private syncFoldToBodyEditor(nodeId: string, collapsed: boolean): void {
  const view = this.activeMarkdownView.get();
  if (!view || view.file?.path !== this.currentFilePath) return;
  ...
}
```

コメント曰く「no active view for this exact file (guards against a stale toggle
racing a not-yet-refreshed file switch)」——本チケットが探している契約そのものが、
別機能で既に実装され、テスト済みの安定コードとして存在している。

### 2-5. 複数 Outline Tree leaf の state 分離

`main.ts` は `workspace.getLeavesOfType(OUTLINE_TREE_VIEW_TYPE)` を用いて複数 leaf
を横断的に扱う箇所を持つ（設定変更時の一斉 refresh 等）。`renameState`/
`currentFilePath`/`currentDoc` はいずれも `OutlineTreeView` の **private インスタンス
フィールド**であり、leaf ごとに独立している。一方 `activeMarkdownView`
（`ActiveMarkdownViewTracker`）は前述のとおりプラグイン全体で共有される単一
インスタンスである。

結果として: 2つの Outline Tree leaf（例: 左右サイドバーに1つずつ）がある場合、
一方で rename 中（`renameState` 非null、`refresh()` が早期 returnし続ける）でも、
もう一方は rename 中でなければ通常どおり `refresh()` が走り、その時点の
`activeMarkdownView.get()`（プラグイン全体で共有）が指す最新のノートを表示する。
つまり **rename 中の leaf の `currentFilePath` は独立して正しく凍結される**——他方の
leaf が別ノートを表示し始めても、rename 中の leaf 自身の `currentFilePath` は
書き換わらない。この点において、複数 leaf 間の state 分離は**既に正しく機能している**
（新たな問題ではない）。

## 3. commit/cancel の副作用が及ぶ範囲（呼び出し経路ごとの精査）

| 経路 | `activeMarkdownView.get()` 呼び出し | 現在の note-identity チェック | 書き込み/undo の可能性 |
|---|---|---|---|
| `commitRename()`（section/list/paragraph） | あり（毎回フレッシュ） | **なし** | `editor.replaceRange()`（`applyLineEditOutcome` 経由、1回） |
| `commitPendingParagraphInsert(insertOrigin)` | あり（毎回フレッシュ） | **なし** | `editor.undo()` → `insertParagraph()` の `replaceRange`、またはフォールバックで `applyParagraphEdit` の `replaceRange` |
| `cancelRename()`（pendingParagraphInsert でない場合） | なし | 該当なし（本文に一切触れない） | なし |
| `rollbackPendingParagraphInsert(anchor)` | あり（毎回フレッシュ） | **なし** | `canSafelyRollbackParagraphInsert` が true の場合のみ `editor.undo()` |

`cancelRename()` の非 pendingParagraphInsert 経路は、5T-11D で確認済みのとおり
「本文/エディタに一切触れない」設計のため、そもそも note-identity の問題が
発生し得ない——本チケットの対象は実質的に上表の**書き込み/undo を行う3経路**
（commitRename・commitPendingParagraphInsert・rollbackPendingParagraphInsert）に
限られる。

## 4. 具体的リスクシナリオ（未検証・実機確認が必須）

### 4-1. heading rename のクロスノート誤上書き（5T-11D §4-3 の再掲・詳細化）

1. Note A の Outline Tree で、3番目の見出し（`sec-2`、レベル2）を dblclick して
   rename を開始する。この時点で `this.currentFilePath = "Note A.md"`。
2. 確定せずに、本文エディタの別タブ（Note B、たまたま3番目の見出しもレベル2）を
   クリックしてアクティブにする。
3. **もしこの時点で rename 中の `<textarea>` から blur が発火し、`inputEl.value`
   が変更されていれば、既存の blur ハンドラが `commitRename()` を呼ぶ**——この
   commitRename 呼び出しの時点で `this.activeMarkdownView.get()` は既に Note B の
   `MarkdownView` を返す可能性がある（タブ切り替えのクリックが先に処理されて
   いれば）。
4. `commitRename()` は `parseDocument(editor.getValue())`——**Note B の内容**——を
   パースし、`renameSection(doc, "sec-2", { headingLevel: 2 }, rawValue)` を呼ぶ。
5. `doc.nodes.get("sec-2")` は Note B の3番目の見出しを返し、`headingLevel === 2`
   も一致するため、再解決は**成功**し、Note B の見出しが Note A 向けに入力された
   テキストで**上書きされる**。

**この一連の流れが実機で実際に発生するかどうかは、次の2点に依存する**:

- タブ切り替えのクリックが、rename 中の `<textarea>` の `blur` を実際に誘発するか
  （5T-11A §13 の知見により、Outline Tree 自身のタブを閉じる場合は「する」ことが
  実機で確認済みだが、**本文エディタの別タブへの切り替え**が同じ挙動を示すかは
  **未確認**——DOM 構造上、Outline Tree はサイドバー、本文タブはメインペインと、
  異なる領域にあるため、同一の焦点遷移パターンが働くとは限らない）。
- blur が発火するとして、`active-leaf-change`（Obsidian のタブ切り替え本体の処理）
  と blur ハンドラの `commitRename()` 呼び出しの、どちらが先に完了するか。

### 4-2. §5（後述）で述べる blur 先行効果により、このシナリオが実機で成立する
可能性はむしろ低いと推測されるが、断定はできない

5T-11A の実機知見（タブクリック→blur→commit/cancel が、close 処理本体より先に
完了する）が本文タブ切り替えにも同様に当てはまるなら、`commitRename()` が呼ばれる
時点では、まだ `active-leaf-change` が処理される前——つまり
`this.activeMarkdownView.get()` はまだ **Note A** を返している可能性がある。その
場合、上記シナリオの手順3〜5は「Note A に対して正しく確定される」という、当初の
意図どおりの結果になる。

しかし、これは**推測**であり、5T-11A の知見が観測されたのは「Outline Tree 自身の
タブをクリックする」という別の DOM 領域でのケースである。本文エディタのタブ
切り替えという**別の DOM 領域・別のイベント経路**でも同じ順序が成り立つかは、
本監査のコードリーディングだけでは確定できない。**実機検証が必須**（§8 マトリクス
参照）。

### 4-3. paragraph 側のリスクは理論上ゼロではないが、極めて低い

paragraph の rename・insert rollback はいずれも `originalText`（バイト単位比較）を
持つため、上記と同じシナリオが paragraph で成立するには、Note B が「同じ
`complexBlockId`（scan-local）・同じ `parentId`/`depth`・**バイト単位で同一の
paragraph テキスト**」を偶然持つ必要がある。現実の文章でこれが偶然一致する確率は
無視できるほど低い。

## 5. leaf/note 切替と blur 先行効果の関係（未検証）

5T-11A §13 で確認された「Outline Tree 自身のタブをクリックして閉じる」ケースの
blur 先行効果が、次のいずれの操作でも同様に成立するかは、**いずれも未検証**である。

- 本文エディタの別タブ（別ノート）をクリックしてアクティブにする
- 別の Outline Tree leaf をアクティブにする（左右ペイン間の切替を含む）
- キーボードショートカットでの note/leaf 切替（`Ctrl/Cmd+Tab` 相当、Obsidian の
  ページ送り等）——キーボード操作は、そもそも rename 中の `<textarea>` から
  フォーカスが外れないため、blur 自体が発火しない可能性がある
- Obsidian コマンドパレット経由でのノート切替

これらのうちどれかでも「blur が rename の commit/cancel を先に処理する」という
保証が崩れる経路があれば、§4 のリスクシナリオが現実的に成立し得る。**本チケットは
理論上の懸念と実機で再現した事実を区別する方針のため、これらの経路がどう振る舞う
かは、本ドキュメント単独では断定せず、§8 の実機マトリクスに委ねる。**

## 6. paragraph insert rollback（`canSafelyRollbackParagraphInsert`）の
note 切替時の挙動

`commitPendingParagraphInsert`/`rollbackPendingParagraphInsert` はいずれも、
`editor.undo()` を呼ぶ**前**に `canSafelyRollbackParagraphInsert`
（`resolveAnchorUnit` によるバイト単位比較込みの再解決）を必ず先に通す。

note が切り替わっていた場合、`view.editor.getValue()` は Note B の内容になり、
`resolveAnchorUnit` は Note B に対して `anchor`（Note A のプレースホルダ由来）を
解決しようとする。前述のとおり Note B に偶然バイト単位で一致するプレースホルダ
段落が存在する確率は現実的にゼロに近いため、**通常は解決に失敗し、`canRollback`
は `false` となり、`editor.undo()` は一切呼ばれない**——Note B の undo 履歴は
触れられず、Note A 側のプレースホルダも rollback されないまま残る（安全側の
no-op、5T-10A の既存契約どおり）。

したがって paragraph insert rollback は、note 切替時であっても**既存の安全確認
機構だけで、誤って別ノートの undo 履歴を破壊するリスクを実質的に防げている**——
これは 5T-11D §5 で既に指摘済みの結論と一致する。本チケットの新たな監査でも、
この結論を覆す事実は見つからなかった。

## 7. 複数 Outline Tree leaf がある場合の追加考慮

§2-5 で述べたとおり、`renameState`/`currentFilePath` は leaf ごとに独立している
ため、「leaf Xで rename 中に leaf Yを操作する」こと自体は、leaf Xの rename
セッションに直接影響しない。ただし、次の点は実機確認が必要である:

- leaf Xで rename 中、leaf Yから同じノートに対して**別の編集**（move/indent/
  delete等）が行われた場合、leaf Xの rename の再解決契約（§1-2）がその変更を
  正しく検知して拒否できるか——これは note 切替固有の問題ではなく、既存の
  「rename 開始後に本文が変更された」という一般的な再検証契約の範囲内であり、
  heading/list であっても `headingLevel`/`marker` 等の構造チェックで一定程度
  検知できるが、テキストの純粋な書き換えのみ（構造は不変）であれば検知でき
  ない、という §1-2 の非対称性がここでも同様に当てはまる。

## 8. 実機再現マトリクス（Method Vault 向け）

以下の手順を Method Vault のチェックリストとして提供する（本ドキュメントの
付録として、実際のファイルは `docs/phase5t12_rename_note_leaf_switch_safety_design.md`
と対で Method Vault に配置する）。

| # | 対象 | 編集中操作 | 切替操作 | 観察 |
|---|---|---|---|---|
| 1 | heading | rename 未確定（変更あり） | 別 note tab へ切替 | 旧note/新noteの本文 |
| 2 | list | rename 未確定（変更あり） | 別 note tab へ切替 | 旧note/新noteの本文 |
| 3 | paragraph | rename 未確定（変更あり） | 別 note tab へ切替 | 旧note/新noteの本文 |
| 4 | paragraph insert | auto rename 未確定 | 別 note tab へ切替 | placeholder/rollbackの状態 |
| 5 | heading | rename 未確定 | 別 Tree leaf を activate | renameState/selectionの残留 |
| 6 | list | rename 未確定 | Outline Tree を左右ペイン間で切替 | state残留 |
| 7 | paragraph | rename 未確定 | Tree view を閉じる | 5T-11A回帰なし（参考、既知） |
| 8 | 各対象 | rename 未確定 | 元noteへ戻る後にEnter/Escape | 誤確定の有無 |

各行について、次を記録できるようにする: 元 note に入力が反映されたか／別 note に
誤反映されたか／どちらにも反映されなかったか／rename UI が残ったか／Tree
selection・highlight が崩れたか／placeholder が残ったか／操作を Enter・Escape・
click-outside のどれで終えたか。

**実機確認結果を得るまでは、問題の存在・非存在を断定しない。**

## 9. 設計案の比較

### 案A: note identity を rename snapshot に保持し、commit/cancel 時に
一致しなければ no-op/cancel する

§2-3/§2-4 で確認したとおり、**新しいフィールドを追加する必要すらない**——
`this.currentFilePath`（rename 中は `refresh()` の早期 return により既に
凍結されている）と、commit/cancel 時に取得する `view.file?.path` を比較する
だけで実現できる。`syncFoldToBodyEditor` に既に実装・稼働中の精確に同じパターン
（`if (!view || view.file?.path !== this.currentFilePath) return;`）を、
`commitRename()`/`rollbackPendingParagraphInsert()` の先頭に追加するだけでよい。

- 実装差分が最小（既存フィールド再利用、precedent あり）。
- heading/list/paragraph 全種別に一律適用できる（`kind` による分岐不要）。
- `editor.undo()`/`editor.replaceRange()` のいずれも、不一致なら一切呼ばれ
  なくなるため、undo 履歴への誤操作リスクも完全に塞げる。
- 拒否時の UX（no-op で静かに閉じるか、Notice で理由を伝えるか）は別途判断が
  必要。

### 案B: rename 開始時に source editor/file を固定し、commit/cancel は常に
その source editor だけへ適用する

`beginRename` 時点の `view`（`Editor` インスタンスそのもの）を `renameState` に
保持し、commit/cancel 時は `this.activeMarkdownView.get()` を再取得せず、保持
した `Editor` を直接使う案。

- 「同じノートに戻ってきたが、その間に leaf が一度閉じて再度開かれた」ような
  ケースで、Obsidian 側が新しい `Editor`/`MarkdownView` インスタンスを生成
  していた場合、保持していた古い `Editor` オブジェクトが無効（stale）になって
  いる可能性があり、Obsidian の Editor ライフサイクル（leaf detach 時に
  Editor が破棄されるか、書き込みが安全に失敗するか）を慎重に確認する必要が
  ある——本監査だけでは Obsidian 内部の保証を確定できない。
- 案Aと異なり、「同じファイルパスだが別インスタンスの Editor」というケースを
  案Aより厳格に弾ける可能性がある一方、「同じファイルが単に再度アクティブに
  なっただけ」の正当なケースまで誤って弾いてしまうリスクもある。
- 実装差分は案Aよりやや大きい（`renameState` への新フィールド追加が必須）。

### 案C: note/leaf switch 検知時に rename を即 cancel し、未確定操作を
持ち越さない

`refresh()` の `renameState` 早期 return ガードを変更し、`active-leaf-change`/
`file-open` によるトリガーの場合に限り、ファイルパスが変わっていれば
`cancelRename()`（pendingParagraphInsert なら `rollbackPendingParagraphInsert`
経由）を呼んでから return する案。

- 5T-11D §10 で「別チケット候補」として既に示唆されていた案そのもの。
- 「note が変わった」ことを**能動的に検知して即座に終了させる**ため、案A・B
  よりも早い段階でユーザーにフィードバックできる（rename box が閉じる）。
- ただし `refresh()` の呼び出し元（`editor-change`/`keyup`/`mouseup`等）と
  `active-leaf-change`/`file-open` を区別するロジックが新たに必要——現状
  `refresh()` は呼び出し原因を一切区別しない設計であり、この案はその設計
  方針からの逸脱を伴う。
- paragraph insert のロールバックとの整合性は保てる（`cancelRename()` の
  既存分岐がそのまま使えるため）。
- 案Aと同時に採用しても矛盾しない（案Aは「書き込み直前の最終防御線」、案Cは
  「そもそも早期に閉じる」という、性質の異なる2層の防御）。

### 案D: section/list の再解決契約を paragraph と同水準へ強化する
（content byte match + 曖昧一致拒否の導入）

`renameSection`/`renameListItem` に、paragraph 同様の「元テキストとのバイト単位
比較」と「ドキュメント全体での曖昧一致チェック」を追加する案。

- 効果は最も根本的——note 切替の有無に関わらず、「rename 開始後に対象が
  変わった」というケース全般（同一ノート内での別編集も含む）を一律で防げる。
- ただし、これは「rename session lifecycle」（本チケット・5T-11Dの主題）では
  なく「rename の再解決契約そのものの強度」に関する、**別種の改善**である
  （5T-11D §4-4 で既に同じ理由で対象外に切り分け済み）。
- heading の場合、「見出しテキストが変わった後の rename」を意図的に許容したい
  ケース（例: 見出しの一部だけ手動編集してから Tree の rename でさらに直す、
  という自然な操作列）まで拒否してしまう可能性があり、single-line snapshot
  の性質上、原文比較の設計が paragraph ほど単純ではない（見出し全体か、
  テキスト部分のみか、という設計判断が別途必要）。
- 今回の最小修正の範囲を明確に超える。

### 比較表

| 観点 | 案A | 案B | 案C | 案D |
|---|---|---|---|---|
| 別noteへの誤更新防止 | 高 | 高 | 中〜高（検知タイミング次第） | 最高 |
| 元noteへの正しい確定 | 保たれる | 保たれる（Editor有効なら） | 保たれる（早期closeのため確定自体が減る） | 保たれる |
| paragraph insert rollbackとの整合性 | 高（同一パターンを追加するだけ） | 中（Editor有効性の確認が別途必要） | 高（既存cancelRename経路を再利用） | 高だが変更範囲が別物 |
| heading/list/paragraphの共通化 | 高（kind分岐不要） | 高 | 高 | 中（heading側の設計判断が別途必要） |
| Undo/Redoへの影響 | なし（不一致なら一切undo/replaceRangeを呼ばない） | なし | なし（早期cancelのためundo/replaceRange自体が起きない） | なし |
| 実装差分 | 最小（既存フィールド再利用、precedentあり） | 中（renameStateへEditor参照追加） | 中（refresh()のトリガー区別ロジック新設） | 大（再解決関数の再設計） |
| Obsidian lifecycle依存 | 低（file.pathの文字列比較のみ） | 高（Editorインスタンスの有効性に依存） | 低〜中（active-leaf-change/file-openの発火順序に依存） | 低 |
| テスト可能性 | 高（既存syncFoldToBodyEditorと同型、静的検査可能） | 中 | 中（トリガー区別のテストが追加で必要） | 中〜高（純粋関数の追加テストは容易だが範囲が広い） |
| 実機確認の容易さ | 高（file.path比較のみで挙動が単純） | 中 | 中〜低（early-cancelのタイミングが体感しにくい可能性） | 低（影響範囲が広く回帰確認が重い） |
| 推奨可否 | ◎ | △（Editor lifecycle未確認のため保留） | ○（案Aと併用する形での将来拡張候補） | △（別チケット候補） |

## 10. 推奨案と最小実装境界

**案Aを推奨する。** 理由:

1. 新しいフィールドを一切追加せず、`this.currentFilePath`（rename 中は既に
   `refresh()` のガードにより凍結されている）を再利用できる、最小差分の実装で
   ある。
2. `syncFoldToBodyEditor` という、同じファイル内で既に稼働している precedent
   と完全に同型のパターンであり、コードレビュー・保守の観点で違和感がない。
3. heading/list/paragraph のいずれにも同一ロジックで適用でき、`kind` による
   分岐が不要。
4. `editor.replaceRange()`/`editor.undo()` のいずれも、note 不一致の場合は
   一切呼ばれなくなるため、案が対象とする「誤って別ノートを書き換える／別
   ノートの undo 履歴を破壊する」というリスクの根本を、書き込み直前で
   確実に塞げる。

**最小実装境界（次フェーズでの実装時の指針、本チケットでは実装しない）**:

- `commitRename()` の先頭、既存の `renameState`/`activeMarkdownView` 取得の
  直後に、`if (!view || view.file?.path !== this.currentFilePath) { ...no-op
  処理... ; return; }` を追加する。
- `rollbackPendingParagraphInsert(anchor)` の先頭にも同様のチェックを追加する
  （`commitPendingParagraphInsert` は `commitRename()` からのみ呼ばれるため、
  `commitRename()` 側のチェックで自動的にカバーされる）。
- 拒否時の挙動（無音の no-op か、Notice で理由を通知するか）は、既存の
  `NOOP_MESSAGES`/`reason.*` の枠組みに新しい reason（例:
  `"note-switched"`）を1つ追加する形が、既存の拒否理由通知の一貫性と合致する
  ——ただし具体的な文言・通知の要否は利用者判断事項とする（§12）。
- `cancelRename()` 自体（非 pendingParagraphInsert 経路）は本文に一切触れない
  ため、変更不要。
- **案Cを、案Aとは独立した将来の拡張候補として残す**——案Aは「書き込み直前の
  最終防御線」、案Cは「note が変わったら能動的に早く閉じる」という、UXの
  異なる別レイヤーの改善であり、互いに排他的ではない。

## 11. Undo/Redo・rollback への影響（設計案の帰結）

案Aを適用した場合、note 不一致時は `editor.replaceRange()`/`editor.undo()`
いずれも一切呼ばれなくなるため、Undo/Redo 履歴への影響はゼロ（現状「新しい
Undo エントリを増やさない」設計そのままで、単に「書き込みを試みる前に諦める」
ケースが1つ追加されるだけ）。paragraph insert rollback
（`canSafelyRollbackParagraphInsert`）は、§6 で述べたとおり、案Aを適用しなくても
既存の安全確認だけで十分に守られていることを確認済みであり、案Aは、その安全性を
「content-changed」判定より前の、より早い段階（そもそも別ノートかどうか）で
弾くことで、判定コストをわずかに下げる副次効果を持つのみである。

## 12. 利用者に必要な判断事項（実装フェーズに向けて、本ドキュメントでは確定しない）

1. 案A採用を前提としてよいか、それとも実機マトリクス（§8）の結果を待ってから
   最終決定するか。
2. 拒否時（note 不一致で no-op になった場合）に Notice で利用者へ通知すべきか、
   それとも無音の no-op でよいか。
3. 案C（note/leaf switch 検知時の即時 cancel）を、案Aと同じチケットで一緒に
   実装するか、完全に別チケットへ切り分けるか。
4. 案D（section/list への content byte match 導入）は、優先度をどう位置づける
   か——本チケットでは対象外としたが、5T-11D から2回連続で「別チケット候補」と
   して先送りされている。
5. §8 の実機マトリクスのうち、どの項目までを次の実機確認ラウンドで優先的に
   検証すべきか（全8項目一度に依頼するか、リスクが高いと判断した項目
   （#1〜#4）を先行させるか）。

## 13. `parseDocument.ts`・`styles.css`・`edit/listBodyRange.ts`・
5T-11A の `onClose()` 実装 未変更の確認

本チケットは docs-only であり、コード変更を一切行っていない。`git diff --stat` で
`src/parser/parseDocument.ts`・`styles.css`・`src/edit/listBodyRange.ts` を含む
**すべてのソースファイルに diff がないこと**、および `src/view/OutlineTreeView.ts`
の `onClose()`（5T-11A実装）・`commitRename()`・`cancelRename()`・
`rollbackPendingParagraphInsert()`・`commitPendingParagraphInsert()` の実装が
一切変更されていないことを確認済み（本ドキュメント自体の追加のみが差分）。

## 14. 実機検証結果と結論（Phase 5T-12A、2026-08-22）

Phase 5T-12A の note identity guard 実装後、§8 の実機再現マトリクスに基づき
実機検証を行った。結果は以下のとおりである。

### 14-1. サマリ

| # | 対象・操作 | 結果 |
|---|---|---|
| 1〜3 | heading/list/paragraph rename 中に本文の別 note タブへ切替 | 元noteへ正しく確定、別noteへの誤反映なし |
| 4 | paragraph insert の auto rename 中に本文の別 note タブへ切替 | プレースホルダは元noteで取り消された（rollback成功）、別noteへの変化なし |
| 5〜6 | 別 Outline Tree leaf のアクティブ化／左右ペイン間切替 | **現行仕様では再現不可**（後述14-3） |
| 7 | Outline Tree 自身のタブをクリックして閉じる | 5T-11Aで確認済みのとおり、クリック時点で確定（参考再確認） |
| 8 | 本文エディタへカーソルを移す（クリックしてフォーカスを移す） | カーソルを移した瞬間に確定される |

### 14-2. blur 先行効果は「タブ切替」に限らず、フォーカスを失わせる操作全般に及ぶ

5T-11A §13 では「Outline Tree 自身のタブをクリックして閉じる」場合に限って
blur 先行効果を確認していたが、今回の実機検証により、次の操作でも同様に
blur が先に rename を確定/破棄することが確認された。

- 本文エディタの**別ノートタブ**へのクリック切替（項目1〜4）
- Outline Tree 自身のタブのクリック（項目7、5T-11Aの再確認）
- 本文エディタ内へカーソルを移すクリック（項目8）

つまり§5で「未検証」としていた「本文タブ切替でもblur先行効果が働くか」という
問いには、**少なくともマウスクリックによる操作全般について、「働く」という
実機確認済みの結論**が得られた。マウスクリックで rename の `<textarea>` から
フォーカスが外れる操作は、その対象が何であれ（別note・Outline Tree自身の
タブ・本文エディタ本体のいずれでも）、同期的に blur を発火させ、blur
ハンドラの commit/cancel が、クリックの本来の目的（タブ切替・タブを閉じる・
カーソル移動）が実際に処理されるより先に完了する、という一貫した挙動である
と結論づけてよい。

### 14-3. 複数 Outline Tree leaf のシナリオ（§7、項目5〜6）は現行仕様では成立しない

`main.ts#activateOutlineTreeView()`（リボンアイコン・コマンド双方の唯一の
入口）は次の実装になっている。

```ts
const existing = workspace.getLeavesOfType(OUTLINE_TREE_VIEW_TYPE);
if (existing.length > 0) {
  await workspace.revealLeaf(existing[0]);
  return;
}
```

既存の Outline Tree leaf が1つでもあれば、新規に leaf を作らず必ずそれを
再利用する（`revealLeaf` するのみ）。つまり本プラグイン自身の正規の開き方
（リボン・コマンド）では、2つ目の Outline Tree leaf は原理的に作られない
——事実上のシングルトンである。利用者の実機報告（「現在の仕様では左右両側に
ツリーリーフを開くことはできない」）はこの実装と整合する。

（Obsidian 標準の「タブを複製」等、本プラグインの制御が及ばない一般的な
leaf 操作を経由すれば理論上は同種の view が2つ存在し得るが、これは本プラグイン
固有の経路ではなく、5T-12D §7 が前提としていたシナリオの実機確認手段では
ない。§7自体の記述——leafごとに`renameState`/`currentFilePath`が独立している
という事実——は静的なコード監査として引き続き有効だが、実機による具体的な
再現確認は現行仕様の下では行えない。）

### 14-4. §4のリスクシナリオへの結論

§4-1で示したheading crossnote誤上書きシナリオ（本文タブ切替を経由するケース）
は、実機検証の結果、**発生しなかった**。§4-2で推測していた「blur が
active-leaf-change より先に処理されるなら、リスクは実際には成立しにくい」
という仮説は、マウスクリックによるタブ切替という主要な操作経路について
実機で裏付けられたことになる。

### 14-5. note identity guard（Phase 5T-12A）の実質的な位置づけ

以上の実機結果を踏まえると、Phase 5T-12A で実装した note identity guard は、
**実機で観測された不具合を修正するものではなく**、次の性質を持つ安全網
（defense-in-depth）として位置づけるのが正確である。

- blur 先行効果は Obsidian のイベント発火順序という、本プラグインが制御
  していない実装詳細に依存する。これは公式にドキュメント化された API
  契約ではなく、将来の Obsidian のバージョンアップで変わり得る前提である。
- 今回未検証のまま残っている経路（キーボードショートカット・コマンド
  パレット経由のノート切替、textareaからフォーカスが外れないままの
  切替）で blur が発火しない場合、guard が実際の防御として機能する
  最後の砦になる。
- 複数 Outline Tree leaf のシナリオ（§7・§14-3）は現行仕様では再現不可
  だが、将来的に仕様が変わり複数leafが解禁された場合に備えた保険にも
  なる。

したがって、guard の実装自体（Phase 5T-12A、コミット`42da5c4`）は維持を
推奨する——実機で頻発する問題ではないと分かった今も、コストの低い
（新規フィールド不要、既存パターンの踏襲）安全網として妥当である。

### 14-6. コマンドパレット・キーボードショートカット経路の扱い（実機確認による整理）

§14-2で確認したとおり、rename中にフォーカスを失わせる操作は、その対象が
何であれ（別note・Outline Tree自身のタブ・本文エディタ・コマンドパレット
のいずれでも）blurを発火させ、既存のblurハンドラが先に確定/破棄を完了する。
これは、**コマンドパレットを開く操作自体もフォーカス喪失を伴うため**、
「コマンドパレット経由でノートを切り替える」という経路を独立に検証する
ことができない、という実機報告により確認された——コマンドパレットを開いた
時点で既にrenameは確定/破棄されており、その後パレットから何を選んでも
rename とは無関係の操作になる。したがって、この経路は「未検証」ではなく
「原理的に他の経路（§14-2）と同じ結論に帰着する、独立には検証しようが
ない経路」として扱うのが正確である。

キーボードショートカットによるノート切替（例: 次のタブへ移動、等）は、
今回の実機環境ではそのようなショートカットが設定されておらず確認できな
かった。これは本チケットの不備ではなく、利用者の環境固有の設定状況に
よるものである。もし将来、そのようなショートカットを設定している環境で
確認する機会があれば、それが「textareaからフォーカスが外れないままの
ノート切替」を検証できる唯一の残された経路となる。

### 14-7. 結論（改訂）

実機で検証可能な範囲においては、rename中にフォーカスを失わせるあらゆる
操作（本文タブ切替・Outline Tree自身のタブクリック・本文エディタへの
カーソル移動・コマンドパレットを開く操作を含む）が、一貫して既存の blur
ハンドラによる先行確定/破棄で処理されることが確認された。複数 Outline
Tree leaf のシナリオは現行仕様では再現不可（§14-3）。残る唯一の未検証
経路（キーボードショートカットによるノート切替）は、今回の実機環境の
設定に依存し確認できなかったが、§14-5で述べたとおり note identity guard
はその経路も含めた安全網として既に機能する設計であるため、この経路が
未検証であること自体が実装の妥当性を損なうものではない。5T-12D／5T-12A
を通じた実機検証は、これをもって完了として扱ってよいと判断する。
