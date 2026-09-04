# Phase 5D-4C: CompositeBlock Atomic Drag-and-Drop 実装ドキュメント

本文書は Phase 5D-4C「CompositeBlock Atomic Drag-and-Drop 最小実装」の完了時点における実装内容を記録するものである。設計契約は `docs/phase5d4b_composite_block_atomic_drag_and_drop_design.md` であり、本文書はその実装結果の報告として作成された。実機受入 fixture の作成、コミット、push、version bump、CHANGELOG 更新、タグ作成、GitHub Release 作成のいずれも本文書提出時点では行っていない。

## §1 変更ファイル一覧と各ファイルの責務

本チケットで変更した3ファイルおよび新規追加した6ファイルは以下の通りである。

| ファイルパス | 種別 | 追加・変更した公開API／内部関数 | 責務 |
|---|---|---|---|
| `src/parser/compositeBlocks.ts` | 変更 | `sameCompositeAnchorLevel(a, b)`（新規export） | `evaluateCompositeBlockMovability` の条件4（parentId・depth・indentColumns の一致判定）を共有 helper として抽出した。`evaluateCompositeBlockMovability` 自身もこの関数を呼び出す形にリファクタリングされ、既存の振る舞いは不変である。新規 resolver（後述）も同じ関数を呼び出すことで、隣接 Move と非隣接 D&D の「同一構造レベル」判定基準が将来乖離することを防ぐ。 |
| `src/move/findCompositeBlockDropTarget.ts` | 新規 | `resolveCompositeBlockDropTarget(doc, source, allComposites, target, zone)`。型 `CompositeBlockDropZone`／`CompositeBlockDropTargetHint`／`CompositeBlockDropTargetCandidate`／`CompositeBlockDropRejectReason`／`CompositeBlockDropResolution`。内部関数 `isNestedInList`。 | 非隣接 CompositeBlock D&D の純粋な判定 resolver。`doc.lines` を一切変更せず、既に解決済みの (source, target候補, zone) の三つ組が安全かどうかと `insertBeforeLine` のみを返す。他 CompositeBlock への widening は行わず、呼び出し側の責務とする。 |
| `src/edit/dropCompositeBlock.ts` | 新規 | `dropCompositeBlock(text, request, rules)`。型 `CompositeBlockDropRequest`／`NoCompositeDropReason`／`CompositeBlockDropOutcome`。内部関数 `rejected`／`findRangeInvalidReason`／`snapshotMatches`／`resolveTargetCandidate`。 | 非隣接 CompositeBlock D&D の純粋な executor。現在の Markdown 本文に対し `parseDocument` → `scanComplexBlocks` → `matchCompositeBlocks` を再実行し、source snapshot と target hint をそれぞれ再解決した上で `resolveCompositeBlockDropTarget` を呼び、許可された場合のみ既存の `insertBlockAt`（`move/moveBlock.ts`、無改造）で本文を書き換える。拒否時は `lines` を byte-for-byte 不変のまま返す。 |
| `src/view/OutlineTreeView.ts` | 変更 | 新規: `interface CompositeDragSession`、field `private compositeDragSession`、メソッド `compositeSnapshotMatches`／`resolveCompositeDragSource`／`compositeDropTargetHint`／`resolveCompositeDropCandidate`／`handleCompositeDragStart`／`handleCompositeDragOverNode`／`handleCompositeDropNode`／`computeCompositeDropZone`／`cancelCompositeDrag`／`dispatchAndApplyCompositeDrop`。変更: `renderNode`（`isComposite` 分岐追加）、`endDrag`（4フィールド目のクリア追加）、`refresh`／`onClose`（`cancelCompositeDrag` 呼び出し追加）、`handleDragOver`／`handleDrop`（`compositeDragSession` 早期分岐追加）。 | CompositeBlock 親行を D&D の source 兼 target として Tree UI に配線する。既存の section/list・paragraph・callout/blockquote の各 D&D 経路とは独立した session フィールド・cancel 経路・dispatch メソッドを持つ。隣接／非隣接の判定と、既存 `moveCompositeBlock`／新規 `dropCompositeBlock` への振り分けもこのファイルの責務である。 |
| `tests/findCompositeBlockDropTarget.test.ts` | 新規 | テストファイル（17テスト） | `resolveCompositeBlockDropTarget` の純粋な判定ロジックの単体テスト。 |
| `tests/dropCompositeBlock.test.ts` | 新規 | テストファイル（21テスト） | `dropCompositeBlock` の再解決・fail-closed・raw-range 保存・post-move 再マッチ安全性の単体テスト。 |
| `tests/OutlineTreeView.compositeDrag.test.ts` | 新規 | テストファイル（24テスト） | view 層の配線が「CompositeBlock 親行のみ」に限定されていることの静的ソーステキスト検査。 |
| `tests/outlineTreeDragPayloadSafety.test.ts` | 変更（例外的、§7参照） | テストファイル（23テスト） | Phase 5T-2R 由来の既存 drag payload 安全性契約に、`handleCompositeDragStart` が従っていることを検証する項目を追加。 |
| `docs/phase5d4b_composite_block_atomic_drag_and_drop_design.md` | 新規（設計段階で作成済み） | 設計文書 | 本実装の設計契約。§11 に例外的変更の記録を含む。 |

## §2 CompositeBlock D&D の完全なデータフロー

### dragstart

1. `renderNode` の `isComposite` 分岐にて `selfEl.addEventListener("dragstart", (evt) => this.handleCompositeDragStart(evt, node.id, itemEl))` が配線されている。
2. `handleCompositeDragStart(evt, compositeId, itemEl)` は次の順で処理する。
   1. `this.currentComposites.find(c => c.id === compositeId)` で対象 composite を解決する。見つからなければ `evt.preventDefault()` を呼んで終了する。
   2. `buildCompositeBlockSnapshot(composite)` で snapshot を構築する（`showCompositeCommandMenu` の Move/Delete が使うものと同一の builder）。
   3. `this.compositeDragSession = { snapshot, sourceTreeNodeId: compositeId }` をセットする。
   4. `this.draggingItemEl = itemEl` とし、`itemEl.addClass("unified-outliner-dragging")` を呼ぶ。
   5. `evt.dataTransfer` が存在すれば `setData("text/plain", "")`（空文字列センチネル）と `effectAllowed = "move"` を設定する。

### dragover

dragover には2つの入口がある。

- 経路A（section/list 行を含む composite 行以外の対象）: `handleDragOver(evt, targetId, selfEl)` が呼ばれ、`this.compositeDragSession` が真である場合に最優先で `this.nodeById.get(targetId)` を解決し、`handleCompositeDragOverNode(evt, node, selfEl)` に委譲して return する（この判定は `calloutDragSession` チェックおよび既存 `dragSourceId` ベースロジックより先に行われる）。
- 経路B（composite 行自身が対象）: `renderNode` の `isComposite` 分岐の dragover listener が `if (this.compositeDragSession) this.handleCompositeDragOverNode(evt, node, selfEl)` を直接呼ぶ。

`handleCompositeDragOverNode(evt, node, selfEl)` の内部処理は次の順である。

1. `this.resolveCompositeDragSource()` で、現在の `this.currentComposites` から `compositeSnapshotMatches` により source composite を再解決する。
2. `this.compositeDropTargetHint(node)` で `node` を hint 化する（list 行ならその範囲、composite 行なら相手の全範囲＋ anchor の parentId）。
3. `doc`／source／target のいずれかが null であれば `clearDropIndicator()` して return する。
4. `this.resolveCompositeDropCandidate(doc, composites, target)` で hint を現在の doc 上の生きたノード／composite と突合し、depth／indentColumns を含む candidate に解決する。解決不能であれば `clearDropIndicator()` して return する。
5. `this.computeCompositeDropZone(evt, selfEl)` で before／after を算出する。
6. `resolveCompositeBlockDropTarget(doc, source, composites, candidate, zone)` を呼ぶ。`allowed: false` であれば `clearDropIndicator()` して return する。
7. 許可された場合のみ `evt.preventDefault()`・`dropEffect = "move"`・`this.setDropIndicator(selfEl, zone)` を実行する。

### drop

drop にも dragover と対になる2つの入口がある。

- 経路A: `handleDrop(evt, targetId, selfEl)` は `evt.preventDefault()` の後、`this.compositeDragSession` が真であれば最優先で session をローカル変数に捕捉し、`clearDropIndicator()` → `endDrag()` の順に呼んだ上で、`this.nodeById.get(targetId)` が解決できれば `handleCompositeDropNode(session, evt, node, selfEl)` を呼んで return する。
- 経路B: composite 行自身の drop listener は `evt.preventDefault()` → `if (!this.compositeDragSession) return` → session を捕捉 → `clearDropIndicator()` → `endDrag()` → `handleCompositeDropNode(session, evt, node, selfEl)` の順で処理する。

`handleCompositeDropNode(session, evt, node, selfEl)` は次の順で処理する。

1. `this.compositeDropTargetHint(node)` で target hint を再算出する。null であれば何もせず return する。
2. `this.computeCompositeDropZone(evt, selfEl)` で zone を算出する。
3. `getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks)` で現在有効なルール集合を取得する。
4. `this.dispatchAndApplyCompositeDrop(session.snapshot, target, zone, rules)` を呼ぶ。

`dispatchAndApplyCompositeDrop(snapshot, target, zone, rules)` が隣接／非隣接を判定し executor を振り分ける、本チケットの中核となる分岐処理である。

1. アクティブな MarkdownView の editor から現在の全文 `text` を取得する。複数カーソル選択時は `notice.multipleCursors` を通知して `false` を返す（他 D&D 経路と同一のガード）。
2. `parseDocument(text)` → `scanComplexBlocks(doc)` → `matchCompositeBlocks(doc, complexScan, rules)` で新鮮な `doc`／`composites` を取得する。
3. `composites.find(c => this.compositeSnapshotMatches(snapshot, c))` で source を再照合する（`resolvedSource`）。
4. `resolvedSource` が解決できた場合のみ、以下の手順で隣接判定を試みる。
   1. `insertBeforeLine = zone === "before" ? target.range.startLine : target.range.endLine + 1`
   2. `direction = insertBeforeLine <= resolvedSource.range.startLine ? "up" : "down"`
   3. 既存 `findCompositeMoveTarget(doc, complexScan, resolvedSource, direction, composites)`（無改造）を呼ぶ。
   4. その戻り値の `range` が今回の drop target の `range` と **完全一致** する場合のみ「隣接」と判定し、`moveCompositeBlock(text, { snapshot, direction }, rules)`（既存、無改造）を呼ぶ。
   5. 一致しない場合、または `findCompositeMoveTarget` が `null` を返した場合は「非隣接」と判定し、`dropCompositeBlock(text, { snapshot, target, zone }, rules)`（新規）を呼ぶ。
5. `resolvedSource` が解決できなかった場合は、直接 `dropCompositeBlock` を呼ぶ（source の安全性再検証を executor 自身に委ねる）。
6. `applyLineEditOutcome(editor, cursor, snapshot.range.startLine, text.split("\n"), outcome, notify)` で結果を適用する。`notify` は意図的な no-op であり、これが CompositeBlock D&D のサイレント拒否契約の実体である。

**隣接／非隣接の境界条件**: 分岐点は「`findCompositeMoveTarget` が解決する隣接位置の `range` と、ユーザーが実際に drop した target の `range` が一致するかどうか」の一点のみである。この判定は dispatch 層における executor 選択に過ぎず、それ自体が安全性の根拠ではない。`moveCompositeBlock`・`dropCompositeBlock` のいずれも、呼ばれるたびに独立した再検証（re-parse／re-scan／re-match／re-resolve）を行うため、誤った振り分けが行われても不正な書き込みには至らない（設計文書 §5 参照）。

### dragend

CompositeBlock 親行を含む全5種の drag source 行が、`selfEl.addEventListener("dragend", () => this.handleDragEnd())` を持つ。`handleDragEnd()` は `this.endDrag()` → `this.clearDropIndicator()` のみを行う。`endDrag()` は `dragSourceId`・`paragraphDragSession`・`calloutDragSession`・`compositeDragSession` の4フィールドを無条件でクリアする、この4種の drag session に共通する唯一の終了処理である。ネイティブ HTML5 の dragend は、drop が成立しなかった場合（Escape キー押下、Tree 外への drop、ドラッグ中断）でも drag source 要素上で必ず発火するため、Tree 外への drop や中断時もこの経路で session が確実にクリアされる。

### cancel 経路（drop／dragend を介さない中断）

- `refresh()`: メソッド冒頭で `this.cancelParagraphDrag()` → `this.cancelCalloutDrag()` → `this.cancelCompositeDrag()` の順に無条件で呼び出す。この直後に `if (this.renameState) return` というガードが続くが、compositeDragSession のクリアはこのガードより **前** に実行されるため、renameState 中であっても確実にクリアされる。
- `onClose()`: `this.activeMenu?.hide()` 等の処理の後、同じく `this.cancelParagraphDrag()` → `this.cancelCalloutDrag()` → `this.cancelCompositeDrag()` の順に呼び出し、その後 `this.contentEl.empty()` で DOM を破棄する。
- `cancelCompositeDrag()` 自身の実装: `if (!this.compositeDragSession) return`（他のドラッグ種別が進行中の場合、または何も進行していない場合は無害な no-op として即座に return する）→ `this.endDrag()` → `this.clearDropIndicator()`。

## §3 fail-closed の実装

### resolver（`resolveCompositeBlockDropTarget`）

判定は固定順（source shape → self-drop → 同一レベル判定 → composite 内部境界）で行われ、最初に該当した理由のみが返される。以下は各拒否理由に対応する入力条件と、拒否結果自体（本関数は `doc.lines` を一切変更しないため「本文が変更されないこと」は関数のシグネチャ自体が保証する）を検証したテストケースの対応表である。

| 拒否理由 | 拒否条件（入力） | 検証テスト（`tests/findCompositeBlockDropTarget.test.ts`） |
|---|---|---|
| `nested-in-list` | source の anchor（`members[0]`）が `doc.nodes` 上で ListBlockNode として解決できない、またはその anchor 自身が別の list item の継続内にネストしている | describe "source shape eligibility" / "rejects (nested-in-list) when the source's own anchor single-line-list member is itself nested inside another list item's continuation" |
| `unsafe-indent` | source の members のうち list／single-line-list 種別のいずれかが `unsafeIndent === true`（タブ・スペース混在インデント等） | 同上 describe / "rejects (unsafe-indent) when the source's own anchor list item mixes tab/space leading whitespace" |
| `self-drop` | 算出された `insertBeforeLine` が `[source.range.startLine, source.range.endLine + 1]` の範囲内に入る | describe "self-drop" / before・after の2テスト |
| `different-parent-or-depth` | `sameCompositeAnchorLevel(anchor, target)` が false（parentId・depth・indentColumns のいずれかが不一致） | describe "different-parent-or-depth" / indentColumns 差異・parentId 差異（nested）・section 差異・synthetic depth 差異の4テスト |
| `composite-internal-boundary` | `insertBeforeLine` が既存いずれかの CompositeBlock の range に厳密に内包される | describe "composite-internal-boundary" / 第三者 composite の anchor 行のみを渡した場合の拒否テスト。加えて describe "widening" 内の "dropping 'after' a third-party composite's own bare anchor-row range (NOT widened) is rejected" が、widening 不足時にこの理由で正しく拒否されることを示す |

widening に関する2件の対照テスト（同一 describe "widening" 内、"before" の anchor-row-only candidate は許可され、同じ candidate を "after" に変えると `composite-internal-boundary` として拒否され、さらに candidate を全範囲まで widen すると再び許可される）により、resolver 自身は widening を一切行わず、呼び出し側が候補を正しく widen して渡すことが安全性の前提であることも合わせて検証されている。

### executor（`dropCompositeBlock`）

固定順（`range-invalid` → target 境界の粗チェック → 再 parse／scan／match → source 再照合 → target 再解決 → resolver 呼び出し）で検証し、最初に失敗した段階の理由を返す。`NoCompositeDropReason` は resolver の5理由に、executor 自身の再解決失敗に由来する3理由を加えたものである。

| 拒否理由 | 拒否条件（入力） | 検証テスト（`tests/dropCompositeBlock.test.ts`） |
|---|---|---|
| `range-invalid` | snapshot の `members` が空、または `range`／`members` 間の整合性が崩れている（開始行が終了行を超える、境界が現在の行数を超える等） | describe "range-invalid" / "rejects a structurally invalid snapshot (empty members)..."、"rejects a snapshot whose aggregate range is reversed (startLine > endLine)" |
| `composite-boundary-changed` | 現在の本文を再 parse／再 scan／再 match した結果、snapshot と field-for-field 完全一致する `CompositeBlockInfo` が存在しない（無関係な編集で range がずれた、内部に callout が挿入され match 自体が崩れた等） | describe "source snapshot mismatch / source re-resolution failure" / "rejects when an unrelated edit shifted the composite's own line range..."、"rejects when the composite no longer re-matches at all (a nested callout was inserted inside it, breaking the match)" |
| `target-boundary-changed` | target hint の range が現在の行数範囲外、または hint の range＋parentId に完全一致する生きた ListBlockNode／CompositeBlockInfo が存在しない | describe "target re-resolution failure" / "rejects when the target hint's range no longer matches any current node..."、"rejects when the target hint's range is out of bounds for the current document..." |
| `self-drop` | resolver が `self-drop` を返す（§3 resolver 表参照）、executor 側の再解決を経た上での end-to-end 検証 | describe "self-drop" / "rejects dropping a composite relative to its own current position..." |
| `different-parent-or-depth` | resolver が `different-parent-or-depth` を返す、executor 側の再解決を経た end-to-end 検証 | describe "different-parent-or-depth" / indentColumns 差異・parentId 差異・section 差異の3テスト |
| `composite-internal-boundary` | resolver が `composite-internal-boundary` を返す、executor 側の再解決を経た end-to-end 検証 | describe "composite-internal-boundary" / "rejects a drop that would land strictly inside a third-party composite's own aggregate range..." |

上記いずれのテストも `outcome.changed` が `false` であることに加え、`outcome.lines` が入力テキストを `split("\n")` したものと完全一致すること（byte 一致）を明示的に assert しており、fail-closed 契約（拒否時に本文が一文字も変わらないこと）はテストごとに個別に確認されている。加えて、purity/idempotency の3テストにより、拒否呼び出しが `snapshot`／`rules` 引数を変異させないこと、および同一入力での反復呼び出しが完全に同一の結果を返す（副作用がない）ことも確認済みである。

## §4 既存機能との非干渉の証明

section/list・paragraph・callout/blockquote の3種の drag source について、本チケット前後で配線カウント・session フィールド・cancel 経路が変化していないことを、以下の根拠により確認した。

| drag source | 配線カウントの根拠 | session フィールドの根拠 | cancel 経路の根拠 |
|---|---|---|---|
| section/list | `this.handleDragStart(` の出現回数が全体で1回のみ（変更前後で同一） | `dragSourceId` のみを使用。`endDrag()` が無条件でクリアする対象は本チケット前から変わらず含まれる | `handleDragOver`／`handleDrop` の既存 `dragSourceId` ベースロジックは、`compositeDragSession`／`calloutDragSession` の双方が偽である場合にのみ到達する最終フォールバックとして温存されている |
| paragraph | `this.handleParagraphDragStart(` の出現回数が全体で1回のみ | `paragraphDragSession` のみを使用。`endDrag()` の無条件クリア対象は不変 | `refresh()`／`onClose()` における `cancelParagraphDrag()` の呼び出し位置・順序は変更前と同一であり、`cancelCompositeDrag()` はその後ろに追記されたのみである |
| callout/blockquote | `this.handleCalloutDragStart(` の出現回数が全体で2回のみ（standalone 行・composite-member 行の既存2箇所、変更前と同一） | `calloutDragSession` のみを使用。`endDrag()` の無条件クリア対象は不変 | `handleDragOver`／`handleDrop` における `compositeDragSession` チェックは `calloutDragSession` チェックより先に置かれているが、両者は同時に真になることがない（単一のネイティブ drag は単一の session しか持てない）ため、callout drag が進行中の間は `compositeDragSession` が常に null であり、新設分岐は素通りする |

これらは以下のテストにより機械的に確認されている。

| 確認項目 | テストファイル／テスト名 |
|---|---|
| 3種の drag source の dragstart 配線回数が変更前と同一であること | `tests/outlineTreeDragPayloadSafety.test.ts` / "section/list, paragraph, and callout/blockquote drag sources each still wire dragstart the exact same number of times as before Phase 5D-4C..." |
| dragend listener 登録数が 4→5（新規 CompositeBlock 分の加算のみ）であること | `tests/outlineTreeDragPayloadSafety.test.ts` / "every drag-source row kind ... still binds a dragend listener to handleDragEnd on the source element itself..." |
| `.setData(` 呼び出し箇所数が 3→4（新規 CompositeBlock 分の加算のみ）であること | `tests/outlineTreeDragPayloadSafety.test.ts` / "has exactly four dataTransfer.setData(...) call sites in the whole file..." |
| `handleDragOver`／`handleDrop` が `compositeDragSession` を `calloutDragSession` および既存 `dragSourceId` ロジックより先にチェックすること | `tests/OutlineTreeView.compositeDrag.test.ts` / "handleDragOver and handleDrop (section/list rows) both check this.compositeDragSession FIRST..." |
| `refresh()`／`onClose()` の cancel 呼び出し順序（paragraph→callout→composite）が保たれていること | `tests/OutlineTreeView.compositeDrag.test.ts` / "refresh() cancels any in-progress composite drag UNCONDITIONALLY, immediately after cancelParagraphDrag()/cancelCalloutDrag()..."、"onClose() also cancels any in-progress composite drag session..." |
| `endDrag()` が4フィールドすべてを無条件クリアすること | 両テストファイル共通の該当テスト（`tests/outlineTreeDragPayloadSafety.test.ts` および `tests/OutlineTreeView.compositeDrag.test.ts`） |

さらに `npm test` を全体実行した結果、既存96テストファイル・1837テストすべてが変更後も成功しており（§5コマンド一括実行の結果は前回報告の通り）、`tests/compositeBlockMovability.test.ts`（`sameCompositeAnchorLevel` 抽出によるリファクタリングの影響を直接受ける既存ファイル）を含め、非回帰は個別ファイル単位でも確認済みである。

## §5 意図的に未対応とした範囲

**member 行・complex-member 行**: `renderNode` の `isComposite` 分岐は `isComplexMember` を一切参照しない独立した分岐であり、member 行・complex-member 行はそれぞれ既存の分岐（standalone callout/blockquote 分岐、composite-member callout/blockquote 分岐）にのみ到達する。加えて `compositeDropTargetHint` は `isOutlineListNode`／`isOutlineCompositeNode` のみを対象としこれら以外の行種別を一切扱わないため、これらの行が hover された場合でも target として解決されずインジケーターも表示されない。

**paragraph 行**: 同様に `renderNode` の `isComposite` 分岐には到達しない（`isOutlineParagraphNode` 専用の別分岐が先に一致する）。paragraph 行の既存 dragover/drop（`handleParagraphDragOver`／`handleParagraphDrop`）は `calloutDragSession` のみをチェックし `compositeDragSession` を一切参照しないため、target としても機能しない。

**section 行**: `compositeDropTargetHint` は `isOutlineSectionNode` を一切扱わず null を返すため、section 行上で dragover が発生しても target として解決されず、インジケーターも表示されない。

**inside drop zone**: `computeCompositeDropZone` は before／after の二値のみを返す関数であり、`CompositeBlockDropZone` 型自体が `"before" | "after"` の Union 型として宣言されている。CompositeBlock は atomic であり子スロットを持たないため、inside 相当のロジックはコード上に一切存在しない。

**CompositeBlock 内部境界への挿入**: `resolveCompositeBlockDropTarget` の判定順5番目（`composite-internal-boundary` チェック）が、算出された `insertBeforeLine` が既存いずれかの CompositeBlock の range に厳密に内包される場合を拒否する。self-drop チェック（判定順3番目）が先に走るため、source 自身の許容される自己隣接位置とは競合しない。

**異なる parentId／depth／indentColumns 間の移動**: `sameCompositeAnchorLevel(anchor, target)` が false を返す場合、`resolveCompositeBlockDropTarget` は判定順4番目で `different-parent-or-depth` として拒否する。section 境界を越える移動も、root list item の parentId が所属 section の id を保持するという既存モデルの性質（`model/block.ts` の `ListBlockNode.parentId` の doc comment に明記）により、この同一理由に自然に包含される。CompositeBlock D&D 専用の "not-same-section" のような別理由は設けていない。

## §6 既知の制約と残存リスク

- モバイル・タッチ・長押し D&D は実装対象外である（デスクトップのみ、`!Platform.isMobile` ガード。Phase 5T-2 以来の既存方針を踏襲した）。
- 複数選択状態での CompositeBlock D&D は対象外である。
- nested CompositeBlock（CompositeBlock 同士の入れ子）はそもそも Phase 5D-0.3 の非対象であり、本チケットでも変わらない。
- 拒否時のユーザー通知は意図的にサイレントである（Notice・i18n キーいずれも新設していない）。ドロップインジケーターが表示されないことのみが唯一のフィードバックであり、他の既存 D&D 経路（section/list・paragraph・callout/blockquote）と同一の慣習であるが、将来ユーザーから「なぜ drop できないか分からない」というフィードバックがあれば、専用 Notice の追加を検討する余地が残る。
- 実機での受入検証（§8 のチェックリスト）は本文書提出時点では未実施である。popout window 上での動作確認も含め、実機でのみ確認可能な項目は全て未検証のまま残っている。
- `resolveTargetCandidate`（`dropCompositeBlock.ts`）における「target ambiguity」は、現行の `ParsedDocument` の構造（ノード range が構築上互いに素であり、CompositeBlock の range は常に2行以上を占めるため単一ノードの range と衝突し得ない）に基づき到達不能と判断した。これは現行実装の構造的性質に依存した結論であり、将来 `ParsedDocument` のモデルが変更された場合は再検証が必要である。
- `ensureBlankSeparation`（`edit/paragraphNonAdjacentMove.ts`）相当の空行補正は追加していない。移動後に隣接行が意図せず新しい CompositeBlock として誤認識・吸収されないことは List+Callout・List+Quote の双方について純関数テストで確認済みだが、実機での多様な Markdown 構造（深いネスト、複数 CompositeBlock ルールの組み合わせ等）における網羅的な確認はまだ行われていない。
- `dispatchAndApplyCompositeDrop` の隣接／非隣接判定ロジック自体は新規実装であるが、安全性を左右しない dispatch 層の選択に過ぎないとはいえ、この判定ロジック自体の単体テストは `tests/OutlineTreeView.compositeDrag.test.ts` において「両方の executor が呼ばれ得ること」の静的検証に留まり、`OutlineTreeView` を実際にインスタンス化した動的テストは行っていない（Obsidian の `ItemView` が vitest 上で構築できないという既存の技術的制約による）。この部分の最終的な動作保証は §8 の実機受入チェックリストに委ねられる。

## §7 例外的変更ファイルの記録

本節は `docs/phase5d4b_composite_block_atomic_drag_and_drop_design.md` §11 と内容が重複するが、指示に従い本文書にも記録する。

### 理由

`tests/outlineTreeDragPayloadSafety.test.ts` は Phase 5T-2R 由来の既存ファイルであり、当初の変更対象ファイル一覧には含まれていなかった。しかし `OutlineTreeView.ts` へ `handleCompositeDragStart`（CompositeBlock 親行専用の新規 dragstart ハンドラ）と対応する dragend listener を追加した結果、同ファイルが持つ2件のハードコードされた件数アサーションが、この新規かつ正当な第4の drag source を検出して失敗した。これは同ファイル自身のドキュメントコメントが明示する「新規 drag source 追加時にこのテストの更新を強制する」という設計上意図された挙動であり、実装の不具合ではない。対象外ファイルを変更する前に報告し承認を得るという制約に従い、`AskUserQuestion` で本状況を報告し、ユーザーの承認を得た。承認は本ファイル1件に限定され、かつ「件数を機械的に更新するだけでなく、CompositeBlock D&D が既存の drag payload safety 契約を実際に満たすことを検証する assertion を追加する」ことが明示的に要求された。

### 変更前に失敗した2件のテスト名

| # | 変更前のテスト名 | 変更前の期待値 |
|---|---|---|
| 1 | "has exactly three dataTransfer.setData(...) call sites in the whole file (section/list dragstart, paragraph dragstart, callout/blockquote dragstart) — no new drag source was added without updating this test" | `.setData(` 呼び出し箇所数が 3 であることを期待 |
| 2 | "every drag-source row kind (section/list, paragraph, standalone callout/blockquote, CompositeBlock-member callout/blockquote) still binds a dragend listener to handleDragEnd on the source element itself..." | `dragend` listener 登録数が 4 であることを期待 |

### 更新した期待値

- `.setData(` 呼び出し箇所数のアサーションを 3 → 4 に更新した（新規 `handleCompositeDragStart` 分）。
- `dragend` listener 登録数のアサーションを 4 → 5 に更新した（CompositeBlock 親行 branch 分）。テスト名自体も「CompositeBlock parent row」を含む記述に更新し、対象の drag source の総数（5種）を明記した。

### 追加した assertion の一覧

- `handleCompositeDragStart` が既存 `handleCalloutDragStart` と同一の空文字列 sentinel（`setData("text/plain", "")`）・`effectAllowed = "move"` を設定し、`compositeId`／`node.id` を一切 payload に含めないことを検証する新規 assertion。
- `handleCompositeDragStart` が既存 `handleCalloutDragStart` と **文字通り同一** の sentinel 文（クロスブラウザ互換性のための同一契約であり、単に見た目が似ているだけではないこと）を持つことを検証する新規 assertion。
- CompositeBlock の dragstart 配線（`this.handleCompositeDragStart(`）がファイル全体で厳密に1箇所のみであり、かつその1箇所が `renderNode` の drag-wiring if/else-if チェーンの最終 branch（`isComposite`）の内部にのみ存在することを、位置ベースで検証する新規 assertion（member 行・complex-member 行・paragraph 行・section 行・plain list 行への誤配線がないことの直接的な証明）。
- `endDrag()` が `dragSourceId`・`paragraphDragSession`・`calloutDragSession`・`compositeDragSession` の4フィールドすべてを無条件クリアすることを検証する既存 assertion の拡張。
- `cancelCompositeDrag()` が `refresh()`／`onClose()` に配線されており、かつ自身が `endDrag()`／`clearDropIndicator()` を呼ぶことを検証する新規 assertion（例外・cancel 後にセッションが残留しないことの検証）。
- CompositeBlock 親行 branch 自身の drop ハンドラが `handleCompositeDropNode` への委譲前に `endDrag()` を呼ぶことを検証する新規 assertion（drop-then-endDrag の順序保証）。
- 既存の section/list・paragraph・callout/blockquote 各 drag source の dragstart 配線回数が本チケット前後で変化していないことを検証する新規 assertion（非回帰の直接証明）。

既存の assertion は一切削除・弱体化しておらず、件数の更新も上記の新規 assertion を伴う実質的な検証とセットでのみ行った。更新後、`npm test`／`npx tsc -noEmit -skipLibCheck`／`npm run lint`／`npm run build`／`git diff --check` を再実行し、全て成功したことを確認済みである（結果は前回報告の通り）。

## §8 実機受入チェックリスト（空欄）

以下は実機確認後に開発指示者が記入するための未記入チェックリストである。

- [ ] Method Vault の `Test/Unified Outliner Test.md` で CompositeBlock D&D が使えること
- [ ] 同一 section・同一 parentId・同一 depth で List + Callout の before/after drop が成功すること
- [ ] 同一 section・同一 parentId・同一 depth で List + Quote の before/after drop が成功すること
- [ ] drop 後に source 行の raw text（list marker・インデント・callout prefix・title・本文・fold marker）が一文字も変わらないこと
- [ ] drop 後に意図しない CompositeBlock 再マッチ（隣接吸収）が発生しないこと
- [ ] drop 後に section/list・paragraph・callout/blockquote の既存 D&D が引き続き動作すること
- [ ] member 行・complex-member 行・section 行への drag が CompositeBlock D&D を起動しないこと
- [ ] inside drop indicator が一切表示されないこと
- [ ] drag 中に refresh または onClose を呼び出しても session が残留しないこと
- [ ] popout window 上でも上記の全項目が動作すること
