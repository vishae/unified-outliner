# Phase 5D-4D: Mobile CompositeBlock Drag Handle 設計メモ

## 前提

Phase 5D-4C(CompositeBlock Atomic Drag-and-Drop)は、デスクトップ環境に
おいて隣接移動(`moveCompositeBlock`)・非隣接ドロップ(`dropCompositeBlock`)
の両方を実装・テスト・実機受入済みである。モバイルでは、CompositeBlock
親行を長押しすると開くコンテキストメニューから、隣接1段のみの Move
up/down が既に実行できる(`showCompositeCommandMenu`、Phase 5C-1 ticket
3b)。

今回の確定方針は、この長押しメニューの「拡張ブロックを上へ移動」「拡張
ブロックを下へ移動」を削除・置換・意味変更しないことを前提とする。両者
は隣接 Move の明示的な操作入口として維持したうえで、セクション/リスト
行の左端に既にある六点(grip-vertical)ドラッグハンドルを CompositeBlock
親行にも付与し、そのハンドルを掴んで before/after の任意位置へドラッグ
することで、デスクトップの CompositeBlock D&D と同じ安全な機能範囲(隣
接移動・非隣接ドロップの両方)をモバイルでも実行できるようにする。長押
しメニューと六点ハンドルは補完関係にある2つの操作入口であり、両者の間
で安全条件を迂回できる差を作ってはならない。モバイル専用の新しい本文編
集ロジック・resolver・executor は一切作らず、デスクトップと全く同じ
`moveCompositeBlock`/`dropCompositeBlock` およびその周辺の snapshot・
再解決・fail-closed 経路をそのまま再利用する。

本メモは、今回の指示(確定方針、4節構成)に基づき §1〜§4 を更新したもの
である。直前に作成した
`docs/phase5d4d_mobile_composite_block_move_buttons_design.md`(隣接1段
のみのタップボタンを検討したもの)は git 未追跡のまま削除済みであり、既
に存在しない。より前に作成した
`docs/phase5d4d_mobile_composite_block_move_controls_design.md`(長押し
メニュー経路の調査メモ)は今回の指示の対象外のため変更していない。§5〜
§7(テスト計画・変更予定ファイルと非対象・実装開始ゲート)は、今回の確
定方針で明示的な指示がなかったため、§1〜§4 の更新内容(特に§3で新たに
確定した入力モデルの事実)との整合を保つ範囲で軽微な更新のみを行い、削
除はしていない。この判断が推測に基づく独断とならないよう、更新結果の報
告時に明示する。

## 1. 機能範囲を確定する

`src/view/OutlineTreeView.ts` を実際に読んで確認した既存実装(Phase
5D-4C・UXP-01)に基づき、許可すること/許可しないことを次のとおり確定す
る。

### 1.1 許可すること

| 項目 | 内容 |
| --- | --- |
| source | CompositeBlock 親行のみ |
| target | plain list 行、または他の CompositeBlock 親行のみ |
| drop zone | before/after の二値のみ(inside は無し) |
| 位置の一致条件 | 同一 section・parentId・depth・indentColumns のみ |
| 隣接 drop | 既存 `moveCompositeBlock` を使う |
| 非隣接 drop | 既存 `dropCompositeBlock` を使う |
| 再利用の範囲 | デスクトップと同一の snapshot・再解決・構造安全判定・
raw text 保存・fail-closed 経路をそのまま再利用する |
| 対応する composite 種別 | List+Callout・List+Quote の両方(`isComposite`
のみで判定され、composite の内部種別による分岐は無いため、両方が等しく
対象になる) |
| ドロップ表示 | デスクトップの before/after ドロップインジケータ
(`setDropIndicator`/`unified-outliner-drop-before`/`-after`)をそのま
ま再利用する |

### 1.2 許可しないこと

| 項目 | 内容 |
| --- | --- |
| member/complex-member 行を source にすること | 許可しない。ハンドル
は CompositeBlock 親行にのみ付与する |
| paragraph/section/plain list 行を source にすること | 許可しない(こ
れらは既存のまま、本チケットでは一切変更しない) |
| CompositeBlock 内部への drop | 許可しない(`composite-internal-boundary`
判定により既存のまま拒否) |
| inside drop zone | 許可しない(zone は before/after の二値のみ) |
| self-drop | 許可しない |
| 異なる section/parentId/depth/indentColumns への drop | 許可しない |
| target ambiguity | 許可しない |
| source snapshot mismatch | 許可しない |
| source 再解決不能 | 許可しない |
| target 再解決不能 | 許可しない |
| モバイル専用の resolver/executor/書き換え経路の新設 | 許可しない |
| callout/blockquote/list marker/indent/fold marker/タイトル/本文の再シ
リアライズ | 許可しない |
| ハンドル以外での composite 行の native HTML5 D&D 化 | 許可しない
(`selfEl` 自体をモバイルで draggable にすることはしない。ドラッグ起点
は六点ハンドルのみに限定する) |
| member/complex-member 単位での移動 | 許可しない |
| 非隣接 D&D 用の新しい本文書き換え関数の新設 | 許可しない |
| 長押しメニューの「拡張ブロックを上へ移動」「拡張ブロックを下へ移動」の
削除・置換・意味変更 | 許可しない。両者は隣接 Move の明示的な操作入口と
してそのまま維持する |
| 移動不能と判定された場合に本文を変更すること | 許可しない。どちらの入
口(長押しメニュー/六点ハンドル)でも、拒否時は本文を一文字も変更しない |

## 2. 既存実装の再利用を確認する

`src/view/OutlineTreeView.ts` を実際に読んで確認した、デスクトップ
CompositeBlock D&D(Phase 5D-4C)を構成する既存関数の一覧を次に示す。
いずれも本チケットでは中身を1行も変更せず、モバイル六点ハンドルからも
同じ経路をそのまま呼び出す。

| 役割 | 既存関数(行番号は現状のコード) | 確認した内容 |
| --- | --- | --- |
| ドラッグセッション開始 | `handleCompositeDragStart`(6597行〜) |
`buildCompositeBlockSnapshot` で snapshot を構築し、
`this.compositeDragSession = { snapshot, sourceTreeNodeId }` を設定、
`unified-outliner-dragging` クラス付与、`dataTransfer` にセンチネル値
を設定する |
| dragover の入口(汎用) | `handleDragOver`(5472行〜) | 冒頭で
`this.compositeDragSession` が真なら `handleCompositeDragOverNode` に
委譲して即 return する、既存の早期分岐(プラットフォーム判定より前) |
| dragover の本体 | `handleCompositeDragOverNode`(6660行〜) |
`resolveCompositeDragSource` で source を再解決、`compositeDropTargetHint`
で target hint を取得、`resolveCompositeDropCandidate` で候補を構築、
`computeCompositeDropZone` で before/after を判定し、pure resolver
`resolveCompositeBlockDropTarget(doc, source, composites, candidate,
zone)` を呼ぶ。`resolution.allowed` の場合のみ `preventDefault()` と
`setDropIndicator` を呼ぶ |
| drop の入口(汎用) | `handleDrop`(5560行〜) | `handleDragOver` と同様、
`compositeDragSession` があれば早期に `handleCompositeDropNode` へ委譲
する |
| drop の本体 | `handleCompositeDropNode`(6683行〜) | target hint を再
解決し zone を計算し、`dispatchAndApplyCompositeDrop(session.snapshot,
target, zone, rules)` を呼ぶ |
| 隣接/非隣接の分岐と実行 | `dispatchAndApplyCompositeDrop`(6697行〜) |
エディタ本文を再パースし `compositeSnapshotMatches` で source を再解決、
`zone`/`target`/`resolvedSource.range.startLine` から `direction` を算
出し、既存 `findCompositeMoveTarget` が返す隣接ターゲットの range と
`target` の range が完全一致する場合のみ `moveCompositeBlock(text,
{snapshot, direction}, rules)` を呼ぶ。一致しない場合(または source 再
解決不能の場合)は `dropCompositeBlock(text, {snapshot, target, zone},
rules)` を呼ぶ。結果は `applyLineEditOutcome` で適用する |
| before/after 判定 | `computeCompositeDropZone`(6446行〜) | 純粋な幾何
判定。`getBoundingClientRect()` から `ratio < 0.5 ? "before" : "after"`
を返す2択専用の判定であり、section/list の3択(`computeDropMode`)とは
別関数 |
| target 解決の呼び出し箇所 | `resolveCompositeBlockDropTarget` の呼び
出しは `handleCompositeDragOverNode` の中の1箇所のみ |
| source snapshot 構築/再照合/再解決 | `buildCompositeBlockSnapshot`、
`compositeSnapshotMatches`(6408行〜、UI 時点専用の等価判定を独自に再実
装したもの)、`resolveCompositeDragSource`(6421行〜、キャッシュ済み
`this.currentComposites` から `compositeSnapshotMatches` で現在の source
を再検出する) |
| target hint 生成/再解決/widening | `compositeDropTargetHint`(6432行
〜、list 行なら自分の range、他の composite 行なら「そのcomposite の
FULL range + アンカーメンバーの parentId」を返す ── ここが「composite
行全体への widening」が構造的に起きる箇所)、
`resolveCompositeDropCandidate`(6469行〜、dragover プレビュー専用の再
解決で depth/indentColumns を補う) |
| refresh/onClose/dragend/cancel でのセッション解除 | `endDrag`
(5613行〜、`compositeDragSession` を含む4フィールドを無条件にクリア)、
`cancelCompositeDrag`(6032行〜、セッションが null なら no-op、そうで
なければ `endDrag()` + `clearDropIndicator()` を呼ぶ)。`refresh()`
(872行〜)と `onClose()`(831行〜)は、いずれもメソッド冒頭付近で
`cancelParagraphDrag()`→`cancelCalloutDrag()`→`cancelCompositeDrag()`
の順に無条件で呼ぶ(今回確認した実際のコード) |
| ドロップインジケータの表示/解除 | `setDropIndicator`(6021行〜、対象
要素に `unified-outliner-drop-before`/`-after`/`-inside` のいずれかを
付与)、`clearDropIndicator`(6009行〜、それらを除去し
`this.dropIndicatorEl = null` にする)。汎用実装であり composite 専用
コードは無い |
| 既存の六点ハンドル(UXP-01) | `dragHandleEl` 生成(1440〜1442行、
`!readOnly` 時のみ)、`draggable` 属性の付与先分岐(2025〜2030行、
モバイルはハンドル/デスクトップは `selfEl`)、`touch-action: none`
(styles.css 336行、ハンドルのみに適用)、長押しタイマーのハンドル起点
除外ガード(1869行、`if (dragHandleEl && dragHandleEl.contains(evt.target
as Node)) return;`) |
| fold(折りたたみ)との関係 | CompositeBlock 親行は子を持たない一枚岩の
ノードであり、`hasChildren` は既存の `buildOutlineTree.ts` の投影ロジ
ック(本チケットでは変更しない)により常に false になる。したがって
`collapseEl` は常にスペーサー(`unified-outliner-collapse-spacer`)であ
り、fold 操作自体が発生しないため、ハンドルとの競合は構造的に起こり得
ない |

以上のうち、本チケットで新しくコードを書く必要があるのは次の2箇所のみ
であり、いずれも UI 配線層(DOM 生成条件・`draggable` 属性の付与先・
長押しタイマーのイベント伝播制御・プラットフォームゲート)に限定され
る。安全判定・snapshot・target 解決・本文変更のロジックには一切触れな
い。

1. `dragHandleEl` の生成条件に `isComposite` を加える(§1.1 の「hasされ
   る composite 種別」を両方満たすため、種別分岐は不要)。
2. composite 専用の描画分岐(2195行、`else if (isComposite &&
   !Platform.isMobile)`)を、`!Platform.isMobile` を外したうえで
   `draggable` 属性の付与先を §1.1 の既存パターンで分岐させ、かつ
   composite 専用長押しブロック(1936行〜)の `pointerdown` ハンドラに
   ハンドル起点除外ガードを追加する。

`dragstart`/`dragover`/`dragleave`/`drop`/`dragend` の5リスナー自体、
および上記の再利用対象関数はすべて1文字も変更しない。

## 3. 入力モデルを確定する

`dragHandleEl` に、これ自身へ直接 `addEventListener` する箇所が存在す
るかを `OutlineTreeView.ts` 全体で検索したが、0件であった(生成時の属
性設定と、他のリスナー内での除外判定用の参照のみで、`dragHandleEl` 自
身が起点のイベントリスナーは無い)。したがって、既存のセクション/リス
ト用六点ハンドルの入力モデルは、次のとおり「ブラウザのネイティブ HTML5
D&D 実装への完全委譲」であり、独自のポインタキャプチャやタッチジェス
チャー再現コードは一切存在しない。モバイル CompositeBlock ハンドルも、
このモデルをそのまま踏襲する。
| 問い | 既存実装の事実 |
| --- | --- |
| ハンドルを押した瞬間に何が起きるか | プラグイン側のコードは何も実行し
ない。`dragHandleEl` 自身にリスナーは無い。触れられるのは
`touch-action: none` が指定された28px角のDOM要素というだけである |
| ドラッグ開始が確定するタイミング | ブラウザ(WebKit/Chromium)自身の
ネイティブ drag-lift 判定に完全に委ねられる。`draggable="true"` を持つ
要素への「押して保持し動かす」というブラウザ標準ジェスチャーがそのまま
`dragstart` を発火させる。プラグイン独自のタイマーや閾値判定は無い
(UXP-01 §8 の実機確認 “ドラッグハンドルを押して移動すると dragstart が
発火する” の裏付けと一致する) |
| スクロール開始との区別 | ハンドルの `touch-action: none` のみが唯一
の機構である。これによりハンドル上で始まったタッチはブラウザのデフォル
トのスクロールジェスチャーとして処理されず、drag-lift 候補として扱われ
る。ハンドル以外(行本体)は `touch-action` を変更していないため、従来
通りスクロール可能なままである |
| 現在の drop 対象・zone の表示 | `dragover` イベントで
`handleCompositeDragOverNode` が `computeCompositeDropZone` で
before/after を判定し、`resolveCompositeBlockDropTarget` が許可すると
判定した場合のみ `setDropIndicator` が対象要素へ `unified-outliner-drop-before`/
`-after` クラスを付与する(既存、無変更) |
| 離した時の drop 確定 | ブラウザのネイティブ `drop` イベントが
`selfEl` 上で発火し(ハンドル起点でもバブリングにより到達する)、
`handleCompositeDropNode` → `dispatchAndApplyCompositeDrop` が呼ばれる |
| target から外れた場合のキャンセル | `dragleave` で `handleDragLeave`
がインジケータを解除する(既存)。ドロップされずにジェスチャーが終わっ
た場合はネイティブ `dragend` が発火し、`handleDragEnd` → `endDrag()` が
セッション・CSS クラスを無条件に解除する |
| pointercancel/touchcancel/スクロール/回転/refresh/onClose/再描画時の
キャンセル | HTML5 DnD 仕様上、ジェスチャーが中断された場合もブラウザ
は `dragend` を保証して発火する。加えて、`refresh()`(872行〜)と
`onClose()`(831行〜)は、いずれも他の処理より前に無条件で
`cancelCompositeDrag()` を呼ぶ既存コードがあり、`dragend` が届く前に
DOM が再構築された場合でも、セッションと CSS クラスが残留しないことが
二重に保証されている(今回のコード確認で確定した事実) |
| 長押しメニューが開かないことの保証 | composite 専用長押しブロック
(1936行〜)は現状 `dragHandleEl` が composite 行に存在しないため除外
ガードを持たないが、これは §2 の変更2箇所目でセクション/リストの汎用
ブロックと同じガード(`if (dragHandleEl && dragHandleEl.contains
(evt.target as Node)) return;`)を追加することで解決する。ガード自体は
新規コードだが、判定ロジックはセクション/リストの既存ガードを一字一句
再利用する |
| ハンドル操作が選択/fold-toggle/コンテキストメニュー/既存 drag session
に伝播しないことの保証 | 行選択(`click` リスナー)は、ネイティブ
drag-lift ジェスチャーが成立した場合ブラウザ自身がその後の合成
`click` を発火させない(UXP-01 の実機受入で誤操作が確認されていないの
と同じ挙動)。fold は `collapseEl` という別 DOM 要素でありハンドルとは
無関係。コンテキストメニューは上記ガードで保証する。既存 drag session
との衝突は、`paragraphDragSession`/`calloutDragSession`/
`compositeDragSession` の3フィールドがそれぞれの `handleXDragStart` で
排他的に設定され、`endDrag()` が常に4フィールドまとめて解除する既存の
構造(無変更)によりそもそも同時に2つ立たない |
| ハンドル以外の長押しで従来通りメニューが開くことの保証 | 追加するガー
ドは `evt.target` がハンドルの内部にあるときのみ早期 return する。行の
バウンディングボックス内でハンドル以外を押した場合はこの条件に一致せ
ず、タイマーは従来通り起動する。これはセクション/リストの既存ガードの
適用範囲をそのまま踏襲したものであり、新しい判定を追加するわけではな
い |
| ポインタキャプチャの使用有無 | 既存のハンドル・長押しブロックのいず
れにも `setPointerCapture`/`releasePointerCapture` の呼び出しは無い
(検索により確認)。モバイル CompositeBlock ハンドルもポインタキャプチ
ャを一切導入しない。ドラッグはネイティブ HTML5 DnD に完全に委譲する |
| `touch-action`/`preventDefault`/`stopPropagation` の適用範囲 |
`touch-action: none` は `.unified-outliner-drag-handle`(28px角の要素)
にのみ適用され、`selfEl` や行全体・ツリー全体には適用されない。これが
防いでいる競合はただ1つ、「ハンドル上で始まったタッチがブラウザのデフ
ォルトのスクロールジェスチャーとして先取りされ、drag-lift 判定に進めな
くなること」である。`preventDefault()` は `handleCompositeDragOverNode`
が `resolution.allowed` の場合にのみ呼ぶ既存コード(HTML5 DnD 仕様上
drop を許可するために必須の呼び出し)であり、無変更のまま再利用する。
`stopPropagation()` はドラッグ関連の `dragstart`/`dragover`/`dragleave`/
`drop`/`dragend` のいずれのリスナーにも存在しない(ハンドルから
`selfEl` へのバブリングが §1.1 の通り必須の前提であるため)。本チケッ
トもこれらいずれにも `stopPropagation()` を新規に導入しない |

## 4. 表示条件を定義する

セクション/リストの既存ハンドルと同じ規約(§1.1 の生成条件、eligibility
判定を持たず常に表示するという方針)を CompositeBlock 親行にもそのまま
適用する。

| 状況 | 挙動 |
| --- | --- |
| `Platform.isMobile` が true | ハンドルに `draggable="true"` が付く。
これがドラッグの唯一の起点になる |
| `Platform.isMobile` が false(デスクトップ) | ハンドルは表示上のアフ
ォーダンス(hover で視認可能)のみで、`draggable` は `selfEl` に付く。
デスクトップの挙動は完全に不変 |
| CompositeBlock 親行(List+Callout) | ハンドルを表示する。`isComposite`
のみで判定されるため List+Quote と区別しない |
| CompositeBlock 親行(List+Quote) | 同上、ハンドルを表示する |
| member 行/complex-member 行 | ハンドルを持たない。`isComposite` は
親行の `node.kind` のみで判定され、選択状態や member 行には依存しない |
| paragraph/section/plain list 行 | 本チケットでは変更しない(section/
list は既存のまま、paragraph はそもそも `dragHandleEl` を使わない) |
| read-only な CompositeBlock 親行 | 常に read-only である CompositeBlock
親行に対して、D&D は Move/Delete/Partial Edit と並ぶ意図的な例外として
最初から設計されている(Phase 5D-0.3 承認§1 のとおり、rename/indent/
outdent は引き続き不可) |
| 移動可能な CompositeBlock | ハンドルは常に表示される。移動先が無い場
合の判定は drop 時点で `resolveCompositeBlockDropTarget`/
`dropCompositeBlock`/`moveCompositeBlock` が行い、拒否時は本文を変更
せず Notice のみ、または `dispatchAndApplyCompositeDrop` 側の silent
no-op(既存、無変更)となる |
| 文書先頭/末尾で移動候補が無い | ハンドル自体は表示されたままだが、ド
ロップ操作自体が既存の resolver によって拒否される(section/list の既
存ドラッグと同じ「まずドラッグさせてから判定する」規約を踏襲) |
| 異なる section/parentId/depth/indentColumns の候補しかない | 同上、
ドロップ時に既存 resolver が拒否する |
| `compositeDragSession`/`paragraphDragSession`/`calloutDragSession`/
`dragSourceId` が残留 | `endDrag()` が既存のまま4フィールドを無条件に
クリアする(無変更)。本チケットは新しいセッションフィールドを追加しな
い |
| `refresh()` 実行中 | `renderNode` はリフレッシュのたびに再実行される
ため、ハンドルの有無も毎回再構築される。加えて `refresh()` 冒頭で
`cancelCompositeDrag()` が無条件に呼ばれる(既存、§3で確認済み) |
| `onClose()` 実行中 | `onClose()` も冒頭付近で
`cancelParagraphDrag()`→`cancelCalloutDrag()`→`cancelCompositeDrag()`
の順に無条件で呼ぶ(既存、§3で確認済み) |
| iPad 縦・横、狭い iPhone 幅、長いラベル | ハンドルの CSS(28px 角固定、
`flex-shrink: 0`、`touch-action: none`)は section/list と完全に同一
であり、ラベル文字数や画面幅に影響されない固定サイズのタップ領域とし
て振る舞う。既存の実機実績(UXP-01 §8)をそのまま引き継ぐ。CompositeBlock
特有の追加検証は§7のゲート項目とする |

## 5. テスト計画

- **View 配線テスト**(想定ファイル: `tests/OutlineTreeView.compositeDrag.test.ts`
  への追記、既存の Phase 5D-4C テストと同一ファイルを想定):
  - `mobile 時に CompositeBlock 親行のハンドルへ draggable="true" が付き、
    selfEl 自体には付かないこと`
  - `desktop 時には selfEl に draggable="true" が付き、ハンドルには付か
    ないこと(既存挙動の回帰確認)`
  - `member/complex-member/paragraph/section/plain list 行にはこのハン
    ドルが生成されないこと`
  - `dragstart/dragover/dragleave/drop/dragend の5リスナーが、モバイル
    ハンドル追加の前後で1文字も変わっていないこと(diff での確認)`
  - `composite 専用長押しブロックが、ハンドル起点の pointerdown でタイ
    マーを起動しないこと(§2/§3で追加すると確定したガードの単体確認)`
  - `setPointerCapture/releasePointerCapture、stopPropagation が composite
    のドラッグ関連コードに一切追加されていないこと(§3の入力モデル確定
    事項の回帰確認)`
- **安全契約の迂回防止テスト**(既存資産の再確認、想定は新規テスト追加
  ではなくファイル単位の確認): `tests/dropCompositeBlock.test.ts`/
  `tests/findCompositeBlockDropTarget.test.ts`/
  `tests/outlineTreeDragPayloadSafety.test.ts` が、モバイルハンドル経由
  の呼び出しであっても既存のテスト対象関数のシグネチャ・戻り値が変わっ
  ていないことを保証する(関数自体を変更しないため、原則としてこれらの
  既存テストの再実行のみで足りる)。
- **回帰テスト**: 既存のセクション/リスト/段落/callout・blockquote の
  ドラッグ&ドロップ(デスクトップ・モバイル双方)、および CompositeBlock
  の長押しメニュー(「拡張ブロックを上へ移動」「拡張ブロックを下へ移
  動」を含む)・エディタコマンド(`move-composite-block-up`/`down`)が、
  本チケットの変更によって一切変化しないことを、既存テストの再実行で
  確認する。長押しメニューと六点ハンドルの間で安全条件の迂回差が生じ
  ていないことも、この回帰テストの一部として確認する。
- **実機受入**: iPad 実機で、CompositeBlock 親行のハンドルを掴んで (1)
  隣接する plain list 行の直前/直後へドロップ(隣接 move、
  `moveCompositeBlock` 経由になること)、(2) 離れた位置の plain list 行
  や他の CompositeBlock 行(List+Callout・List+Quote 双方)の前後へド
  ロップ(非隣接 drop、`dropCompositeBlock` 経由になること)、(3) 異な
  る section/parentId/depth/indentColumns の位置へドロップして拒否され
  本文が変わらないこと、(4) member 行やハンドル以外の場所からドラッグ
  が開始されないこと、(5) ドラッグ中に長押しメニューが誤って開かない
  こと、(6) ハンドル以外を長押しした場合は従来通りメニューが開くこと、
  (7) 移動後の raw text(callout の折りたたみ・タイトル・本文、
  blockquote の `>` プレフィックス)がデスクトップと同一に保たれること
  を確認する。

## 6. 変更予定ファイルと非対象

- **変更予定**: `src/view/OutlineTreeView.ts` のみ。変更点は §2 で確定
  した2箇所(dragHandleEl 生成条件への `isComposite` の追加、composite
  専用描画分岐の `!Platform.isMobile` ゲート除去+`draggable` 付与先の
  分岐+長押しブロックへのハンドル起点除外ガード追加)に限定される。
  `styles.css` は既存の `.unified-outliner-drag-handle` をそのまま再利
  用するため、新規クラスの追加は不要と見込む(実装時に見た目の微調整
  が必要になった場合のみ、最小限の追記を検討する)。
- **明示的に変更しない**: `src/edit/dropCompositeBlock.ts`、
  `src/move/findCompositeBlockDropTarget.ts`、`src/edit/moveCompositeBlock.ts`
  相当のファイル、`showCompositeCommandMenu`(「拡張ブロックを上へ移
  動」「拡張ブロックを下へ移動」を含む)/`dispatchAndApplyCompositeMove`/
  `dispatchAndApplyCompositeDrop`/`handleCompositeDragStart`/
  `handleCompositeDragOverNode`/`handleCompositeDropNode`/
  `computeCompositeDropZone`/`compositeSnapshotMatches`/
  `resolveCompositeDragSource`/`compositeDropTargetHint`/
  `resolveCompositeDropCandidate`/`endDrag`/`cancelCompositeDrag`/
  `setDropIndicator`/`clearDropIndicator`(いずれも呼び出され方は変わ
  るが、関数の中身は無変更)、`main.ts` のコマンド群、
  `docs/phase5d4c_composite_block_atomic_drag_and_drop_implementation.md`、
  `docs/phase5d4d_mobile_composite_block_move_controls_design.md`、既存
  の fixture・テスト本体。
- **非対象**: member/complex-member 単位での D&D、CompositeBlock の
  rename/indent/outdent(引き続き不可)、長押しメニューのコマンド構成の
  変更、CompositeBlock 以外の行種別のモバイル D&D 仕様変更、ポインタキ
  ャプチャ/`stopPropagation` の新規導入、設定項目/バージョン更新/
  CHANGELOG/リリース関連の作業。

## 7. 実装開始ゲート

- [ ] §2 の2箇所の変更で、デスクトップの既存挙動(`selfEl` 全体がドラ
      ッグ起点)が一切変わらないことをコードレビューで確認する。
- [ ] composite 専用長押しブロックへのガード追加により、UXP-01 が
      section/list で解決した「ハンドルとの競合」が CompositeBlock でも
      再発しないことを実機で確認する。
- [ ] §3 で確定した入力モデル(ネイティブ HTML5 DnD への完全委譲、ポイ
      ンタキャプチャ不使用、`stopPropagation` 不使用、`touch-action:
      none` の適用範囲がハンドルのみであること)が実装後も維持されてい
      ることをコードレビューで確認する。
- [ ] 長押しメニューの「拡張ブロックを上へ移動」「拡張ブロックを下へ移
      動」と六点ハンドルの間で、安全条件を迂回できる差が生じていないこ
      とを確認する。
- [ ] fold(§2の既存事実、CompositeBlock 親行は常に `hasChildren` が
      false)との無関係性を、実装時に実際の値で再確認する。
- [ ] §5 のテスト対象・ファイルパスが確定している。
- [ ] iPad 実機受入手順(§5「実機受入」の7項目)が実装後にそのまま実行
      できる形で用意されている。
- [ ] 計画される変更が `src/view/OutlineTreeView.ts` の§2で確定した2箇
      所に収まっており、新しい resolver/executor/書き換えロジックを一切
      導入していないことが確認されている。


## 8. スパイク結果と実装記録(2026-09、iPad 実機スパイク後の確定版)

本節は、§1〜§7 の設計(判定A採用前)に対して、実機スパイクの結果と、そ
の後に実装・テストまで完了した Phase 5D-4D の確定内容を記録するもので
ある。§1〜§7 の内容は変更していない。

### 8.1 スパイク結果の正確な記録

iPad Pro 11 inch、iPadOS 26.6、Obsidian mobile 1.14 において、既存の単
独ブロック(セクション/リスト)の六点ハンドルを起点とする native HTML5
D&D が実用上成立したことを確認した。ただし、この確認の性質は次のとお
り正確に記録する。

「dragstart、dragover、drop、dragend の各イベントは console debug log
で直接観測したものではない。隣接・非隣接移動の成立、before / after
indicator の表示、操作中断後の状態残留がないことという、該当イベント
経路が実行されなければ成立しない機能結果から、イベント経路の成立を確
認した。」

確認できた事実、および証拠性が機能的観測にとどまる事実を分けて記す。

- 六点ハンドルは iPad で常時表示された
- 隣接移動が成立した
- 非隣接移動が成立した
- before / after indicator が視認できた
- inside indicator が明示的に「出ないこと」を独立確認したわけではない
- scroll、長押しメニュー、画面回転、refresh 相当、中断後の残留は正常と
  報告されたが、詳細な操作手順のログは未取得である
- 一時的に追加した phase5d4d-spike instrumentation は削除済みであり、
  production code、fixture、テストにはスパイク由来の差分が残っていな
  い

上記のうち、instrumentation の削除とスパイク由来差分が残っていないこ
とは、次のコマンドの実行結果によって確認済みである(2026-09-03 実行)。

- `grep -ril "phase5d4d-spike" . --include="*.ts"` — 一致なし(空)
- `git diff -- src/view/OutlineTreeView.ts | grep "^+.*console\."` —
  一致なし(空)
- `git diff --check` — 成功(空白関連の問題なし)

上記のとおり、「すべてのイベントを直接観測済み」という意味には解釈で
きない。イベント発火そのものの直接観測ではなく、機能結果からの間接確
認である点をここに明記する。

### 8.2 実装結果の記録

今回の mobile CompositeBlock drag handle 実装(`src/view/OutlineTreeView.ts`
のみ、承認済みの最小3箇所の production 変更)について、以下を記録す
る。

- `dragHandleEl` の生成条件を `!readOnly` から `!readOnly || isComposite`
  へ拡張した
- CompositeBlock 親行の drag-wiring 分岐を `isComposite && !Platform.isMobile`
  から `isComposite` へ拡張した
- モバイルでは draggable 属性の付与先を六点ハンドルとし、desktop では
  既存どおり行全体(`selfEl`)とする
- 既存の dragstart/dragover/dragleave/drop/dragend の5リスナーの実装
  内容そのものは変更していない(ゲート条件と draggable 付与先の分岐の
  みを変更した)
- CompositeBlock 専用の長押し処理に、既存の単独ブロックと同じハンドル
  起点除外ガード(`if (dragHandleEl && dragHandleEl.contains(evt.target
  as Node)) return;`)を追加した
- 長押しコンテキストメニューの「拡張ブロックを上へ移動」「拡張ブロッ
  クを下へ移動」は削除・置換・意味変更せず維持した
- 隣接 drop は既存 `moveCompositeBlock` を使用する(無変更)
- 非隣接 drop は既存 `dropCompositeBlock` を使用する(無変更)
- 既存の `resolveCompositeBlockDropTarget`、snapshot 構築、snapshot 再
  照合、target 再解決、fail-closed、raw text 保存をそのまま再利用する
  (いずれも無変更)
- mobile 専用の resolver/executor/Markdown 書き換え経路、touch/pointer
  D&D state machine、synthetic drag event は追加していない
- member/complex-member/paragraph/section/plain list 行は CompositeBlock
  D&D の source にならない(生成条件・ゲート条件のいずれも `isComposite`
  ── 親行の node.kind のみで判定される値 ── を要求するため)
- drop zone は before/after のみであり、inside は追加していない
  (`computeCompositeDropZone` は無変更のまま再利用)

### 8.3 テストと追随修正の記録

以下のテスト群と、その責務を記録する。

| ファイル | 種別 | 責務 |
| --- | --- | --- |
| `tests/OutlineTreeView.mobileCompositeDragHandle.test.ts` | 新規 |
dragHandleEl 生成条件の排他性、drag-wiring ゲートの排他性、draggable
属性のプラットフォーム分岐、5リスナー登録の既存実装との完全一致、長押
しガードの実行順序、`showCompositeCommandMenu` の Move up/down 維持、
既存デスクトップ D&D コアへの非回帰、新しい mobile 専用 resolver/
executor の不在、先行分岐への非漏出、dragend リスナー数の非回帰を検証
する |
| `tests/OutlineTreeView.compositeDrag.test.ts` | 既存改修 | drag-wiring
チェーンの境界抽出ヘルパーをチェーン内スコープに修正し、ゲート条件の
完全一致テストを書き換え、draggable 属性のプラットフォーム分岐テスト・
dragHandleEl 生成条件の拡張テスト・長押しガードテストを追加した |
| `tests/outlineTreeDragPayloadSafety.test.ts` | 既存改修 | drag-wiring
分岐本文抽出ヘルパーと「配線が1箇所にのみ出現する」テストの inline
anchor を、チェーン内スコープの landmark に修正した |
| `tests/listPrefixUiWiring.test.ts` | 例外的追随修正 | production code
内の branch 条件(dragHandleEl 生成条件の拡張)が正当に変更されたこと
で陳腐化した旧 landmark(裸の部分文字列 `"isComposite) {"`)への依存を
修正した |
| `tests/paragraphOutlineTreeUiWiring.test.ts` | 例外的追随修正 | 同じ
く production code の正当な変更(CompositeBlock 分岐の `dragHandleEl`
参照追加)により陳腐化した、paragraph drag branch 抽出ヘルパーの終端
landmark を修正した |
| `tests/paragraphPartialEditLaunchUiWiring.test.ts` | 例外的追随修正 |
同じく production code の正当な変更(`dragHandleEl` 生成条件の拡張)に
より陳腐化した、固定200文字近傍探索による landmark 依存を廃止し、構
造的検証に置き換えた |

上記のうち最後の3ファイルは、いずれも今回の mobile 実装が
`src/view/OutlineTreeView.ts` 内の branch 条件を承認済みの範囲で正当
に変更したことにより、静的ソーステストが切り出し landmark としていた
旧い厳密文字列が陳腐化したことへの、例外的な追随修正である。これらの
3ファイルへの変更は、テストの切り出しロジックの landmark 更新に限定
されており、各テストが検証していた安全契約そのものは変更していない。

また、次を明記する。

- 既存 assertion は削除していない
- 既存 assertion の期待値を緩和していない
- skip、todo、only、条件付き無効化を追加していない
- landmark 未検出、曖昧一致、逆順境界、空範囲を検出するガードを追加し
  た
- paragraph、list、Partial Edit の各 branch に CompositeBlock 固有の
  ハンドル・session・handler が漏れないことを追加検証した
- 全体テストは 97 test files / 1853 tests が成功した

### 8.4 残る実機受入項目(未確認チェックリスト)

実機受入で必ず確認する、現時点で未確認または証拠性が弱い項目を次に示
す。

- [ ] CompositeBlock 親行にのみ六点ハンドルが常時表示される
- [ ] member 行、complex-member 行にはハンドルが表示されない
- [ ] List + Callout の CompositeBlock を before / after の隣接位置へ
      移動できる
- [ ] List + Callout の CompositeBlock を before / after の非隣接位置
      へ移動できる
- [ ] List + Quote の CompositeBlock を before / after の隣接位置へ移
      動できる
- [ ] List + Quote の CompositeBlock を before / after の非隣接位置へ
      移動できる
- [ ] inside indicator が表示されない
- [ ] 移動後も list marker、indent、callout prefix、callout type、
      title、blockquote prefix、本文、fold marker が変化しない
- [ ] 意図しない CompositeBlock 再マッチまたは隣接吸収が起きない
- [ ] 異なる section、parentId、depth、indentColumns の位置へ drop し
      ても本文が変わらない
- [ ] self drop、CompositeBlock 内部 boundary、target ambiguity、
      snapshot mismatch、再解決不能でも本文が変わらない
- [ ] ハンドル起点では長押しコンテキストメニューが開かない
- [ ] ハンドル以外の CompositeBlock 親行長押しでは従来どおりメニュー
      が開く
- [ ] 長押しメニュー内の「上へ移動」「下へ移動」が従来どおり動く
- [ ] スクロール開始時に意図しない移動が起きない
- [ ] 操作途中のキャンセルで dragging class、drop indicator、session
      が残留しない
- [ ] refresh、ビュー切替、画面回転後に状態が残留しない
- [ ] Undo が一回で元の位置と本文へ戻る
- [ ] iPad 縦向き、横向き、可能なら狭い表示幅で表示が破綻しない
- [ ] section/list、paragraph、callout/blockquote の既存モバイル操作
      と desktop D&D に回帰がない

### 8.5 変更範囲の確定

Phase 5D-4D の実装で変更・追加した範囲を次のとおり確定する。

- **変更した production code**: `src/view/OutlineTreeView.ts` のみ、
  §2 で確定した3箇所(dragHandleEl 生成条件への `isComposite` 追加、
  composite 専用描画分岐のモバイルゲート除去+draggable 付与先分岐、
  composite 専用長押しブロックへのハンドル起点除外ガード追加)。
- **変更した既存テスト**: `tests/OutlineTreeView.compositeDrag.test.ts`、
  `tests/outlineTreeDragPayloadSafety.test.ts`。
- **追加した新規テスト**: `tests/OutlineTreeView.mobileCompositeDragHandle.test.ts`。
- **追随修正した例外テスト**: `tests/listPrefixUiWiring.test.ts`、
  `tests/paragraphOutlineTreeUiWiring.test.ts`、
  `tests/paragraphPartialEditLaunchUiWiring.test.ts`(§8.3 の理由によ
  る、landmark 更新のみの例外的変更)。

上記以外の production code、fixture、resolver、executor、parser、
settings、version、CHANGELOG、release 関連ファイルへの変更は存在しな
い。
