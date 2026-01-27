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

カテゴリ（daily / idea / research / image / log）

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

ファイル命名

{category}/{YYYY-MM-DD}-{uuid}.md

既存ファイルへの上書き禁止

Markdown形式（固定）
---
title: 自動生成
date: YYYY-MM-DD
tags: [tag1, tag2]
source: discord
type: idea | research | image
drive_url: (画像のみ)
summary: 要約
---

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
