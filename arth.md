AI実装向け 技術仕様サマリ（端的版）
1. 前提条件（確定）

UI：Discord Bot（単一）

AI：サブスク契約（API従量課金なし）

AI権限：

❌ GitHub操作不可

❌ 削除・編集不可

永続ストレージ（正本）：GitHub

保存方式：新規ファイル追記型のみ

画像保存：Google Drive のみ

commit / push：完全自動

人間は GitHub / Drive を直接触らない前提

2. システム構成（最小）
Discord
  ↓
Bot（Node/Python）
  ├─ text → AI → Markdown生成 → GitHub commit
  └─ image → Drive upload → URL → AI要約 → GitHub commit

3. Botの責務（重要）
Botがやる

Discordイベント受信

会話コンテキスト管理

AIプロンプト生成

GitHub API操作（create file / commit）

Google Drive API操作（upload / URL取得）

Botがやらない

内容判断（AIに委譲）

ファイル編集・削除

既存ファイルの変更

4. AIの責務（純粋思考のみ）
入力

会話ログ
-（画像時）画像URL or キャプション

出力（必須）

要約（summary）

タグ配列（tags）

カテゴリ（daily / ideas / research / images / logs / schedule / tasks）

Markdown本文（YAML frontmatter 付き）

AIが扱わないもの

GitHub API

Drive API

ファイルパス決定

5. GitHubリポジトリ仕様
構成（例）
memory/
├─ daily/
├─ ideas/
├─ research/
├─ images/
├─ logs/
├─ schedule/
└─ tasks/

ファイル命名

{category}/{YYYY-MM-DD}-{uuid}.md

既存ファイルへの上書き禁止

Markdown形式（固定）
---
title: 自動生成
date: YYYY-MM-DD
tags: [tag1, tag2]
source: discord
type: daily | ideas | research | images | logs | schedule | tasks
drive_url: (画像のみ)
summary: 要約
---

# スケジュール用追加フィールド（type: schedule の場合）
start_date: YYYY-MM-DD
end_date: YYYY-MM-DD
start_time: HH:MM
end_time: HH:MM
location: 場所
recurring: none | daily | weekly | monthly | yearly

# タスク用追加フィールド（type: tasks の場合）
status: todo | doing | done
due_date: YYYY-MM-DD
priority: high | medium | low

本文

6. GitHub権限設計

fine-grained PAT

✅ contents: write

❌ delete

❌ force push

main ブランチ直 commit

PR 不使用（簡素化）

7. Google Drive仕様（画像限定）

Bot専用フォルダ

権限：

upload

read

❌ delete

保存パス：

/ai-memory/images/YYYY/MM/

GitHubには URLのみ保存

8. 保存トリガー

明示的：

「覚えといて」

暗黙的（任意）：

長文

調査結果

画像投稿

※ 最初は 明示トリガーのみ推奨

9. 検索フロー（簡易）

Botが GitHub から

YAML

summary
を取得

AIに意味比較させる

上位N件を返す

※ ベクトルDB不要（後付け可能）

10. 安全設計の要点

AIは「読む・書く内容を決める」だけ

永続操作はすべて Bot 経由

削除不可・上書き不可

ミスは「新しいファイルで補正」

11. 実装順（推奨）

Discord Bot（text保存のみ）

GitHub自動commit

AI Markdown生成プロンプト固定

検索

画像 → Drive連携

12. 技術選定メモ（参考）

Bot：Node.js + discord.js

GitHub：REST API

Drive：Google Drive API v3

ID：UUID v7 推奨

13. UX改善設計（cmd_005）

(A) サーバー招待時の自動挨拶

トリガー: Client の `guildCreate` イベント（Bot がギルドに追加された時点で発火）
GatewayIntentBits.Guilds は既存で対応済み。追加のIntent不要。

送信先の優先順位:
1. guild.systemChannel（サーバー設定の「システムメッセージチャンネル」）
2. guild.channels.cache から TextChannel を取得し、最初に channel.permissionsFor(guild.members.me!).has(PermissionFlagsBits.SendMessages) が true のチャンネル
3. 全て失敗時はログ出力のみ（console.warn）。ユーザーに影響を与えない。

挨拶内容（Embed形式）:
- タイトル: 「🐬 Dolphive へようこそ！」
- 使い方3点:
  1. 🔍 `/search キーワード` で過去のメモを検索
  2. 📝 カテゴリ名チャンネル（#daily, #ideas 等）での発言は自動保存
  3. 💾 `!save` で会話を手動保存
- フッター: 「詳しくは !help で確認できます」

実装箇所: src/discord/bot.ts の setupEventHandlers() に guildCreate ハンドラを追加

(B) チャンネル名ベースのカテゴリ自動判定

チャンネル名と MemoryCategory のマッチング規則:
- #daily → daily, #ideas → ideas, #research → research
- #schedule → schedule, #tasks → tasks, #logs → logs, #images → images
- 部分一致を許容（例: #daily-log → daily, #my-ideas → ideas）
- マッチ判定: channel.name.toLowerCase().includes(keyword) で比較（keyword も小文字化済み）
- マッチしない場合は null を返し、AI が内容から判定（従来の shouldSaveMemory フロー）

カテゴリマッチしたチャンネルでの挙動:
- 全メッセージが自動保存対象
- AI の shouldSaveMemory 判定をスキップし、直接 generateMemory → saveMemory を実行
- カテゴリは channel.name から確定したものを使用（AI判定のcategoryを上書き）
- 保存時にカテゴリを返信で通知: 「📁 daily として保存しました」

誤分類対策:
- !save <category> で手動上書き可能（例: !save ideas）
- commands.ts の !save ハンドラに第一引数として category を受け取る分岐を追加
- 引数が MemoryCategory に一致しない場合は無視（従来の !save 動作）

ユーティリティ関数:
- ファイル: src/discord/channel-category.ts
- export function detectCategoryFromChannel(channelName: string): MemoryCategory | null
- 引数: channel.name（string）
- 戻り値: MemoryCategory | null

(C) 検索のスラッシュコマンド化

コマンド定義:
- /search <query> [category]
- query: 必須、String 型、description: "検索キーワード"
- category: オプション、String 型、choices に MemoryCategory の7値を列挙

登録方式:
- SlashCommandBuilder（discord.js から import）で定義
- ギルド限定登録（guild.commands.set）→ 即時反映
  ※ グローバル登録（application.commands.set）は反映に最大1時間かかるため不採用
- 起動時に冪等登録: client の ready イベント内で全参加ギルドに対して実行
  guild.commands.set() は全量上書きのため、既存コマンドの重複を気にする必要なし

実行時の挙動:
1. interaction.options.getString('category') でカテゴリ取得
2. category 未指定時: interaction.channel が TextChannel なら detectCategoryFromChannel で推定
3. 推定できなければ全カテゴリ検索
4. memoryManager.searchMemories(query, categories) を実行
5. 結果を Embed で表示（最大5件、タイトル+summary+カテゴリ+日付）
6. 5件以上ある場合は ButtonBuilder で「もっと見る」ボタンを追加
   - customId: `search_more:${query}:${offset}` 形式
   - interactionCreate で customId をパースしてページネーション

ハンドラ:
- src/discord/slash-commands.ts に以下をexport:
  - commandData: SlashCommandBuilder の定義
  - registerCommands(client: Client): Promise<void> — ready イベント後に呼ぶ
  - handleSearchInteraction(interaction: ChatInputCommandInteraction, memoryManager: MemoryManager): Promise<void>
- src/discord/bot.ts の setupEventHandlers() に interactionCreate ハンドラを追加
  - interaction.isChatInputCommand() → handleSearchInteraction
  - interaction.isButton() → ページネーションハンドラ

(D) 非エンジニア向けUX改善

D-1. 保存時プレビュー+確認ボタン
- AI が generateMemory した後、即座に GitHub 保存せず Embed + ActionRowBuilder で表示
- Embed 内容: title, category, tags, summary のプレビュー
- ボタン2つ:
  - 「💾 保存」(customId: `save_confirm:${uuid}`) — style: ButtonStyle.Success
  - 「❌ キャンセル」(customId: `save_cancel:${uuid}`) — style: ButtonStyle.Danger
- 待機: const reply = await message.reply({ embeds: [...], components: [...] });
  reply.awaitMessageComponent({ componentType: ComponentType.Button, time: 30_000 }) でユーザー入力を待機
- 「保存」押下 → memoryManager.saveMemory 実行 → 完了メッセージ
- 「キャンセル」押下 or タイムアウト → 「保存をキャンセルしました」
- uuid は生成したメモリデータを一時 Map<string, GeneratedMemory> で保持（メモリ内、永続化不要）

D-2. 保存完了時に「次にできること」を提示
- 保存成功の返信メッセージに以下を追記:
  「🔍 検索: `/search キーワード`」
  「📋 最近のメモ: `!recent`」
  「📁 カテゴリ一覧: `!categories`」

D-3. 絵文字リアクションで保存トリガー
- 追加 Intent: GatewayIntentBits.GuildMessageReactions
- 追加 Partial: Partials.Reaction
- イベント: messageReactionAdd
- トリガー絵文字: 📝 (Unicode: \u{1F4DD})
- ハンドラ:
  1. reaction.emoji.name === '📝' を判定
  2. reaction.message.partial なら reaction.message.fetch() で完全取得
  3. Bot自身のリアクションは無視
  4. 対象メッセージで保存フロー（D-1のプレビュー確認付き）を実行

D-4. エラー文に「次の手順」を明示
- 権限不足（403）: 「Botに必要な権限を付与してください: メッセージ送信、埋め込みリンク」
- トークン未設定: 「.env ファイルに DISCORD_TOKEN を設定してください」
- GitHub API エラー（401）: 「GITHUB_TOKEN の有効期限を確認してください」
- レート制限（429）: 「しばらくお待ちください。{retryAfter}秒後に再試行できます」
- 各エラー返信にはユーザー向けの自然な日本語を使用（技術用語を避ける）

14. 簡易KPI（運用指標）

以下の指標をログ出力で計測する。DB不要。

- 保存成功率: console.log(`[KPI] save_attempt`) / console.log(`[KPI] save_success`)
  保存試行時と成功時にそれぞれ出力
- 手動save率: console.log(`[KPI] save_manual`) / console.log(`[KPI] save_auto`)
  !save 経由か自動保存かを区別して出力
- 検索利用率: console.log(`[KPI] search_slash`) — /search 実行時に出力
- リアクション保存: console.log(`[KPI] save_reaction`) — 📝 リアクション経由の保存時
- 挨拶送信: console.log(`[KPI] greeting_sent:{guildId}`) — guildCreate 時に出力

ログ形式は `[KPI] {event_name}` で統一し、将来的にログパーサーで集計可能にする。

15. 実装ファイル構成

新規ファイル:
- src/discord/channel-category.ts
  - detectCategoryFromChannel(channelName: string): MemoryCategory | null
  - CATEGORY_KEYWORDS: Record<MemoryCategory, string[]>（カテゴリごとのキーワードマップ）
- src/discord/slash-commands.ts
  - commandData: SlashCommandBuilder
  - registerCommands(client: Client): Promise<void>
  - handleSearchInteraction(interaction: ChatInputCommandInteraction, memoryManager: MemoryManager): Promise<void>

修正ファイル:
- src/discord/bot.ts
  - constructor: GatewayIntentBits.GuildMessageReactions 追加、Partials.Reaction 追加
  - setupEventHandlers(): guildCreate / interactionCreate / messageReactionAdd ハンドラ追加
  - handleMessage(): チャンネル名カテゴリ判定による自動保存分岐を追加
- src/discord/commands.ts
  - !save <category> オーバーライド対応（第一引数を MemoryCategory として検証）
- src/discord/types.ts
  - GeneratedMemory 型の追加（プレビュー用一時保持）
- src/index.ts
  - registerCommands() の呼び出しを bot.start() 後に追加
