# git-push-release-runbook（Tree 操作機能の実機受入手順）

## 0. 位置づけ

Phase 5T-1R の指示に基づき、Tree 起点の操作（context menu からの move 等）
を含む機能について、「テスト・型検査・lint・build が green」であることを
単独で「完了」の根拠として扱ってはならない、という原則を手順化したもの。
Phase 5T-1 の初回実装（`0fc3b0a`）は、まさにこの4点すべてが green の状態
で「完了」と報告されたにもかかわらず、実機（Method Vault）で右クリックし
た瞬間に「メニューが一切開かない」という致命的な不具合が発覚した
（`faadbac` で修正）。この事例が本ランブックの直接の根拠である。

対象: `src/view/OutlineTreeView.ts` の Tree node 起点の書き込み系操作
（context menu からの move/rename/delete/insert/indent-outdent 等）を追
加・変更するすべてのフェーズ。

## 1. 手順（10ステップ）

1. **ビルド**: リポジトリのルートで `npm run build` を実行し、
   `main.js`/`manifest.json`/`styles.css` を最新化する（`npm run build`
   は内部で `tsc -noEmit -skipLibCheck` を先に実行するため、型検査が失敗
   すればここで build 自体が失敗する）。
2. **デプロイ先 Vault の明示**: 検証対象の Obsidian Vault を明示的に指定
   する（本プロジェクトでは Method Vault
   `/Users/kazumikaizuka/Obsidian/Method` を標準の実機検証先とする）。
   `npm run deploy:dev`（内部で `scripts/deploy-dev.mjs` を呼び、
   `OBSIDIAN_VAULT` 環境変数が指す Vault の
   `.obsidian/plugins/unified-outliner/` に `manifest.json`/`main.js`/
   `styles.css` をコピーする）を使うか、同等の安全な手段（例:
   リポジトリの `main.js`/`manifest.json`/`styles.css` を対象ディレクトリ
   へ直接コピーする）で配置する。
3. **hash 一致確認**: ソースリポジトリの `main.js` と、デプロイ先 Vault の
   `main.js` について、暗号学的ハッシュ（`sha256sum main.js` 等）を計算
   し、両者が完全に一致することを確認する。ファイルサイズや `grep` によ
   る内容確認、あるいは mtime 比較だけでは代替しない——特に、検証環境の
   クロックが実機のクロックと同期していない場合があり、mtime 比較は信頼
   できないことが確認されている。
4. **Vault を開く**: 検証対象の Vault を Obsidian で開く。
5. **プラグインの再読み込み**: 対象プラグインを一度無効化してから再度有
   効化する、または Obsidian 自体をリロードする。`main.js` をディスクに
   上書きしただけでは、起動中の Obsidian に自動反映されない。
6. **実機操作**: Method Vault の検証用ノート（例:
   `phase5t1-paragraph-tree-context-move-verification.md`）に記載された
   手順に従い、実際に操作する。
7. **結果確認**: 成功ケース・拒否ケースの両方、および既存ノードへの非
   リグレッションを確認する。
8. **実機バグが見つかった場合**: 修正前に、最小再現条件を記録したノート
   と、それを自動的に再検出する回帰テストの両方を用意してから修正する
   （テストを書かずに直接修正しない）。
9. **完了報告の禁止事項**: 実機確認が完了するまで、「完了報告」を出さな
   い。テスト・型検査・lint・build の green は必要条件であって十分条件で
   はない。
10. **完了報告に記載する項目**: 確認に使った Vault、デプロイした bundle
    の hash、Obsidian の再読み込み方法、検証項目と結果を、完了報告に明記
    する。

## 2. Phase 5T-1R での実施記録（本ランブック導入時点の実例）

- 対象 Vault: Method Vault
  （device_bash マウント名 `plugins--unified-outliner` が指す
  `.obsidian/plugins/unified-outliner/`）。
- デプロイ方法: `npm run build` 後、`main.js`/`manifest.json`/
  `styles.css` を対象ディレクトリへ直接コピー
  （`OBSIDIAN_VAULT` 環境変数経由の Vault ルートが検証環境から到達不能
  だったため、`scripts/deploy-dev.mjs` そのものは実行できず、同等のコピ
  ー手順で代替した——このランブックのステップ2が「同等の安全な手段」を
  明示的に許容しているのはこのため）。
- hash 一致確認: `sha256sum` でソースリポジトリの `main.js` と デプロイ
  先の `main.js` を比較し、一致を確認済み（値は完了報告に記載）。
- 再読み込み方法・実機操作結果: 完了報告本文を参照。
