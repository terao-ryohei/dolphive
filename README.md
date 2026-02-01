# Dolphive

Dolphin（イルカ）+ Archive（保管庫）= イルカのように賢く記憶を保管するサービス。

Discord上の会話をAIが自動分析し、GitHubリポジトリにMarkdown形式で保存するメモリボット。

## 主な特徴

- **サイレント保存**: 会話の流れを止めず、プレビュー確認後にワンクリックで保存
- **AI自動判定**: 保存が必要な発言をAI（GLM-4互換）が自動検出
- **カテゴリ自動分類**: チャンネル名から自動でカテゴリ判定、タグ・要約も自動生成
- **マルチサーバー対応**: サーバーごとにメモリを分離して管理
- **GitHub保存**: すべてのメモリはGitHubリポジトリにMarkdownとしてコミット

## コマンド一覧

### テキストコマンド（`!` プレフィックス）

| コマンド | 説明 | 例 |
|---------|------|-----|
| `!save [カテゴリ]` | 直前の会話を保存（カテゴリ指定は任意） | `!save` / `!save daily` |
| `!search <キーワード>` | メモリをキーワード検索 | `!search 買い物` |
| `!recent` | 最近のメモリを5件表示 | `!recent` |
| `!categories` | カテゴリ別メモリ件数を表示 | `!categories` |
| `!delete <キーワード>` | メモリを検索して削除（1件一致時） | `!delete 古いメモ` |
| `!edit <キーワード> \| <フィールド>=<値>` | メモリを検索して編集 | `!edit 買い物 \| title=新しいタイトル` |
| `!remind <分>m <メッセージ>` | リマインダーを設定（1〜10080分） | `!remind 30m 会議の準備` |
| `!help` | コマンド一覧を表示 | `!help` |

`!edit` の編集可能フィールド: `title`, `summary`, `tags`（tagsはカンマ区切り: `tags=買い物,食品,週末`）

### スラッシュコマンド（`/` プレフィックス）

| コマンド | 引数 | 説明 |
|---------|------|------|
| `/search` | `query`（必須）, `category`（任意） | メモリを検索。5件以上は「もっと見る」ボタンで次ページ表示 |
| `/delete` | `keyword`（必須） | メモリを検索して確認ボタン付きで削除 |
| `/edit` | `keyword`（必須）, `field`（必須: title/summary/tags）, `value`（必須） | メモリを検索して編集 |
| `/remind` | `message`（必須）, `minutes`（必須: 1〜10080） | リマインダーを設定 |

## 自動保存の仕組み

Dolphiveには4つの保存トリガーがある。

### 1. カテゴリチャンネルでの即時自動保存

チャンネル名にカテゴリキーワードが含まれている場合、そのチャンネルでの発言は**AI判定をスキップ**して即座にプレビュー表示される。

| カテゴリ | キーワード |
|---------|-----------|
| `daily` | daily, 日記 |
| `ideas` | ideas, idea, アイデア |
| `research` | research, 調査 |
| `images` | images, image, 画像 |
| `logs` | logs, log, 作業ログ |
| `schedule` | schedule, 予定 |
| `tasks` | tasks, task, タスク |

チャンネル名は正規化される（全角→半角変換、記号・絵文字の除去）。例: `#📝daily-log` → `daily` カテゴリ

### 2. キーワードトリガーによる自動保存

以下のキーワードを含むメッセージは、AI呼び出しなしで即座に保存対象と判定される:

「覚えといて」「覚えておいて」「メモして」「メモしといて」「保存して」「記録して」「忘れないように」

### 3. AI判定による自動保存

カテゴリチャンネル以外で、上記キーワードにも該当しないメッセージは、AIが保存の必要性を自動判定する。AIが「保存すべき」と判断した場合のみプレビューが表示される。

### 4. 📝リアクションによる保存

任意のメッセージに📝（メモ）リアクションを付けると、そのメッセージを保存対象としてプレビューが表示される。

### 保存確認フロー（全トリガー共通）

上記いずれのトリガーでも、保存前に必ず**プレビュー確認**が表示される:

1. AIが会話内容からタイトル・カテゴリ・タグ・要約を自動生成
2. Embed形式でプレビュー表示（タイトル、カテゴリ、タグ、要約）
3. 「💾 保存」または「❌ キャンセル」ボタンで確定
4. 30秒操作がなければ自動キャンセル

## 環境変数

`.env.example` を `.env` にコピーして編集する。

```bash
cp .env.example .env
```

### 必須

| 変数名 | 説明 |
|--------|------|
| `DISCORD_TOKEN` | Discord Botトークン |
| `GLM_API_KEY` | GLM-4互換APIのAPIキー |
| `GITHUB_TOKEN` | GitHub Personal Access Token（`repo`スコープ必須） |
| `GITHUB_OWNER` | GitHubユーザー名またはOrg名 |
| `GITHUB_REPO` | メモリ保存先リポジトリ名 |

### 任意

| 変数名 | デフォルト値 | 説明 |
|--------|------------|------|
| `DISCORD_CHANNEL_ID` | （なし） | 監視対象チャンネルID。未設定時は全チャンネルを監視 |
| `GLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | AI APIのベースURL |
| `GLM_MODEL` | `glm-4` | 使用するモデル名 |
| `GITHUB_TEMPLATE_OWNER` | `terao-ryohei` | テンプレートリポジトリのオーナー |
| `GITHUB_TEMPLATE_REPO` | `myLife` | テンプレートリポジトリ名 |
| `GITHUB_REPO_PRIVATE` | `true` | 自動作成するリポジトリをprivateにするか |

> **注意: `GLM_BASE_URL` にはベースURLのみを指定すること。`/chat/completions` は含めない。**
> OpenAI SDK が自動でエンドポイントパスを付与するため、含めるとURLが二重化して404エラーになる。
>
> - 正: `https://api.example.com/api/paas/v4`
> - 誤: `https://api.example.com/api/paas/v4/chat/completions`

## セットアップ

### 前提条件

- Node.js 18以上
- npm
- GitHubアカウント（Personal Access Token）
- Discord Botアカウント

### 1. インストール

```bash
git clone <repository-url>
cd myLife-bot
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
# .env を編集して必要な値を入力
```

### 3. Discord Botの作成

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーション作成
2. Botタブでトークンを取得
3. 必要なIntent: `Guilds`, `GuildMessages`, `MessageContent`, `GuildMessageReactions`, `DirectMessages`
4. OAuth2 > URL Generatorで招待URL生成（権限: Send Messages, Read Message History, Embed Links）
5. サーバーにBotを招待

### 4. ビルドと起動

```bash
npm run build
npm start
```

### 開発モード

```bash
npm run dev    # TypeScriptファイル変更を監視して自動コンパイル
npm run clean  # dist/ を削除
```

## 本番デプロイ（PM2）

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 startup    # サーバー再起動時の自動復帰
pm2 save
```

| コマンド | 説明 |
|---------|------|
| `pm2 status` | 稼働状況確認 |
| `pm2 logs dolphive` | ログ確認 |
| `pm2 restart dolphive` | 再起動 |
| `pm2 stop dolphive` | 停止 |

## メモリカテゴリ

| カテゴリ | 説明 | 追加フィールド |
|---------|------|---------------|
| `daily` | 日常の出来事、日記 | - |
| `ideas` | アイデア、思いつき | - |
| `research` | 調査結果、技術メモ | - |
| `images` | 画像に関するメモ | - |
| `logs` | 作業ログ、進捗 | - |
| `schedule` | スケジュール、予定 | `start_date`, `end_date`, `start_time`, `end_time`, `location`, `recurring` |
| `tasks` | タスク、TODO | `status`(todo/doing/done), `due_date`, `priority`(high/medium/low) |

## 保存形式

メモリは `memory/{guildId}/{category}/{YYYY-MM-DD}-{uuid}.md` に保存される。
DMからの保存は `memory/dm/{category}/...` に保存。

```markdown
---
title: タイトル
date: 2026-02-01
tags: [tag1, tag2]
source: discord
type: daily
summary: 要約テキスト
---

本文（Markdown形式）
```

## ファイル構造

```
src/
├── index.ts                # エントリポイント（初期化・起動）
├── config.ts               # 環境変数の読み込みとバリデーション
├── reminder.ts             # リマインダー機能（GitHub永続化・60秒間隔チェック）
├── discord/
│   ├── bot.ts              # Botメインクラス（イベントハンドラ・自動保存ロジック）
│   ├── commands.ts         # テキストコマンド処理（!save, !search 等）
│   ├── slash-commands.ts   # スラッシュコマンド処理（/search, /delete 等）
│   ├── channel-category.ts # チャンネル名→カテゴリ判定（全角正規化対応）
│   ├── index.ts            # エクスポート
│   └── types.ts            # 型定義
├── github/
│   ├── client.ts           # GitHub Contents APIクライアント（リトライ付き）
│   ├── memory.ts           # メモリ管理（保存・検索・インデックス・旧パス互換）
│   ├── index.ts            # エクスポート
│   └── types.ts            # 型定義
├── ai/
│   ├── client.ts           # AI APIクライアント（OpenAI互換・画像メタデータ対応）
│   ├── prompts.ts          # メモリ生成・保存判定プロンプト
│   ├── index.ts            # エクスポート
│   └── types.ts            # 型定義
└── utils/
    └── retry.ts            # 指数バックオフリトライ（429 Retry-After対応）
```

## ライセンス

MIT
