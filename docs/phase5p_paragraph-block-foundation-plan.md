# Unified Outliner — 段落ブロック基盤 実装計画（Phase 5P）

作成日: 2026-08-15
状態: **Phase 5P 全体（5P-0〜5P-4）完了（2026-08-17）。** 5P-0（方針改訂）・5P-1（範囲・親・深さの契約）・5P-1R（editability 訂正・Move block 適用範囲の固定）・5P-2（カーソル解決・安全なホイスト）・5P-3D（任意 Tree 表示の設計固定）・5P-3（任意 Tree 表示 実装）・5P-4（隣接交換の契約化）のすべてを実装完了として承認済み。後続は独立系統 **Phase 5T（Tree Interaction / Tree Move）** へ引き継ぐ — §12 参照。
対象リポジトリ: `/Users/kazumikaizuka/Obsidian/unified-outliner-public`
関連: `docs/mixed-structure-spec.md` §6（5P-0で改訂済み）、`docs/phase5c_block-model-and-tree-display-spec.md` §4（5P-0で移管済み）、`docs/統合実装ロードマップ_2026-08-05.md` §3.8（実装記録の正）、`docs/phase5p3d_paragraph-tree-display-design.md`（5P-3 の確定設計。§6「5P-3 — 任意 Tree 表示」の詳細はこちらを正とする）、`docs/phase5t_tree-interaction-move-design.md`（Phase 5T-0。5P 完了後の Tree 発火 move / D&D 設計）

## 実装状況（2026-08-17、Phase 5P 完了時点）

- **5P-0**: 本ドキュメント§3の改訂を`docs/mixed-structure-spec.md` §6、`docs/phase5c_block-model-and-tree-display-spec.md` §4、`docs/統合実装ロードマップ_2026-08-05.md`に反映した。本番コードの変更はなし。
- **5P-1**: `src/parser/complexBlocks.ts`の`scanParagraphBlocks`を、本ドキュメント§5の境界規則・親子規則に沿って拡張した。新規の純粋関数`complexBlockDepth`（同ファイル）で深さ契約をテスト固定した。`tests/complexBlocks.test.ts`に境界・親子・深さの新規テストケースを追加し、`npm test`（949件）・`tsc`・`npm run lint`・`npm run build`すべて成功を確認済み。実装の詳細・変更ファイル一覧・回帰確認の要点は`docs/統合実装ロードマップ_2026-08-05.md` §3.8を正とする。
- **5P-1R**: paragraph の editability 訂正（Option A採用、paragraph の supported 化）と、Move block の意図しない適用拡大の防止を実施。コミット `fcd1128`。
- **5P-2**: カーソル位置の段落を一意に解決する純粋 resolver（`src/resolver/resolveParagraphAtCursor.ts`）と、Apply 時に parentId/depth/内容完全一致を再確認する安全な Partial Edit hoist（`src/edit/paragraphPartialEdit.ts`）を実装した。コミット `b0b7f02`。テスト1002件・tsc・lint・build すべて成功。
- **5P-3D**: paragraph を設定オン時のみ Outline Tree に読み取り専用の葉ノードとして表示するための設計を固定した。詳細は `docs/phase5p3d_paragraph-tree-display-design.md` を参照。本番コードの変更はなし。
- **5P-3**: `showParagraphsInOutline`設定（既定オフ）を追加し、オン時のみ paragraph を Outline Tree に読み取り専用・fold不可の葉ノードとして投影した。コミット `a7e0bcf`。テスト1045件・tsc・lint・build すべて成功。
- **5P-4**: 5P-1R が Move block に設けていた狭い例外を、本文カーソル起点・同一 parentId 限定の正式な「隣接交換」契約として固定した。paragraph↔list・section越境は意図的に対象外。コミット `6ecafa0`。テスト1069件・tsc・lint・build すべて成功。
- **Phase 5P 完了承認**: 上記全サブフェーズの実装報告・実機確認をもって、Phase 5P（5P-0〜5P-4）は2026-08-17に完了として承認された。完了範囲の確定リストは §12 を参照。

## 0. なぜ別系統か

Phase 5C は拡張ブロック（callout / blockquote / fenced-code / table）と、それらを束ねる CompositeBlock の基盤である。paragraph は拡張ブロックではない。見出しでもリストでもない通常本文を、アウトラインの基本単位として扱うための基盤である。

したがって本計画は 5C-6 や 5D の一部にせず、別系統 **Phase 5P** とする。P は Paragraph / Prose を意味する。

## 1. 再確認: 現行計画に存在しない

2026-08-15 時点で、次を確認した。段落を第一級の基盤ブロックとして実装する予定は、どの Phase にも割り当てられていない。

| 文書 / コード | 段落の扱い |
|---|---|
| `docs/mixed-structure-spec.md` §6 | 「段落専用ノードの追加をしない」と確定。独立した drag & drop / Partial Edit 対象にしない |
| `docs/phase5c_block-model-and-tree-display-spec.md` §4 | 上記を踏襲。`editability` は常に `read-only` または `ambiguous`。Tree の表示・選択・追加対象外。5D 以降で変えるなら §6 の改訂が必須 |
| `docs/統合実装ロードマップ_2026-08-05.md` | 5D = callout/blockquote 編集、5E = Mermaid/表。段落基盤の Phase はない |
| `ROADMAP.ja.md` | 次の重点は CompositeBlock の編集（5C-1 / 5D） |
| Phase 6 | 分類・横断検索。inline property や block ID を持つ段落だけを索引対象にする、とあるのみ |
| Phase 7 | Phase 6 の BlockIndex を前提にした構造図 |
| Git（`feature/phase5c-1-editable-composite-blocks`） | 5C-1〜5C-5 は実装済み。5C-6 は統合レビュー番号であり、段落実装ではない。paragraph の Tree 統合コミットはない |

現行コードが既に持っているのは、次の狭い範囲だけである。

- `scanParagraphBlocks` が、他 kind に当たらない本文連続範囲を診断用 catch-all として返す
- `ComplexBlockKind` に `"paragraph"` がある
- `Move block up/down` に限り、境界確定済みの段落を前後のブロックと交換できる
- Tree ノード、選択対象、Partial Edit、drag & drop、追加・削除の対象にはなっていない

「段落を含んだ section を壊さず移動できる」ことと、「段落そのものを基本ブロックとして識別・投影・操作できる」ことは別である。前者は Phase 4D / 5C で足りている。後者が本 Phase の対象である。

## 2. 目的

見出しのない連続本文を、Markdown を唯一の正としたまま、範囲を持つ基本ブロックとして扱う。

これにより、見出し中心ではないノートでも、段落を選択・ホイストし、必要なら Tree に出せるようにする。拡張ブロック基盤（5C）と、分類・検索（6）の間に欠けていた「本文段落の基本単位化」を埋める。

## 3. 方針改訂（着手条件）

Phase 4D の次の一文を、本 Phase の着手前に改訂する。

> 段落専用ノードの追加（段落を独立した drag & drop / Partial Edit Pane 対象にはしない）。

改訂後の契約は次とする。

- 段落は範囲を持つ基本ブロックである
- 初期実装では Tree 常時表示、drag & drop、追加、自動分割・結合は行わない
- カーソル解決、ホイスト、任意表示、隣接交換は許可する
- Partial Edit は 5P-2 で「カーソル位置の段落を投影できる」ところまでを許可し、Tree からの常時対象化はしない
- この改訂なしに実装へ入らない

## 4. モデル上の位置

paragraph は 5C の都合で `ComplexBlockKind` に入っているが、これは診断用 catch-all であって、拡張ブロックとしての分類ではない。

5P でも、初回から `parseDocument.ts` の `BlockNode`（section / list）へ合流させない。理由は次の通り。

- `parseDocument.ts` は section / list の唯一の権威パーサである
- 5C は `BlockNode` と `ComplexBlockInfo` の混同・合体を禁じている
- 見出しなしノートの当面の必要は、範囲確定・親確定・カーソル解決・任意投影であり、パーサ中枢の書き換えを先に必要としない

したがって 5P のモデル契約は次とする。

| 層 | 役割 |
|---|---|
| `scanParagraphBlocks` | 引き続き範囲の供給源。ただし「永続 read-only」前提を外す |
| `ComplexBlockInfo`（kind `paragraph`） | 当面の記録型。`ParsedDocument.nodes` には入れない |
| Tree 投影 | 5C-2 / 5D-0.3 の standalone 投影経路を再利用する。既定では出さない |
| 将来の統合型（`BlockNode \| ComplexBlockInfo`） | 5P の対象外。必要になったら独立判断する |

`editability` は「この kind は永久に操作しない」という意味では使わない。5P 以降の意味は次に限る。

- `supported`: 境界が確定し、本 Phase が許可した操作（解決・ホイスト・任意表示・隣接交換）の対象になりうる
- `read-only`: 境界は確定しているが、当該インスタンスは操作しない（例: 他ブロックと衝突して残った診断用）
- `ambiguous`: 境界が不確実。操作しない

## 5. 境界規則

既存 5C 仕様を維持する。

1. 見出し、list、blockquote、callout、fenced-code、table、thematic-break のいずれでもない通常テキストを開始行とする
2. 空行、または別種別ブロックの開始直前で閉じる
3. 衝突時の優先順位は `callout > blockquote > (fenced-code, table) > paragraph` のまま
4. 親は次の二軸だけである
   - 直近の ATX 見出し section の子
   - 親 list item の本文開始列まで字下げされていれば、その list item の子
5. 字下げされない段落は、直前の list item の子にしない。section 内の兄弟とする
6. frontmatter、未閉鎖 fence 内部、境界不確実な範囲は paragraph にしない

表示ラベルは、構文上の題がないため次の順とする。

1. ~~将来の明示タイトル（`<!-- uo-title: ... -->`）~~ — **5P-3D で不採用と確定**（`docs/phase5p3d_paragraph-tree-display-design.md` §3-2）。`scanParagraphBlocks` の現行の境界規則では、直前行に空行を挟まないコメント行は段落本文そのものへ合流してしまい、5P-1/5P-1R で固定した境界規則および 5P-2 の Apply 契約と衝突するため、5P-3 では読み取らない
2. 先頭文のプレビュー
3. 種別＋通番（`段落 1`）

Tree に出す場合の既定記号は `¶` とする。設定で空文字にできる（5P-3D 時点では固定値、設定の追加自体は5P-3の対象外）。

## 6. サブフェーズ

進行中の 5C-1（CompositeBlock 編集）は止めない。5P は別系統として、現行ブランチが安定した直後、または `parseDocument.ts` を触らない範囲で並行する。

### 5P-0 — 方針改訂と契約固定

**目的**: 実装前に、§6 改訂と本計画のモデル契約を承認する。

**実施内容**

- `docs/mixed-structure-spec.md` §6 を改訂する
- `docs/phase5c_block-model-and-tree-display-spec.md` §4 を「5P へ移管」と更新する
- `docs/統合実装ロードマップ_2026-08-05.md` に Phase 5P を追記する
- 本番コードは変更しない

**完了条件**

- 改訂文面が承認されている
- 「既定非表示」「追加・自動結合は対象外」が文書上固定されている

### 5P-1 — 範囲・親・深さの契約

**目的**: paragraph を診断用残り物ではなく、親と深さを持つ基本単位としてテストで固定する。

**実施内容**

- `scanParagraphBlocks` の契約を、上記境界規則で再固定する
- section 子、list item 子、list と兄弟、空行分割、他 kind との境界を fixture 化する
- `editability` の意味を §4 の新契約へ更新する。既存の「paragraph は supported にならない」という横断 assert は、新契約に合わせて書き換える
- `ParsedDocument.nodes` への挿入、Tree 常時表示、追加・削除はしない

**完了条件**

- 通常本文を paragraph としてパースできる
- 空行・見出し・list・blockquote・callout・fence・table・thematic-break で境界が閉じる
- 字下げ段落だけが list item の子になる
- 字下げされない段落が list item の子に誤判定されない
- 既存 section / list / composite / standalone complex のテストが回帰しない

### 5P-2 — カーソル解決とホイスト

**目的**: 本文上の段落を、今いる単位として解決し、Partial Edit に投影できる。

**実施内容**

- カーソル行から当該 paragraph を返す resolver を追加する
- 既存の `resolveMoveTarget` が持つ狭い隣接交換とは分離し、一般の「現在段落」解決にする
- Partial Edit は段落範囲だけを読み、Apply はその範囲だけを置換する
- 境界再解決に失敗したら Apply を拒否し、原文を変えない
- Tree からの常時投影、breadcrumb / subtree navigator の本対応はしない

**完了条件**

- カーソル位置の段落を一意に解決できる
- ホイスト（Partial Edit）で前後の見出し・list・拡張ブロックを巻き込まない
- Cancel / Close は未適用変更を捨て、本文を変えない
- 衝突・消失時は no-op + Notice

### 5P-3 — 任意 Tree 表示

**目的**: 設定がオンのときだけ、段落を Outline Tree に出せる。

**実装状況（2026-08-17完了、コミット `a7e0bcf`）**: 5P-3D で確定設計を `docs/phase5p3d_paragraph-tree-display-design.md` にまとめ、その設計どおりに実装完了した。以下はその要旨であり、詳細・根拠・比較検討は同文書を正とする。

**実施内容**

- 設定 `showParagraphsInOutline`（「本文段落も Outline Tree に表示する」）を追加する。既定はオフ。`showListItemsInOutline` と同型のトップレベル boolean で、マイグレーションコードは不要
- 5C-2 / 5D-0.3 の standalone 投影経路（グルーピング・`line` ソートによるマージ）をそのまま再利用するが、`complex-member` kind は流用せず、新しい独立した `"paragraph"` kind を追加する（既存の standalone complex-member 用コンテキストメニューへ誤って合流し、Tree から意図せず Partial Edit を起動可能にしてしまうのを避けるため）
- 表示は `¶` + プレビュー。`<!-- uo-title -->` は 5P-3 では読み取らない（境界規則との衝突のため不採用、上記文書§3-2）
- paragraph は常に葉ノード・fold 不可とする。fold state・永続 identity を一切持たせない
- 既定オフ時は、paragraph ノードを Tree モデルへ一切投影しない（「作ってフィルタする」方式は採らない）
- Tree からの rename / delete / insert / drag / indent-outdent / 一般的な Move block / CompositeBlock 操作は一切許可しない。コンテキストメニュー自体を paragraph 行に構築しないことで到達経路を構造的に断つ

**完了条件**

- 既定では Tree が 5C-5 時点と同じに見える
- 設定オンで、見出しなしノートの段落が先頭文ラベルで並ぶ
- list 子の字下げ段落だけが、その list item の下に出る
- 既存の composite / standalone complex の親子関係が崩れない

### 5P-4 — 隣接交換の契約化

**目的**: 既にある Move block の狭い例外を、5P の正式操作として固定する。

**実装状況（2026-08-17完了、コミット `6ecafa0`）**: 以下の実施内容・完了条件どおりに実装完了した。

**実施内容**

- 境界確定済みの paragraph と、同じ親を持つ隣接単位との交換だけを許可する
- section 越境、list をまたぐ移動、自動 indent 変更は拒否する
- Tree 表示の有無に依存しない（コマンドは本文カーソル基準）

**完了条件**

- 同一親内の隣接交換だけが成功する
- 拒否時に本文が一文字も変わらない
- 既存の section / list / composite move が回帰しない

## 7. 意図的な非対象

次は 5P では実装しない。後続 Phase で別途設計する。

| 項目 | 理由 | 送り先の目安 |
|---|---|---|
| Tree からの追加・削除 | 隣接段落の結合・分割規則が構文的に決まらない | 将来の 5P-x または独立チケット |
| 自動分割・自動結合 | Markdown 破壊リスクが高い | 対象外を維持 |
| 既定の全段落表示 | 長文ノートで Tree が過密になる | 設定の既定オフを維持 |
| drag & drop | Tree 常時対象化と同じ政策判断が要る | 5P 完了後に独立判断 |
| indent / outdent | 段落に list 用の階層操作を持ち込むと意味が壊れる | 対象外 |
| `BlockNode` への合流 | 権威パーサの書き換えは別リスク | 独立判断 |
| BlockIndex 全面投入 | 分類トラックの仕事 | Phase 6 |
| `<!-- uo-title -->` の入力 UI | 表示ラベルの供給源としては 5P-3 で読んでよい | 後続 UI |
| 拡張ブロック内部の子段落化 | 5C / 5D の所有権と衝突する | 5D 側の判断 |

## 8. 他 Phase との関係

```
Phase 5C（拡張ブロック基盤、5C-5 まで完了扱い）
        │
        ├─ 進行中: 5C-1 CompositeBlock 編集、5U UI 仕上げ
        │
        └─ Phase 5P（本計画。基本本文単位）
                 5P-0 方針改訂
                 5P-1 範囲・親・深さ
                 5P-2 カーソル解決・ホイスト
                 5P-3 任意 Tree 表示
                 5P-4 隣接交換の契約化
                        │
                        ├─→ Phase 5D（拡張ブロック個別編集。混ぜない）
                        └─→ Phase 6（分類。メタデータ付き段落だけ索引）
```

- 5D に混ぜない。5D は callout / blockquote 等の編集である
- 6 より先に 5P-1 を終わらせる。索引は境界契約に依存する
- 5C-6 は統合レビュー番号であり、本計画で再利用しない

## 9. 推奨する着手順

1. 進行中の CompositeBlock 編集チケットを止めない
2. 5P-0 を先に承認する
3. 5P-1 を単独で完了させる
4. 5P-2 を次に実装する。見出しなしノートに対する実用価値がここで出る
5. 5P-3 / 5P-4 は 5P-2 の受入後に進む

5P-1 までなら `parseDocument.ts` を触らずに済む見込みが高く、5D 作業との衝突は小さい。5P-3 の Tree 投影は `buildOutlineTree.ts` を共有するため、CompositeBlock 投影の安定後に入る。

## 10. 受け入れ試験の最小セット

- [ ] 通常本文を paragraph としてパースできる
- [ ] 空行・見出し・list・blockquote・callout・fence・table・thematic-break で境界が閉じる
- [ ] paragraph が section の子として正しい範囲・親を持つ
- [ ] list 本文列まで字下げされた paragraph だけが list item の子になる
- [ ] 字下げされない paragraph が list item の子にならない
- [ ] カーソル位置から paragraph を解決してホイストできる
- [ ] Apply が段落範囲外を変更しない
- [ ] Tree 表示を既定で抑制できる
- [ ] 設定オン時のみ `¶` + 先頭文で表示できる
- [ ] 同一親内の隣接交換だけが成功する
- [ ] 追加・分割・自動結合は未対応として拒否するか、本文編集へ委譲する
- [ ] 既存の section / list / composite / standalone complex 操作に回帰がない

## 11. 実装時の注意

- Markdown を唯一の正とする。専用本文形式を作らない
- 境界が不確実なら原文を変更しない
- 書き戻し経路は既存の apply 経路だけを使う
- paragraph を CompositeBlock の member にも、拡張ブロックの一種にもしない
- テストは Obsidian 非依存の純粋関数を先に厚くする
- Method Vault の実機確認は、見出しなしの連続本文ノートを必須ケースにする

## 12. Phase 5P 完了範囲の確定と Phase 5T への引き継ぎ（2026-08-17）

Phase 5P（5P-0〜5P-4）は、2026-08-17 に完了として承認された。完了範囲は次のとおり確定する。

- paragraph の範囲・親・深さ・editability 契約の固定（5P-1）
- カーソル位置からの paragraph 解決（5P-2、`resolver/resolveParagraphAtCursor.ts`）
- paragraph の安全な Partial Edit / hoist（5P-2、`edit/paragraphPartialEdit.ts`）
- 設定既定オフの Outline Tree 表示（5P-3、`showParagraphsInOutline`）
- Tree 上の paragraph を read-only な葉ノードとして扱うこと（5P-3、`collectReadOnlyOutlineNodeIds`・`isLeaf: true`）
- 本文カーソル起点での、同一親・隣接 block に限った安全な交換（5P-4、`move/resolveMoveTarget.ts`）
- paragraph ↔ list、および section 越境を意図的に未対応とすること（5P-1〜5P-4 一貫方針）
- Tree 起点の move / drag & drop / context menu edit を意図的に未対応とすること（5P-3、5P-4 とも）

次に検討すべきは、Tree 上でのマウス操作による移動、ならびに context menu からの移動である。ただし、これは 5P-4 の UI を追加するだけの作業ではなく、paragraph を Tree 上の read-only node として扱う契約・drag/drop の意味論・Tree 選択と本文カーソルの同期・drop target の妥当性・cross-model move・Markdown の安全な書き戻しを同時に扱う独立の設計課題である。したがって、この検討は本計画（Phase 5P）の対象外とし、独立系統 **Phase 5T（Tree Interaction / Tree Move Design）** として切り出す。5T-0（設計のみ）の内容は `docs/phase5t_tree-interaction-move-design.md` を正とする。

**追記（2026-08-19、Phase 5T-4D）**: 本節冒頭で「Tree 起点の move / drag & drop / context menu edit を意図的に未対応とすること」と確定した5P完了範囲のうち、「context menu edit」（Tree 上の paragraph から Partial Edit を起動すること）は、利用者の明示的な指示により Phase 5T-4D で見直しの検討対象となった。見直しの結果、既存の paragraph Partial Edit 契約（本節の `resolver/resolveParagraphAtCursor.ts`・`edit/paragraphPartialEdit.ts`）自体は一切変更せず、Tree 側から既存の `activatePartialEditViewForParagraph` を再利用する形で起動するという設計方針を固定した（本番コード変更なし、設計・監査のみ）。詳細は `docs/phase5t4_tree_paragraph_partial_edit_design.md` を正とする。

Phase 5P は、本ドキュメント §8 の関係図における「5P-4 隣接交換の契約化」で完結し、以降の Tree 発火操作の検討は 5T 側の責任とする。§8 の関係図を以下のとおり更新する。

```
Phase 5C（拡張ブロック基盤、5C-5 まで完了扱い）
        │
        ├─ 進行中: 5C-1 CompositeBlock 編集、5U UI 仕上げ
        │
        └─ Phase 5P（本計画。基本本文単位。5P-0〜5P-4 完了）
                 5P-0 方針改訂
                 5P-1 範囲・親・深さ
                 5P-2 カーソル解決・ホイスト
                 5P-3 任意 Tree 表示
                 5P-4 隣接交換の契約化
                        │
                        ├─→ Phase 5D（拡張ブロック個別編集。混ぜない）
                        ├─→ Phase 6（分類。メタデータ付き段落だけ索引）
                        └─→ Phase 5T（Tree Interaction / Tree Move。5T-0 で設計中）
                                 5T-0 設計（本番コード変更なし）
                                 5T-1 候補: Tree context menu 上下移動
                                 5T-2 候補: Tree D&D 隣接交換、その他調査事項
```
