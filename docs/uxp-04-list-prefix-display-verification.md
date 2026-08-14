# UXP-04 — Configurable List Marker Prefix Display 検証ノート

## 1. チケット情報

- 名称: UXP-04 — Configurable List Marker Prefix Display
- 目的: Outline Tree に表示される list item について、実際の Markdown list marker（`-`／`*`／`+`／`1.`／`2)` 等）を、heading / composite / complex-member と同じ「本体 text と分離された独立 prefix 要素」として表示できるようにする。
- 対象外: Markdown本文、list marker の書き換え・正規化・採番、list構造、move / indent / outdent / drag / delete / insert の意味論、parser の所属判定、task list の解析・表示、list 子 complex-member の構造編集、UXP-05（heading / cursor line 背景色）。
- 実装コミット: `aa520ff`（branch `feature/phase5c-1-editable-composite-blocks`）
- 確認者: ユーザー
- 実機確認の実施者はClaudeではない。Claudeは以下のデプロイ手順・確認手順・記録欄を提示するのみで、実機確認結果の記入・判定はユーザーが行う。

## 2. デプロイ前確認（Claude実施済み）

- branch: `feature/phase5c-1-editable-composite-blocks`
- HEAD: `aa520ff`
- `git status --short`: 追跡対象ファイルへの未コミット変更なし（本チケットに無関係な未追跡ログファイルが作業ディレクトリに残存しているのみ）
- TypeScript check (`tsc -noEmit -skipLibCheck`): 成功（エラーなし）
- test (`vitest run`): 62ファイル940件、全成功
- lint (`eslint "src/**/*.ts"`): エラー0件。警告3件はいずれも本チケットと無関係な既存の `PluginSettingTab.display()` 非推奨警告
- build (`npm run build`): 成功

## 3. ターミナルデプロイ手順（ユーザーが実行）

以下はすべて、このプロジェクトで既に使われている安全な手順（過去のUXP-01〜UXP-03bで実際に使用したものと同一の配置先・同一のコマンド形）のみで構成している。破壊的な削除コマンドは含まない。

### 3-1. 現在の変更を確認する

```
cd /Users/kazumikaizuka/Obsidian/unified-outliner-public
git status --short
git log -1 --oneline
```

`aa520ff UXP-04: Configurable List Marker Prefix Display` がHEADであることを確認する。

### 3-2. 必要ならbuildを実行する

Claude側で既に`npm run build`まで実行済みのため、`main.js`は最新化されている。念のため再ビルドしたい場合のみ、以下を実行する。

```
cd /Users/kazumikaizuka/Obsidian/unified-outliner-public
npm run build
```

### 3-3. Obsidian vault の plugin 配置先を確認する

```
ls -la /Users/kazumikaizuka/Obsidian/Method/.obsidian/plugins/unified-outliner/
```

`main.js` / `manifest.json` / `styles.css` が存在することを確認する。

### 3-4. ビルド成果物を安全に反映する

```
cp "/Users/kazumikaizuka/Obsidian/unified-outliner-public/main.js" "/Users/kazumikaizuka/Obsidian/Method/.obsidian/plugins/unified-outliner/main.js"
cp "/Users/kazumikaizuka/Obsidian/unified-outliner-public/manifest.json" "/Users/kazumikaizuka/Obsidian/Method/.obsidian/plugins/unified-outliner/manifest.json"
cp "/Users/kazumikaizuka/Obsidian/unified-outliner-public/styles.css" "/Users/kazumikaizuka/Obsidian/Method/.obsidian/plugins/unified-outliner/styles.css"
```

### 3-5. 反映後に対象ファイル・時刻を確認する

```
ls -la /Users/kazumikaizuka/Obsidian/Method/.obsidian/plugins/unified-outliner/main.js /Users/kazumikaizuka/Obsidian/Method/.obsidian/plugins/unified-outliner/manifest.json /Users/kazumikaizuka/Obsidian/Method/.obsidian/plugins/unified-outliner/styles.css
```

3つのファイルの更新時刻が、コピーを実行した直前の時刻になっていることを確認する。

### 3-6. Obsidian で plugin を reload する

ターミナル操作ではなく、Obsidian本体での操作である。

1. Obsidianの設定（歯車アイコン）→「コミュニティプラグイン」を開く。
2. 一覧から「Unified Outliner」を探し、トグルを一度オフにしてから再度オンにする（再読み込み）。
3. もしくは、コマンドパレット（Cmd+P）から「Reload app without saving」を実行し、Obsidian全体を再読み込みする。

## 4. Obsidian上の確認手順

以下は「設定 → Unified Outliner → リストmarker」の値を切り替えながら確認する。既定値は「表示しない」である。

| # | 確認項目 |
|---|---|
| 1 | 設定初期値が「表示しない」であること |
| 2 | 設定を「Markdown marker」に切り替えると、unordered `-` が prefix として表示されること |
| 3 | `*` と `+` がMarkdown原文どおりprefixとして表示されること |
| 4 | ordered `1.`、mid-list restartの `3.`、`2)` がMarkdown原文どおりprefixとして表示されること |
| 5 | 設定を「表示しない」に戻すと、ordered / unordered ともmarkerが消えること |
| 6 | ordered markerが本文と二重表示されないこと（以前の「1. Ordered item」のような本文埋め込みが残っていないこと） |
| 7 | 本文が長いlist itemで、ellipsis（省略記号）とtooltip（ホバー時の全文表示）が従来どおり動くこと |
| 8 | 本文が空のlist itemで、markerだけがprefixとして表示され、行が壊れないこと |
| 9 | ネストしたlist（親子関係）が問題なく読めること |
| 10 | list子のcallout/blockquote（Phase 5C-5）のfold・表示が壊れないこと |
| 11 | drag handle、fold、選択、keyboard navigation、context menuが壊れないこと |
| 12 | 左サイドバー・右サイドバー・main area・popoutのうち、確認できた範囲を記録欄に明記すること |
| 13 | light theme / dark theme それぞれでprefixの可読性を確認すること |
| 14 | 設定画面の文言・list itemのprefixが日本語・英語それぞれで正しく読めること（設定言語を切り替えて確認） |

## 5. 記録欄

| # | 確認項目 | 結果（Pass / Fail / Not tested） | 観察メモ |
|---|---|---|---|
| 1 | 既定値「表示しない」 | | |
| 2 | unordered `-` 表示 | | |
| 3 | `*` `+` 表示 | | |
| 4 | ordered `1.` / `3.` / `2)` 表示 | | |
| 5 | OFFで両方消える | | |
| 6 | 二重表示なし | | |
| 7 | ellipsis / tooltip | | |
| 8 | 空list itemのmarker | | |
| 9 | nested list | | |
| 10 | list子callout/blockquoteのfold | | |
| 11 | drag handle / fold / 選択 / keyboard nav / context menu | | |
| 12 | 確認したペイン配置（左/右/main area/popout） | | |
| 13 | light / dark theme 可読性 | | |
| 14 | i18n（日本語・英語） | | |

## 6. 判定基準

- Pass の条件: 各確認項目で、期待どおりの表示・動作になっており、既存機能（fold・選択・keyboard navigation・context menu・ellipsis・tooltip・list子complex-memberの表示など）に崩れがないこと。
- Fail 時に記録すべき情報: 発生した具体的な症状、再現手順（設定値・対象のMarkdown・操作手順）、環境（デスクトップ／iPad等、テーマ、サイドバー位置）。
- UXP-04を完了と扱える条件: 上記14項目すべてが Pass、またはユーザーが許容範囲と判断したNot tested項目を除いて実質的な問題が報告されないこと。ユーザーからの実機確認結果の報告を受け、この条件を満たすと判断された時点で初めて「完了」とする。それまでは「UXP-04: 実装完了・ユーザー実機確認待ち」として扱う。
