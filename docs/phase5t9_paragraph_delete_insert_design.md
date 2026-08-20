# Phase 5T-9D: Outline Tree paragraph の delete / insert 設計監査（docs-only）

作成日: 2026-08-20

本フェーズは設計監査のみであり、コード変更は一切行っていない。対象リポジトリの
`src/`・`tests/`・`parseDocument.ts`・`styles.css` に差分がないことは §9 で確認する。

## 0. 位置づけ

Phase 5T-7B（設計監査）→ 5T-7C（pointerdown 二重クリック検出）→ 5T-8A（paragraph dblclick →
inline rename、実機受入コミット `587ec91`）により、paragraph の rename のみが最小解禁された
段階にある。paragraph は当初「rename / delete / insert / drag / indent-outdent / Tree 経由の
Partial Edit を許可しない」という基礎方針で導入され、その後 D&D（5T-2）・非隣接 move
（5T-3A）・Partial Edit 起動（5T-4A）・rename（5T-8A）が段階的に解禁されてきた。本フェーズは、
残る delete / insert について、安全に解禁できる最小スコープを実装に先立って定義する。

## 1. 目的（7項目への回答の要旨）

1. **delete を先行できるか** — できる。ただし「案A: 右クリックのみ・確認モーダルなし」で
   先行させるのは推奨しない。詳細は §5。
2. **insert を delete から分離すべきか** — 分離すべきである。insert は「新規の空段落を
   Markdown 上どう表現するか」という、delete にはない固有の難所（blank-line-not-allowed
   契約との衝突）を抱えており、着手順は delete 先行が妥当。詳細は §6-4、§8。
3. **どの paragraph が対象か** — 既存の paragraph Tree 表示対象と同一の集合（section 直下・
   top-level・list item 子）のうち、初期スコープでは list item 子 paragraph を対象外とする
   ことを推奨する。詳細は §6-1。
4. **どの Markdown 構造を絶対に壊してはいけないか** — list item のマーカー行、section の
   見出し行、CompositeBlock member、callout/blockquote/code fence/table の内部構造。加えて、
   本監査で新たに特定した固有のリスクとして「delete/insert の結果、隣接する別の paragraph
   候補・callout/blockquote 内部行と意図せず結合してしまう」危険がある（§3-1、§3-2、§6-3）。
5. **既存 rename / Partial Edit / D&D / Move とどう共存させるか** — 既存の
   `resolveParagraphFromTreeHint`/`buildParagraphMoveAnchor`（および move 系の3段階
   再解決契約）をそのまま再利用し、新しい解決ロジックを作らない。詳細は §5、§6-6。
6. **どの UI 導線から解禁するか** — delete は `showParagraphMoveMenu` への追加項目、insert も
   同様に `showParagraphMoveMenu` の拡張を推奨（専用メニュー新設は不要）。詳細は §5。
7. **Undo / Redo / no-op / Notice の契約をどうするか** — 既存の
   `applyLineEditOutcome`（1回の `editor.replaceRange` = 1 Undo 単位）をそのまま踏襲できる。
   no-op / reject 条件は §6-7 にまとめる。

## 2. 背景整理（前提の確認）

以下の前提を崩さずに検討した。

- paragraph の Tree 表示は既に存在する（`tree/buildOutlineTree.ts` の
  `OutlineTreeParagraphNode`、`editability === "supported"` の paragraph のみを投影）。
- paragraph の D&D adjacent move（5T-2）／non-adjacent move（5T-3A）は解禁済み。
- paragraph の dblclick は inline rename に統一済み（5T-8A）。
- paragraph Partial Edit は F2 / context menu「段落を編集…」導線で維持されている。
- paragraph delete / insert は当初方針では未解禁 — 実際に `showParagraphMoveMenu` を
  改めて確認したが、delete（`trash-2`）・insert（`plus`）に相当する項目は存在しない。
- paragraph は section 直下 / top-level / list item 子に現れうる（Phase 5P-1）。
- CompositeBlock member や callout / blockquote / code fence / table 内部は、既存の
  editability 判定（`parser/complexBlocks.ts` の merge 優先度）により、そもそも
  `kind: "paragraph"` の `editability: "supported"` な `ComplexBlockInfo` として現れない。
  したがって delete / insert の対象範囲を検討する上でも、これらは構造的に除外されたままで
  よい（5T-8A の rename と同じ前提）。

## 3. 監査

### 3.1 paragraph delete

既存の削除系プリミティブを比較のうえ調査した（`edit/deleteBlock.ts`、
`edit/deleteCompositeBlock.ts`）。

- **top-level / section直下 paragraph の削除**: `deleteBlock.ts` と同様、対象 range
  （`rangeStart`..`rangeEnd`）をそのままスライス削除する方式で対応可能。特別な扱いは不要。
- **list item 子 paragraph の削除**: `parser/complexBlocks.ts#scanParagraphBlocks` の
  `isCandidate` は list マーカー行自体を候補から明示的に除外しており（`LIST_RE.test(line)`
  で弾く）、子 paragraph の range はマーカー行より後ろの、内容開始列
  （`listItemContentColumn`）以上に字下げされた行のみで構成される。したがって削除操作
  そのものがマーカー行を巻き込む危険は構造的にない。ただし `edit/listBodyRange.ts`
  （Phase 4B、list item のツールチップ抽出）は Phase 5P-1 以降の「子 paragraph は独立した
  ComplexBlockInfo である」という区分に追随しておらず、同じ物理行が (a) list item 自身の
  ツールチップ本文としても、(b) 独立した paragraph Tree ノードとしても、二重に表現されている
  ことが判明した。これはデータ破壊のリスクではなく表示上の整合性の問題だが、子 paragraph が
  独立に delete/insert 可能になった場合、ツールチップ側の表示が古い内容のまま残る／消えた
  はずの文言がツールチップにだけ残るといった混乱を招きうる。この点から、初期スコープでは
  list item 子 paragraph を対象外とすることを推奨する（§6-1）。
- **先頭 / 末尾 / 単独 paragraph の削除**: range 自体の削除ロジックに違いはないが、前後の
  空行の扱いが論点になる（次項）。
- **前後の空行がどうなるか／削除後に Markdown が結合・崩壊しないか**: `deleteBlock.ts` と
  `deleteCompositeBlock.ts` はいずれも「削除範囲の前後にある空行や、削除後に新たに隣接する
  ことになる内容には一切手を加えない」という一貫した方針を意図的に採っている
  （単純な slice-and-concat のみ）。この方針は section/list/CompositeBlock には安全だが、
  paragraph には固有のリスクがある。`scanParagraphBlocks` の候補判定は「空行・見出し・
  リストマーカー行のいずれでもない行」を連続して1つの paragraph 候補としてまとめる
  ため、ある paragraph を削除した結果、削除箇所の直前・直後にあった「もう1つの paragraph
  候補（または callout/blockquote の内部行）」同士が直接隣接してしまうと、次回の再解析時に
  それらが1つの新しい paragraph 候補として意図せず結合される可能性がある。これは
  `edit/paragraphNonAdjacentMove.ts#ensureBlankSeparation` が非隣接 move の着地点で既に
  対処している問題と全く同じ性質のものであり、delete 実装でも同じ判定
  （`isBlankLine`／見出し正規表現／リストマーカー正規表現をチェックし、いずれにも該当しない
  隣接行がある場合のみ1行の空行を挿入する）を、削除で生じた「穴」の直前直後に適用することを
  推奨する。これは `deleteBlock.ts` 系のどの既存削除にも存在しない、paragraph 固有の追加要件
  である。
- **list item 本体と子 paragraph の関係が壊れないか**: 壊れない（上記のとおりマーカー行は
  構造的に除外される）。
- **親 block が空になった場合の扱い**: 例えば section の本文が対象 paragraph 1つだけだった
  場合、削除後は見出し行のみが残る。これは `deleteBlock.ts` が section 本文を削除した場合と
  全く同じ挙動であり、特別な処理は不要（既存契約のまま）。list item の唯一の子 paragraph を
  削除した場合も、list item 自身の行は影響を受けない。
- **全消去に近いケースの扱い**: delete は「paragraph 1個をまるごと削除する」操作であり、
  rename 欄を空文字にする話とは別物である。5T-8A の blank-line-not-allowed（空文字確定の拒否）
  と混同しないよう、delete と rename の空文字入力は明確に別契約として扱う（§5 案C参照）。
- **source 再解決契約**: `deleteBlock.ts` の1段階（`resolve-failed` のみ）ではなく、
  `edit/paragraphTreeMove.ts#resolveAnchorUnit` と同じ3段階＋文書全体の曖昧一致チェック
  （`resolve-failed` / `identity-changed` / `content-changed` / `ambiguous-match`）を
  再利用すべきである。paragraph は section/list のような構文マーカーを持たず、id の
  信頼性が低いため、move で既に確立されているこの厚い契約をそのまま踏襲するのが安全かつ
  最小差分である。
- **Undo / Redo 契約**: 既存の `applyLineEditOutcome`（1回の `editor.replaceRange` 呼び出し
  ＝ 1 Undo 単位という、Phase 5C-1A/1B・5T-8A で既に実機確認済みの性質）をそのまま利用できる。
  新しい Undo 配線は不要。

### 3.2 paragraph insert

既存の `edit/insertBlock.ts`（section/list 用）を比較対象として調査した。

- **6種の挿入位置の区別**: 同レベル sibling の前 / 後、parent の先頭 / 末尾、top-level への
  挿入、section 直下への挿入、list item 子としての挿入 — これらは、`insertBlock.ts` が
  section/list に対してすでに区別している「sibling 挿入」「child 挿入」の枠組みと構造的に
  対応する。ただし paragraph には「parent」という概念が section/list ほど明確ではない
  （paragraph 自身は子を持てない leaf node）ため、実装時は「基準 paragraph に対する
  before/after」と「基準 section/list item に対する先頭/末尾」を別のパラメータ形状として
  整理する必要がある。
- **新規空 paragraph を許すか**: 許容できない。`scanParagraphBlocks` の `isCandidate` は
  空行・空白のみの行を候補から除外するため、「空の paragraph」はそもそも Markdown 上
  表現不可能である。これは 5T-8A の `blank-line-not-allowed` 契約（空文字確定を拒否する）
  と完全に整合する制約であり、insert 側もこの制約を回避せず正面から受け止める必要がある。
- **プレースホルダ text を入れて作るか**: 必要になる。heading の `"## "` や list item の
  `"- "` と異なり、paragraph には構文マーカーがないため、空文字や空白のみの初期値では
  「空 paragraph」と区別がつかず、次回の再解析で候補として認識されない（=Tree に表示され
  ない、または直後の rename/Partial Edit がすぐに対象を見失う）。非空白文字を最低1つ含む
  プレースホルダ文言（例: 「新しい段落」）が必要になる。
- **挿入直後に inline rename に入るか**: 一貫性の観点から最も妥当な選択である。heading/list
  の既存 `autoRenameAfterInsert`（挿入直後、`this.highlightedId` に対して
  `beginRenameForNode` を呼ぶ）と同じパターンを、5T-8A で新設した
  `beginParagraphRenameForNode`（もしくはそれに準ずる、id 起点で呼べる形）に対して適用する
  ことが自然な流れになる。ただし `autoRenameAfterInsert` は現状 `beginRenameForNode`
  （section/list 専用）を直接呼んでおり、highlightedId が解決する node の kind に応じて
  section/list 用と paragraph 用のどちらを呼ぶか分岐させる拡張が新たに必要になる —
  これは実装フェーズでの調査事項として残す。
- **挿入直後に Partial Edit を開くか**: 選択肢としては挙げられるが、Partial Edit は別ペイン
  を開く重い操作であり、「短いプレースホルダ文言をその場で書き換える」という insert 直後の
  典型的な用途には inline rename の方が軽量で一貫性が高い。
- **挿入だけ行って未編集で終われるか**: 可能にすべきである。heading/list の既存動作
  （rename を Escape でキャンセルしても `"## "`/`"- "` は本文に残る）と同様、paragraph
  insert を Escape でキャンセルした場合もプレースホルダ文言は本文に残ることになる。ただし
  `"## "`/`"- "` は空文字に近い簡潔な記法であるのに対し、paragraph のプレースホルダは
  非空白の文言（例:「新しい段落」）である必要があるため、キャンセル時に本文へ意味のある
  日本語（または任意言語）の文言がそのまま残る点は heading/list より目立つ。この挙動を
  許容するか、あるいはプレースホルダをより記号的な文言（例: 「…」）にするかは、利用者判断
  事項として残す（§10）。
- **必要空行を自動挿入するか**: する。3-1 の delete と同じ理由（paragraph 候補の意図しない
  結合防止）により、`ensureBlankSeparation` と同じ条件付きロジック（挿入点の前後が既に
  blank/見出し/リストマーカーでなければ、それぞれ独立に1行だけ空行を追加する）を、insert
  される新規 paragraph の前後にも適用する必要がある。
- **空 paragraph を Markdown としてどう表現するか**: 表現不可能（前述のとおり）。この制約は
  そのまま「空のまま挿入して後で書く」というワークフローを禁止することを意味する —
  必ず何らかのプレースホルダ文言を伴って挿入されることになる。
- **blank-line-not-allowed 契約と衝突しないか**: 衝突しない。むしろ、insert が生成する
  初期テキストは非空白文言である必要があるという要件そのものが、この契約から直接導かれる
  帰結である。

## 4. 絶対に壊してはならない既存契約（確認）

以下はいずれも本監査（docs-only）の対象外であり、コード変更を伴わない本フェーズでは
当然ながら無変更である。実装フェーズにおいても変更禁止・回帰禁止とする。

- 5T-7C の pointerdown 二重クリック検出（`rowDoubleClickDetector.ts`、
  `handleRowPointerDownForDoubleClick`）
- 5T-8A の paragraph inline rename（`beginParagraphRenameForNode`、`beginRename` の
  paragraph 分岐、`commitRename` の `applyParagraphEdit` 分岐）
- paragraph Partial Edit 本体（`view/PartialEditView.ts`、
  `main.ts#activatePartialEditViewForParagraph`）と F2 / context menu 導線
  （`openParagraphPartialEditFromTree`）
- paragraph D&D（`handleParagraphDragStart` 等）、section / list D&D
- `draggable` 属性、`computeDropMode`、`runRelocateCommand`、drop indicator
- selection / highlight repair（selection follow）
- mobile long-press
- `parseDocument.ts`
- `styles.css`

特に、delete / insert のために paragraph を別 kind にしたり、Tree モデルや parser を
作り替える必要は一切ないと判断した — `edit/paragraphTreeMove.ts`・
`edit/paragraphNonAdjacentMove.ts`・`edit/paragraphPartialEdit.ts` の既存プリミティブと
同じ「id ではなく内容で再解決する」契約を踏襲すれば、既存の kind 分類・investigator
（`isOutlineParagraphNode`）・readOnlyNodeIds の扱いは無変更のまま実現できる。

## 5. 比較した設計案（各3案以上）

### delete の案

- **案A: 右クリックメニューからのみ paragraph delete を解禁（確認モーダルなし）**
  既存の `showStructureCommandMenu`/`showListCommandMenu` の delete 項目
  （`trash-2`、`.setWarning(true)`、確認モーダルなしの即時削除）と同じ UX パターン。
  長所: 実装が最も薄く、既存パターンとの一貫性が高い。短所: paragraph は heading（短い
  1行）や list item（通常短い1行）と異なり、複数文・複数行にわたる可変長のテキストを
  保持しうるため、誤クリック1つで比較的多くの文章を即座に失うリスクが heading/list より
  高い。
- **案B: 専用コマンド（delete paragraph）+ 確認モーダル**
  CompositeBlock delete（`showCompositeCommandMenu` → `ConfirmCompositeDeleteModal`）と
  同じ UX パターンを踏襲する。長所: 誤操作防止。CompositeBlock と paragraph は「本文量が
  可変で、削除前に内容を目視確認する価値がある」という性質を共有しており、確認モーダルの
  正当性が既存パターンからも裏付けられる。短所: 実装コストが案Aより高い（既存
  `ConfirmCompositeDeleteModal` の汎用化、または同等の新規モーダルが必要）。
- **案C（危険案）: rename UI 中の空文字確定を delete とみなす**
  5T-8A は全消去を `blank-line-not-allowed` で明示的に拒否しているため、この案は既存契約と
  正面から矛盾する。さらに rename の blur-commit-if-changed 契約（テキストを変更した状態で
  フォーカスを外すと自動的にコミットされる）と組み合わさると、「空にしてから他の行を
  クリックしただけ」で段落が意図せず削除される可能性があり、5T-8A 自身が慎重に回避した
  誤操作のクラスをそのまま再導入することになる。**明確に非推奨**とする。

**推奨: 案B（専用コマンド + 確認モーダル）。** ただし、まず案Aの薄い実装で最小に着手し、
実機で誤操作リスクが実際にどの程度あるかを確認したうえで確認モーダルの要否を判断する、
という段階導入も現実的な代替案として提示する（利用者判断事項、§10）。

### insert の案

- **案A: 右クリックメニューで「前に段落を挿入」「後に段落を挿入」**
  既存の `showParagraphMoveMenu` を拡張し、move 項目群の近くに insert 項目を追加する。
- **案B: 先頭へ / 末尾へ / 前へ / 後へ の専用コマンド UI**
  5T-3A の非隣接 move（「先頭へ移動」「末尾へ移動」「指定した段落の前へ移動…」等）と
  同じ、位置指定ピッカーを伴う UI パターン。
- **案C: rename 完了後に sibling 追加ショートカットを別導線で提供**
  rename 中の textarea から直接次の段落を追加する、といった導線。

**推奨: 案A。** insert は「新規作成 + 挿入位置の指定」であり、5T-3A の非隣接 move が扱う
「既存の段落をどこか離れた場所へ移す」問題（対象候補が多数あり得るためピッカーが必要）とは
性質が異なる — insert の挿入位置は基本的に「今右クリックした行の前/後」で十分にカバーでき、
位置ピッカーは過剰な UI である。案Cは導線として発見しにくく、既存の「右クリックメニューに
機能が集約されている」という Tree 全体の慣習からも外れる。

**`showParagraphMoveMenu` 拡張 vs paragraph 専用メニュー新設**: 拡張を推奨する。
`showParagraphMoveMenu` は既に `resolveParagraphFromTreeHint`/`buildParagraphMoveAnchor` で
target を再解決し、anchor を構築済みであり、insert 項目もこの既存の解決結果をそのまま
利用できる。専用メニューを新設すると、この解決ロジックを重複させるか、共有のために新たな
抽象化が必要になり、いずれも「既存 UI を再利用する」という 5T-8A までの一貫した方針から
外れる。

## 6. 特に整理した難所（8項目）

1. **list item 子 paragraph の delete / insert を今回含めるか** — 含めないことを推奨する。
   `edit/listBodyRange.ts`（list item ツールチップ）が Phase 5P-1 の子 paragraph 独立化に
   追随しておらず、同じ物理行が二重に表現されている状態（§3-1）を解消してからでないと、
   delete/insert 後にツールチップ表示が不整合になる懸念がある。初期スコープは
   section 直下 / top-level paragraph のみとする。
2. **section 境界・list 境界をまたぐ insert を禁止するか** — 禁止すべきである。既存の
   paragraph move（`resolveAnchorUnit`／`resolveTargetAnchor`）が既に
   `parentId`/`depth` の不一致を拒否条件としているのと同じ制約を、insert の挿入先
   （どの parent の子として挿入するか）にもそのまま適用する。
3. **paragraph を delete した結果、近接ブロックが意図せず結合する危険をどう避けるか** —
   `edit/paragraphNonAdjacentMove.ts#ensureBlankSeparation` と同じ条件付き空行挿入
   ロジックを、delete で生じた「穴」の前後・insert する新規 paragraph の前後の双方に
   適用する（§3-1、§3-2で既述）。
4. **insert 直後の新規 paragraph の編集導線を rename にするか、Partial Edit にするか、
   未編集のまま許すか** — rename を第一候補として推奨する（heading/list の
   `autoRenameAfterInsert` と一貫）。未編集のまま Escape でキャンセルして終わることも
   許容する。Partial Edit を直後に開く案は、動線としては可能だが本フェーズの推奨からは
   外す。
5. **1操作=1編集=1Undo を満たせるか** — 満たせる。insert・delete いずれも
   `applyLineEditOutcome` 経由の単一 `editor.replaceRange` 呼び出しに収まる設計が可能
   （空行の条件付き挿入を含めても、最終的な `lines` 配列の差し替えは1回で完結する）。
6. **source / target / insertion point の再解決契約** — delete の source、insert の
   「基準 paragraph」いずれも、`resolveAnchorUnit` と同じ3段階＋曖昧一致チェック
   （resolve-failed / identity-changed / content-changed / ambiguous-match）を踏襲する。
   insert の挿入位置自体（sibling の前/後、parent の先頭/末尾）は、基準ノードの再解決に
   付随する形で決まるため、独立した「target」再解決は move ほど複雑にはならない見込み。
7. **no-op / reject / Notice の基準** — delete/insert 共通で
   resolve-failed・identity-changed・content-changed・ambiguous-match の4種を基本とし、
   insert 側は挿入先の parent（section/list item）自体が解決できない場合の
   target-resolve-failed 相当を追加する。`reason.identity-changed`/`reason.content-changed`
   は `i18n.ts` に汎用（paragraph 編集全般で使い回せる）文言として既に存在する一方、
   `ambiguous-match` は `edit/paragraphTreeMove.ts#paragraphTreeMoveReasonText` が
   汎用の `"reason." + reason` 合成キーではなく、move 専用の
   `"reason.paragraphTreeMoveAmbiguous"` という機能別の専用キーを使っている（`i18n.ts` に
   汎用の `"reason.ambiguous-match"` キー自体は存在しない）。delete/insert 側で
   ambiguous-match を独自の文言にするか、move と同じ専用キーを再利用するかは実装時に
   決める必要がある。
8. **実機確認で見るべき最小チェック項目**（実装フェーズ用の下書き） —
   (a) section直下/top-level paragraph の delete が正常に機能する、
   (b) delete 後に隣接テキストが意図せず結合しない、
   (c) delete に確認モーダルが採用された場合、キャンセルで本文が変わらない、
   (d) insert（前/後）で新規 paragraph が正しい位置に挿入される、
   (e) 挿入直後に rename 入力欄が開く、
   (f) Escape で未編集のまま終わっても本文が破綻しない、
   (g) heading/list/paragraph rename・Partial Edit・D&D が回帰していない、
   (h) Undo/Redo が1操作=1単位で機能する。

## 7. 成果物

- `docs/phase5t9_paragraph_delete_insert_design.md`（本ファイル）
- `docs/統合実装ロードマップ_2026-08-05.md` の更新（新規行の追加）
- Method Vault の利用者向け判断ノート（git には追加しない）

## 8. 実装順の提案

delete を先行させることを推奨する。理由は、insert が「空 paragraph を Markdown 上どう
表現するか」というプレースホルダ設計（delete には存在しない固有の難所）を必要とする一方、
delete は既存の move/CompositeBlock delete の再解決契約をほぼそのまま転用でき、設計上の
未決定事項が少ないためである。delete の実装・実機受入を経て、そこで確立された
「厚い再解決契約」と「空行結合防止ロジック」の実装知見を insert にも再利用する段階的な
進め方を推奨する。

## 9. 品質ゲート

本フェーズは docs-only のため実装コードの変更はない。念のため以下を確認した。

- `git status --short`: 本フェーズ開始前・終了後とも `src/`・`tests/` に変更なし
- `git diff -- src/parser/parseDocument.ts styles.css`: 差分なし（0行、そもそも変更対象に
  含めていない）

## 10. 利用者判断事項（最大5問、次フェーズ着手前に確認したい事項）

1. delete の UX は案B（専用コマンド + 確認モーダル）を初手から採用するか、まず案A（確認
   モーダルなし）で最小実装し実機で誤操作リスクを見てから判断するか。
2. 初期スコープを「section直下 / top-level paragraph のみ」（list item 子は対象外）とする
   ことに同意するか。
3. insert 直後のプレースホルダ文言をどう表現するか（意味のある日本語文言か、より記号的な
   文言か）、また Escape キャンセル時にその文言が本文に残ることを許容するか。
4. delete/insert の実装順を「delete 先行 → insert」とすることに同意するか。
5. `edit/listBodyRange.ts`（list item ツールチップ）の Phase 5P-1 未追随（二重表現）の
   修正を、本フェーズと同時に行うか、別チケットとして切り出すか（list item 子 paragraph を
   対象外とする限り本フェーズの実装には影響しないが、いずれ解消が必要な既存の技術的負債
   として記録する）。

## 11. 実装確定内容（Phase 5T-9A、2026-08-20）

上記§10の5問への回答が確定し、delete が最小スコープで実装された（コミット `188c932`）。
insert は本フェーズでは未実装のまま据え置く。

- **採用した delete UX**: 案B（専用コマンド + 確認モーダル）。CompositeBlock delete の
  `ConfirmCompositeDeleteModal` パターンを `view/ConfirmParagraphDeleteModal.ts` として
  そのまま踏襲した（`resolved` フラグ、Cancel先頭・非focus、Delete は `mod-warning`、
  `onClose` の暗黙キャンセルは常に `onChoice(false)`）。折衷案（案A→実機確認後に判断）は
  不採用。
- **初期スコープ**: top-level paragraph と section 直下 paragraph のみ。list item 子
  paragraph は明示的に対象外とし、`edit/deleteParagraph.ts#isInScopeParagraphParent` で
  メニュー表示時とコマンド実行時の両方に同じスコープ判定を適用する。
- **再解決契約**: 新規モジュールを起こさず、`edit/paragraphTreeMove.ts#resolveAnchorUnit`
  （id候補 → parentId/depth構造一致 → 本文バイト一致 + 文書全体の曖昧一致検査、の3段階＋
  曖昧性チェック）をそのまま再利用した。delete固有の追加チェックは2つ:
  (1) 親が list item の場合は `"list-item-parent"` で拒否、
  (2) `matchCompositeBlocks` を再実行し CompositeBlock のメンバーであれば `"composite-member"`
  で拒否（ただし `parser/compositeBlocks.ts#collectCandidates` が `kind === "paragraph"` を
  合成候補から常に除外しているため、現状はこの分岐に到達し得ないことを
  `tests/deleteParagraph.test.ts` で直接検証した — 将来 paragraph が合成メンバーとして
  設計された場合に備えた防御的実装として維持する）。
- **空行結合防止**: `paragraphNonAdjacentMove.ts#ensureBlankSeparation` と同種の、削除後に
  新しく隣接する2行が両方とも「段落候補行」（非空白・非見出し・非リストマーカー）である
  場合にのみ空行を1行だけ挿入する条件付き補正を実装した。ただし
  `scanParagraphBlocks` の貪欲な候補走査の性質上、独立して解決可能な paragraph は既に
  両側が空行・見出し・リストマーカー・文書端のいずれかで区切られていることが構造的に
  保証されるため、この分岐も現状は理論上到達不能である（`tests/deleteParagraph.test.ts`
  内に、この性質を明示的に検証・文書化したテストを含む）。`deleteCompositeBlock.ts`の
  `NoCompositeDeleteReason` が既に持つ「現状到達不能な理由を将来のための防御として残す」
  という本コードベースの既存方針にならった。
- **delete 後の選択/フォーカス**: 次の兄弟（同じ parentId/depth を共有する
  paragraph/callout/blockquote のうち削除範囲より後で最も近いもの）→ 前の兄弟（同条件で
  最も近いもの）→ 親セクションの見出し行 → 削除開始行（クランプ）、の順で `newStartLine`
  を決定し、`queueSelectionFollow` に渡す。これは section/list の汎用 delete
  （`runDeleteCommand`/`dispatchAndApply(..., false)`）が selection-follow を行わない
  方針とは異なる、本チケット§6の明示的要求に基づく意図的な違いである。
- **UI 導線**: `showParagraphMoveMenu` の既存メニュー構造に「段落を削除」項目を追加した
  （新規の専用メニューは作らなかった）。表示は `isInScopeParagraphParent` によるスコープ
  ゲートのみで、他の move/edit 項目とは独立して判定される。
- **`edit/listBodyRange.ts` の技術的負債**: 本フェーズでは一切変更していない。list item
  子 paragraph を対象外としたため直接の影響はないが、Phase 5P-1 未追随（同一行がツール
  チップと独立 paragraph Tree ノードの両方に二重表現される問題）は未解消のまま残っている。
  別チケットとして切り出すことを推奨する。
- **`parseDocument.ts` / `styles.css`**: 無変更（`git diff --stat` で確認済み）。

## 12. 実機受入結果（Phase 5T-9A、2026-08-20）

Method Vault のチェックリスト（`phase5t9a-paragraph-delete-manual-check.md`、12項目）に基づく
実機確認の結果、利用者より「実機で確認し正常に機能した」との報告を受けた。top-level /
section 直下 paragraph の delete、確認モーダルの Cancel/Delete 挙動、削除後の Tree/本文
同期、paragraph rename・Paragraph Partial Edit（context menu・F2）・heading/list rename・
D&D・Undo/Redo のいずれにも回帰は報告されていない。

これをもって Phase 5T-9A の delete 実装（コミット `188c932`／docs `634e0f5`）は実機受入
完了とする。insert は引き続き未着手であり、次フェーズへ持ち越す。

## 13. 実装確定内容（Phase 5T-10A、2026-08-20）

5T-9A の実機受入完了を受けて、Outline Tree paragraph insert（top-level / section 直下、
最小スコープ）を実装した。

- **Insert UI**: 既存の `showParagraphMoveMenu` を拡張し、「段落を前に挿入」「段落を後に
  挿入」の2項目を「段落を編集…」の直後・Move up/down の直前に追加した。表示は delete 項目
  と同じ `isInScopeParagraphParent` ゲート（計算を1回にまとめ、insert 2項目・delete 1項目
  で共有）。
- **スコープ**: top-level / section 直下 paragraph の insert-before / insert-after のみ。
  list item 子 paragraph、parent 先頭/末尾への insert、section/list 境界を跨ぐ insert は
  すべて対象外（据え置き）。
- **採用したプレースホルダ文言**: `"新しい段落"`
  （`edit/insertParagraph.ts#PARAGRAPH_INSERT_PLACEHOLDER_TEXT`）。paragraph は見出し/リスト
  と異なり構文マーカーを持たないため、空文字列では `scanParagraphBlocks` に候補行として
  認識されない — Markdown として即座に paragraph と認識される非空文字列が必要という制約
  への対応。挿入直後に inline rename が自動的に開き、この文言は選択状態で表示されるため、
  次の1打鍵で置き換わることを前提とした最小限の文言とした。
  Cancel/Escape で確定されなかった場合は insert 自体がロールバックされるため、この文言が
  本文に永続することは正常フローでは想定していない。
- **再解決契約**: delete と同じ `edit/paragraphTreeMove.ts#resolveAnchorUnit` を再利用。
  スコープ判定も `edit/deleteParagraph.ts#isInScopeParagraphParent` をそのまま import
  して再利用し、delete と insert のスコープ契約が構造的に乖離しないようにした。
  composite-member チェックも delete と同じ理由（`collectCandidates` が paragraph を合成
  候補から常に除外）で現状到達不能だが、防御的実装として維持した
  （`tests/insertParagraph.test.ts` で明示的に検証）。
- **空行補正**: `paragraphNonAdjacentMove.ts#ensureBlankSeparation` と同種の、双方向・
  条件付きの空行挿入ロジックを実装した。挿入位置の直前・直後それぞれについて独立に
  「段落候補行（非空白・非見出し・非リストマーカー）かどうか」を判定し、必要な側にのみ
  空行を1行だけ挿入する。delete のケースと異なり insert は新しい境界を2つ生成するため、
  片側（対象paragraphに接する側）は常に空行が必要、もう片側（対象paragraphの外側、既存の
  行に接する側）は構造的にほぼ常に不要（対象paragraph自身が独立して解決可能であった
  ことがその境界の非候補性を保証するため）だが、この分岐は決め打ちにせず、両側とも実際の
  行内容を再チェックする汎用実装とした。
- **rename との接続**: `renameState`（`beginRename`/`beginParagraphRenameForNode`）に
  追加専用の `pendingParagraphInsert` フラグを導入。insert 直後は新しい
  `autoRenameAfterParagraphInsert()`（`dispatchAndApplyParagraphInsert` 内の `refresh()`
  完了後に呼ばれ、`this.highlightedId`—5T-5A の `resolveCurrentPositionNodeId` が
  `newCursorCh` で置かれたカーソル位置から自動的に解決する—を使って
  `beginParagraphRenameForNode(id, true)` を呼ぶ）が inline rename を自動的に開始する。
  rename を確定（Enter／内容が変化した状態での blur）した場合のみ paragraph は本文に残る。
  既存の heading/list/既存 paragraph の rename パスは完全に無変更（`pendingParagraphInsert`
  は追加専用のオプショナルフィールド・引数で、デフォルト `false`）。
- **Cancel/rollback 契約**: Escape、またはプレースホルダ未変更のまま blur（既存の
  blur ハンドラが「値が initialText と同じなら cancelRename()」という判定を既に持って
  いるため、5T-10A 用の特別分岐は不要だった）は、いずれも既存の `cancelRename()` に到達
  する。`cancelRename()` は `pendingParagraphInsert && kind === "paragraph"` の場合のみ
  新設の `rollbackPendingParagraphInsert(anchor)` に分岐する（それ以外の既存パス — 通常の
  heading/list/paragraph rename の cancel — は一切変更していない）。
  `rollbackPendingParagraphInsert` は `edit/insertParagraph.ts#canSafelyRollbackParagraphInsert`
  でプレースホルダ paragraph が未編集のまま再解決可能かを検証したうえで、Obsidian の
  `Editor#undo()` を呼ぶ。手動での逆スプライス関数は実装しなかった: (1) rename の textarea
  は commitRename() が走るまで本文に一切書き込まない DOM オーバーレイである、
  (2) `beginRename` 自身の「既に rename 中なら先に cancel する」ガードにより、この rename
  が開いている間に他の Tree 起動編集が割り込むことはない、(3) 本文エディタ自体をクリック
  すると、その操作は必ずこの textarea 自身の blur ハンドラを先に発火させる（プレースホルダ
  未変更のため cancel に帰着する）ため、undo 実行時点でエディタの直近の Undo 履歴エントリ
  は必ず insert 自身の `replaceRange` 呼び出し1件のみであることが構造的に保証される。
  これにより `editor.undo()` は新規の Undo 履歴エントリを一切生成せずに insert
  （プレースホルダ本体＋実際に追加された区切り空行）を正確に取り消し、その後の Redo も
  自然に正しく復元する。`canSafelyRollbackParagraphInsert` が false を返した場合（＝
  何らかの理由でプレースホルダが未編集のまま再解決できない場合）は undo を呼ばず、
  rename box を閉じるだけに留める（プレースホルダは通常の本文として残る）— チケット
  §6/§7 の「resolve不能な場合は安全側no-op」要求への対応。
- **Undo/Redo契約**: 上記の通り、(A) insert から rename 確定までは
  `editor.replaceRange()` が2回（insert 自身の1回、commitRename の1回）呼ばれるため、
  厳密には2つの独立した Undo ステップになる（5T-8A の commitRename 自身の doc comment
  が既に検証している通り、このコードベースでは個々の `replaceRange` 呼び出しは呼び出し
  タイミングや `origin` 引数に関わらず常に独立した Undo ステップになるという Obsidian の
  実測済み挙動があるため、新規の Undo グルーピング機構を追加しない限り単一ステップ化は
  できない）。ただし (B) Cancel/Escape 経路は `editor.undo()` を使うため新規 Undo 履歴を
  一切残さず、プレースホルダの残骸も残らない — これは (B) の「最低限、Cancel/Escape は
  本文にゴミを残さず、Undo 履歴を過度に汚さない」という §7 の最低要件を満たす。(A) の
  2ステップ化は、体感として「insert → 続けて Undo を2回押すと元に戻る」という形になる
  （1回目の Undo で rename 確定分が、2回目の Undo で insert 自体が取り消される）。
- **`edit/listBodyRange.ts` の技術的負債**: 本フェーズでも一切変更していない。5T-9A から
  引き続き別チケットとして切り出すことを推奨する。
- **`parseDocument.ts` / `styles.css`**: 無変更（`git diff --stat` で確認済み）。
