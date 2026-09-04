# Phase 5D-4D: Mobile CompositeBlock Drag Handle 実装ドキュメント

本文書は Phase 5D-4D「Mobile CompositeBlock Drag Handle」の実装内容を記録するものである。設計契約は `docs/phase5d4d_mobile_composite_block_drag_handle_design.md` であり、本文書はその実装結果とテスト・実機受入の記録として作成された。コミット、push、version bump、CHANGELOG 更新、タグ作成、GitHub Release 作成のいずれも本文書提出時点では行っていない。

## 1. チケット概要

Phase 5D-4D の目的は、モバイル環境（iPad 等、Obsidian mobile アプリ）において CompositeBlock（List+Callout / List+Quote）親行を D&D で移動できるようにすることである。

具体的には、CompositeBlock 親行にモバイル用の六点ドラッグハンドルを追加した。ハンドル要素（dragHandleEl）の生成条件を `!readOnly` から `!readOnly || isComposite` へ拡張し、モバイル環境でも CompositeBlock 親行にハンドルが表示されるようにしている。

実装は Phase 5D-4C で構築済みのデスクトップ D&D の安全経路をそのまま再利用する形で行った。resolver（`move/findCompositeBlockDropTarget.ts#resolveCompositeBlockDropTarget`）、executor（`edit/dropCompositeBlock.ts#dropCompositeBlock`、既存の `edit/moveCompositeBlock.ts#moveCompositeBlock`）、`view/OutlineTreeView.ts` 側の `dispatchAndApplyCompositeDrop`・`computeCompositeDropZone`・`handleCompositeDragOverNode`・`endDrag`・`cancelCompositeDrag` は、いずれもテキスト上一切変更していない。

モバイル専用の resolver、executor、Markdown 書き換え経路は追加していない。この事実は `tests/OutlineTreeView.mobileCompositeDragHandle.test.ts` の non-regression テスト（`dropCompositeBlock`/`moveCompositeBlock`/`findCompositeBlockDropTarget` が既存の Phase 5D-4C のモジュールパスからそれぞれ一度だけ import されていること、`mobileComposite(Drag|Drop|Resolver|Executor)` という語のパターンがファイル中に存在しないこと、`setPointerCapture`/`releasePointerCapture` が使われていないことを確認するテスト）によって検証済みである。

既存の長押しメニューが提供する「拡張ブロックを上へ移動」（`tree.menu.compositeMoveUp`）「拡張ブロックを下へ移動」（`tree.menu.compositeMoveDown`）は維持しており、本チケットはこれらを置き換えるものではなく補完するものである。この事実は `showCompositeCommandMenu` の該当項目が変更されていないことを確認するテストで検証済みである。

## 2. 変更ファイル一覧

本チケットに関係する production code、テスト、設計文書、実機 fixture を以下に一覧化する。`git status --short` だけでなく各ファイルの内容そのもの（冒頭ドキュメントコメントに限らず、本文中の "Phase 5D-4D" 言及の有無）を直接確認したうえで、Phase 5D-4C 由来かつ Phase 5D-4D では実質的な変更を受けていない差分（グループB）と、Phase 5D-4D で新たに追加・変更した差分（グループA）を明確に分けて記載する。Phase 5D-4C で作成されたファイルであっても、Phase 5D-4D で実質的な変更（新規 assertion の追加や既存ヘルパーの修正など）を受けたものは、グループAに含める。

### グループA: Phase 5D-4D 由来の変更（本チケット固有）

| ファイルパス | 変更種別 | 役割 | 変更理由 | 安全契約への影響 |
|---|---|---|---|---|
| `src/view/OutlineTreeView.ts` | 変更（同一ファイル内に Phase 5D-4C の既存差分と Phase 5D-4D の追加差分が混在。Phase 5D-4D 由来の差分の内訳は本文書§3参照） | Tree ビューのレンダリングと D&D の UI 配線 | dragHandleEl の生成条件拡張、CompositeBlock 分岐のモバイル許可、長押しガード追加 | UI 配線のみの変更であり、source/target 解決・resolver・executor 自体には触れていない。詳細は§4参照 |
| `tests/OutlineTreeView.mobileCompositeDragHandle.test.ts` | 新規 | Phase 5D-4D 専用の static-source-text テスト | モバイルハンドル追加が加算的な UI 配線変更のみであることを検証するため | 安全契約の非回帰を直接検証する新規テスト群（§4・§5参照） |
| `tests/listPrefixUiWiring.test.ts` | 変更（landmark 陳腐化に伴う例外的追随更新） | list 行の UI 配線テスト | Phase 5D-4D の production 変更で旧 landmark 文字列が非一意化したため | 契約の削除・緩和なし。境界検証を追加（§5参照） |
| `tests/paragraphOutlineTreeUiWiring.test.ts` | 変更（同上） | paragraph 行の D&D 配線テスト | 同上 | 同上 |
| `tests/paragraphPartialEditLaunchUiWiring.test.ts` | 変更（同上） | Partial Edit 起動テスト | 同上 | 同上 |
| `tests/outlineTreeDragPayloadSafety.test.ts` | 変更（大部分は Phase 5D-4C 由来。Phase 5D-4D 固有の差分はコメント上の言及とチェーン境界ヘルパーの再利用・isComposite 分岐の配線位置検証に限られる） | dataTransfer ペイロード安全性の全体テスト | Phase 5D-4D による isComposite 分岐ゲート条件の拡張後も、配線位置・cleanup 契約が崩れていないことを確認するため | 崩れていないことをテストで直接確認済み（§4・§5参照） |
| `tests/OutlineTreeView.compositeDrag.test.ts` | 既存改修（Phase 5D-4C で作成された既存テストファイルであり、Phase 5D-4D で mobile drag handle 関連の検証を追加・更新した） | CompositeBlock D&D の UI 配線テスト。Phase 5D-4C の desktop CompositeBlock D&D 契約と、Phase 5D-4D の mobile drag handle 契約を同一ファイルで継続して検証している | Phase 5D-4D の production 変更（dragHandleEl 生成条件拡張、drag-wiring ゲート条件変更、draggable 属性のプラットフォーム分岐、長押しガード追加）を検証する新規 assertion を追加し、既存の分岐切り出し helper をチェーン内スコープに更新する必要があったため | 契約の削除・緩和なし。desktop 契約（Phase 5D-4C）と mobile 契約（Phase 5D-4D）の双方を継続検証。詳細は§5参照 |
| `docs/phase5d4d_mobile_composite_block_drag_handle_design.md` | 新規（本エンゲージメント内で作成し、§8として最終記録を追記済み） | 本チケットの設計メモ | 設計契約とスパイク結果・実装記録・テスト記録の確定 | 文書のみであり production code への影響なし |
| `/Users/kazumikaizuka/Obsidian/ipad-test/Test/Phase 5D-4D Mobile CompositeBlock Drag Handle Acceptance.md` | 新規（ipad-test vault、git 管理外） | iPad 実機受入専用 fixture | Case 1〜7 の実機受入手順を提供するため | plugin repository 外のファイルであり、既存 `Test/Unified Outliner Test.md` には一切影響しない |

### グループB: Phase 5D-4C からすでに存在していた差分（本チケットでは変更なし。参考として記載）

| ファイルパス | 変更種別 | 役割 | 本チケットとの関係 |
|---|---|---|---|
| `src/parser/compositeBlocks.ts` | 変更（Phase 5D-4C 由来） | `sameCompositeAnchorLevel` 共有 helper の抽出 | 本チケットでは一切変更していないことをコード読解（`git diff` の内容が全て "Phase 5D-4C" と明記されていること）で確認済み |
| `src/edit/dropCompositeBlock.ts` | 新規（Phase 5D-4C 由来） | 非隣接 CompositeBlock drop の executor | 同上。冒頭コメントに "Phase 5D-4C" と明記 |
| `src/move/findCompositeBlockDropTarget.ts` | 新規（Phase 5D-4C 由来） | 非隣接 CompositeBlock drop の resolver | 同上 |
| `tests/dropCompositeBlock.test.ts` | 新規（Phase 5D-4C 由来） | executor の unit test | 同上 |
| `tests/findCompositeBlockDropTarget.test.ts` | 新規（Phase 5D-4C 由来） | resolver の unit test | 同上 |
| `docs/phase5d4b_composite_block_atomic_drag_and_drop_design.md` | 新規（Phase 5D-4B 由来） | Phase 5D-4B の設計メモ | 本チケットでは未変更。参照のみ |
| `docs/phase5d4c_composite_block_atomic_drag_and_drop_implementation.md` | 新規（Phase 5D-4C 由来） | Phase 5D-4C の実装記録 | 本チケットでは未変更。参照のみ |

### グループC: 本チケットの変更対象ではないファイル（参考として記載）

`docs/phase5d4d_mobile_composite_block_move_controls_design.md`（未追跡、既存）は、ファイル冒頭に「Phase 5D-4D: Mobile CompositeBlock Move Controls 設計メモ」とあり、本チケット（Drag Handle）とは異なる設計アプローチ（D&D ではなく Move 用コントロールの検討）を扱う別の文書である。本チケットではこのファイルを作成・変更していない。このファイルと本チケットとの経緯上の関係（採用・不採用・並行検討等）については、本文書の直接確認範囲を超えるため、これ以上の断定は行わない。

## 3. 実装内容

`src/view/OutlineTreeView.ts` に対する Phase 5D-4D 由来の変更として、以下を正確に記録する。

- dragHandleEl の生成条件を `!readOnly` から `!readOnly || isComposite` へ拡張したこと。
- CompositeBlock drag-wiring 分岐のゲート条件を `isComposite && !Platform.isMobile` から `isComposite` へ変更したこと。
- モバイルではハンドル（dragHandleEl）を draggable にし、デスクトップでは既存どおり行全体（selfEl）を draggable にすること。
- dragstart、dragover、dragleave、drop、dragend の既存 listener 本体（`handleCompositeDragStart`/`handleCompositeDragOverNode`/`handleDragLeave`/`handleCompositeDropNode`/`handleDragEnd` の呼び出し文言）を変更していないこと。
- composite 専用の長押し処理へ、既存単独ブロックと同じハンドル起点除外ガード（`if (dragHandleEl && dragHandleEl.contains(evt.target as Node)) return;`）を追加したこと。
- CompositeBlock 親行だけを source とすること。
- member、complex-member、paragraph、section、plain list 行を CompositeBlock D&D の source にしないこと。
- before / after のみを使い、inside drop zone を追加していないこと。
- 隣接 drop は `moveCompositeBlock`、非隣接 drop は `dropCompositeBlock` を使うこと。
- source snapshot、target 再解決、resolver、executor、fail-closed、raw text 保存の既存経路（いずれも Phase 5D-4C 由来）を再利用すること。
- 新しい本文書き換え経路を追加していないこと。

これらの事実はいずれも `tests/OutlineTreeView.mobileCompositeDragHandle.test.ts` の各テスト（dragHandleEl 生成条件テスト、isComposite 分岐ゲート条件テスト、draggable 属性のプラットフォーム分岐テスト、5リスナー byte-identical テスト、長押しガード順序テスト、non-regression テスト群）および `tests/outlineTreeDragPayloadSafety.test.ts` の該当テストによって、production code 上のテキストと突き合わせて確認済みである。

## 4. 安全契約の監査

以下の安全契約は、いずれも Phase 5D-4C で確立され本チケットでは変更していないものである。本チケットの意義は、これらの契約に触れることなくモバイルでも到達可能にした点にあるため、各項目についてコード上の確認とテスト上の確認を分けて記録する。

| 安全契約 | コード上の確認 | テスト上の確認 |
|---|---|---|
| source の限定 | `handleCompositeDragStart` の呼び出しは isComposite 分岐内の一箇所のみで、他の分岐からは呼ばれていない | `outlineTreeDragPayloadSafety.test.ts` の配線位置テスト、`OutlineTreeView.mobileCompositeDragHandle.test.ts` の precedingBranches 検証テスト |
| target の限定 | `handleCompositeDragOverNode`/`resolveCompositeBlockDropTarget` の呼び出し文言は Phase 5D-4C から不変 | `OutlineTreeView.mobileCompositeDragHandle.test.ts` の non-regression テスト |
| before / after の二値限定 | `computeCompositeDropZone` は不変で "inside" を含まない | 同テストで `zoneBody` が `"inside"` を含まず `"before"`/`"after"` を含むことを確認 |
| inside drop 禁止 | 同上 | 同上 |
| 同一 section・parentId・depth・indentColumns の限定 | `sameCompositeAnchorLevel`（Phase 5D-4C 由来、`resolveCompositeBlockDropTarget` 内で使用）は不変 | `tests/findCompositeBlockDropTarget.test.ts`（Phase 5D-4C 由来、既存） |
| self drop 拒否 | `resolveCompositeBlockDropTarget` の "self-drop" 判定は不変 | 同上 |
| CompositeBlock 内部 boundary 拒否 | 同関数の "composite-internal-boundary" 判定は不変 | 同上 |
| target ambiguity 拒否 | `dropCompositeBlock.ts` の "target-boundary-changed" 判定は不変 | `tests/dropCompositeBlock.test.ts`（Phase 5D-4C 由来、既存） |
| snapshot mismatch 拒否 | 同ファイルの "composite-boundary-changed" 判定は不変 | 同上 |
| source / target 再解決不能時の拒否 | `resolveTargetCandidate`/`findRangeInvalidReason` は不変 | 同上 |
| fail-closed | 全ての拒否経路で `changed: false` かつ `lines` が入力と byte-identical（`dropCompositeBlock.ts` 冒頭コメントに明記） | 同上 |
| raw text の保存 | `move/moveBlock.ts#insertBlockAt`（既存、未変更）が既存行を移動するのみでテキストを再構成しない | 同上 |
| 意図しない再マッチ・隣接吸収の防止 | `snapshotMatches`/`findRangeInvalidReason` は不変 | 同上 |
| refresh・onClose・dragend・cancel 後の cleanup | `endDrag()` が `compositeDragSession = null` を含む4フィールドのクリアを行うこと、`cancelCompositeDrag()` が `endDrag()` と `clearDropIndicator()` を呼ぶことは不変 | `outlineTreeDragPayloadSafety.test.ts` の endDrag／cancelCompositeDrag テスト、`OutlineTreeView.mobileCompositeDragHandle.test.ts` の non-regression テスト |
| 既存長押しメニューの維持 | `showCompositeCommandMenu` の Move up/down 項目は不変 | `OutlineTreeView.mobileCompositeDragHandle.test.ts` の該当テスト |
| section/list・paragraph・callout/blockquote の既存操作非回帰 | 先行する4分岐に CompositeBlock 固有参照が漏れていないこと、dragend リスナー数が5のまま増えていないこと | 同テスト、および3件の landmark 例外更新テスト（§5参照） |

## 5. テスト監査

本チケットに関係するテストを以下に分類して記録する。

### 新規テスト

`tests/OutlineTreeView.mobileCompositeDragHandle.test.ts`（180行）。Phase 5D-4D 専用の static-source-text テストであり、dragHandleEl 生成条件、isComposite 分岐ゲート条件、draggable 属性のプラットフォーム分岐、5リスナーの byte-identical 性、長押しガードの順序、長押しメニューの非回帰、desktop D&D コアの非回帰、import の非回帰、先行4分岐への漏れなし、dragend リスナー数を検証する。

### 既存テストの正規な更新

`tests/outlineTreeDragPayloadSafety.test.ts`（+175行）。この diff の大部分は Phase 5D-4C 由来（CompositeBlock 親行が4件目の drag source として追加されたことに伴うテスト追加）であり、本チケット固有の内容はコメント上の言及（"Phase 5D-4D: the branch's own gate condition widened..."）と、isComposite 文字列が非一意になったことに対応するチェーン境界ヘルパー（`getDragWiringChainRange`）の再利用、および isComposite 分岐の配線位置検証テストの記述更新に限られる。この診断は `git diff -- tests/outlineTreeDragPayloadSafety.test.ts` の全文を直接確認して行った。

`tests/OutlineTreeView.compositeDrag.test.ts`（384行、全27件の `it()` のうち4件が明示的に "Phase 5D-4D" と明記されたテストである）。本ファイルは Phase 5D-4C で作成された既存テストファイルであり、Phase 5D-4D ではこのファイルを新規作成したのではなく、既存ファイルを更新した。Phase 5D-4C の desktop CompositeBlock D&D 契約（compositeDragSession の独立性、5リスナーの配線、`handleDragOver`/`handleDrop` からの委譲など）を検証する既存テストは変更せず維持したまま、Phase 5D-4D では少なくとも以下の mobile drag handle 関連検証を追加または更新した。

- dragHandleEl 生成条件が `!readOnly` から `!readOnly || isComposite` へ拡張されたことの検証
- CompositeBlock drag-wiring 分岐のゲート条件が `isComposite && !Platform.isMobile` ではなく、単に `isComposite` であることの検証（`isComposite && !Platform.isMobile` という旧ゲート文字列がファイル中に存在しないことを直接確認するテストを含む）
- mobile では drag handle（dragHandleEl）、desktop では row 本体（selfEl）に `draggable` 属性を付与するプラットフォーム分岐が存在することの検証
- CompositeBlock 専用の長押し処理（`isComposite && Platform.isMobile` ブロック）に、ハンドル起点のタッチを除外するガードが存在し、かつ `isPrimary` チェックより先に実行されることの検証
- 既存の composite branch 切り出しヘルパー（`compositeBranchBody()` 等）が、`"} else if (isComposite) {"` という文字列がファイル中で非一意になったことに対応して、drag-wiring チェーン内の正しいスコープ（`chainStart`〜`chainEnd`）を対象にするよう更新されたこと

したがって本ファイルは「既存改修テスト」であり、Phase 5D-4C の desktop CompositeBlock D&D 契約と、Phase 5D-4D の mobile drag handle 契約を、同一ファイルで継続して検証している。この分類は `tests/OutlineTreeView.compositeDrag.test.ts` の全文を直接読解し、"Phase 5D-4D" という文字列の出現箇所（4件の `it()` およびヘルパー関数のコメント）を確認したうえで行った。

### landmark 陳腐化に伴う例外的追随更新

以下の3ファイルは、いずれも本チケットの production 変更（isComposite 分岐ゲート条件の変更、dragHandleEl 生成条件の拡張）によって、既存の static-source-text landmark が非一意化・陳腐化したことへの追随修正である。

| ファイル | 旧 landmark | 新 landmark | 守った契約 | 追加した境界検証 |
|---|---|---|---|---|
| `tests/listPrefixUiWiring.test.ts` | `body.indexOf("isComposite) {")`（非一意な部分一致） | `listRowBranchBody()` ヘルパー：開始 `"isOutlineListNode(node)) {"`、終了 `"} else if (isComposite) {"` を、出現回数・順序を検証したうえで使用 | list 行の branch 本体に `innerEl.setText` が含まれないこと、CompositeBlock 固有参照が含まれないこと | landmark 未検出・曖昧一致・逆順境界・空範囲を検出する例外送出ガード |
| `tests/paragraphOutlineTreeUiWiring.test.ts` | 固定文字数（約200文字）による近接判定 | `paragraphDragBranch()` ヘルパー：開始 `"} else if (isOutlineParagraphNode(node) && !Platform.isMobile) {"`、終了 `"} else if (\n      isComplexMember &&\n      node.isStandalone &&"` | paragraph drag branch に `dragHandleEl`／CompositeBlock 固有参照が含まれないこと | 同上 |
| `tests/paragraphPartialEditLaunchUiWiring.test.ts` | 固定200文字の近接判定 | `if (!readOnly || isComposite) {` の一意出現とその後の `dragHandleEl = selfEl.createDiv(...)` 生成文までの間に他の文が挟まらないことを直接検証 | paragraph branch への漏れなし、F2／Partial Edit 起動経路が無変更であること | 同上、および `isComposite`/`isParagraph` の独立した派生元宣言の存在確認 |

以下の事実も記録する。

- assertion の削除はない。
- assertion の期待値緩和はない。
- skip、todo、only、条件付き無効化は追加していない。
- landmark 未検出、曖昧一致、逆順境界、空範囲を検出するガードを追加した。
- paragraph、list、Partial Edit の branch に CompositeBlock 固有参照が漏れないことを検証した。
- npm test は 97 test files / 1853 tests が成功した（既に得られた結果であり、本文書作成のために再実行していない）。

## 6. 実機受入

開発指示者が iPad 実機上で専用 fixture の Case 1〜Case 7 を確認し、すべて正常に動作したと報告した。詳細なケース別ログは作成していない。本実機受入は開発指示者の要約報告に基づく。

以下の事実のみを記録する。

- 開発指示者が iPad 実機で確認したこと。
- 使用した fixture の完全パスは `/Users/kazumikaizuka/Obsidian/ipad-test/Test/Phase 5D-4D Mobile CompositeBlock Drag Handle Acceptance.md` であること。
- 開発指示者が Case 1〜Case 7 のすべてが正常に動作したと要約報告したこと。
- 詳細なケース別ログは作成していないこと。
- この受入判定は開発指示者の要約報告に基づくこと。
- fixture 作成後、fixture 本体に実機操作の痕跡が残っていないこと（sha256 が `d11e14a007ea605162c16ec97697bc6cdea468c989a9dbe0e267b6d4ae9b6075` のまま、作成直後・実機テスト後・本文書作成直前の再確認の3時点で一致することを確認した）。
- 既存 `Test/Unified Outliner Test.md` が無変更であること（sha256 が `1c89e4cccee7767c2dafa4064e1ba1a5e998edfa5bb1c0e71a8267bf20077093` のまま、同じ3時点で一致することを確認した）。
- iPad 実機操作は開発指示者が行い、Claude は代行していないこと。

## 7. 検証結果

以下は、本文書作成以前に既に得られていた結果の記録である。本文書作成のために npm test、tsc、lint、build は再実行していない。

- `npm test`: 97 test files / 1853 tests 成功。
- `npx tsc -noEmit -skipLibCheck`: 成功。
- `npm run lint`: error 0、既存 warning 3。
- `npm run build`: 成功。
- `git diff --check`: 成功。

lint warning は、今回の変更と無関係な既存の `src/settings.ts` の警告であり、今回由来の新規 warning は 0 件である。

## 8. 既知の制約

- 実機受入は開発指示者による要約報告であり、全ケースの個別ログは残していない。
- mobile native HTML5 D&D の挙動は、Obsidian mobile および端末 WebView の実装に依存する。
- 今回は iPad Pro 11 inch、iPadOS 26.6、Obsidian mobile 1.14 での受入結果を根拠とする。
- iPhone、Android、別バージョンの Obsidian、別バージョンの OS については、今回の実機受入の対象外である。
- member / complex-member 単位の D&D は対象外である。
- inside drop は対象外である。
- 危険または曖昧な構造への drop は fail-closed で拒否する。
- 長押しメニューは維持しており、六点ハンドルはその補完である。
- 今回の範囲では settings、version、CHANGELOG、release 作業は行っていない。

## 9. 最終自己監査

- 本チケット（Phase 5D-4D Mobile CompositeBlock Drag Handle）に由来する production code 変更は `src/view/OutlineTreeView.ts` に限定される。同じ `git status --short` 上に現れる `src/parser/compositeBlocks.ts`、`src/edit/dropCompositeBlock.ts`、`src/move/findCompositeBlockDropTarget.ts` は、いずれも冒頭コメントに "Phase 5D-4C" と明記されており、本チケットでは一切変更していないことをコード読解によって確認した。
- 本チケットに由来する test 変更は、承認済みの新規テスト（`tests/OutlineTreeView.mobileCompositeDragHandle.test.ts`）、`tests/outlineTreeDragPayloadSafety.test.ts` の Phase 5D-4D 関連部分（コメント上の言及とチェーン境界ヘルパーの再利用、配線位置検証）、`tests/OutlineTreeView.compositeDrag.test.ts` の Phase 5D-4D 関連部分（Phase 5D-4C で作成された既存テストファイルに対する、mobile drag handle 関連検証の追加・更新。詳細は§5参照）、および例外承認済みの3テスト（`tests/listPrefixUiWiring.test.ts`／`tests/paragraphOutlineTreeUiWiring.test.ts`／`tests/paragraphPartialEditLaunchUiWiring.test.ts`）に限定される。`tests/dropCompositeBlock.test.ts`／`tests/findCompositeBlockDropTarget.test.ts` は Phase 5D-4C 由来であり、本チケットでは変更していないことを確認した。
- 本チケットに由来する fixture 変更は、ipad-test vault の専用新規 fixture（`Phase 5D-4D Mobile CompositeBlock Drag Handle Acceptance.md`）だけである。既存の `Test/Unified Outliner Test.md` には触れていない。
- plugin repository の変更内容（`git status --short` の全項目）を1件ずつ確認し、いずれも Phase 5D-4B／5D-4C 由来の既存差分（本チケットでは未変更）、または Phase 5D-4D の承認済み変更のいずれかに分類できることを確認した。`docs/phase5d4d_mobile_composite_block_move_controls_design.md` のみ、本チケットとは異なる設計アプローチを扱う既存の未追跡ファイルであり、本チケットでは作成・変更のいずれも行っていない。
- コミット、push、version bump、CHANGELOG 更新、タグ作成、GitHub Release 作成のいずれも行っていない。
- 実機確認は開発指示者が実施し、Claude は実施していない。Claude が実機を代行操作した、直接操作した、直接観測したという事実はない。
