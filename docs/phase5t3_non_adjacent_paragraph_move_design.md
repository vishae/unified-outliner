# phase5t3_non_adjacent_paragraph_move_design

## 0. 位置づけ

Phase 5T-3D は、**設計・既存コード監査・手動評価準備のみ**を行うフェーズ
である。本番ソースコードの変更、GUI 自動操作、実機検証の代行は一切行っ
ていない。基準として Phase 5T-2S（`7e9e7c1`）・5T-2S-B（`842affb`）を受
け入れ、paragraph の Tree context menu 隣接 swap（5T-1系）・Tree D&D 隣
接 swap（5T-2系）・Tree 外 drop の内部 ID 流出修正（5T-2R）・drop
indicator の着地エッジ表示（5T-2S-B）・Source Mode/Reading View 優先6操
作での Tree/本文不一致非再現（5T-2S §6）を、いずれも確定事実として扱う。
paragraph ↔ list の cross-model move は本フェーズの対象外、別課題のまま
とする。

本ドキュメントが答える問いは一つ: 「paragraph を同一 parent・同一 depth
内の非隣接位置へ、安全に一回の編集で移動させる機能を将来実装するなら、ど
のモデル・契約で行うべきか」である。実装の是非そのもの（GO/NO-GO の最終
判断）は利用者判断に委ねる。

## 1. 目的とスコープ

**対象とする操作**: paragraph A を、同じ安全な sibling 群（同一
parentId・同一 depth・`isSafeToMoveComplexBlock` が真となる kind）に属す
る paragraph または許可済み standalone complex block（callout/
blockquote 等）の前後へ、既存位置から切り出して指定位置へ挿入する。

**対象外（本フェーズでも今後も変更しない前提）**:

- section・list item・list subtree の移動（既存の relocate 経路が別途担
  当）
- 異なる parent・異なる depth・異なる section/list item 境界を越える移動
- paragraph ↔ list の cross-model move
- child drop・parent 変更・indentation 変更
- paragraph の rename/delete/insert/indent/outdent・Tree Partial Edit
- `parseDocument.ts` の変更、`ParsedDocument.nodes` への paragraph 追加

## 2. 絶対に維持する原則（再確認）

以下はすべて、既存コードを直接確認して**再確認済み**である（各項目の根拠
は §4 の構造調査を参照）。

| 原則 | 根拠 |
|---|---|
| Markdown 本文が唯一の正 | `refresh()`/`moveParagraphFromAnchor` は常に現行本文の `parseDocument`/`scanComplexBlocks` から再構築する |
| `parseDocument.ts` を変更しない | 本フェーズは読解のみ、diff ゼロを確認済み |
| paragraph を `ParsedDocument.nodes` に追加しない | paragraph は `scanComplexBlocks`（`complexBlocks.ts`）が担当する別モデルのまま |
| paragraph Tree node は read-only・leaf・fold 不可 | `buildOutlineTree.ts` の既存実装を変更していない |
| Tree view id / scan-local id を永続 identity に使わない | `ParagraphMoveAnchor` は `originalText` バイト一致まで含む3段階再検証を必須とする（`resolveAnchorUnit`） |
| source/target とも現行本文から再解決する | 既存の `resolveAnchorUnit`（source）は3段階再検証。target 側の同等契約は新設が必要（§5） |
| ambiguous match では本文を変更しない | `resolveAnchorUnit` の `"ambiguous-match"` reason で既に保証 |
| section/list item/list subtree/異parent/異depth/nested list 境界を越えない | `findComplexSiblingTarget` の `parentId` 一致チェックがこの境界を強制。非隣接版でも同じ境界チェックを継承する必要がある |
| child drop・parent 変更・indentation 変更を行わない | 既存の paragraph 系関数はすべて同一 parentId 内の並び替えのみを扱う。新設する resolver もこの制約を継承する |
| paragraph ↔ list の cross-model move を扱わない | 既存 `findComplexSiblingTarget` は list item を candidate に含めない（`isSafeToMoveComplexBlock`／kind フィルタ） |
| Tree 外 drop を本文貼り付けとして扱わない | 5T-2R の空文字列 payload 化がそのまま有効。変更なし |
| 既存 5T-1 / 5T-2 を回帰させない | 新設する resolver・コマンドは既存の `moveParagraphFromAnchor`（隣接 swap）と**別の関数**として追加し、既存呼び出し経路は変更しない設計を前提とする |

## 3. 案の比較（A/B/C）

以下、共通の入力例を用いる。

```
段落A。
段落B。
段落C。

> [!note] コールアウトX
> 本文。

段落D。
```

目的操作:「段落Aを、コールアウトXの直後（段落Dの直前）へ移動する」。

### 案A: 同一 parent の任意 sibling 前後への一回の移動

段落Aを一度だけ切り出し、指定した target（コールアウトX）の after へ一回
で挿入する。

```
段落B。
段落C。

> [!note] コールアウトX
> 本文。

段落A。

段落D。
```

- 実行は1回の `lines[]` 再構成 → `applyLineEditOutcome` の1回の
  `editor.replaceRange` で完結する。
- 中間 sibling（段落B・C）はそのまま位置を保つだけで、個別に動かす必要は
  ない。

### 案B: 隣接 swap を内部で複数回繰り返す

5T-2 の `moveComplexBlock`（隣接 swap）を、目的位置に到達するまで繰り返
し呼び出す。上の例では「段落A ↔ 段落B」「段落A ↔ 段落C」「段落A ↔ コー
ルアウトX」の3回の隣接 swap が必要になる。

- 各 swap 後に `resolveAnchorUnit` による再解決と `refresh()` が必要（1
  回のユーザー操作のつもりでも、内部的には3回の独立した「移動」が発生す
  る）。
- 3回のうち2回目が失敗した場合（例: 途中で本文が変わった、または
  boundary-unknown になった）、段落Aは「元の位置でも目的の位置でもない、
  中間の位置」に取り残される——ユーザーの意図（1回の移動）と実際の結果
  （中断された複数回移動の残骸）が食い違う。
- 1回の undo で全体を元に戻すには、3回の `replaceRange` を1つの CM6
  transaction にまとめる**新しい**グルーピング機構が必要になる（既存コー
  ドにこの機構はない）。まとめない場合、3回 undo しないと元に戻らず、
  「一回の編集が一回の undo」という §5 の契約に反する。
- move の方向（up/down）の意味が「1step」から「Nstep」に変わり、
  `MoveDirection` 型（up/down の2値）だけでは目的位置を表現できない——
  結局、目的位置を表す何らかの識別子が必要になり、案Aの resolver を先に
  作ることになる。

### 案C: 任意位置を見せず、専用コマンドとして提供する

D&D で「任意位置に挿入できるように見える UI」を採用せず、以下のような
離散的なコマンドとして提供する。

- 「先頭へ移動」「末尾へ移動」（同一 parent 内の先頭/末尾 sibling へ）
- 「指定 sibling の前へ移動」「指定 sibling の後へ移動」（Tree 上で target
  を明示的に選択させる——例えばコンテキストメニューから「移動先を選択」
  → Tree 上で対象行をクリック、または番号選択のモーダル）

このモデルは**UI 層の選択**であり、§3-A の cut-and-reinsert という**mutation
モデル**とは独立である。案Cの各コマンドは、内部的には「target を明示的
に受け取った案Aの resolver」を呼ぶだけで実装できる。

### 3-1. 比較表

| 観点 | 案A（一回の cut-and-reinsert） | 案B（隣接swapの繰り返し） | 案C（専用コマンド、mutationは案Aを利用） |
|---|---|---|---|
| Markdown 書き戻しの複雑さ | 低（既存の `insertBlockAt` を再利用可能、§4） | 高（N回の独立した書き換えを1回に見せる追加の合成が必要） | 低（案Aと同一） |
| source/target の再解決 | 新設が必要だが1箇所（§5） | 各ステップごとに再解決が必要（N倍） | 案Aと同一 |
| 空行の扱い | 新しい規則が必要（§6）だが1回で確定できる | 各 swap ごとに `swapBlocks` の「gapは元位置に残る」規則が適用され、最終結果の空行位置が予測しづらい | 案Aと同一 |
| before/after の意味 | source/targetの相対位置ごとに1回定義すれば済む（§5） | 各ステップのup/downの意味が毎回変わり複雑 | 案Aと同一 |
| undo の一貫性 | 1回の `lines[]` 差分 → 1回の `replaceRange` → 1回のundoで保証（既存の `applyLineEditOutcome` 経路を再利用） | 新しいグルーピング機構が必須（未実装、既存コードにない） | 案Aと同一 |
| Tree 再描画 | 1回の `refresh()` | N回、または最後にまとめての1回（実装次第で挙動が変わりテストが複雑化） | 案Aと同一（1回） |
| selection/highlight/cursor | 既存の「隣接moveでも保証しない」方針をそのまま拡張できる（§5） | 中間状態でselectionが不安定に揺れる可能性が高い | 案Aと同一 |
| D&D の視覚表現 | 「任意位置に見えるUI」を採用する場合は5T-2S-Bの教訓（indicatorの着地エッジ表現）を距離が伸びた分さらに慎重に設計する必要がある | 同上のリスクに加え、中間ステップの視覚表現も必要になり複雑化 | D&Dを採用しないため視覚的な曖昧さのリスクを最小化できる |
| stale drag/stale target | 新設のresolverで1回だけ判定すればよい | 各ステップごとに判定が必要（N倍のstale判定コード） | 案Aと同一 |
| テスト容易性 | 高（純粋関数1個、既存の3系統テスト規約に沿う） | 低（合成ロジック・中断状態のテストが必要） | 高（案Aのresolverをコマンド引数で駆動するだけ） |
| 実機受入の容易性 | 中（新しいUIの実機確認が必要） | 低（中断・部分適用のシナリオが実機でも再現しにくい） | 高（離散的なコマンドは1操作1回のテストで完結） |
| 既存5T-1/5T-2との整合性 | 高（既存のswap経路とは別関数として追加、既存経路は無変更） | 低（既存のswap関数をループで叩く新しい呼び出し方が既存契約の想定外） | 高（既存のswap経路・新しいresolverのいずれとも独立して共存可能） |
| 推奨可否 | **推奨（mutationモデルとして）** | 非推奨 | **推奨（UIモデルとして、案Aと併用）** |

### 3-2. 結論

mutation モデルは**案A**、UI モデルは**案C**を推奨する。両者は独立した
軸であり、「案Aのresolverをmutationの土台とし、UIは当面D&Dを採用せず専
用コマンドに限定する」という組み合わせが、既存コードとの整合性・テスト
容易性・実機受入の容易性のいずれの観点からも最も安全である。案Bはいずれ
の観点からも推奨しない。

## 4. 必須の構造調査

指示にある各対象を実際に読解した。結論を先に示す: **cut-and-reinsert の
mutation プリミティブ自体は既に存在する**（`move/moveBlock.ts` の
`insertBlockAt`）。これは section/list の cross-section list hop
（`findMoveTarget` の `"insert"` kind）が既に使っている汎用的な純粋関数
であり、paragraph/complex-block 用に**新設が必要なのは「どの target に
挿入するかを安全に解決するresolver」の部分だけ**である。

### 4-1. 再利用可能な部分

| 対象 | 現状 | 非隣接move での再利用可否 |
|---|---|---|
| `move/moveBlock.ts#insertBlockAt` | source range を切り出し、`insertBeforeLine`（**元の行番号系**で指定してよい）の直前に再挿入する汎用純粋関数。source が target より前/後どちらでも、内部で `idx -= block.length` により**自動的にオフセット補正**する。「末尾から処理する」ような特別な順序は不要（既に解決済みの問題） | **そのまま再利用可能**。paragraph/complex-block 用の新しい cut/insert アルゴリズムを書く必要はない |
| `move/moveBlock.ts#insertBlockAt` の重なり時フォールバック | `insertBeforeLine` が source 自身の range 内に落ちた場合、`idx = source.startLine` に**黙って**クランプする | この黙ったフォールバックを安全機構として**信用してはならない**。新設resolverが「source/targetのrangeが重なる場合は呼び出し前に拒否する」契約（§5）を持ち、`insertBlockAt` に矛盾した引数を渡さないことで保証する必要がある |
| `edit/paragraphTreeMove.ts#resolveAnchorUnit` | source（移動元）の3段階再解決（id候補→構造一致→content一致→document全体でのambiguity検査）。既にparagraph用に実装済み | **そのまま再利用可能**。sourceの解決はこの関数に委譲する |
| `edit/paragraphTreeMove.ts#buildParagraphMoveAnchor` / `ParagraphMoveAnchor` | Tree row から安全なアンカーを構築する型・関数 | **そのまま再利用可能**。sourceのアンカーはこの型のままでよい |
| `move/resolveMoveTarget.ts#isSafeToMoveComplexBlock` | 対象kindが移動候補として安全か（editability等）を判定 | **そのまま再利用可能**。新設resolverのcandidate絞り込みに使う |
| `commands/applyLineEditOutcome.ts` | 最小差分の `editor.replaceRange` 1回で書き戻し、cursor復元。既存のmove/no-op処理と共通 | **そのまま再利用可能**。新しいoutcome型を`LineEditOutcome`のサブタイプとして作れば、この関数は変更不要 |
| `parser/complexBlocks.ts#scanComplexBlocks`/`complexBlockDepth` | 現行本文からのcandidate列挙・depth計算 | **そのまま再利用可能** |

### 4-2. 新設が必要な部分

| 対象 | 必要な理由 |
|---|---|
| target 解決関数（`findComplexSiblingTarget` の一般化） | 既存の `findComplexSiblingTarget` は「**最も近い**隣接candidateを1つ返す」設計であり、`ComplexSiblingTarget` 型も `{kind:"swap"}` のみで `insert` variantを持たない。任意のsiblingをtargetとして受け取り、それが「今この瞬間、本当にsourceと同一parent・同一depthの安全なsibling群に属しているか」を再解決する**新しい型・新しい関数**が必要 |
| target 側の安全なアンカー（`ParagraphMoveAnchor` 相当のtarget版） | 現状、target解決はTree hint（`rangeStart`/`rangeEnd`/`parentId`）からのみ行われ、**paragraph宛のtarget再解決に content一致までの多段検証はない**（`resolveParagraphFromTreeHint` はambiguity拒否のみでcontent一致は見ない）。target が非隣接になった分、drag開始時とdrop時の間で target 自体が変化している可能性も高くなるため、target側にも `ParagraphMoveAnchor` 相当（idヒント→構造一致→content一致→ambiguity拒否）の再解決契約を新設すべき |
| 挿入位置と空行の計算ロジック | `insertBlockAt` はinsertBeforeLineの直前に**そのまま**挿入するだけで、空行の追加・除去は一切行わない。paragraph同士が空行なしで隣接すると**1つのparagraphに融合する**ため、新設resolverが挿入前後に空行を補う/確認するロジックを持つ必要がある（§6） |
| `MoveComplexBlockOutcome`/`ComplexSiblingTarget` に相当する新しいinsert版の型 | 既存型はswap専用。`{kind:"insert", insertBeforeLine, gapPolicy}` のような新しいunion memberか、既存とは独立の新しい型が必要 |
| Tree UI側: target選択のためのコマンド・ハンドラ | §3で推奨した案Cのコマンド（先頭へ/末尾へ/指定siblingの前後へ）、またはtarget pickerのUI配線。既存の `showParagraphMoveMenu`/`dispatchAndApplyParagraphMove` は「up/down 1step」専用のシグネチャであり、targetを受け取る新しいシグネチャの追加が必要 |
| Tree selection/highlight/cursor followの新しい方針 | 既存の「隣接moveでも保証しない」という受け入れ済みの制限を、移動距離が伸びる非隣接moveでもそのまま維持するか、再検討するかの利用者判断が必要（§5） |
| CM6 undo group | 新設は不要と判断する。理由は §6 参照（既存の`applyLineEditOutcome`の1回`replaceRange`契約を維持すれば、新しいグルーピング機構なしに1回のundoが保証される） |

### 4-3. 既存の section/list D&D relocate 経路について

`move/relocateSection.ts`/`move/relocateListSubtree.ts` は、既に
`ParsedDocument.nodes` の永続的な node id（section/list）を前提に、
before/after/insideの3値で任意位置への挿入を行っている——つまり
section/listは**すでに非隣接moveを持っている**。しかし5T-2D（既存ドキュ
メント §14）で確認済みの通り、これらはid空間・親変更の可否・書き戻し経
路のいずれもparagraphの前提と異なり、そのままの再利用はできない。ただし
「非隣接insertを安全に行う」という**構造上の考え方**（before/after/
insideをtargetの相対位置として明示的に定義する設計）は参考にできる——
本ドキュメント §5の契約はこの考え方をparagraph向けに再定義したものであ
る。

## 5. 文書として固定すべき契約

### 5-1. source / target 解決

- source は既存の `ParagraphMoveAnchor` と既存の三段階検証
  （`resolveAnchorUnit`）で解決する。**変更しない**。
- target は Tree view id、scan-local id、表示 text 単独には依存しない。
  target 側にも「idヒント → parentId/depth構造一致 → content(originalText)
  バイト一致 → document全体でのambiguity拒否」という、sourceと同型の
  再解決契約を新設する。
- target が source と同一（rangeStart/rangeEnd/parentIdが一致）なら拒
  否する（`"self-drop"` 相当）。
- target が複数candidateにambiguousな場合は拒否する。
- 本文が変化し、分割・結合・削除・種類変化・親/深さ変化が生じた場合は、
  source側・target側どちらであってもno-opとする。
- source と target が同一parentId・同一depthでない場合はno-opとする
  （既存の `findComplexSiblingTarget` のparentId一致チェックと同じ制約
  をtargetにも適用する）。

### 5-2. 挿入位置

- **before/afterの定義**: 「targetの前」とは、targetのrange.startLineの
  直前に挿入することを意味する。「targetの後」とは、targetのrange.endLine
  の直後に挿入することを意味する。
- **source/targetの相対位置によるindex補正**: `insertBlockAt` が既に
  `insertBeforeLine`（**移動前の行番号系**で表現してよい）を受け取り、
  内部で source 除去後のオフセットを自動補正する（§4-1）。新設resolver
  は、source側のrangeを保持したまま「移動前の行番号系での insertBeforeLine」
  を計算して`insertBlockAt`に渡すだけでよく、呼び出し側で二重に補正する
  必要はない。
- **sourceとtargetが隣接している場合**: 既存の隣接swap（`moveComplexBlock`）
  と等価な結果になる（cut-and-reinsertでも隣接なら実質的にswapと同じ行
  順序になる）。新設resolverは隣接ケースを特別扱いする必要はなく、同じ
  cut-and-reinsertロジックで正しい結果が出ることを確認する（回帰テスト
  候補）。
- **sourceとtargetのrangeが重なる場合は拒否する**: `insertBlockAt`の黙っ
  たクランプ（§4-1）に依存せず、resolver層で明示的に拒否する。
- **文書先頭・末尾、section内先頭・末尾、list item本文内先頭・末尾**:
  いずれも「同一parentId内のsibling群のうちの最初/最後」として表現でき
  るため、特別扱いのコードパスを新設する必要はない——「先頭へ移動」
  「末尾へ移動」（案C）は、同一parent内のsibling列の最初/最後をtarget
  として選ぶ通常のcaseとして実装できる。
- **空行の帰属**: `scanComplexBlocks`（`scanParagraphBlocks`含む）は空行
  を一切rangeに含めない——空行は常にどのblockにも属さない「隙間」であ
  る（既存の一貫した規則、変更しない）。cut-and-reinsertの新しい規則と
  して、以下を明文化する。
    - source を切り出した後、元の位置に残る隙間（前後の空行）は
      **そのまま残す**（既存の`deleteBlock.ts`/`deleteCompositeBlock.ts`
      の「空行の後始末をしない」という確立された規約に合わせる）。
    - target への挿入時は、挿入したparagraphの**前後どちらか本文側と
      空行なしで隣接する側があれば、区切りの空行を1行補う**——これは
      既存規約からの新しい要件であり、section/listのようにmarker/heading
      で自己区切りされないparagraph特有の必要性である（§6で詳述）。
- Markdown 本文の最終改行は維持する（既存の`applyLineEditOutcome`の
  diff-and-replace契約がこれを保証している前提を継続する）。
- **undo**: 新設resolverは最終的に1個の`lines[]`を返し、既存の
  `applyLineEditOutcome`（1回の`editor.replaceRange`）に渡すだけでよい
  設計にする。これにより、CM6側で新しいtransactionグルーピング機構を実
  装しなくても「1回の編集が1回のundo」という契約が既存コードの延長で自
  動的に満たされる。

### 5-3. UI

- D&D は当面採用しない。§3の結論の通り、mutationモデル（案A）とUIモデ
  ル（案C、専用コマンド）を組み合わせることを推奨する。
- D&D を将来採用する場合の条件（今回は実装しないが明文化しておく）:
  5T-2S-Bで確認された「indicatorは判定用のzoneでなく、実際の着地edgeで
  描画する」という契約を、移動距離が伸びた非隣接moveでも維持できること
  が前提になる。具体的には、中間に存在するsibling群の上をホバーしてい
  る間はindicatorを出さない（invalid slot）、target候補の直前/直後にの
  みindicatorを出す、という設計が必要になる。
- target row のbefore/after indicator: 案Cでコマンド実行後にTree上で
  target行を選択させる場合も、選択中の行に一時的なハイライト（既存の
  highlightedId/selectedIdの仕組みを再利用可能）を出す。
- invalid slot（同一parent/depthでないsibling、対象外kind）にはindicator
  を出さない。
- child/inside indicatorは出さない（paragraphに子要素という概念がない
  ことに変更はない）。
- context menuとキーボードの代替操作: 案Cのコマンドは、既存の
  `showParagraphMoveMenu`と同じコンテキストメニュー経路に追加する形が
  既存UIとの一貫性が高い。キーボードショートカットの追加は本フェーズの
  対象外とし、次フェーズでの検討事項とする。
- モバイル対応は別設計とする（本フェーズでは扱わない）。

## 6. 成果物と完了条件

本フェーズ（5T-3D）は設計・調査・利用者向け判断材料の作成のみを対象と
し、以下を成果物とする。

- 本ファイル（`docs/phase5t3_non_adjacent_paragraph_move_design.md`）。
- `docs/phase5t_tree-interaction-move-design.md` への追記（本ドキュメント
  への参照リンクと結論の要約）。
- 利用者が手動で判断するための Method Vault ノート（Claude 自身は GUI
  操作・スクリーンショット・実機確認を行わない。ノートは判断材料の提示
  のみを目的とする）。
- 本フェーズはドキュメントのみの変更であり、`src/` 以下の本番コード、
  CSS、`manifest.json`、ビルド生成物、および `parseDocument.ts` はいずれ
  も変更しない。`tests/debug.test.ts` は本フェーズのスコープ外であり、
  削除・権限修復・`.gitignore` 変更のいずれも行わず、`git add` もしない。

### 6-1. 次フェーズより前に利用者が判断すべき事項

1. 案A（1回のcut-and-reinsert）を次フェーズの実装対象として採用してよ
   いか。案B（隣接swapの繰り返し）は本ドキュメントの比較により非推奨と
   結論しているが、この結論に異論がないか。
2. UI として案C（専用コマンド: 先頭へ/末尾へ/指定siblingの前へ/指定
   siblingの後へ）の方向性でよいか。それとも将来的にD&D拡張を優先した
   いか。
3. §5-2 で提示した「target側に隣接する本文との間に区切り空行を挿入す
   る」というparagraph特有の新規ルールについて、空行挿入の実装（自動挿
   入）でよいか、それとも移動を拒否する（安全側に倒す）方が望ましいか。
4. 案Cのコマンド群を実装する場合、どの経路から呼び出せるようにするか
   （既存のcontext menu `showParagraphMoveMenu` への追加のみで十分か、
   コマンドパレット/キーボードショートカットも同時に必要か）。
5. 本ドキュメント §2 で確認した「paragraph↔list cross-model move」は
   引き続き別トピックとして扱うことに同意するか（本フェーズのスコープ
   には含めない前提で進めてよいか）。
