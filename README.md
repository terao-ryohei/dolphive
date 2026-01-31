# Dolphive

Dolphin（イルカ）+ Archive（保管庫）= イルカのように賢く記憶を保管するサービス。

Discord BotからAI経由でメモをGitHubに自動保存するシステム。

## 概要

- Discordでの会話から重要な情報をAI（GLM-4）が抽出
- Markdown形式でGitHubリポジトリに自動保存
- カテゴリ分類、タグ付け、要約を自動生成

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example`を`.env`にコピーして編集:

```bash
cp .env.example .env
```

必要な値:

- `DISCORD_TOKEN`: Discord Botトークン
- `DISCORD_CHANNEL_ID`: 監視対象チャンネルID（未設定時はBOTが参加している全サーバーの全テキストチャンネルを自動監視。設定時は指定チャンネルのみ監視）
- `GLM_API_KEY`: GLM-4 APIキー
- `GITHUB_TOKEN`: GitHub Personal Access Token
- `GITHUB_OWNER`: GitHubユーザー名
- `GITHUB_REPO`: メモリ保存先リポジトリ名

### 3. Discord Botの作成

1. [Discord Developer Portal](https://discord.com/developers/applications)でアプリケーション作成
2. Botタブでトークンを取得
3. OAuth2 > URL Generatorで招待URL生成（権限: Send Messages, Read Message History）
4. サーバーにBotを招待

### 4. ビルドと起動

```bash
npm run build
npm start
```

## コマンド

| コマンド | 説明 |
|---------|------|
| `!save` | 直前の会話をメモリとして保存 |
| `!search <キーワード>` | メモリを検索 |
| `!recent` | 最近のメモリを表示 |
| `!help` | ヘルプを表示 |

## チャンネル名によるカテゴリ自動判定

チャンネル名にカテゴリキーワードが含まれている場合、そのチャンネルでの発言は対応するカテゴリとして自動保存されます。

| カテゴリ | キーワード（英語） | キーワード（日本語） |
|---------|-------------------|---------------------|
| `daily` | daily | 日記 |
| `ideas` | ideas, idea | アイデア |
| `research` | research | 調査 |
| `images` | images, image | 画像 |
| `logs` | logs, log | 作業ログ |
| `schedule` | schedule | 予定 |
| `tasks` | tasks, task | タスク |

- チャンネル名は正規化されます（全角→半角変換、記号・絵文字の除去）
- 例: `#📝daily-log` → `daily` カテゴリ、`#アイデア` → `ideas` カテゴリ
- マッチしないチャンネルではAIが自動判定（下記「自動保存トリガー」参照）

## 自動保存トリガー

以下のキーワードを含むメッセージで自動保存:

- 「覚えといて」「覚えておいて」
- 「メモして」「メモしといて」
- 「保存して」「記録して」
- 「忘れないように」

## メモリカテゴリ

| カテゴリ | 説明 |
|---------|------|
| `daily` | 日常の出来事、日記 |
| `ideas` | アイデア、思いつき |
| `research` | 調査結果、技術メモ |
| `images` | 画像に関するメモ |
| `logs` | 作業ログ、進捗 |
| `schedule` | スケジュール、予定、約束 |
| `tasks` | タスク、TODO、やること |

## ファイル構造

```
src/
├── index.ts        # エントリポイント
├── config.ts       # 設定管理
├── github/         # GitHub API連携
│   ├── client.ts   # GitHub APIクライアント
│   ├── memory.ts   # メモリ管理
│   └── types.ts    # 型定義
├── discord/        # Discord Bot
│   ├── bot.ts      # Botメインクラス
│   ├── commands.ts # コマンド処理
│   └── types.ts    # 型定義
└── ai/             # AI統合
    ├── client.ts   # GLM-4 APIクライアント
    ├── prompts.ts  # プロンプト定義
    └── types.ts    # 型定義
```

## 保存形式

メモリは以下の形式でMarkdownファイルとして保存:

```markdown
---
title: タイトル
date: 2024-01-01
tags: [tag1, tag2]
source: discord
type: ideas
summary: 要約
---

本文（Markdown）
```

保存先: `memory/{category}/{YYYY-MM-DD}-{uuid}.md`

### スケジュール追加フィールド（type: schedule）

```yaml
start_date: "2026-02-01"   # 必須: 開始日
end_date: "2026-02-01"     # 任意: 終了日
start_time: "10:00"        # 任意: 開始時刻
end_time: "11:00"          # 任意: 終了時刻
location: "会議室A"         # 任意: 場所
recurring: "none"          # 任意: none/daily/weekly/monthly/yearly
```

### タスク追加フィールド（type: tasks）

```yaml
status: "todo"             # 必須: todo/doing/done
due_date: "2026-02-01"     # 任意: 期限
priority: "medium"         # 任意: high/medium/low
```

## 開発

```bash
# 開発モード（ファイル変更監視）
npm run dev

# ビルド
npm run build

# クリーン
npm run clean
```

## AWS Lightsail へのデプロイ（推奨）

EC2より設定がシンプルで、固定料金のため費用が予測しやすい。

### 費用プラン

| プラン | スペック | 費用 |
|--------|---------|------|
| $3.50/月 | 512MB RAM, 1 vCPU | Discord Bot に十分 |
| $5/月 | 1GB RAM, 1 vCPU | 余裕を持たせたい場合 |

### 1. Lightsailインスタンスの作成

1. [AWS Lightsail コンソール](https://lightsail.aws.amazon.com/) にアクセス
2. 「インスタンスの作成」をクリック
3. 設定:
   - **リージョン**: Tokyo (ap-northeast-1)
   - **プラットフォーム**: Linux/Unix
   - **ブループリント**: OS のみ → **Amazon Linux 2023**
   - **インスタンスプラン**: $3.50 USD/月（512MB）
   - **インスタンス名**: `dolphive`
4. 「インスタンスの作成」をクリック

### 2. SSH接続

Lightsailコンソールから「ブラウザベースSSH接続」ボタンをクリック
（または、SSHキーをダウンロードしてターミナルから接続）

### 3. サーバー環境のセットアップ

```bash
# Node.js と git をインストール
sudo dnf install -y nodejs npm git

# Node.js バージョン確認（18以上が必要）
node --version
```

### 4. ボットのデプロイ

```bash
# リポジトリをクローン
git clone <repository-url>
cd myLife-bot

# 依存パッケージインストール
npm install

# ビルド
npm run build

# 環境変数を設定
cp .env.example .env
nano .env  # 必要な値を入力
```

### 5. PM2 でプロセス管理（常時稼働）

```bash
# PM2 をグローバルインストール
sudo npm install -g pm2

# ボットを起動（ecosystem.config.cjs を使用）
pm2 start ecosystem.config.cjs

# 自動再起動設定（サーバー再起動時も自動復帰）
pm2 startup
# 表示されたコマンドをコピーして実行
pm2 save
```

### 6. PM2 コマンド

| コマンド | 説明 |
|---------|------|
| `pm2 status` | 稼働状況確認 |
| `pm2 logs dolphive` | ログ確認 |
| `pm2 restart dolphive` | 再起動 |
| `pm2 stop dolphive` | 停止 |

### 7. 動作確認

1. `pm2 status` でボットが `online` 状態か確認
2. Discordで `!help` コマンドを送信して応答を確認
3. `pm2 logs dolphive` でログにエラーがないか確認

---

## AWS EC2 へのデプロイ（代替案）

より柔軟な構成が必要な場合や、無料枠を利用したい場合はEC2を使用。

### Lightsail vs EC2 比較

| 項目 | Lightsail | EC2 |
|------|-----------|-----|
| 料金 | $3.50/月〜（固定） | 無料枠後 $7-8.5/月 |
| 設定難易度 | 簡単 | やや複雑 |
| セキュリティグループ | 自動設定済み | 手動設定必要 |
| 静的IP | 無料で付属 | 別途 Elastic IP |
| 適用ケース | 小規模アプリ | 柔軟な構成が必要な場合 |

### 1. EC2インスタンスの作成

- **AMI**: Amazon Linux 2023 または Ubuntu 22.04
- **インスタンスタイプ**: t2.micro (無料枠) または t3.micro
- **ストレージ**: 8GB (デフォルト)
- **セキュリティグループ**: SSHポート22のみ許可

### 2. サーバー環境のセットアップ

```bash
# Amazon Linux 2023
sudo dnf install -y nodejs npm git

# Ubuntu 22.04
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### 3. ボットのデプロイ

```bash
git clone <repository-url>
cd myLife-bot
npm install
npm run build
cp .env.example .env
nano .env  # 必要な値を入力
```

### 4. PM2 でプロセス管理

Lightsailセクションの「5. PM2 でプロセス管理」と同じ手順を実行。

### 費用目安

| サービス | 費用 |
|---------|------|
| EC2 t2.micro | 無料枠(750時間/月)、以降約$8.5/月 |
| EC2 t3.micro | 約$7.5/月 |

## ライセンス

MIT
