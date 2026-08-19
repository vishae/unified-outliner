# Phase 5T-5D: 本文カーソル → Tree current-position highlight と、Tree selection follow の拡張設計・監査

本ドキュメントは設計・監査専用であり、`src/`・`tests/`・CSS・manifest・ビルド成果物への変更は一切含まない。`src/parser/parseDocument.ts` も未変更である。

## §0 目的

本フェーズの目的は、次の2つの、互いに独立した課題について設計を確定することである。

1. **current-position highlight（`highlightedId`）の拡張**: 現在、本文エディタのカーソル位置に連動する `highlightedId` は section/list（`BlockNode`）のみを対象としている。これを、paragraph・standalone callout・standalone blockquote・fenced code・table を含む、既存の7種類の対象種別に拡張するための設計を行う。ただし本フェーズが対象とするのは「すでに Tree に表示されている node」のみであり、Tree に新たな表示種別を追加することは対象外である。
2. **selection follow / repair（`selectedId`）の拡張**: Tree 上で選択していたノードに対して move/edit コマンドを実行した後、Markdown 本文は正しく更新されるにもかかわらず、Tree の選択状態（`selectedId`）が古い位置、または誤ったノードを指したままになる場合がある、という利用者の報告を受け、その原因を監査によって特定し、修復方式を設計する。この不具合が paragraph 固有のものか、Tree ノード全般に及ぶ一般的な問題かを、コード監査によって切り分ける。

`selectedId`（利用者主導の Tree 操作状態）と `highlightedId`（カーソル駆動の現在位置表示）の責務は本フェーズを通じて明確に分離されたままとする。selection follow は `highlightedId` の代用・転用として実装してはならず、独自の「論理的対象の再解決」として実装されなければならない。

## §1 対象範囲・非対象範囲（再確認）

### 対象（current-position highlight）

対象7種別: section、list item、paragraph、standalone callout、standalone blockquote、fenced code、table。ただし「Tree に表示される node」だけを対象にする——Tree に存在しないものを新たに表示・生成することは本フェーズの対象外である（§3-3 でこの制約と対象7種別の間に生じる緊張関係を報告する）。

### 対象（selection follow / repair）

Tree 上で選択されていたノードに対する move/edit 系操作（paragraph move、paragraph 非隣接 move、paragraph Partial Edit 保存、section/list move、standalone complex block move、composite move/delete 等）の後、`selectedId` が同じ論理的対象を指し続けるように再解決する設計、および再解決が不可能な場合の扱いの設計。

### 非対象（共通）

- `parseDocument.ts` への変更。
- `ParsedDocument.nodes` へ paragraph/ComplexBlock を追加すること。
- `ComplexBlockInfo` と `BlockNode` のモデル統合。
- paragraph Tree node の read-only/leaf/no-fold 契約の変更。
- Tree-node-id・scan-local-id・view-id を永続的な識別子として使うこと。
- 本番コード・テスト・CSS・manifest・ビルド成果物の変更、GUI 自動操作、実機検証。
- paragraph↔list のクロスモデル move（既存スコープ外のまま）。

## §2 絶対不変条件（再掲）

- Markdown が唯一の真実であり続ける。
- `parseDocument.ts` は変更しない。
- paragraph Tree node は read-only・leaf・no-fold のままとする。
- Tree-view-id・scan-local-id は永続識別子として扱わない——Tree row の range/parentId/depth はあくまで再解決のためのヒントに過ぎない。
- 保存時は常に現在の本文から再解決する。
- 不安全・曖昧・変化後の状態は安全側に拒否する。
- Tree と本文が恒久的に不整合な状態にならない。
- 既存の 5T-1/5T-2/5T-3A move 契約、5T-2S の Tree/body 整合性スコープを退行させない。
- paragraph↔list のクロスモデル move は対象外のまま。
- `selectedId` と `highlightedId` の責務は分離を維持する。selection follow は `highlightedId` の代用として実装しない。

## §3 監査結果

### §3-1 既存の cursor → Tree highlight 同期パイプライン

**resolveHighlightedNodeId / resolveHighlightedSectionId**（`src/tree/resolveHighlightedSectionId.ts`）は、Obsidian に依存しない純粋関数であり、`resolver/resolveCurrentBlock.ts` の上に薄くラップされている。`resolveHighlightedNodeId(doc, cursorLine, {includeLists})` は `includeLists: true` の場合、解決された `BlockNode` の id をそのまま返す（カーソルが list item 内にあればその list item がハイライトされる）。`includeLists` が false／未指定の場合は、`parentId` を辿って最初に見つかる `type === "section"` の祖先の id を返す。**この2関数はどちらも `BlockNode` のみを対象としており、`ComplexBlockInfo`（paragraph/callout/blockquote/fenced-code/table/thematic-break）を一切認識していない。**

**resolveCurrentBlock**（`src/resolver/resolveCurrentBlock.ts`）はカーソル1行を受け取り、範囲外なら `{node:null, reason:"out-of-range"}`、`doc.codeBlockLines[cursorLine]` が真なら（他のどのチェックより先に、無条件に）`{node:null, reason:"code-block"}`、frontmatter 行なら `{node:null, reason:"frontmatter"}`、それ以外は `doc.lineToOwningNodeId[cursorLine]` を引いて対応する `BlockNode` を返す。

**重要な訂正（本チケット自身の前提を修正する監査結果）**: `parser/parseDocument.ts` の `lineToOwningNodeId` は2パスで構築される。パス1で、あるセクションの `range.startLine..endLine`（見出しから次の見出し直前まで）に含まれるすべての行が、そのセクション自身の id に割り当てられる——これには、list item に属さない本文行（standalone paragraph、callout、blockquote、table、thematic-break）がすべて含まれる。パス2で、list item の range（5P-1 のインデント契約に基づくネストした子段落行を含む）に含まれる行だけが、その list item 自身の id で上書きされる。

**結論**: 今日すでに、カーソルが standalone paragraph/callout/blockquote/table 内（list item 内でも fenced code 内でもない）にある場合、`resolveCurrentBlock`/`resolveHighlightedNodeId` は **null ではなく、囲んでいるセクション**（実在する `BlockNode` の id）に解決される。真に `null`（どこもハイライトされない）になるのは次の3ケースのみである。

| ケース | 理由 |
| --- | --- |
| fenced code block 内の行 | `codeBlockLines` チェックがセクション/list の所有権判定より無条件に先行するため |
| frontmatter 内の行 | `frontmatterLines` チェック |
| ドキュメント範囲外の行 | `out-of-range` |

したがって、本チケット自身が挙げる症状「本文カーソルが paragraph/callout/blockquote/fenced code/table 内にあると、Tree 上の該当行が current-position としてハイライトされない」は、**「その block 自身の行には正確にハイライトされない」という意味でのみ真**であり、「まったく何もハイライトされない」という意味では真ではない（fenced code を除く）。真のギャップは2種類に整理される。

1. **精度の粗さ**: 正確な該当行ではなく、囲むセクション（または `includeLists:true` 時は囲む list item）という粗い祖先にフォールバックしている。
2. **fenced code の無条件 null**: これは「対象7種別」に fenced code を含む本チケットの要求と直接関係するが、そもそも fenced code は Tree に表示される node ではない（§3-3 参照）。

**トリガー機構（本チケット自身の想定の訂正）**: Obsidian の公開 API には「カーソル移動」専用のイベントが存在しない。実際の実装（`OutlineTreeView.ts` の `onOpen`）は、CM6 の selection-change リスナーではなく、`active-leaf-change`・`file-open`・`editor-change` の workspace イベントと、`document` レベルの `keyup`/`mouseup` DOM イベントを、150ms のリーディングエッジ debounce（`scheduleRefresh`）を介して `refresh()` に束ねるという、実務的なプロキシ方式である。`refresh()` は毎回、`view.editor.getCursor().line` から `highlightedId` を全面的に再計算する（`this.highlightedId = resolveHighlightedNodeId(doc, cursorLine, { includeLists })`）。したがって「CM6 cursor/selection-change リスナー」という本チケットの想定は不正確であり、実際は粗いイベントプロキシ + debounce である。

**Tree → editor ジャンプ側**（`jumpToLine`）は、CM6 リスナーとのループを防ぐ特別な機構を持たない——そもそもループさせるべき対象リスナー自体が存在しないためである。`jumpToLine` は `editor.setCursor(...)` を呼んだ直後に `this.highlightedId = id` を直接代入し、即座に `renderTree()` する。次の keyup/mouseup トリガーの再計算を待たない、という単純な「先出し」設計である。

**renderNode() の適用**: `isHighlighted = node.id === this.highlightedId`、`isSelected = this.hasFocus && node.id === this.selectedId`（1071/1077行）。ハイライトは focus 状態に依存しないが、selection の可視化は `this.hasFocus`（Tree パネル自体が DOM フォーカスを持っているか）に依存する——Obsidian 自身の File Explorer の is-selected/is-active の使い分けを模している。

### §3-2 既存の selectedId パイプライン

`selectedId` への書き込み箇所は `OutlineTreeView.ts` 内に **正確に7箇所** しか存在せず、`selectedId` という識別子はファイル外では一切書き込まれない（`tree/outlineNavigation.ts` はコメントで言及するのみ）。

| 箇所 | 行 | 内容 |
| --- | --- | --- |
| `refresh()` | 653 | アクティブな MarkdownView がない場合に null リセット |
| 行クリック | 1386 | クリックされた node の id をそのまま代入 |
| `ensureSelection()` | 1812 | 可視ノードが0件なら null |
| `ensureSelection()` | 1817 | id 消失時、highlightedId かフォールバック（先頭可視ノード）へ |
| `moveSelection()` | 1874 | 矢印キーで隣接可視ノードへ |
| 子へ展開 | 1944 | Right キー：折り畳み解除して最初の子を選択 |
| 親へ | 1972 | Left キー：折り畳んで親を選択 |

**move/edit の dispatch 関数（`dispatchAndApplyParagraphMove`・`dispatchAndApplyParagraphNonAdjacentMove`・`dispatchAndApplyStandaloneComplexBlockMove`・`dispatchAndApplyCompositeMove`・`dispatchAndApplyCompositeDelete`・`PartialEditView.ts` の保存成功パスのいずれも、`selectedId` を一切書き換えない。** これらはすべて成功後に `this.refresh()` を直接呼ぶ（例: `dispatchAndApplyParagraphMove` は `changed` が真の場合、同期的に `this.refresh()` を呼ぶ）。つまり move/edit 後の `selectedId` の運命は、完全に `refresh()` 経由の `ensureSelection()` 一箇所に委ねられている。

**ensureSelection() の実装（1800-1818行）**:

```
private ensureSelection(): void {
  const visible = flattenVisibleOutlineTree(this.currentTree, this.collapsedIds);
  if (visible.length === 0) { this.selectedId = null; return; }
  if (this.selectedId && visible.some((n) => n.id === this.selectedId)) return;
  const highlighted = this.highlightedId;
  this.selectedId = highlighted && visible.some((n) => n.id === highlighted) ? highlighted : visible[0].id;
}
```

このロジックは、`selectedId` が新しい Tree の中に**同じ文字列の id として存在するかどうか**だけを見ており、**その id が同じ論理的対象を今も指しているかどうかは一切検証しない**。

**id の安定性——確定した根本原因**: `parser/parseDocument.ts` の id 割り当ては `` `sec-${secSeq++}` ``・`` `li-${liSeq++}` ``（118行/225行）という、ドキュメント走査順の単純な連番カウンタである。paragraph の Tree id（`viewId`）も同様に、`buildParagraphOrdinals`/`groupParagraphBlocks`（`src/tree/buildOutlineTree.ts`）が、ドキュメント全体の paragraph を毎回 `startLine` でソートし直して 1 から採番し直す、**その refresh 限りの表示用連番**である（`tree/foldIdentity.ts` 自身のコメントが section/list id を「a fresh per-parseDocument() counter, only meaningful within one parse」と明言しており、これは paragraph の連番採番方式と同じ性質を持つ）。

**結論——paragraph 固有ではなく一般的な Tree node の問題である**: move によってドキュメント順序が変わると、その move より後（または前）にある同種ノードの連番がすべてシフトする。`ensureSelection()` はこのとき、旧 `selectedId` の文字列が新しい Tree にたまたま存在すれば（連番が 1..N と連続で採番される以上、多くの場合存在する）、**それが指す対象が move によって入れ替わった全くの別ノードであっても、無条件に「まだ有効」と判定してしまう**。これは「選択が消えて困る」という穏当な不具合ではなく、「選択が黙って別のノードにすり替わる」という、より深刻な不具合である。

paragraph でこれが特に目立つのは、paragraph の連番がドキュメント全体で毎回振り直されるため、ほぼどの paragraph move でも id 衝突条件（移動先・移動元の双方の位置に、moveの前後で「別のparagraphが同じ連番を得る」)が成立しやすいからであり、section/list で目立ちにくいのは、その move より前にある同種ノードの並びが変化しない限り連番が保たれるケースが相対的に多いからに過ぎない。**アルゴリズム上の欠陥そのものは section・list・paragraph のすべてに等しく存在する一般的な `selectedId` の不具合である**、というのが本監査の結論である。

**既存の類似先例——`pendingMoveFlash` 機構**: `main.ts` の `queueOutlineTreeMoveFlash` と `OutlineTreeView.ts` の `applyPendingMoveFlash`（789-838行）は、move 成功直後にワンショットのフラッシュ表示を出すための、構造的にほぼ同一の問題をすでに解決済みの先例である。`applyPendingMoveFlash` 自身のコメントが明言する通り、「section/list ids are only stable within a single parseDocument() pass...so matching by line, not id, is what stays correct after the move」——**id の生の等価性ではなく、line や nodeIdHint といった「ヒント」を、move 後に再構築された Tree に対して再マッチングする**という設計にすでになっている。ただし、この機構はあくまで視覚的なフラッシュ用の一時的なターゲット解決であり、`selectedId` そのものの修復には使われていない。また、paragraph/complex-block move の `nodeIdHint` は paragraph 自身の id ではなく「囲むセクション」の id を指す設計になっており（2026-08-11 時点、paragraph がまだ独自の Tree row を持つ前の設計のまま引き継がれている）、5P-3/5T-3A/5T-4A 以降の paragraph 独自行の存在を反映できていない、という副次的な陳腐化も確認された（selectedId の修復設計そのものには影響しないが、§7 の利用者判断事項で触れる）。

### §3-3 paragraph/complex-block の現在位置解決とTree投影の対応関係

`ComplexBlockKind` は `"callout" | "blockquote" | "fenced-code" | "table" | "paragraph" | "thematic-break"` の6値（`src/model/complexBlock.ts`）。しかし Tree 上に**自分自身の row として投影されるのは、このうち callout・blockquote・paragraph の3種類のみ**であることを、`src/tree/buildOutlineTree.ts` のコードから確定的に確認した。

- `isStandaloneComplexBlockEligible`（919-921行）は `(info.kind === "callout" || info.kind === "blockquote") && info.editability === "supported"` とハードコードされており、そのコメント自身が「Every other ComplexBlockKind (fenced-code/table/paragraph/thematic-break) is out of scope for this ticket and excluded unconditionally」と明記している。
- `complexMemberDisplayLabel` のコメント（605-609行）も「only callout/blockquote are ever composite-block members」と明言している——composite の子として投影される場合も callout/blockquote 以外は対象外である。
- paragraph は `groupParagraphBlocks`/`buildParagraphTreeNode` という、callout/blockquote とは意図的に分離された別関数（5P-3 の設計方針「paragraph 用の専用分岐として実装すること」）で、standalone のみ投影される。

**結論**: fenced-code・table・thematic-break は、standalone としても composite member としても、**今日いかなる形でも Tree row を持たない**。

**本チケット自身の要求との緊張関係**: 本チケットの §1 は対象7種別として fenced code と table を明示的に含める一方、スコープ制約として「Tree に表示される node だけを対象にする、新たな表示種別の追加は対象外」と定めている。監査の結果、fenced code と table はこの制約と両立しない——「すでに Tree 表示されている」という前提そのものが、この2種別については成立しない。この緊張関係は解消せず、そのまま §7 の利用者判断事項として提示する。

**優先順位・tie-break ルール（案A採用時の仕様、5種別: section/list item/paragraph/standalone callout/standalone blockquote 向け）**:

1. カーソル行が list item の range 内（かつ list item 自身の見出し行ではなく子本文行）にある場合、`includeLists:true` の既存動作を優先する。
2. カーソル行が、Tree 投影対象（paragraph/standalone callout/standalone blockquote）のいずれかの `ComplexBlockInfo.range` に含まれる場合、その ComplexBlockInfo に対応する Tree node id（`viewId`／standalone complex node の `info.id`）を返す。ただし、その ComplexBlockInfo が **すでに composite member として消費されている**場合（`consumedComplexBlockIds`）は、standalone row 自体が存在しないため、この候補は無効とし次点にフォールバックする。
3. 上記いずれにも該当しない場合、既存の `resolveHighlightedNodeId`（section へのフォールバック）をそのまま使う。
4. fenced code 内の行は、既存どおり `codeBlockLines` によって無条件に「Tree 側では何も対応する候補がない」として扱う（§3-1 のケース1）。table の行も、対応する Tree row が存在しないため同様に「粗いフォールバック（囲みセクション）」止まりとなる——精密な該当行ハイライトは、table 用の Tree row が存在しない以上、本フェーズのスコープ内では実現できない。
5. 空行・境界行（見出し行そのもの、fence の開始/終了行、table のセパレータ行）は、`ComplexBlockInfo.range` の startLine..endLine に含まれるかどうかでそのまま判定され、特別扱いは不要——`scanComplexBlocks` がすでに range 全体（開始/終了フェンス行を含む）を1つの block として走査しているため。
6. カーソルが同じ行で複数候補と重なることは、per-line 排他的な `lineToOwningNodeId`／`ComplexBlockInfo.range` の非重複設計上、構造的に発生しない（callout の子として paragraph が入れ子になるケースは `parentId` の親子関係として表現され、range 自体は重ならない）。

### §3-4 selectedId 陳腐化の切り分け評価

| 操作 | selectedId は陳腐化するか | 根拠 |
| --- | --- | --- |
| paragraph move（隣接・非隣接とも） | する（高頻度） | `buildParagraphOrdinals` がドキュメント全体を毎回再採番するため、move のたびにほぼ確実に他の paragraph の id が影響を受ける |
| paragraph Partial Edit 保存 | しうる（保存内容が段落数を増減させる場合、またはテキスト変更で他のブロックの行番号がシフトする場合） | 段落の増減や大幅な行数変化は他ノードの連番/section の子並びに波及しうる |
| section/list move | しうる（低頻度〜中頻度） | `secSeq`/`liSeq` は move 対象より前にある同種ノードの並びが変わらない限り安定するため、paragraph より発生条件は狭いが、機構としては同一の欠陥を持つ |
| composite move/delete | しうる | 同上（composite member の id は section/list id か ComplexBlockInfo.id に依存する） |

**highlightedId の拡張だけでは selectedId のこの問題を修正できない**——`ensureSelection()` のフォールバック先の一つが `highlightedId` であるとはいえ、それは「selectedId が消失した（新しい Tree に文字列として存在しない）」場合にのみ発動する経路であり、本監査で確定した「文字列としては存在するが、指す対象が入れ替わっている」という主たる不具合パターンには一切効かない。したがって selection follow は `highlightedId` とは独立した、専用の再解決ロジック（§4 の案C）を必要とする。

**根本原因**: 特定の未初期化変数や単純なタイポではなく、「id は毎 refresh で再割り当てされる、その回限りの表示用連番である」という前提と、「その連番の文字列が新しい Tree に存在するかどうかだけを見る」という `ensureSelection()` の検証ロジックの間の**構造的なミスマッチ**である。論理的対象の再解決（行ヒント・range・kind・内容の組み合わせによる再マッチング）でしか、原理的に修復できない。

修復が不可能な場合（対象が削除された、範囲が特定できないほど大きく変化した等）の方針は §5-2 で選択肢を比較する。

## §4 設計方式比較

### highlightedId 拡張（4方式）

| 基準 | 案A: 新規の純粋な current-position resolver | 案B: resolveHighlightedSectionId.ts 自体を拡張 | 案C（highlight目的での転用、比較のため記載） | 案D: OutlineTreeView が DOM/旧id を直接調べてその場しのぎで補正 |
| --- | --- | --- | --- | --- |
| BlockNode/ComplexBlockInfo 二重モデルへの適合 | 高——両方の候補を対等に扱う新層として設計できる | 中——既存関数に異種モデルの知識を混ぜ込む | 該当なし（highlightではselectedId用のCを流用しない方針のため参考評価） | 低——DOMから逆引きするため型の区別が曖昧になりやすい |
| Markdown唯一の真実への準拠 | 高 | 高 | — | 中——DOM状態に一時的に依存しうる |
| selectedId/highlightedIdの分離 | 高——highlight専用に閉じる | 高 | — | 低——View内で両者が混線しやすい |
| stale-id回避 | 高——毎回doc+cursorから再計算 | 高 | — | 中 |
| move/edit時の論理的対象追従 | 対象外（highlightはカーソル追従のみで十分） | 対象外 | — | 対象外 |
| テスト容易性 | 高——Obsidian非依存の純粋関数のまま維持できる | 中——既存テストへの影響範囲が広がる | — | 低——DOM依存のテストになる |
| OutlineTreeViewからの独立性 | 高 | 高 | — | 低（View内に実装が閉じる設計そのもの） |
| refresh/editor変更時の一貫性 | 高 | 高 | — | 中 |
| 実装差分の小ささ | 中——新規ファイル1つ | 高（差分は小さいが既存ファイルの責務が肥大化） | — | 中 |
| 将来のComplexBlockKind拡張性 | 高——候補リストに追加するだけ | 中 | — | 低 |
| パフォーマンス | 同等（どちらも1回のO(候補数)スキャン） | 同等 | — | 低い可能性（DOM照会を伴う） |
| 退行リスク | 低——既存関数は無傷のまま新層から呼ばれる想定 | 中——既存の呼び出し元すべてに影響が波及しうる | — | 高 |
| 推奨 | ○ | △ | — | × |

**結論**: 案A（新規の `resolveCurrentPositionNodeId` のような純粋関数を新設し、内部で既存 `resolveCurrentBlock`／section フォールバック機構と、ComplexBlockScanResult 由来の paragraph/standalone callout/blockquote 候補を、§3-3 の優先順位で統合する）を第一候補として確認した。これは本チケット自身の既定の想定と一致する。5P-3 が確立した「paragraph は callout/blockquote と同じ分岐に混ぜない」という設計原則の精神を踏襲し、既存の `resolveHighlightedSectionId.ts` を無傷のまま保てる点、および `OutlineTreeView.ts` からの独立性を保てる点で、案Bより優位と判断した。案Dは本チケット自身が明示的に非推奨としており、監査の結果もそれを覆す根拠は見当たらなかった。

### selection follow / repair（4方式）

| 基準 | 案A（highlight用resolverの転用、比較のため） | 案B（比較のため） | 案C: 新規の専用「selection-follow repair resolver」 | 案D: OutlineTreeViewがその場でDOM/旧idを補正 |
| --- | --- | --- | --- | --- |
| BlockNode/ComplexBlockInfo二重モデルへの適合 | — | — | 高——moveの対象種別を問わず同じヒント構造で扱える | 低 |
| Markdown唯一の真実への準拠 | — | — | 高——常に現在の本文から再解決 | 低——DOM/旧stateに依存しがち |
| selectedId/highlightedIdの分離 | 低（highlightedIdをselection修復に転用することになり、本チケットの不変条件に反する） | — | 高——highlightedIdとは独立した専用の入出力を持つ | 中 |
| stale-id回避 | 低（highlightedId自体もstaleな候補を参照しうる） | — | 高——「移動前の論理的対象」を表す独立したヒント値を渡す設計 | 低 |
| move/edit時の論理的対象追従 | 低 | — | 高——これこそが案Cの主目的 | 中（都度アドホックに実装されがち） |
| テスト容易性 | — | — | 高——`resolveParagraphFromTreeHint`と同様、Obsidian非依存の純粋関数にできる | 低 |
| OutlineTreeViewからの独立性 | — | — | 高 | 低（定義上View内蔵） |
| refresh/editor変更時の一貫性 | — | — | 高——refresh()の一部として呼べる | 中 |
| 実装差分の小ささ | — | — | 中〜大——move dispatch箇所（6箇所）すべてに「事前ヒントの取得」呼び出しを追加する必要がある | 小〜中 |
| 将来のComplexBlockKind拡張性 | — | — | 高 | 低 |
| パフォーマンス | — | — | 同等（1回のO(候補数)スキャン、pendingMoveFlashと同オーダー） | 中 |
| 退行リスク | 高（不変条件違反そのもの） | — | 低——既存のensureSelection()呼び出し位置に差し込める | 高 |
| 推奨 | × | — | ○ | × |

**結論**: 案Cを第一候補として確認した。本チケット自身の既定の想定と一致するのみならず、`main.ts`/`OutlineTreeView.ts` にすでに存在する `pendingMoveFlash`（`queueOutlineTreeMoveFlash`/`applyPendingMoveFlash`）という、構造的にほぼ同一の課題をすでに解決済みの先例が、この設計が本コードベースの既存の慣用パターンと自然に整合することを裏付けている。案Aの転用は、本チケット自身の不変条件（highlightedIdをselection follow の代用にしない）に正面から反するため、監査を経てあらためて明確に除外した。案Dも本チケット自身の想定どおり非推奨のまま確認された。

## §5 契約確定

### §5-1 highlightedId の契約

- **入力**: 現在の本文（`ParsedDocument`）、カーソル位置（0-indexed line）、現在の Tree/scanner の結果（`ComplexBlockScanResult`、`consumedComplexBlockIds`）。
- **出力**: Tree node id、または null。
- **不変**: 次の render に古い node id を持ち越さない——毎 refresh で必ず入力から全面的に再計算する（既存の `refresh()` の呼び出し方をそのまま踏襲）。
- **不変**: 現在の本文内容に対応しない id を指してはならない。
- **空行・曖昧・Tree非表示行のポリシー**: null ではなく「最も近い可視な祖先」へフォールバックする——これは案Aの優先順位（§3-3）がすでに体現している既存動作（section へのフォールバック）を、5種別に一般化したものである。真の null は、fenced code 内・frontmatter・範囲外の3ケースに限定する（§3-1 で確定した既存の契約をそのまま維持する）。

### §5-2 selectedId の契約

- **意味**: 「利用者が直近に Tree 操作の対象として選択した論理的対象」を表す。
- **不変**: move/edit/refresh をまたいで、再解決可能な限り同じ論理的対象を追従する。
- **不変**: 生の旧 id をそのまま保持し続けることを、追従の手段としてはならない（現状の `ensureSelection()` のバグが示す通り）。
- **修復手順**: 常に現在の本文＋現在の Tree から再解決する。案Cの `resolveSelectionFollowTarget`（仮称）は、move/edit dispatch の直前に呼び出し元が捕捉した「移動前の論理的対象ヒント」（kind・移動前 range・parentId・必要に応じて短い内容スナップショット——`resolveParagraphFromTreeHint` の「ヒントはあくまでヒントであり、再解決時に無条件に信頼しない」という既存方針を踏襲）を受け取り、refresh 後の新しい Tree に対して再マッチングする。
- **修復不能時の方針**: 本フェーズでは「selectedId を null にクリアする」ことを第一候補として比較した——理由は、`highlightedId` へのフォールバックも「先頭可視ノードへのフォールバック」も、いずれも「別の、利用者が選んでいない対象を暗黙に選択状態にする」という、より誤解を招きやすい結果になるためである（本チケット自身の「repair-failure-must-not-silently-select-a-wrong-node」という要求と整合する）。ただし、この選択（null clear）を最終確定するかどうかは §7 の利用者判断事項として提示する——null にクリアした場合、Tree パネルにフォーカスがある状態で矢印キーを押すと `ensureSelection()` の既存フォールバック（先頭可視ノード）が発動する、という副次的な挙動も合わせて確認済みである。
- **不変**: `highlightedId` を selectedId の代替修復手段として使わない。

### §5-3 優先度・競合ポリシー

- Tree パネルが DOM フォーカスを持つ場合: `selectedId` の視覚的表現（`.unified-outliner-selected`）が表示される（既存の `isSelected = this.hasFocus && node.id === this.selectedId` をそのまま維持）。
- 本文エディタがフォーカスを持つ場合: `highlightedId` の視覚的表現（`.unified-outliner-current`）のみが表示される——`isHighlighted` は `hasFocus` を条件にしないため、既存どおりどちらのフォーカス状態でも表示され続ける。
- move/edit 成功直後にどちらが視覚的に優先されるか: 既存の `jumpToLine` パターン（highlightedId を即座に先出しし、次の debounce を待たない）を踏襲し、selectedId の再解決結果も同じ refresh サイクル内で即座に反映する。両者が異なるノードを指す状態は許容される（selectedId はユーザーが選んでいた対象を追従し、highlightedId はカーソル位置を追従するという、本来別々の情報を表しているため）。
- Partial Edit の開始・保存・キャンセル時: Partial Edit 起動中は `refresh()` 自体が呼ばれ続ける前提のため、保存成功時は §5-2 の再解決フローがそのまま適用される。キャンセル時は本文もTreeも変化しないため、selectedId/highlightedIdともに変化させない。

### §5-4 fold/visibility ポリシー

- 非表示（折り畳まれた祖先の下にある）対象ノードを、ハイライト・選択のためだけに強制展開しない。
- 折り畳まれた現在位置対象については、「最も近い可視な祖先へのフォールバック」（§5-1 と同じ方針）と「null」を比較した結果、前者（既存の section フォールバックと一貫する）を踏襲する。
- selection follow も同様にフォールド状態を自動展開しない。再解決した対象が非表示なら、その祖先へのフォールバック、または §5-2 のクリア方針のいずれかを、対象がどちらの状況か（一時的に折り畳まれているだけか、恒久的に消失したか）に応じて使い分ける、という設計が妥当と判断したが、この使い分けの最終基準も §7 の利用者判断事項に含める。
- fold 状態自体は、ハイライト・選択のためにいかなる場合も変更しない。

## §6 将来テスト計画（本フェーズでは実装しない）

### highlightedId 拡張のテスト（将来フェーズ）

既存の section/list 回帰、standalone paragraph、callout に隣接する paragraph、standalone blockquote、fenced code の開始/中間/終了行、table のヘッダ/セパレータ/本体行、list-item-body 内の paragraph、nested list、カーソルが空行にある場合、カーソルが Tree 非表示行にある場合、折り畳まれた祖先を持つ対象の場合、アクティブノート切り替え、Partial Edit 中、drag 中、Tree→editor ジャンプ直後のハイライト、refresh 後に旧 id が存在しない場合。

### selectedId 追従のテスト（将来フェーズ）

paragraph move 後に selection が対象を追従すること、paragraph Partial Edit 保存後に同じ論理的対象に selection が留まること、section/list move の既存回帰確認、refresh 時に旧 selectedId が消失した場合の修復またはクリアの確認、修復失敗時に誤ったノードを黙って選択しないことの確認、Tree フォーカス時と editor フォーカス時の表示一貫性、highlightedId の更新が selectedId を破壊しないことの確認、fold を保持したまま追従できること（自動展開しないこと）。

Method Vault の手動シナリオメモは §7 直前に作成してよいが、GUI 実行・スクリーンショット・実機検証は本フェーズでは一切行わない。

## §7 利用者判断事項

1. **fenced code / table の Tree 表示範囲との緊張関係**: 監査により、fenced-code・table・thematic-break は今日いかなる形でも Tree 上に自分自身の row を持たないことが確定した。本チケットの対象7種別には fenced code と table が含まれる一方、スコープ制約は「Tree にすでに表示されている node のみを対象とする」と定めている。この2種別は本フェーズのスコープ内では「精密な該当行ハイライト」を実現できず、既存の粗いフォールバック（囲みセクションへのハイライト、fenced code の場合は無条件 null）に留まる。fenced code・table 用の専用 Tree row を新設する（スコープ拡張を伴う）方向で別チケットを起こすか、現状の粗いフォールバックのままとするかの判断を仰ぎたい。
2. **selectedId 修復不能時の方針**: null クリア（利用者に「選択が外れた」ことを明示する）と、最も近い可視な祖先へのフォールバックのどちらを既定方針とするか。§5-2 では null クリアを第一候補として提示したが、最終確定には利用者の判断を仰ぎたい。
3. **折り畳まれた再解決対象の扱い**: selection follow の再解決先が折り畳まれた祖先の下にある場合、祖先へのフォールバックと null クリアのどちらを既定とするか（§5-4）。
4. **pendingMoveFlash の nodeIdHint 陳腐化**: §3-2 で確認した副次的な発見として、paragraph/complex-block move 時のフラッシュ表示ターゲットが、paragraph 自身の Tree row ではなく「囲むセクション」を指す、5T-3A/5T-4A 以前の設計のまま残っている。selectedId 修復の実装とは独立した論点だが、同じ将来フェーズで合わせて更新するかどうかの判断を仰ぎたい。
5. **実装フェーズの分割方針**: highlightedId 拡張（案A）と selectedId 追従修復（案C）は設計上独立しているため、別々の実装チケットに分けるか、1つの実装チケットにまとめるかの判断を仰ぎたい。

## 付録: 監査で確認した主な既存コード上の事実（要約）

- `resolveHighlightedSectionId.ts`／`resolveCurrentBlock.ts`: section/list（BlockNode）専用。ComplexBlockInfo 非対応。
- `parseDocument.ts` の `lineToOwningNodeId`: standalone paragraph/callout/blockquote/table の行は、今日すでに囲むセクションへフォールバックしている（true null ではない）。
- `buildOutlineTree.ts` の `isStandaloneComplexBlockEligible`: callout/blockquote のみ。fenced-code/table/paragraph/thematic-break は明示的に対象外（paragraph は別関数で独自に投影）。
- `parseDocument.ts` の `sec-${secSeq++}`/`li-${liSeq++}`、および `buildParagraphOrdinals` の毎回振り直しによる連番: Tree node id はすべて「その refresh 限りの表示用連番」であり、永続識別子ではない。
- `ensureSelection()`: id 文字列の存在チェックのみで、論理的同一性を検証しない——これが selectedId 陳腐化・誤選択の根本原因。
- `selectedId` の書き込み箇所は `OutlineTreeView.ts` 内の7箇所のみ。move/edit dispatch 関数はいずれも selectedId を触らない。
- `pendingMoveFlash`（`queueOutlineTreeMoveFlash`/`applyPendingMoveFlash`）: line/nodeIdHint による再マッチングという、案Cと構造的に同種の既存先例。
- cursor→highlight のトリガーは CM6 selection リスナーではなく、`active-leaf-change`/`file-open`/`editor-change` + `keyup`/`mouseup` の 150ms debounce プロキシ。
