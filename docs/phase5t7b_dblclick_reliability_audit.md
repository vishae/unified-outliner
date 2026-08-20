# Phase 5T-7B: Outline Tree 行のダブルクリック信頼性問題 設計監査（docs-only）

本ドキュメントは、Phase 5T-7A（paragraph の dblclick/F2 起動）の実機受入テスト中に利用者から報告された「ダブルクリックが効かない」不具合の調査記録である。調査の結果、この不具合は 5T-7A で新規に書いたコード固有の欠陥ではなく、Outline Tree の行（heading／list／paragraph のいずれも）に共通する、既存の・より根本的な問題であることが判明した。5T-6D の監査文書と同じ方針に従い、実装には着手せず、確認済み事実と未確認の仮説を明確に分離した上で、根本原因候補・改善案の比較・検証手順・利用者判断事項を整理する。

## 0. 経緯

Phase 5T-7A の完了後、利用者による実機確認で以下2件の不具合が報告された。

1. paragraph row のダブルクリックで何も起こらない。
2. 選択中の paragraph row で F2 を押しても何も起こらない。

調査の結果、(2) の F2 については、利用者の Obsidian 側で F2 キーに別のコマンドが割り当てられており、そのバッティングが原因であったことが確認された（コード側の不具合ではない）。バッティング解消後、F2 は設計通りに Paragraph Partial Edit Pane を起動することが確認された。

(1) のダブルクリックについては、追加のヒアリングにより次の事実が判明した。

- Outline Tree パネルを**左サイドバー**に配置した場合、ダブルクリックで Partial Edit Pane が開いたのは（テスト中）**1回のみ**で、以降は反応しなくなった。
- Outline Tree パネルを**右サイドバー**に配置した場合は、ダブルクリックで Partial Edit Pane が**毎回**開くようになった。
- この左右差は **paragraph だけでなく、heading・list のダブルクリックによるインライン rename でも同様に発生する**。

3点目が重要な事実であり、これは 5T-7A の新規コード（paragraph 専用の dblclick 分岐）とは無関係に、Phase 2〜3 の時点から存在していた既存の rename-dblclick 機構自体に及ぶ、横断的な問題であることを意味する。そのため、この監査は paragraph に限定せず、Outline Tree の行全体のダブルクリック処理を対象とする。

## 1. 確認済み事実（コードを直接確認したもの）

### 1.1 全 row 共通: `draggable="true"` とダブルクリックの共存

`src/view/OutlineTreeView.ts` の `renderNode()` 内、`!readOnly` の行（heading・list。paragraph は別途 `else if (isOutlineParagraphNode(node) && !Platform.isMobile)` の専用分岐）は、デスクトップ環境で `selfEl.setAttribute("draggable", "true")` を設定する（D&D のため、Phase 3A/4A/UXP-01 以来の既存挙動）。この `dragstart` 判定には、マウスの最小移動量に関するガードが一切存在しない。同じ `selfEl` に、rename 用（`!readOnly` 行）・paragraph Partial Edit 用（paragraph 行）の `dblclick` リスナーが、いずれも行全体（`selfEl`）に対して張られている。

### 1.2 全クリックで `renderTree()` が走る

`click` リスナー（`selfEl` に無条件で付与、行の種類を問わない）は `this.selectedId = node.id` の後に `this.jumpToLine(node.id, node.line, { focusEditor: false })` を呼ぶ。`jumpToLine` は最後に `this.highlightedId = id; this.renderTree();` を無条件に実行しており、`renderTree()` は `this.treeRootEl.empty()` から全行を再構築する。つまり **クリック1回ごとに Outline Tree の DOM が丸ごと作り直される**。ただし、この挙動は左右サイドバーで共通であり、それ自体は左右差の説明にはならない。

### 1.3 `hasFocus`／blur ハンドラの副作用は限定的

`treeRootEl` の blur ハンドラ（`OutlineTreeView.ts:598-612` 付近）は `renameState` が無ければ `this.hasFocus = false` として `renderTree()` を呼ぶのみで、`selectedId` のクリアや `renameState` への干渉は無い。`hasFocus` は選択行のハイライト表示（`isSelected` 判定）とモバイル専用のタップ挙動にしか使われておらず、dblclick リスナーの張り直し自体は `renderTree()` のたびに行われるので、focus 状態が dblclick リスナーの有無に影響することはない。

### 1.4 `activatePartialEditViewForParagraph` の配置ロジック（既存仕様）

`src/main.ts#activatePartialEditViewForParagraph`（Phase 5P-2、`activatePartialEditView` とは独立実装）は、既存の Partial Edit Pane leaf があれば再利用し（`existing[0]`）、無ければ新規に開く。新規に開く際、`hasOutlineTreeLeafInLeftSidebar`（`src/view/outlineTreeLeafPlacement.ts`、UXP-03b で導入）で「Outline Tree が左サイドバーにあるか」を判定するが、**判定結果は「右サイドバーを split するかどうか」だけに使われ、常に `workspace.getRightLeaf(...)` が呼ばれる**（`getLeftLeaf` は一切使われない）。これは UXP-03b の**意図的な仕様**であり（左に Outline Tree、右に Partial Edit Pane を並べて表示するための設計）、バグではない。

そのため、Outline Tree が左サイドバーにある場合、Partial Edit Pane は常に右サイドバーに開く。`workspace.revealLeaf(leaf)` によって、左サイドバー内で完結する操作（Outline Tree が右サイドバーにある場合）と比べ、**左サイドバーから右サイドバーへとワークスペース全体をまたぐフォーカス移動**が発生することになる。

### 1.5 F2 の別件不具合は、コード側の欠陥ではなかった

前述の通り、F2 が反応しなかった原因は Obsidian 側のホットキー競合であり、5T-7A で実装した F2 分岐のコード自体は意図通りに動作することが確認済みである。本監査の対象はダブルクリックのみである。

## 2. 未確認の事実・仮説（コード上の証拠だけでは判定できないもの）

- ブラウザ（Chromium/Electron）が、`draggable="true"` の要素に対して、実際の物理マウス移動がどの程度あれば dragstart と判定するか。トラックパッド操作の「揺れ」がこの閾値を超えるかどうかは、本リポジトリのコードからは検証できない。
- `workspace.revealLeaf()` が Obsidian コア内部でサイドバーの表示・フォーカス状態にどう作用するか、特に「左サイドバーが表示された状態で右サイドバーへ revealLeaf する」場合と「右サイドバー内で revealLeaf する」場合とで、コア側の挙動に差があるかどうか。これは Obsidian 本体のソースに依存し、本プラグインのコードでは確認できない。
- 「左サイドバーでは1回だけ成功し、以降失敗する」という現象が、①そもそも Partial Edit Pane を一度も開かなくても（rename だけを繰り返しても）再現するのか、②Partial Edit Pane が一度開いたことが引き金になっているのか、の切り分けはまだできていない。1.3 節の heading/list の rename でも同様の左右差が報告されているため、Partial Edit Pane を経由しない reproduction（heading の rename dblclick のみを左サイドバーで連続して行う）でも同じ現象が起きるかどうかが、原因の切り分けに重要な情報となる。

## 3. 根本原因候補（可能性の高い順）

| 候補 | 内容 | 左右差の説明力 | 本プラグインのコードで修正可能か |
|---|---|---|---|
| ① ネイティブ `draggable` とダブルクリックの衝突 | 最小移動量ガードの無い `draggable="true"` により、実際のダブルクリック操作がブラウザに微小ドラッグと誤認され、`click`/`dblclick` が発火しない | **弱い**（左右で発生条件が変わる理由が無い。汎用的な信頼性問題として、左右どちらでも一定確率で起こるはず） | 可能（ただし D&D 判定ロジックへの変更を伴う） |
| ② サイドバーをまたぐ `revealLeaf` によるフォーカス遷移の副作用（Obsidian コア） | Outline Tree（左）→ Partial Edit Pane（右）という、サイドバーをまたぐ `workspace.revealLeaf` が、同じ右サイドバー内で完結する遷移よりも大きな再フォーカス／レイアウト変更を Obsidian コア側に引き起こしている | **強い**（左右差の直接的な説明になる。ただし heading/list の rename dblclick（Partial Edit Pane を一切開かない操作）でも同じ左右差が報告されている点との整合性は未検証 — 2節参照） | **不可**（Obsidian コア側の挙動であり、本プラグインのコードの外側） |
| ③ `renderTree()` の全体再描画とクリックタイミングの競合 | クリックのたびに全行が再構築されるため、大きいツリーで2回目のクリックのタイミングと再描画完了が競合する余地がある | 弱い（左右で差が出る理由が無い） | 可能（再描画をより差分的にする等） |
| ④ その他（hasFocus/blur、nodeById 解決失敗、Partial Edit Pane 配置ロジック自体のバグ） | 個別に調査したが、いずれもコード上明確な欠陥は見つからなかった | — | — |

現時点で最も有力なのは②だが、これは本プラグインの外側（Obsidian コア）の挙動であるため、確実な修正はプラグイン単体では困難である可能性が高い。一方、①は左右差そのものは説明しないが、独立した信頼性問題として実在する可能性があり、②と①が併発している可能性も否定できない。2節で述べた「Partial Edit Pane を経由しない heading rename のみでの左サイドバー再現テスト」が、①と②を切り分ける最も重要な次の一手である。

## 4. 改善案の比較（実装は行わない、比較のみ）

| 案 | 内容 | 長所 | 短所・リスク |
|---|---|---|---|
| A. `draggable` の誤発火ガードを追加 | mousedown〜dragstart までの移動量が小さい場合に `dragstart` を `preventDefault()` してキャンセルする、または一時的に `draggable` を外す等の迂回策 | ①の候補に直接対処できる。全サイドバー配置に効く可能性がある | D&D 関連コードへの変更を伴うため、過去チケットで一貫していた「D&D 判定ロジック・移動ロジックには触れない」制約に抵触する。効果があるかは②が主因だった場合には限定的 |
| B. ネイティブ dblclick に依存しない独自のダブルクリック検出へ移行 | `pointerdown`/`pointerup` ベースで自前にダブルクリックを検出する（モバイルの長押し検出と同様の手法） | ドラッグ判定と competing しない、独立した検出になる。①を根本的に回避できる | 変更範囲が heading/list/paragraph 全体に及び、影響範囲が大きい。②が主因だった場合はやはり効果が限定的 |
| C. 静観・運用上の回避策として案内する | プラグイン側の修正は保留し、「Partial Edit Pane を頻繁に使う場合は Outline Tree を右サイドバーに配置することを推奨する」旨をドキュメント化するに留める | 実装リスクがゼロ。②が Obsidian コア起因であれば、これが最も確実な対応になる可能性がある | 左サイドバー運用の利用者にとって不便が残る。①が独立して存在する場合はこの案では解決しない |
| D. Partial Edit Pane の配置ロジックを変更し、Outline Tree が左サイドバーにある場合は新規 Pane も左サイドバー（split）に開くようにする | `hasOutlineTreeLeafInLeftSidebar` の判定結果を使って `getLeftLeaf` 側に開く分岐を追加する | サイドバーをまたぐフォーカス遷移自体を無くせる可能性がある | UXP-03b で意図的に確定した「左に Outline Tree・右に Partial Edit Pane」というレイアウト方針を変更することになるため、独立した合意形成が必要。根本原因が本当に②なのか未検証な段階でこの変更に踏み切るのはリスクがある |

## 5. 自動テスト計画（限界の明記）

この不具合の性質上（ネイティブ HTML5 D&D の発火閾値、Obsidian コアのフォーカス管理、実際のマウス操作のタイミング）、vitest 環境の静的ソーステキスト検証では**再現も検証もできない**。これは 5T-6A/5T-7A までに使ってきたテスト手法の限界であり、正直にそう明記する。改善案が確定した段階で書けるのは、せいぜい次のような「意図した変更が確かにコードに存在すること」を確認する構造的テストに限られる。

- 案A採用時: dragstart ハンドラに移動量ガードのロジックが存在すること（閾値の妥当性そのものはテストできない）。
- 案B採用時: pointerdown/pointerup ベースの新しいダブルクリック検出ロジックが、対象行すべてに一貫して配線されていること。
- 案D採用時: `hasOutlineTreeLeafInLeftSidebar` の判定結果に応じて `getLeftLeaf`/`getRightLeaf` が正しく分岐すること（`outlineTreeLeafPlacement.test.ts` 的な既存の単体テストパターンを踏襲できる）。

いずれの案でも、「実機でダブルクリックが実際に毎回反応するかどうか」という核心部分は、利用者による実機確認に依存せざるを得ない。

## 6. 手動検証手順（原因切り分け用、次のアクションとして提案）

以下は実装前の追加切り分けとして、利用者にお願いしたい再現テストの案である。

1. Outline Tree を左サイドバーに配置した状態で、**Partial Edit Pane を一切開かず**、heading 行のダブルクリック rename だけを5〜10回連続で試す。何回目から反応しなくなるか（あるいは最初から不安定か）を記録する。
2. 同じ手順を右サイドバーで行う。
3. 1・2の結果を比較し、「Partial Edit Pane を経由しなくても左サイドバーで劣化するか」を確認する。経由しなくても劣化するなら候補①（ドラッグ誤判定）が濃厚、Partial Edit Pane を開いた後にだけ劣化するなら候補②（サイドバーをまたぐ revealLeaf）が濃厚と判断できる。
4. 可能であれば、ダブルクリックの2回のクリックの間に意識的にマウスを全く動かさないよう慎重に操作した場合と、通常通り操作した場合とで、失敗頻度に差が出るかも記録する（候補①の直接的な傍証になる）。

## 7. 利用者の判断が必要な事項

1. 上記6節の追加切り分けテストを先に実施するか、それとも現時点の情報（左右差の報告）だけで4節のいずれかの改善案に進むか。
2. 改善に進む場合、D&D 判定ロジックへの変更（案A・B）を許可するか、Partial Edit Pane の配置ロジック変更（案D、UXP-03bの方針変更を伴う）を許可するか、あるいは静観（案C）を選ぶか。
3. 根本原因が Obsidian コア側（候補②）であった場合、プラグイン側での完全な解決が困難である可能性を許容できるか（その場合、案Cのような運用上の回避策が現実的な着地点になる）。

## 8. Phase 5T-7C 実装確定事項（追記）

利用者による追加切り分け試験（heading/list rename のみ、Partial Edit Pane 不使用、左右サイドバー各8試行以上）の結果、**左右いずれのサイドバーでもダブルクリックが不安定**であることが確認された。これにより、3節の候補②（サイドバーをまたぐ `workspace.revealLeaf` のフォーカス遷移）は主要因から除外され、候補①（`draggable="true"` とネイティブ `dblclick` の一般衝突）を主対象として、Phase 5T-7C を実施した。

### 採用した方針

4節の改善案のうち、**案Aでも案Bでもない、両者の折衷**を採用した。すなわち、`draggable` 属性・`dragstart`/`dragover`/`drop`/`dragend`・`computeDropMode`・`runRelocateCommand` には一切触れず、rename／paragraph Partial Edit 起動のトリガーだけを、ネイティブ `dblclick` から `pointerdown` ベースの独立二重クリック検出へ置き換えた。既存の native `dblclick` リスナーは完全に削除し、並存させていない。

### 実装

- 新規ファイル `src/view/rowDoubleClickDetector.ts`: Obsidian/DOM ランタイム非依存の純粋関数。
  - `isDoubleClickPointerDown(current, previous)`: 同一 `nodeId`、時間差 `DOUBLE_CLICK_TIME_THRESHOLD_MS`（400ms）以内、距離 `DOUBLE_CLICK_DISTANCE_THRESHOLD_PX`（6px、ユークリッド距離）以内の3条件で二重クリックと判定。
  - `isEligibleRowBodyPointerDown(...)`: 主ボタン（`button === 0`）かつ主ポインタ（`isPrimary`）、collapse spacer 上でない、drag handle 上でない、の4条件で候補対象かを判定。
- `src/view/OutlineTreeView.ts`:
  - 新規フィールド `private lastRowPointerDown: RowPointerDownRecord | null = null`（View インスタンス単位、`renderTree()` による全体再描画をまたいで保持）。
  - `renderNode` の rename 用（`!readOnly`）・paragraph Partial Edit 用（`else if (isParagraph)`）の両ブランチの native `dblclick` リスナーを、共通の `private handleRowPointerDownForDoubleClick(...)` を呼ぶ `pointerdown` リスナーへ置き換え。起動先（`beginRenameForNode`／`openParagraphPartialEditFromTree`）は無変更。
  - `evt.stopPropagation()` は二重クリックが実際に成立した場合のみ呼び出し、1回目のポインタ押下では呼ばない（既存の `click` リスナーによる `selectedId` 更新・`jumpToLine` は従来通りそのまま発火する）。

### 対象外（無変更を確認済み）

`draggable` 属性の設定箇所（`selfEl.setAttribute("draggable", "true")` / `dragHandleEl?.setAttribute("draggable", "true")`）、`handleDragStart`／`handleDragOver`／`computeDropMode`／`runRelocateCommand`／`handleParagraphDragStart` はいずれもテキストレベルで無変更。F2 経路（`case "F2"`）・context menu（`showParagraphMoveMenu`、`contextmenu` リスナー）も無変更。`parseDocument.ts`・`styles.css` は diff なし。

### テスト

- 新規 `tests/rowDoubleClickDetector.test.ts`（16件）: 純粋関数の直接テスト（時間・距離のしきい値境界、斜め移動のユークリッド距離判定、右クリック・補助ボタン・非主ポインタの除外、collapse/drag handle の除外）。
- `tests/paragraphPartialEditLaunchUiWiring.test.ts` を全面改訂（旧10件→新17件）: pointerdown 配線・二重クリック状態の同一性・native dblclick 不在・D&D 無変更・F2/context menu 無回帰の各確認。
- `tests/paragraphOutlineTreeUiWiring.test.ts` の該当1件を pointerdown ベースの記述へ更新。
- 全体 `npx vitest run`: 74ファイル/1289件全通過。tsc/lint/build いずれも成功（lint は既存の無関係な警告3件のみ、エラー0件）。

### 残した制約・既知の限界

- 自動テストはいずれも静的ソーステキスト検証であり、実際に実機で二重クリックとして安定検出されるかどうかの核心部分は検証できていない。実機確認が必須。
- モバイル（`Platform.isMobile`）に対する明示的な条件分岐は追加していない（旧 `dblclick` リスナーも同様にモバイルを特別扱いしていなかったため、最小変更の原則に従い踏襲）。モバイルの長押し検出用 `pointerdown` リスナーとは独立に共存するが、理論上は長押しの最初の押下も本検出の「1回目」として記録され得る（従来の dblclick 依存でも類似の曖昧さは存在しており、新規に持ち込んだ問題ではない）。
- 時間閾値（400ms）・距離閾値（6px）は暫定値であり、実機確認の結果次第で調整が必要になる可能性がある。
