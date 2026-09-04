# Phase 5D-4D: Mobile CompositeBlock Move Controls 設計メモ

## 現状と位置づけ

本文書は、Phase 5D-4D「Mobile CompositeBlock Drag Handle」の初期調査・比較検討段階で作成された設計メモである。作成時点では、モバイルで CompositeBlock 親行を移動する操作 UI が不足しているという認識を出発点としていた。その後の調査(下記§1・§1.3)により、既存の長押しコンテキストメニューには「拡張ブロックを上へ移動」「拡張ブロックを下へ移動」(`showCompositeCommandMenu`、Phase 5C-1 ticket 3b)が既に存在し、隣接1段の `moveCompositeBlock` 経路が利用可能であることが確認された。

その後、Phase 5D-4D の最終採用方針として、CompositeBlock 親行に六点(grip-vertical)ドラッグハンドルを表示し、モバイルでも既存の安全な CompositeBlock D&D 経路を利用可能にする実装が採用され、実装・テスト・commit(`b6a8865`)・iPad 実機受入まで完了している。現在は、この六点ハンドルを起点として、隣接移動だけでなく非隣接の before/after drop も利用できる。隣接 drop は既存 `moveCompositeBlock` を使い、非隣接 drop は既存 `dropCompositeBlock` を使う。source snapshot、target 再解決(`resolveCompositeBlockDropTarget`)、fail-closed、raw text 保存という既存の安全契約はいずれも変更されておらず、そのまま再利用されている。

本文書が下記§2で比較する案A・案B・案Cは、いずれも本メモ作成時点(初期調査段階)における比較検討案であり、現在の最終採用実装を置き換えるための未着手要求ではない。特に、§2で推奨した案A(既存長押しメニューの維持)は「初期調査段階での推奨」に過ぎず、実際に最終採用されたのは、案A・B・Cのいずれとも異なる六点ハンドル D&D 方式である。下記§7「実装開始ゲート」のチェックリストも、本メモ作成時点の着手判断用のものであり、現在の実装状況を示すものではない。本文書は、長押しメニュー経路の調査記録と、将来の代替入力・アクセシビリティ・操作困難時の fallback を検討するための参考資料として残す。

現在の最終採用方針は、以下の2文書を正とする。

- `docs/phase5d4d_mobile_composite_block_drag_handle_design.md`
- `docs/phase5d4d_mobile_composite_block_drag_handle_implementation.md`

### 将来検討事項として残す範囲

本文書が残す将来検討事項は、次の範囲に限定する。

- 六点ハンドル操作が困難な利用者のための代替入力
- アクセシビリティ上の補助操作
- 常時表示の上/下ボタンまたは専用トリガーの必要性
- mobile native HTML5 D&D が実用にならない端末・WebView・将来バージョンにおける fallback
- 既存長押しメニューの発見しやすさまたは操作性の改善

### 本メモにより再提案・再実装してはならない事項

以下は、本メモを根拠として再提案・再実装してはならない。

- 現在の drag handle D&D を置き換えること
- `moveCompositeBlock`、`dropCompositeBlock`、`resolveCompositeBlockDropTarget` の安全契約を変えること
- mobile 専用の resolver、executor、Markdown 書き換え経路を追加すること
- member/complex-member 単位の D&D を追加すること
- inside drop を追加すること
- 非隣接 drop の新規実装を追加すること
- 既存長押しメニューの Move Up/Move Down を削除すること

## 前提

Phase 5D-4C(CompositeBlock Atomic Drag-and-Drop)の実機受入は、デスクトップ
環境において全項目が正常に完了済みである。詳細は
`docs/phase5d4c_composite_block_atomic_drag_and_drop_implementation.md` を
参照のこと。同ドキュメントは本メモの作成にあたって一切変更していない。

一方、モバイル版(iPad およびスマートフォン幅で動作する Obsidian アプリ)では
HTML5 の native drag-and-drop 自体が機能しない。したがって Phase 5D-4C の
CompositeBlock D&D 実装(dragstart/dragover/drop/dragend を起点とする一連の
処理)は、モバイル環境では原理的に到達不能である。この事実は本メモの前提
として扱う。(※ この前提は本メモ作成時点(Phase 5D-4D 初期調査段階)のもの
である。その後、六点ハンドルを起点とする native HTML5 D&D がモバイルでも
機能することが実装・実機受入により確認されている。詳細は冒頭「現状と位置
づけ」節を参照。)

ただし、下記 §1 の調査により、CompositeBlock 親行に対する「移動」操作その
ものは、native D&D とは別の経路 ――長押しで開くコンテキストメニューの
Move up / Move down 項目―― を通じて、モバイルでも既に到達可能であること
が実コード上確認された。この事実は、ユーザーが述べた「CompositeBlock 親行
を移動するための操作 UI が現状存在しない」という前提と部分的に食い違う
ため、本メモの冒頭で明示しておく。以降の §1・§2 は、この既存経路の存在を
踏まえたうえで検討する。

## 1. 現行モバイル操作の棚卸し

すべて `src/view/OutlineTreeView.ts`(全 `Platform.isMobile` 出現 13 箇所、
グレップ一致 39 件)の実コードを直接読んで確認した内容であり、推測による
記述は含まない。

### 1.1 D&D / draggable 属性

| 行種別 | `draggable` 属性(モバイル) | D&D ソースとしての実質的機能 |
| --- | --- | --- |
| セクション行 | `Platform.isMobile` 分岐でハンドル要素 `dragHandleEl` に付与(UXP-01) | native D&D 自体がモバイルで機能しないため、属性が付いていても実質的な並べ替え操作としては機能しない(本メモの前提どおり) |
| リスト行(トップレベル) | 同上(ハンドル要素) | 同上 |
| リスト行(Composite メンバー) | 付与されない(常に read-only) | なし |
| 段落行 | 付与されない(常に read-only) | デスクトップの `handleParagraphDragStart` 経由のみ |
| スタンドアロン callout/blockquote 行 | 付与されない(常に read-only) | デスクトップの `handleCalloutDragStart` 経由のみ |
| Composite メンバー callout/blockquote 行 | 付与されない(常に read-only) | デスクトップの `handleCalloutDragStart` 経由のみ(ただし CompositeBlock D&D 自体は誘発しない) |
| CompositeBlock 親行 | 付与されない(Phase 5D-0.3 承認 §1 により恒久的に非 draggable) | なし(D&D ソースにもターゲットにもならない、Phase 5D-4C のドラッグ経路とは無関係) |

`data-platform` 属性(1411 行付近)は CSS フック専用であり、いずれの行種別
でも操作の可否そのものを左右しない。

### 1.2 メニュー / 操作の到達可否(モバイル)

| 行種別 | モバイル長押しメニュー | Move up/down 相当 | rename | delete | indent/outdent | Partial Edit |
| --- | --- | --- | --- | --- | --- | --- |
| セクション行 | あり(`showStructureCommandMenu`) | あり(メニュー内、隣接1段のみ) | あり(メニュー内 + タップ二度押し) | あり | あり | あり |
| リスト行(トップレベル) | あり(`showListCommandMenu`) | あり(メニュー内、隣接1段のみ) | あり | あり(サブツリー削除) | あり | あり |
| リスト行(Composite メンバー) | なし(常に read-only、長押しレイヤー自体が付与されない) | なし | なし | なし | なし | なし |
| 段落行 | **なし**(long-press レイヤーが `!readOnly` ガードで除外され、段落専用の長押しブロックも存在しない) | デスクトップのみ(`showParagraphMoveMenu`、隣接+非隣接) | なし(そもそも desktop 右クリックメニューにも rename 項目なし) | なし | なし | あり(デスクトップのみ到達) |
| スタンドアロン callout/blockquote 行 | **なし**(同上、Phase 5D-0.3 承認 §1 により長押しレイヤーごと非付与) | デスクトップのみ(`showStandaloneComplexBlockMenu`) | なし | なし | なし | あり(デスクトップのみ到達) |
| Composite メンバー callout/blockquote 行 | **なし**(同上) | デスクトップのみ(`showComplexMemberMenu`、Phase 5D-3B で追加) | なし | なし | なし | あり(デスクトップのみ到達) |
| CompositeBlock 親行 | **あり**(`isComposite && Platform.isMobile` 専用ブロック、Phase 5C-1 ticket 3b、`showCompositeCommandMenu` を直接呼び出す) | **あり**(同一メニュー内、`dispatchAndApplyCompositeMove` → `moveCompositeBlock`、隣接1段のみ) | なし(仕様上不可) | あり(条件付き) | なし(仕様上不可) | あり |

rename は `beginRenameForNode` の `node.kind !== "section" && node.kind !== "list"`
ガード(4875 行付近)により、セクション/リスト以外のいかなる行種別でも
到達しないことを確認済みである。

### 1.3 最重要所見(前提との照合が必要な事実)

`OutlineTreeView.ts` 1936〜1972 行付近に、`if (isComposite && Platform.isMobile)`
という、汎用の長押しブロック(1846 行付近、`!readOnly && Platform.isMobile`)
とは別の、CompositeBlock 専用の長押しブロックが存在する。ドキュメント
コメントには「Phase 5C-1 ticket 3b: composite rows' own long-press → menu
gesture」と明記されており、汎用ブロックのタイムアウトコールバックが
`isOutlineSectionNode`/`isOutlineListNode` のみを分岐するために composite
行(常に read-only)を扱えないことへの対策として、独立に追加されたもの
である。

このブロックのタイムアウトコールバックは `this.showCompositeCommandMenu(menuEvt, node.id)`
を直接呼び出す(1970 行)。`showCompositeCommandMenu` 自体(定義は 3016〜
3120 行付近)を読んだところ、次の項目が含まれることを確認した。

1. 「拡張ブロックを Partial Edit で開く」(常時表示)
2. 「Move up」(`movabilityUp.eligible` の場合のみ表示、`evaluateCompositeBlockMovability` で判定)
3. 「Move down」(`movabilityDown.eligible` の場合のみ表示、同上)
4. 「拡張ブロックを削除」(`deletability.deletable` の場合のみ表示)

Move up/down の onClick は `this.dispatchAndApplyCompositeMove(snapshot, "up"/"down", rules)`
であり、これは `moveCompositeBlock(text, { snapshot, direction }, rules)`
(edit/moveCompositeBlock.ts)を呼ぶ ―― Phase 5D-4C の D&D 実装が隣接移動
時に使う **同一の関数** である(`docs/phase5d4c_..._implementation.md` §2
参照)。このメニューは、デスクトップの右クリック(1736〜1738 行)と、
このモバイル長押しブロック(1970 行)の両方から、全く同じ `showCompositeCommandMenu`
呼び出しとして到達する。

**結論として、CompositeBlock 親行を「隣接する1段だけ」移動させる操作 UI
は、モバイルにおいても、Phase 5C-1 ticket 3b の時点から既にコード上存在
し、機能する形で配線されている。** これは「CompositeBlock 親行を移動す
るための操作 UI が現状存在しない」というユーザーの前提と、少なくとも
静的コード解析のレベルでは一致しない。考えられる乖離の理由としては、
(a) 長押しジェスチャー自体の発見しにくさ(視覚的な手がかりが一切ない)、
(b) 実機上で当該長押しが何らかの理由で発火しない、または `Menu` の表示
が iPad 上で意図通り機能していない、(c) ユーザーが念頭に置いていたのは
「隣接1段の移動」ではなく、Phase 5D-4C 相当の「任意位置への D&D 的な移
動」であり、それが存在しないことを指していた、のいずれか、または複数の
組み合わせが想定される。本メモではこの事実を隠さず記録し、§2 以降の設計
はこの乖離を踏まえたうえで進める。§7 に、実機での再確認を実装開始前の
必須ゲート項目として明記する。

## 2. 推奨 UI 案

§1.3 の所見により、少なくとも1つの案(案A)は「新規実装」ではなく「既存
機構の維持・強化」という性質を持つ。この点を踏まえ、以下の3案を比較する。
いずれの案も、対象は CompositeBlock 親行のみとし、メンバー行/複合メンバー
行が個別に移動可能になることは決してない(§3 参照)。

- 案A: 既存の長押し→ `showCompositeCommandMenu` の Move up/down 項目を
  そのまま維持する(必要に応じて発見しやすさのみ改善する)
- 案B: CompositeBlock 親行に常時表示の上下矢印ボタンを追加する
- 案C: 親行に「移動専用」の小さいトリガー(ハンドル)を追加し、タップで
  Move up/down のみのコンパクトなメニューを開く

| 評価軸 | 案A(既存メニュー維持) | 案B(常時表示ボタン) | 案C(専用トリガー) |
| --- | --- | --- | --- |
| 誤タップリスク | 低い(450ms の長押し閾値 + 10px の移動キャンセル閾値、`longPressGesture.ts` で既に検証済み) | 中〜高(狭い Tree 行内にボタンを常設すると隣接行との誤タップが起きやすい) | 中(トリガー自体は小さいが、意図した対象へのタップ精度が必要) |
| タップ対象面積 | 行全体(既存のまま) | 新規に確保が必要(行の高さ制約と衝突しうる) | 新規に確保が必要(案Bより小さくてよい) |
| 既存モバイルジェスチャーとの衝突 | なし(既存の仕組みをそのまま使う) | スクロール操作や選択操作との干渉を新規に検証する必要がある | 同上、ただし対象範囲が小さい分リスクはやや低い |
| Tree 行の密度への影響 | なし | 増える(常設要素が行の高さ/横幅を圧迫する) | 増える(案Bより小さいが、セクション/リストの `dragHandleEl` と並置する設計が必要) |
| アクセシビリティ | 既存のメニュー読み上げ・フォーカス機構をそのまま継承 | 新規ボタンに対する ARIA ラベル等を新たに設計する必要がある | 同上 |
| iPad + スマートフォン幅の両対応 | 既に両方で動作する設計(Pointer Events ベース) | 画面幅により常設ボタンの視認性・タップ性が変動しやすい | 同上、ただし専用トリガーのみのため影響範囲は限定的 |
| 既存 UI との一貫性 | 高い(セクション/リストの「長押し→右クリックメニューと同一メニュー」という既存規約と完全に一致) | 低い(他のいかなる行種別も常時表示の移動ボタンを持たない) | 中(セクション/リストの `dragHandleEl` と似た位置づけだが、ドラッグではなくタップ専用という新しい概念を導入する) |
| 実装規模 | 実質ゼロ(§1.3 のとおり既に実装済み) | 中〜大(新規 DOM 要素、CSS、表示条件判定、イベント配線が必要) | 中(新規 DOM 要素は小さいが、タップ判定とメニュー生成の新規配線が必要) |
| テスト容易性 | 高い(既存の `showCompositeCommandMenu`/`dispatchAndApplyCompositeMove` のテスト資産をそのまま流用できる) | 中(新規の表示条件・イベント配線のテストが別途必要) | 中(同上、ただし範囲は限定的) |

**推奨: 案A を基本方針とする。** 既に安全に機能している経路が存在する以上、
新たな DOM 要素やイベント配線を追加してリスクを増やすより、まずこの経路
を正式な「モバイル操作 UI」として認め、発見しやすさの改善(例: 初回利用
時のヒント表示、設定内のドキュメント追記など、いずれも UI 表示条件や安全
契約に影響しないもの)に限定して検討するのが最小リスクである。案B・案C
は、§7 の実機再確認の結果、案Aが実機で機能していない、または「隣接1段の
移動」では要求を満たさない(任意位置への移動が真に必要である)ことが判明
した場合の代替案として保持する。(※ この推奨は本メモ作成時点(初期調査
段階)の比較検討結果であり、その後の最終採用方針ではない。実際に最終採用
されたのは、案A・B・Cのいずれとも異なる六点ハンドル D&D 方式である。詳細
は冒頭「現状と位置づけ」節を参照。)

## 3. 操作の安全契約

いずれの案(A/B/C)を採るとしても、以下の契約を逸脱してはならない。

- 本文を書き換える新規ロジックは一切作らない。既存の `moveCompositeBlock`
  (edit/moveCompositeBlock.ts)、`buildCompositeBlockSnapshot`、
  `evaluateCompositeBlockMovability`、`dispatchAndApplyCompositeMove` を
  そのまま再利用する。案B/Cを採る場合でも、onClick の実処理は
  `dispatchAndApplyCompositeMove` 呼び出しに帰着させ、独自の再実装は行わない。
- 対象は CompositeBlock 親行(`isComposite === true`)のみ。メンバー行/
  複合メンバー行/段落行/セクション行/通常リスト行のいずれにも、この
  移動操作を表す UI 要素を一切表示しない。
- 移動先は「同一セクション・同一 `parentId`・同一深さ・同一 `indentColumns`」
  を満たす隣接候補のみとする。この判定は既に `evaluateCompositeBlockMovability`
  /`moveCompositeBlock` 内部の `findCompositeMoveTarget` 相当のロジックが
  行っており、新規の判定ロジックをここに重複させない。
- 移動が不可能な場合は本文を一切変更しない。これは `applyLineEditOutcome`
  が `changed` を返した場合のみ書き込みを行う既存の実装により、既に保証
  されている。
- 移動成功後、移動した CompositeBlock の生テキストを再シリアライズしない。
  `moveCompositeBlock` は範囲単位のスワップのみを行い、callout/blockquote
  内部の構文(折りたたみマーカー、タイトル、`>` プレフィックス等)を一切
  解析・変換しない。
- この機能はあくまで **隣接1段のみの移動**(既存の `moveCompositeBlock`
  相当)であり、Phase 5D-4C の非隣接ドロップ(`dropCompositeBlock`)を
  モバイル UI から呼び出すことは対象外とする。任意位置への移動が必要と
  判明した場合(§7 のゲート参照)は、それ自体を別の独立した設計課題として
  改めて起票する。
- 既存の隣接移動の判定・実行パス(`showCompositeCommandMenu` →
  `dispatchAndApplyCompositeMove`)を重複実装しない。案B/Cはあくまで
  「同じ実行パスへの新しい入り口」を追加するに過ぎない。

## 4. UI 表示条件

| 状況 | 表示条件(既存の `showCompositeCommandMenu` の挙動) |
| --- | --- |
| 最初の(それより上に移動可能な対象がない)Composite | `movabilityUp.eligible === false` となり、Move up 項目自体が **表示されない**(非表示、無効化表示ではない) |
| 最後の(それより下に移動可能な対象がない)Composite | 同様に Move down 項目が非表示 |
| 隣接する対象が移動不可能な種別 | `evaluateCompositeBlockMovability` が非 eligible と判定し、該当方向の項目が非表示 |
| 隣接する対象が異なるセクションに属する | 同上(セクション不一致は既存の判定に含まれる) |
| 隣接する対象が異なる `parentId`/深さ/`indentColumns` | 同上 |
| CompositeBlock 内部/メンバー行が選択されている | 移動操作の対象はあくまで親行の `node.id` であり、メンバー行の選択状態はこのメニューの表示条件に影響しない(メンバー行はそもそもこのメニュー自体を持たない) |
| `Platform.isMobile` が false(デスクトップ) | このモバイル専用長押しブロック自体が付与されない。デスクトップは右クリックの `showCompositeCommandMenu` を使う(同一メニュー、同一表示条件) |
| `refresh()` 実行中 | メニューは常にクリック/長押し時点で `this.currentComposites`/`this.currentComplexScan` を再評価して構築されるため、`refresh()` の実行タイミング自体が表示条件に影響することはない |
| `onClose()` 実行中 | Move操作自体はドラッグセッションのような永続状態を持たない単発の同期呼び出しであるため、`onClose()` 時にクリアすべきセッションフィールドが存在しない(§3のとおり) |
| ドラッグセッションが残存している | Move の実行パスは `compositeDragSession` 等のドラッグ専用フィールドを一切参照しない。両者は `editor.getValue()` を経由する以外に共有状態を持たないため、原理的には独立である。ただし実機上での相互作用未検証のため、§7 のゲート項目とする |
| CompositeBlock 親行が read-only である | Move/Delete/Partial Edit は、read-only 行に対する意図的な例外として最初から設計されている(§1.3参照)。read-only 判定そのものが表示条件に影響することはない |

既存の `showCompositeCommandMenu` は「条件を満たさない項目は無効化表示
せず、メニューから完全に取り除く」という規約を一貫して採用している
(`showListCommandMenu`/`showStructureCommandMenu` が採る「無効化表示 +
『(使用不可)』サフィックス」規約とは異なる)。案B/Cを採る場合も、この
CompositeBlock 固有の「非表示」規約を踏襲し、リスト/セクションの規約に
合わせて変更しないことを推奨する。

## 5. テスト計画

案Aを基本方針とする場合、Move up/down の判定・実行ロジック自体は
Phase 5D-4C 以前から存在するため、新規テストの主眼は「モバイル経路が
既存ロジックへ正しく配線されていること」の確認と回帰防止に置く。

- 純粋関数テスト(既存資産の再確認): `evaluateCompositeBlockMovability`
  の最初/最後の対象、異なる構造レベル、自己移動、スナップショット不一致、
  再解決不能ケースは、既存の `tests/` 配下(Phase 5D-4C 以前のテスト資産)
  で既にカバーされている前提を、実装着手前に改めてファイル単位で確認する。
  未カバーの分岐が見つかった場合のみ追加する。
- View 配線テスト(想定ファイル: `tests/OutlineTreeView.compositeMobileMove.test.ts`
  のような新規ファイル、または既存の composite 系テストファイルへの追記):
  `isComposite && Platform.isMobile` の長押しブロックが `showCompositeCommandMenu`
  を正しく呼び出すこと、メンバー行/複合メンバー行/段落行/セクション行/
  通常リスト行には同等の呼び出しが一切配線されないことを、DOM/イベント
  レベルで検証する。
- 回帰テスト: 既存のセクション/リスト/段落/callout・blockquote のモバイル
  操作(§1.2 の一覧)が、本チケットの変更によって一切変化しないことを、
  既存テストの再実行(グリーン維持)で確認する。
- セッション安全性テスト: Move 操作の前後、および `refresh()`/`onClose()`
  をまたいだ場合に、リンガリングする状態が生じないことを確認する
  (§3・§4 のとおり、Move は元々セッションレスであるため、主眼は「新規に
  セッション状態を持ち込んでいないこと」の確認になる)。
- 実機受入: iPad 実機およびスマートフォン幅表示それぞれで、CompositeBlock
  親行への長押しから Move up/down が実際に機能することを確認する。誤タップ
  (隣接行・メンバー行への意図しないタップ)が発生しないこと、移動後の
  生テキストが Phase 5D-4C のデスクトップ受入と同様に保持されることを
  合わせて確認する。この項目こそが §1.3 の乖離を解消する決定的な検証で
  あり、§7 の実装開始ゲートの前提となる。

## 6. 変更予定ファイルと非対象

案Aを基本方針とする場合の変更予定は以下のとおりである。

- 変更予定ファイル(production code): 実機再確認の結果、案Aがそのまま
  機能することが確認できれば、原則として **変更不要**。発見しやすさの
  改善のみを行う場合でも、対象は表示文言/ドキュメント程度に限定される
  想定であり、`showCompositeCommandMenu`/`dispatchAndApplyCompositeMove`/
  `moveCompositeBlock` 本体には触れない。
- 新規作成予定ファイル: §5 のテストギャップが見つかった場合に限り、
  view 配線テストの新規ファイル(または既存 composite テストファイルへの
  追記)。それ以外の新規ファイルは想定しない。
- 明示的に変更しない: production code 全般(既存の Move 機構をそのまま
  使う限り)、`docs/phase5d4c_composite_block_atomic_drag_and_drop_implementation.md`、
  既存の fixture(`tests/`配下・`ipad-test`/実機受入ノート双方)。

非対象(本チケットのスコープ外):

- native drag-and-drop のモバイル対応そのもの
- メンバー行/複合メンバー行単位での移動
- 非隣接ドロップ(`dropCompositeBlock`)のモバイル対応
- CompositeBlock の rename/delete UI 以外の変更(delete/Partial Edit の
  既存挙動は変更しない)、indent/outdent(そもそも CompositeBlock には
  存在しない)
- 既存のセクション/リスト/段落/callout・blockquote のモバイル操作仕様の
  変更
- 新規の直接 Markdown 書き込み経路の追加
- 設定項目/バージョン更新/CHANGELOG/リリース関連の作業

## 7. 実装開始ゲート

(※ 本節のチェックリストは本メモ作成時点(初期調査段階)における、案A・B・
Cの着手判断用のゲートである。Phase 5D-4D は、本メモとは異なる六点ハンドル
D&D 方式で既に実装・commit(`b6a8865`)・iPad 実機受入まで完了しており、
以下のチェックリストが未チェックのまま残っていることは、現在の実装状況
が未着手であることを意味しない。詳細は冒頭「現状と位置づけ」節を参照。)

以下がすべて確認されるまで、実装(production code の変更)には着手しない。

- [ ] §1.3 で確認した既存の長押し→ `showCompositeCommandMenu` の Move up/
      down が、iPad 実機およびスマートフォン幅表示の双方で実際に発火・
      機能することを、ユーザー自身の実機操作で再確認済みである(本メモの
      調査はあくまで静的コード解析であり、実機検証そのものではない)。
- [ ] 上記が実機で機能することが確認できた場合: 本チケットの残作業が
      「発見しやすさの改善」および「既存カバレッジの確認」程度の軽微な
      ものに縮小されることに、ユーザーの同意を得ている。
- [ ] 上記が実機で機能しないことが確認できた場合: 案A(既存メニュー)が
      なぜ実機で機能しないのか(発火しない/メニューが開かない/開いても
      操作できない等)の根本原因調査が、新規 UI 設計に先立つ実際の次の
      ステップであることに、ユーザーの同意を得ている。
- [ ] 推奨 UI 案(§2)がユーザーによって承認されている、または上記いずれ
      かの分岐に応じた代替方針が別途指示されている。
- [ ] 呼び出す既存の Move/スナップショット/安全性 API(§3)が確定して
      おり、新規の本文書き換えロジックを作らないことが確認されている。
- [ ] §5 のテスト対象・ファイルパスが確定している。
- [ ] 計画される変更ファイルが最小限(§6)であることが確認されている。
- [ ] iPad 実機受入手順が定義されている(Phase 5D-4C の実機受入手順・
      fixture の構成規約を踏襲する想定)。

## git status --short

本メモ作成にあたり、production code・fixture・既存テスト・既存ドキュメント
はいずれも変更していない。変更は本ファイル
(`docs/phase5d4d_mobile_composite_block_move_controls_design.md`)の新規
作成のみである。実際の `git status --short` の結果は、本メモに続く報告で
別途提示する。
