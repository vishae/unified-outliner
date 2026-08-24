# Phase 5T-13D: Section / List rename の再解決契約強化を設計監査する（docs-only）

対象: Outline Tree の heading（section）／list rename が、**同一ノート内**で
commit 時に再解決する対象を取り違える可能性についての設計監査である。
Phase 5T-12D／5T-12A が扱った「rename 未確定のまま別ノートへ切り替わる」と
いう cross-note の懸念とは独立の軸であり、5T-12A の note identity guard
（`evaluateRenameNoteIdentity`／`currentFilePath`）が正しく機能して commit
対象が確かに rename を開始したのと同じノートであると確定した**その後**に、
なお「同じノートの中の、意図した見出し／list item と異なる別のノードに
commit してしまう」危険が残っていないかを検証することが本監査の目的である。

## 0. 目的

heading（section）rename と list rename の commit 時再解決契約が、rename
開始時に捕捉したスナップショットと commit 時に再 parse したドキュメントの
間で、意図した対象を安全に一意特定できているかを監査する。とくに、
paragraph の再解決契約（`originalText` の byte-for-byte 比較、
parentId/depth 構造照合、曖昧一致の拒否）と比較したとき、heading/list の
契約に構造的な弱点がないかを明らかにし、その弱点を埋める最小の設計案を
提示することが目的である。本チケットは**設計監査のみ**であり、実装は
一切行わない。

## 1. 前提

### 1-1 対象範囲

- section（heading）rename と list rename の、**同一ノート内**での commit
  時再解決契約のみを対象とする。
- 5T-12A が導入した cross-note（ノート切替）に対する防御は、本監査の対象
  外として現状のまま維持する。5T-12A の guard は「commit しようとしている
  Editor が rename 開始時と同じノートのものか」を検証するものであり、本
  監査が扱う「同じノートの中で、正しいノードに commit しているか」とは
  完全に直交する別の防御レイヤーである。

### 1-2 維持すべき既存契約（変更しない前提）

- **Phase 5T-12A**: `src/edit/renameNoteIdentityGuard.ts` の
  `evaluateRenameNoteIdentity`、および `OutlineTreeView.ts` の
  `commitRename()`／`commitPendingParagraphInsert()`／
  `rollbackPendingParagraphInsert()` に組み込まれた note identity guard。
- **Phase 5T-11A**: `onClose()` の teardown（Tree タブを閉じる際の
  rename 破棄）。
- blur／Enter／Escape の基本動作（2026-08-11 fix・5T-11A follow-up を含む）。
- paragraph 側の全セマンティクス（`applyParagraphEdit`／
  `resolveAnchorUnit`／D&D／insert-then-rename の collapse-Undo 等）は
  一切変更しない。**そのまま section/list へ流用できる最小原則を抽出する
  対象**としてのみ参照する。
- 触れてはならないファイル: `src/parser/parseDocument.ts`、
  `styles.css`、`src/edit/listBodyRange.ts`。ただし、これらが既に export
  している純粋関数を**import して再利用する**ことは、5T-12A が
  `contentColumnOf` を `insertBlock.ts` から import して使っているのと
  同じ意味で「変更」には当たらないとみなす。

### 1-3 実装は禁止

本チケットは docs-only である。`src/`／`tests/` への変更、および build
成果物の生成は一切行わない。§5 で示す「最小実装候補」は、あくまで**次
フェーズ（5T-13A 相当）の実装チケットが着手できる粒度まで設計を詰めた
提案**であり、本チケット自身では一切コードを書かない。

### 1-4 開始時点のベースライン

`git status --short` が空であることを確認したうえで着手した。
`git log --oneline` の先頭は `2a95e67`（Phase 5T-12A docs: close out the
command-palette/keyboard-shortcut question）であり、これはチケット本文が
挙げる基準コミット群（`9b5cec1`／`42da5c4`／`2f608b4`／`e17f054`／
`6d93d82`／`96f649d`／`29831fd`／`32d9f8b`／`587ec91`）のうち直近
`9b5cec1` からさらに1コミット進んだ状態であるが、これは同じ 5T-12A の
docs-only follow-up が積まれただけであり、対象コードには影響しない。

## 2. 監査対象コードの現状確認

### 2-1 section/list の再解決契約（`src/edit/renameBlock.ts`）

`beginRename()`（`OutlineTreeView.ts`）が rename 開始時に捕捉する
スナップショットは次のとおりである。

```ts
export interface SectionRenameSnapshot {
  /** node.headingLevel, captured when the rename UI opened. */
  headingLevel: number;
}

export interface ListRenameSnapshot {
  /** node.listMarker, captured when the rename UI opened. */
  marker: string;
  /** node.indentColumns, captured when the rename UI opened. */
  indentColumns: number;
  /** contentColumnOf(doc, node), captured when the rename UI opened. */
  contentColumn: number;
}
```

commit 時（`renameSection`／`renameListItem`）の再解決契約は、いずれも
次の3段階のみである。

1. `doc.nodes.get(nodeId)` で id からノードを再解決する（見つからなければ
   `"resolve-failed"`）。
2. `isSectionNode`／`isListNode` で種別が変わっていないか確認する
   （変わっていれば `"type-changed"`）。
3. スナップショットの構造フィールド（heading は `headingLevel` のみ、
   list は `marker`／`indentColumns`／`contentColumn`）が現在のノードと
   一致するか確認する（不一致なら `"heading-level-changed"`／
   `"list-syntax-changed"`）。

**この3段階には、対象ノードの見出しテキストや list item 本文テキストを
比較する処理が一切存在しない**。id が（偶然にせよ）再解決に成功し、かつ
構造フィールドが（偶然にせよ）一致してしまえば、rename 開始時に見ていた
テキストとまったく異なるテキストを持つノードへも無条件に commit する。

### 2-2 paragraph の再解決契約（比較対象）

**`src/edit/paragraphPartialEdit.ts#applyParagraphEdit`**（Partial Edit
Pane からの Apply）の契約は3段階である。

1. id 一致（`anchor.complexBlockId` と一致し、かつ `editability ===
   "supported"` であること。不一致は `"resolve-failed"`）。
2. 構造一致（`parentId`／`complexBlockDepth` が一致すること。不一致は
   `"identity-changed"`）。
3. **byte-for-byte のテキスト一致**（`doc.lines.slice(...).join("\n")`
   が `anchor.originalText` と一致すること。不一致は `"content-changed"`）。

**`src/edit/paragraphTreeMove.ts#resolveAnchorUnit`**（Tree の
「上へ移動／下へ移動」・D&D 共通の再解決）は、上の3段階に加えて第4段階
を持つ、より厳格な契約である。

1. id 一致（`resolve-failed`）。
2. 構造一致（`identity-changed`）。
3. byte-for-byte テキスト一致（`content-changed`）。
4. **文書全体を再走査し、`parentId`／`depth`／`originalText` の三つ組が
   完全に一致する候補が id 一致した1件を含めて2件以上存在しないかを確認
   する。2件以上存在すれば `"ambiguous-match"` として commit 全体を
   拒否する**。id 番号は再 parse ごとにローカルに振り直されるため、
   構造とテキストが完全に同じ「兄弟」が2つ以上あると、id が示す候補が
   ユーザーの意図した方だという保証がそもそも成立しない——というのが
   この第4段階の設計意図である（同モジュールの doc comment に明記）。

### 2-3 比較表（再解決契約の8軸）

| 軸 | section rename | list rename | paragraph（applyParagraphEdit） | paragraph（resolveAnchorUnit） |
|---|---|---|---|---|
| id によるスロット一次特定 | ○（`sec-N`） | ○（`li-N`） | ○（scan-local id） | ○（scan-local id） |
| 種別（kind）一致確認 | ○ | ○ | ○（`editability==="supported"`） | ○ |
| 構造フィールド一致確認 | ○（`headingLevel`） | ○（`marker`/`indentColumns`/`contentColumn`） | ○（`parentId`/`depth`） | ○（`parentId`/`depth`） |
| **本文テキストの byte-for-byte 一致確認** | **×（存在しない）** | **×（存在しない）** | ○（`originalText`） | ○（`originalText`） |
| 文書全体での曖昧候補拒否 | × | × | ×（Apply 単体では未実装） | ○（`ambiguous-match`） |
| 複数行本文のサポート | 対象外（見出しは単一行） | ×（marker 行のみ比較、継続行は無視） | ○（`newText` の複数行を許容） | ○（同上） |
| 空白のみの変更の検出 | ×（`headingText` は trim 済みなので空白のみの差は検出不能） | ×（本文テキストを一切見ないため検出不能） | ○（byte-for-byte なので空白差も検出） | ○ |
| 直前挿入によるノード出現順シフトの検出 | ×（id 一致とスロット一致だけでは検出できない） | ×（同左） | △（byte 一致で多くのケースは弾けるが、内容が偶然一致すれば通る） | ○（ambiguous-match が最後の砦） |

この表からわかるとおり、heading/list の再解決契約は、paragraph が持つ
5段階のうち最初の2段階（id 一次特定・構造一致）しか持たない。paragraph
が「テキストが変わっていないこと」「同じ形の兄弟が複数ないこと」まで
確認しているのに対し、heading/list はいずれも確認していない。

### 2-4 id 生成の非安定性（`src/parser/parseDocument.ts`）

```ts
let secSeq = 0;
...
id: `sec-${secSeq++}`,
...
headingText: m[2].trim(),
```

```ts
let liSeq = 0;
...
id: `li-${liSeq++}`,
```

`secSeq`／`liSeq` は `parseDocument()` の呼び出しごとに 0 から始まる
**単純な出現順カウンタ**である。つまり `sec-3`／`li-3` といった id は
「1回の parse の中でドキュメントの上から3番目に出現した section/list
item」という意味しか持たず、次の parse で同じ id が同じノードを指す保証
は一切ない。rename 開始時の parse と commit 時の再 parse の間に、対象
より前の位置へ同種のノードが1つでも挿入・削除されれば、以降の全ノードの
連番がずれ、rename 開始時に捕捉した id は commit 時には**別のノード**を
指すことになる——これが本チケットのリスクシナリオ§3の共通前提である。

### 2-5 `SectionBlockNode.headingText` と `ListBlockNode` の非対称性

`src/model/block.ts` の `SectionBlockNode` は、`parseDocument.ts` により
**parse のたびに新規計算される** `headingText: string`（"#" の後を trim
した文字列）フィールドをすでに持っている。これは、heading の
content-match チェックを追加するにあたって、新しいパーサロジックを一切
必要としないことを意味する——rename 開始時の `section.headingText` を
スナップショットへ保存し、commit 時に再解決したノードの現在の
`headingText` と比較するだけで済む。ただし `headingText` は
**trim 済み**であるため、末尾・先頭の空白のみの変更は検出できないという
限界がある。

一方 `ListBlockNode` にはこれに相当するフィールドが存在しない。持って
いるのは `listMarker`／`indentColumns`／`unsafeIndent`／`ordered` のみで
ある。ただし `src/edit/listBodyRange.ts`（変更禁止・import のみ許容）が
すでに次を export している。

```ts
export function collectListItemBodyLines(
  doc: ParsedDocument,
  itemId: string
): ListItemBodyLinesOutcome; // { ok: true; lines: string[] } | { ok: false; lines: []; reason }
```

`collectListItemBodyLines` は、指定した list item 自身が所有する
**生の行**（marker 行＋自身が所有する継続行、ネストした子 item の行は
除く）を返す——これはまさに `move/relocateListSubtree.ts` が1ブロックと
して移動させる単位と同一であり、`renameBlock.ts` が `insertBlock.ts` から
`contentColumnOf` を import しているのと全く同じパターンで、list rename
の content-match チェックがそのまま再利用できる候補である
（`formatListItemBodyLines` の整形済みテキストではなく、この raw な
`lines` を比較対象とすべきである——整形は marker 除去・空行除去を行う
非可逆処理であり、`applyParagraphEdit` の byte-for-byte 比較の精神に
反する）。

### 2-6 `commitRename()` の現状構造（5T-12A 適用後）

`OutlineTreeView.ts#commitRename()` の実行順序は次のとおりである
（5T-12A で追加された note identity guard を含む）。

1. `!state` なら即 return。
2. `pendingParagraphInsert` かつ `insertOrigin` があれば
   `commitPendingParagraphInsert()` へ委譲して return（paragraph 専用
   経路、本監査の対象外）。
3. `activeMarkdownView.get()` で `view` を取得、`null` なら
   `"reason.no-active-editor"` を notify して return。
4. **5T-12A note identity guard**:
   `evaluateRenameNoteIdentity(this.currentFilePath, view.file?.path)`
   が `allowed: false` なら `abortRenameForNoteSwitch()` を呼んで
   return（cross-note 防御。ここまでで「ノートは正しい」ことが確定する）。
5. `editor.listSelections().length > 1` なら
   `"notice.multipleCursors"` を notify して return。
6. `parseDocument(editor.getValue())` で**現在のノートを再 parse**。
7. `state.kind` に応じて `renameSection`／`renameListItem`／
   `applyParagraphEdit` のいずれかを呼ぶ——**本監査が強化を検討する
   のはこのステップである**。
8. `applyLineEditOutcome(...)` で実際の書き込みを行う。

すなわち、本監査が提案する content-match／ambiguous-match チェックは、
**ステップ4（5T-12A guard）の後、ステップ7（`renameSection`／
`renameListItem` の呼び出し）の内部**に位置づけるのが自然である。これは
paragraph 側で `applyParagraphEdit`／`resolveAnchorUnit` 自身が
チェックを内包し、呼び出し元の `commitRename()` は関知しないのと
まったく同じ配置方針であり、`commitRename()` 自体への変更は「新しい
スナップショット型を渡す」以上のものを必要としない設計にできる見込みが
高い。5T-12A の guard（cross-note）と、本監査が扱う same-note
content-match は、判定対象（ノート単位 vs. ノード単位）も実装場所
（`OutlineTreeView.ts` vs. `renameBlock.ts`）も異なる、**完全に独立した
2層の防御**として共存できる。

## 3. リスクシナリオ（12項目）

各シナリオについて、(a) 現状での誤 commit 可能性、(b) 誤爆時の結果が
no-op か実際の誤書き込みか、(c) 誤爆の直接原因、(d) content-match が
あれば防げるか、(e) ambiguous-match reject があれば防げるか、(f) 追加の
スナップショット情報が必要か、を検討する。

### heading（section）系

**S1. 直前への同レベル見出し挿入によるスロットずれ**
rename 開始後、対象見出しより前の位置に同じ見出しレベルの新しい見出しが
挿入されると、`sec-N` の連番が1つずつ後ろへずれ、commit 時に元の id
番号のスロットには**別の見出し**が座っている可能性がある。
(a) あり。(b) `headingLevel` が偶然一致すれば誤書き込み、一致しなければ
`"heading-level-changed"` で安全に拒否される——**つまり現状でも「レベルが
違えば」半分は守られているが、同レベルなら無条件に通る**。
(c) id ベースの一次特定に構造フィールドしか続かないため。
(d) 防げる（`headingText` が一致しないので `content-changed` になる）。
(e) 不要（id ずれによる誤爆であり複製ではない）。(f) `originalText`
相当のフィールドが必要。

**S2. 対象見出しの削除によるスロット繰り上がり**
rename 対象の見出しが（別操作で）削除され、直後の見出しが同じ id
スロットに繰り上がる。(a) あり（S1 と同じ機序）。(b)〜(f) S1 と同様。

**S3. 別セクションへの移動中に、同内容の見出しが新規追加される**
対象見出しが別の親セクション配下へ移動する編集が別途行われ、かつ
元の位置付近に同じテキストの見出しが新規追加された場合。
(a) あり。(b) 誤書き込み——ただし新規追加された見出しは"意図しない
標的"であり、byte 一致確認があっても**別の理由**（後述 S4/S12 の曖昧性）
で防げないケースがある。(c) 構造フィールドのみの一致判定。
(d) 部分的（対象自体の `headingText` が変わっていなければ防げない場合
もある——このケースは実質的に S4 の重複見出し問題と同根）。
(e) 有効（ambiguous-match により、同じ `headingLevel`＋`headingText`
の候補が複数あれば安全側拒否できる）。(f) 曖昧性検出には親子関係の
フィンガープリントが要る可能性がある（§4 案C参照）。

**S4. 同名見出しの重複**
同じテキスト・同じレベルの見出しが文書中に複数存在する状態で、その
うちの1つを rename している最中に、他の同名見出しの並び順や個数が
変わる。(a) 現状は id 一次特定に依存しているため、id が偶然別の
同名見出しを指しても構造フィールドは当然一致し、`content-changed`
すら発生しない（テキストも同じだから）。(b) 誤書き込みだが、**結果的に
「別の、しかし見た目が同じ見出し」が書き換わる**という、他のシナリオ
より発見しにくい誤爆である。(c) id の非安定性＋テキストの偶然一致。
(d) 防げない（内容が同じなので content-match は素通りする）。
(e) 有効（ambiguous-match が本命の対策）。(f) 不要（ambiguous-match の
みで十分）。

### list 系

**S5. 直前への同条件 list item 挿入**
rename 開始後、同じ `marker`／`indentColumns`／`contentColumn` を持つ
新規 list item が対象より前に挿入される。(a)〜(f) は S1 と同型
（heading の `headingLevel` を list の3フィールド組に置き換えたもの）。
content-match（`collectListItemBodyLines` の raw lines 比較）で防げる。

**S6. 対象 item の削除によるスロット繰り上がり**
S2 の list 版。同様に content-match で防げる。

**S7. 対象 item の別リストへの移動中に、元位置へ別 item が挿入される**
D&D／move コマンドとの相互作用シナリオ。移動先で anchor が再解決される
のは `paragraphTreeMove.ts` 側の話であり、**list rename 自体はこの
移動 API を使わない**（`renameListItem` は id 解決のみ）ため、rename
中に item が move されると `doc.nodes.get(nodeId)` が別の item を返す
可能性がある。(a) あり。(d) 防げる（本文テキストが異なれば
content-changed）。(e) 有効（同内容の item が move 前後で複数化する
ケースをカバー）。(f) 不要。

**S8. 内容が重複する list item**
同じ marker／indent／本文テキストを持つ list item が複数存在する状態で
rename する。S4 の list 版。content-match は素通りするため
ambiguous-match が本命。

### 共通シナリオ

**S9. rename 入力中に外部操作で対象テキストのみが変更される**
（構造は不変）。ユーザー自身が本文エディタ側で対象見出し／item の
テキストを直接編集した場合など。(a) あり——現状は構造フィールドが
一致する限り、rename 開始時に見ていた古いテキストで問答無用に
上書きしてしまう（**ユーザーの直接編集を rename が握りつぶす**、
paragraph の `"content-changed"` が守っている典型ケース）。
(d) 防げる。(e) 無関係。(f) `originalText` 相当が必要（S1 と同じ
フィールドで足りる）。

**S10. 他コマンド／プラグインによる文書全体の再フォーマット**
改行コード変換、末尾空白の一括除去など。(a) 変換の性質次第。
`headingText`／`collectListItemBodyLines` は trim 済み比較になる
箇所があるため、末尾空白除去程度なら誤検出（false reject）は
起きにくいが、インデント幅の一括変換は `indentColumns` 不一致として
確実に安全側拒否される（現状の構造フィールド一致判定がすでに
カバー済み）。(d)/(e) 追加の防御は主に取りこぼしを減らす方向。
(f) 不要。

**S11. stale id が別の同種ノードに再利用され、構造フィールドまで
偶然一致する**
S1/S5 の一般化。id とスロットのみに依存する現状契約が原理的に持つ
最大の弱点。(d) 有効、(e) 有効（両方を組み合わせて初めて S4/S8 まで
含めて閉じる）。

**S12. resolver が複数候補から一意に絞り込めない**
現状の `renameSection`／`renameListItem` には「複数候補」という概念
自体が存在しない（id 一致した1件を無条件に採用するのみ）。
paragraph 側の `resolveAnchorUnit` が持つ「id 一致は一次フィルタに
過ぎず、最終的には文書全体を再走査して曖昧性を確認する」という設計
思想が heading/list には一切移植されていない、という事実そのものが
本シナリオである。§4/§5 の設計案の主眼はこのギャップを埋めることに
ある。

## 4. 設計案比較

### 案A: 全文一致必須化

rename 開始時に対象の「現在のテキスト」をスナップショットへ追加し、
commit 時に再解決したノードの現在のテキストと byte-for-byte で比較する。
heading は `headingText`、list は `collectListItemBodyLines` の raw
`lines`（`join("\n")` して比較、または配列同士を比較）を用いる。
paragraph の `applyParagraphEdit` と同じ第3段階を heading/list へ
そのまま移植する案である。

### 案B: 案A + 曖昧候補の安全側拒否

案Aに加え、`resolveAnchorUnit` の第4段階と同じ「文書全体を再走査し、
構造フィールド＋テキストの組が完全一致する候補が2件以上あれば
`ambiguous-match` として拒否する」処理を heading/list にも追加する。
S4／S8（重複見出し・重複 list item）に対する唯一の実効的な対策。

### 案C: 案A + 親／祖先パスの指紋

案Aに加え、対象ノードの親からルートまでの祖先チェーン（見出しレベルの
連なり、あるいは祖先 id の並び）をスナップショットへ追加し、commit 時
にも一致を要求する。同名見出しが**異なる親セクションの下に**複数存在する
ケース（S3 のような「移動＋複製」の組み合わせ）を、案Bの
ambiguous-match よりも早い段階で、かつ誤検出（false reject）少なく
絞り込める可能性がある。ただし、祖先パス自体が rename 中に変わりうる
編集（親セクションの見出しレベル変更や祖先の並べ替え）に対して脆く
（fragility）、意図した対象そのものが動いていないのに祖先の都合で
`content-changed` 相当の拒否が増える恐れがある——「本来通したい正当な
commit まで弾いてしまう」false reject 増加のリスクと、絞り込み精度の
向上とのトレードオフになる。

### 案D: 行番号／ソース範囲スナップショット比較

対象ノードの `range.startLine`（あるいは `rangeStart`／`rangeEnd`）を
スナップショットへ追加し、commit 時にも一致を要求する。paragraph 側は
`ParagraphMoveAnchor.rangeStart`／`rangeEnd` を持つが、**識別の決め手
としては使っておらず、あくまで D&D のドロップ判定などの補助情報**で
あることに注意が必要である。行番号「だけ」を再解決の必須条件にするのは
危険である——rename 中に対象より前の行に1行でも挿入・削除があれば、
対象ノード自体は正しく存在し続けていても行番号は必ずずれるため、
正当な commit まで一律に拒否してしまう（false reject が過剰になる）。
行番号は他の条件（id・構造・テキスト一致）と**併用する副次的なヒント**
としてのみ意味を持ち、単独の判定基準には採用しない。

### 11軸比較表

| 軸 | 案A（全文一致） | 案B（A＋曖昧拒否） | 案C（A＋祖先指紋） | 案D（行番号併用） |
|---|---|---|---|---|
| 1. 同一ノート内の誤書き込み防止力（S1/S2/S5/S6/S7/S9/S11） | ○ | ○ | ○ | △（他条件併用時のみ） |
| 2. 重複ノード（S4/S8）への対応力 | ×（内容が同じなので通ってしまう） | ○（本命の対策） | △（祖先も同じなら通ってしまう） | △（行番号が異なれば弾けるが偶然一致もありうる） |
| 3. 正当な commit の保持（false reject の少なさ） | ○（テキスト変更のない編集は通す） | ○（案Aと同等、曖昧時のみ拒否） | △（祖先変化に弱く false reject が増えうる） | ×（挿入/削除のたび行番号がずれ false reject が増えやすい） |
| 4. 外部編集／sync 安全性 | ○ | ○ | △ | × |
| 5. heading/list/paragraph の契約共通化 | ○（同じ形の第3段階） | ○（同じ形の第4段階） | △（祖先パスの定義が heading/list で非対称） | △ |
| 6. 複数行本文（list の継続行）のサポート | ○（`collectListItemBodyLines` を raw のまま利用） | ○ | ○ | 無関係 |
| 7. 曖昧時の挙動 | 定義なし（そもそも検出しない） | 明示的 reject＋専用理由 | 部分的にしか検出しない | 定義なし |
| 8. Undo/Redo への影響 | なし（判定のみ、書き込み形は不変） | なし | なし | なし |
| 9. 実装差分の大きさ | 小（スナップショット2フィールド追加＋比較1行×2） | 小〜中（＋文書全体の再走査1回×2） | 中（祖先チェーン計算が新規に必要） | 小だが有効性が低い |
| 10. テスト容易性 | 高（純粋関数の入出力テストのみ） | 高（paragraph 側の既存テストパターンを流用可） | 中（祖先チェーンのフィクスチャが要る） | 高だが検証すべき価値が低い |
| 11. 実機検証容易性 | 高（本文編集→rename未確定→commitの単純な手順で再現可能） | 中（重複ノードを意図的に作る手順が必要） | 低（祖先変化を伴う複合手順が必要） | 中 |

## 5. 推奨案と最小実装候補

### 5-1 推奨案

**案B（案A＋曖昧候補の安全側拒否）を推奨する。**

理由は次のとおりである。

- 案Aだけでは S4／S8（重複見出し・重複 list item）という、実際の
  Markdown ノートで十分に起こりうる構成（同名の "TODO" 見出しが複数
  セクションにある、同じ文言の list item が複数箇所にある、等）を
  一切救えない。paragraph 側がまさにこの理由で `resolveAnchorUnit` に
  第4段階を持つ設計になっている以上、heading/list だけこの段階を
  省略する理由はない。
- 案Cは絞り込み精度で案Bに勝る場面があるものの、祖先パスという
  heading/list 双方に非対称な新しい概念を持ち込むため、実装・テスト
  コストの割に「正当な commit まで弾いてしまう」リスクが増える。
  重複ノードという限定的な問題に対しては、案Bの「曖昧なら安全側で
  reject し、ユーザーに再実行を促す」という保守的な方針で十分であり、
  paragraph 側の既存合意（`ambiguous-match` は事故ではなく仕様）とも
  一貫する。
- 案Dは単独では危険であり、本監査では不採用とする。

### 5-2 最小実装候補（次フェーズ実装チケットへの申し送り）

**新規スナップショットフィールド**（`renameBlock.ts`）

```ts
export interface SectionRenameSnapshot {
  headingLevel: number;
  /** node.headingText, captured when the rename UI opened (Phase 5T-13, tentative). */
  originalHeadingText: string;
}

export interface ListRenameSnapshot {
  marker: string;
  indentColumns: number;
  contentColumn: number;
  /** collectListItemBodyLines(doc, itemId).lines, captured when the rename
   *  UI opened — raw lines, not the tooltip-formatted text (Phase 5T-13, tentative). */
  originalBodyLines: string[];
}
```

**新規 reject reason**（`RenameRejectReason` への追加候補）

- `"content-changed"`（paragraph の同名 reason と役割を揃える）
- `"ambiguous-match"`（paragraph の `resolveAnchorUnit` と役割を揃える）

**`renameSection`／`renameListItem` 内部での追加ステップ**（既存の
「id → 種別 → 構造フィールド」の後に挿入）

1. 現在の `headingText`／`collectListItemBodyLines(doc, itemId).lines`
   を取得し、スナップショットの `originalHeadingText`／
   `originalBodyLines` と比較。不一致なら `"content-changed"`。
2. `doc.nodes` 全体（heading は同レベルの section、list は同条件の
   list item）を再走査し、構造フィールド＋テキストの組が完全一致する
   候補が2件以上あるかを確認。2件以上なら `"ambiguous-match"`。

**`commitRename()` 側への影響**: なし、あるいは最小限。5T-12A guard
（cross-note）はそのまま維持し、その後段の `renameSection`／
`renameListItem` 呼び出しは呼び出しシグネチャ・返り値の形が変わらない
限り無修正で済む見込みである（新しい `reason` 値は既存の
`this.reasonText(outcome.reason)` 経由の Notice 表示にそのまま乗る
はずだが、`i18n.ts` への文言追加は必要）。

**5T-12A note identity guard との関係**: 完全に独立・直交する2層の
防御として共存する。実行順序は現状のまま
「①5T-12A guard（cross-note）→ ②renameSection/renameListItem
内部の新チェック（same-note re-resolution）」で問題ない——ノートが
違う場合はそもそも同じ note を再 parse する意味がないため、①を先に
評価する現状の配置は妥当である。

**Undo／Redo／rollback への影響**: なし。`pendingParagraphInsert` 関連の
rollback 経路（`rollbackPendingParagraphInsert`／
`commitPendingParagraphInsert`）は `state.kind === "paragraph"` の
場合にのみ通る専用パスであり、`renameSection`／`renameListItem` の内部
変更とは接点がない。

**既存テストへの非破壊導入プラン**: 新フィールドを必須（optional でない）
にした場合、`beginRename()` の呼び出し側（heading/list 分岐）で
スナップショット構築時に `originalHeadingText`／`originalBodyLines` を
渡すよう1箇所ずつ追記すれば足りる見込みであり、破壊的変更というよりは
「常に埋まっている新フィールドの追加」に近い。既存の
`tests/renameBlock*.test.ts`（想定）は、スナップショット構築ヘルパーを
経由していれば影響が小さいはずだが、テストフィクスチャが
`SectionRenameSnapshot`／`ListRenameSnapshot` をハードコードで直接
構築している場合は、その全箇所の更新が必要になる——この見積もりの
確定は次フェーズの実装チケット自身が既存テストファイルを読んでから
行うべき事項として申し送る。

## 6. Method Vault 実機確認マトリクス

本監査自体は docs-only であり、§5 の設計はまだ実装されていない。した
がって本チケットの実機確認マトリクスは「**現状（5T-13D 時点）の挙動を
確認し、§3 のリスクシナリオが実機でも再現しうるかを見極めるための
探索的確認**」という位置づけであり、5T-12D と同様、Method Vault へ
`SendUserFile` ＋ `device_commit_files` で別途納品する（git 管理対象外）。
概要のみ以下に記す（詳細手順は納品するマトリクス本体を参照）。

1. heading rename 中に、対象より前へ同レベルの新規見出しを本文側で挿入
   → Enter で確定（S1 の実機再現確認）。
2. heading rename 中に、対象見出し自体を本文側で削除 → Enter（S2）。
3. heading rename 中に、対象と同名・同レベルの見出しを別途追加 →
   Enter（S4）。
4. list rename 中に、同条件（marker/indent 一致）の新規 item を対象
   より前へ挿入 → Enter（S5）。
5. list rename 中に、対象 item 自体を本文側で削除 → Enter（S6）。
6. list rename 中に、対象と内容が重複する item を別途追加 →
   Enter（S8）。
7. 通常の heading rename（何も外部変化がない場合の回帰確認）。
8. 通常の list rename（同上）。
9. task list item（`- [ ] ...`）の rename（型としての回帰確認）。
10. 複数行本文を持つ list item の rename（継続行があるケースの回帰
    確認——本文表示・確定後の見た目に崩れがないか）。
11. Escape／blur（他要素クリック）／Enter それぞれで rename を終了した
    場合の3系統の回帰確認。
12. 上記1〜10 の commit 後に Undo／Redo を行い、意図しない別ノードが
    巻き込まれていないかの回帰確認。

各項目で記録すべき事項: 元の対象ノードに正しく反映されたか／別ノード
（重複見出し・重複 item・繰り上がった item 等）に誤って反映されたか、
Notice の有無と文言、Tree の selection／highlight の崩れ、Undo 履歴の
一貫性。

## 7. ロードマップ更新

`docs/統合実装ロードマップ_2026-08-05.md` へ Phase 5T-13D の
docs-only 監査完了エントリを追記する（本チケット自身の commit に
同梱するか、後続の docs-only follow-up として別 commit にするかは
実施時の判断に委ねる）。

## 8. 結論（監査時点でのまとめ）

heading/list の同一ノート内 rename 再解決契約は、paragraph が持つ
「byte-for-byte テキスト一致」「文書全体での曖昧候補拒否」という
2つの防御段階を欠いている。id 生成が per-parse-local な連番である
（`parseDocument.ts`）以上、rename 中に対象より前の位置で同種ノードの
増減があれば、現状の契約（id → 種別 → 構造フィールドのみ）は
**別ノードへの誤 commit を構造的に防げない**——これが本監査で確認した
最大の弱点である。幸い、heading は既存の `headingText` フィールドを、
list は既存の `collectListItemBodyLines`（変更不要・import のみ）を
再利用することで、paragraph と同等の防御を比較的小さな差分で移植できる
見込みが立った（案B）。ただし本チケットはあくまで設計監査であり、
実装は次フェーズのチケットに委ねる。

## 利用者判断事項

1. §5 の推奨案（案B）で次フェーズの実装チケット（5T-13A 相当）へ進めて
   よいか、それとも案A（重複ノード対策なしの最小構成）から段階的に
   進めたいか。
2. `SectionRenameSnapshot`／`ListRenameSnapshot` への新規フィールド
   追加を「必須フィールド」とするか「オプショナル＋未指定時は旧挙動」
   とするか（後者は既存呼び出し箇所を壊さないが、防御が有効化されない
   経路が残るリスクがある）。
3. 新しい reject reason（`"content-changed"`／`"ambiguous-match"`）に
   対する Notice 文言を、paragraph 側の既存文言（`reason.resolve-failed`
   等）と完全に共有するか、heading/list 専用の文言を新設するか。
4. §6 の実機確認マトリクスを、本チケット納品後すぐに実施するか、次
   フェーズの実装完了後（挙動が実際に変わった後）にまとめて実施する
   方が効率的と考えるか。
5. 案C（祖先パス指紋）を、案Bで拾いきれない「異なる親の下にある重複
   ノード」への追加対策として、将来の別チケットで検討する価値がある
   と考えるか、それとも ambiguous-match の安全側拒否で十分と判断する
   か。

## 9. 実機検証結果と結論（Phase 5T-13D、2026-08-24）

### 9-1 サマリ

| 項目 | 結果 |
|---|---|
| 1〜8（S1/S2/S4/S5/S6/S8の再現手順＋通常rename） | 再現不能（blur先行効果により、rename入力欄からのフォーカス喪失を伴う「外部編集→戻ってEnter」という手順自体が成立しない） |
| 9（task list item の rename） | 正常動作 |
| 10（複数行本文を持つ list item の rename） | 正常動作 |
| 11（Escape/blur/Enter による終了） | 正常動作 |
| 12（commit後の Undo/Redo） | 未報告（別途確認依頼中） |

### 9-2 blur先行効果が same-note シナリオにも及ぶことの確認

5T-12A の実機検証で確認された「rename 未確定中に、rename 入力欄から
フォーカスが外れる操作（別ノートのタブクリック、Outline Tree 自身の
タブクリック、本文エディタへのカーソル移動）は、その操作自体が既存の
blur ハンドラを同期的に発火させ、切替/移動本体の処理より先に rename を
確定/破棄してしまう」という現象は、rename 対象と**同じノートの本文を
編集する場合**にも同様に適用されることが、本チケットの実機確認によって
確認された。

§3 のリスクシナリオ S1・S2・S4・S5・S6・S8 を実機で再現するための手順は、
いずれも「rename 未確定のまま、本文エディタ側で外部編集を行う」という
ステップを要求していたが、rename の `<textarea>` は Outline Tree 側の
DOM 要素であり、本文エディタとは別要素であるため、本文エディタへ
カーソルを移す（＝外部編集を行うために必要な最初の操作）こと自体が
既存の blur ハンドラを発火させ、外部編集が行われる**前に** rename を
確定（変更ありの場合）または破棄（変更なしの場合）してしまう。したがって
「外部編集を行ってから、rename 入力欄へ戻って Enter で確定する」という
手順そのものが、5T-12A で確認されたのと同じ構造的理由により成立しない。

### 9-3 §4 リスクシナリオへの結論（改訂）

この結果は、S1〜S8 が「起こり得ない」ことを意味しない。§2-4 で確認した
id 生成の非安定性と、§2-1 で確認した現状の `renameSection`／
`renameListItem` の再解決契約の弱さ自体は、コードレベルでは変わらず
存在する。今回判明したのは、**マウス操作による手動実機テストでは、この
弱点を露呈させる「rename 未確定のまま同一ノート内で外部編集を行う」と
いう経路自体を、既存の blur ハンドラが事実上封じている**という点である。

したがって、S1〜S8 の危険な組み合わせが実際に踏み抜かれ得る経路は、
次の2種類に限られる。(a) キーボードショートカットなど blur を発生
させない経路で本文編集を行った場合（5T-12D で「キーボードショートカット
によるノート切替は未検証」としたのと同じ、この利用者の環境では確認
できない経路）。(b) 別の Obsidian プラグイン・同期処理・スクリプト
経由での、フォーカスを奪わないプログラム的な文書変更（人間の手操作を
経由しないため、blur ハンドラの発火とは無関係に発生し得る）。

(b) は特に、5T-12A の cross-note シナリオには存在しなかった、
same-note 特有の残存リスク経路である——他プラグインやシステム全体の
自動処理（例: フォーマッタ、同期コンフリクト解決）が、rename 未確定中に
対象ノートの本文をプログラム的に書き換えるケースは、ユーザーのマウス
操作を経由しないため blur を発生させず、rename 入力欄は開いたまま
残る。この場合、commit 時に content-match／ambiguous-match チェックが
存在しなければ、依然として S1〜S8 で指摘した誤 commit が発生し得る。

### 9-4 §5 推奨案（案B）の位置づけの再確認

以上を踏まえると、§5 で提案した content-match／ambiguous-match
チェック（案B）は、5T-12A の note identity guard と同様、「実機の通常
操作では踏み抜きにくいが、Obsidian のイベント順序という非契約的な
前提や、プラグイン間の非同期的な文書変更といった、手動テストでは
再現できない経路への安全網」として位置づけるのが適切である。手動 UI
テストで再現できないことは、この安全網の実装優先度を下げる理由には
ならない——むしろ「人間の操作では気づきにくい、稀だが発生し得る経路」
こそ、事前の設計的防御が最も効く領域である。

### 9-5 項目9〜11（正常機能確認）

task list item の rename・複数行本文を持つ list item の rename・
Escape／blur／Enter それぞれによる rename 終了は、いずれも実機で正常に
機能することが確認された。5T-13D のスコープでは変更を加えていない
既存動作であり、想定どおりの回帰結果である。

### 9-6 未確認事項（項目12）

項目12（commit 後の Undo／Redo 回帰）についての報告はまだ受けていない。
可能であれば別途確認をお願いしたい。

## 結論（改訂）

Phase 5T-13D の実機検証により、5T-12A で確認された blur 先行効果は
cross-note（ノート切替）だけでなく same-note（同一ノート内の外部編集）
にも及ぶことが確認された。これにより、S1〜S8 の手動 UI 再現手順は
成立しないが、根本原因（id の非安定性、content-match の欠如）自体は
コード上に残存しており、非マウス操作経路（キーボードショートカット・
他プラグインのプログラム的編集）への安全網として、§5 の推奨案（案B）
は引き続き有効な設計提案であると結論する。
