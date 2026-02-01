# 対話機能（チャット応答）

## 1. 機能概要

Dolphive は、指定されたチャンネルでユーザーのメッセージに対して自然な対話応答を返す機能を持つ。環境変数 `CHAT_CHANNEL_IDS` にチャンネルIDをカンマ区切りで設定すると、そのチャンネルでの発言に対して Dolphive キャラクターとして応答する。

応答生成時には、ユーザーが過去に保存したメモリを RAG（Retrieval-Augmented Generation）で検索し、関連する記憶があれば会話に自然に織り込む。

## 2. セットアップ方法

### 環境変数

`.env` ファイルに `CHAT_CHANNEL_IDS` を追加する。

```env
# 対話応答を有効にするチャンネルID（カンマ区切りで複数指定可）
CHAT_CHANNEL_IDS=1234567890,9876543210
```

パース処理（`src/config.ts` の `loadConfig()`）：

```typescript
chatChannelIds: process.env['CHAT_CHANNEL_IDS']
  ? process.env['CHAT_CHANNEL_IDS'].split(',').map(id => id.trim()).filter(Boolean)
  : [],
```

- 未設定または空文字の場合、`chatChannelIds` は空配列となり対話機能は無効
- 前後の空白は `trim()` で除去される
- 空要素は `filter(Boolean)` で除外される

### 起動時のログ

`src/index.ts` の起動時に以下のログが出力される：

```
Chat response enabled for channels: 1234567890, 9876543210
```

### 注意事項

**GatewayIntentBits.MessageContent が必要**

対話機能はメッセージ本文を読み取って動作するため、Discord Developer Portal で **Message Content Intent** を有効にする必要がある。`src/discord/bot.ts` のクライアント初期化で `GatewayIntentBits.MessageContent` が設定されている。この Intent が無効だと `message.content` が空文字になり、応答が生成されない。

**DISCORD_CHANNEL_ID との併用時の挙動**

`DISCORD_CHANNEL_ID`（単一チャンネル制限）が設定されている場合、Bot はそのチャンネル以外のギルドメッセージを無視する（`src/discord/bot.ts` の `handleMessage` 冒頭）：

```typescript
if (this.config.channelId && message.guild && message.channel.id !== this.config.channelId) return;
```

そのため、`CHAT_CHANNEL_IDS` に `DISCORD_CHANNEL_ID` のスコープ外のチャンネルを指定しても、メッセージ自体が無視されるため対話応答は発生しない。起動時に以下の警告ログが出力される（`src/index.ts`）：

```
Warning: CHAT_CHANNEL_IDS 9876543210 are outside DISCORD_CHANNEL_ID scope and will be ignored
```

## 3. 動作フロー

`src/discord/bot.ts` の `handleMessage` メソッドでメッセージを以下の優先順位で処理する：

```
メッセージ受信
  │
  ├─ Bot自身のメッセージ → 無視
  ├─ DISCORD_CHANNEL_ID スコープ外 → 無視
  ├─ !コマンド → CommandHandler で処理
  ├─ カテゴリチャンネル（#daily 等）→ 自動保存
  ├─ CHAT_CHANNEL_IDS に含まれるチャンネル
  │    ├─ shouldSaveMemory() で保存トリガー検出 → 自動保存（応答しない）
  │    └─ 保存トリガーなし → handleChatResponse() で対話応答
  └─ その他 → checkAutoSave()（従来の自動保存トリガー検出）
```

**保存が対話より優先される**。`CHAT_CHANNEL_IDS` のチャンネルであっても、「覚えといて」「メモして」等の保存トリガーが検出された場合は `handleAutoSaveWithPreview()` が呼ばれ、対話応答は行われない。

該当コード（`src/discord/bot.ts`）：

```typescript
if (this.config.chatChannelIds.length > 0 && this.config.chatChannelIds.includes(message.channel.id)) {
  const decision = await this.aiClient.shouldSaveMemory(message.content);
  if (decision.shouldSave) {
    console.log(`[KPI] chat_channel_save_trigger: ${decision.reason}`);
    await this.handleAutoSaveWithPreview(message);
    return;
  }
  await this.handleChatResponse(message);
  return;
}
```

## 4. RAG機能

`handleChatResponse` 内で、ユーザーのメッセージをクエリとしてメモリを検索し、上位3件を会話コンテキストに含める。

```typescript
const guildId = getScopeId(message.guild?.id, message.author.id);
const searchResults = await this.memoryManager.searchMemories(message.content, guildId);
const relatedMemories = searchResults.slice(0, 3).map((r) => ({
  title: r.frontmatter.title,
  summary: r.frontmatter.summary,
  category: r.frontmatter.type,
}));
```

検索結果は `formatMemoryContext()`（`src/ai/prompts.ts`）でプロンプト用に整形される：

```typescript
export function formatMemoryContext(
  memories: ReadonlyArray<{ title: string; summary: string; category: string }>
): string {
  if (memories.length === 0) return '';
  const lines = memories.map(
    (m) => `- [${m.category}] ${m.title}: ${m.summary}`
  );
  return `\n## 関連するユーザーのメモリ\n${lines.join('\n')}\n`;
}
```

整形されたメモリコンテキストは `CHAT_RESPONSE_PROMPT` に連結されてシステムプロンプトとなる。

### スコープ分離

RAG 検索は `getScopeId()`（`src/discord/scope.ts`）で生成されたスコープIDに基づいて行われる：

- **ギルド内**: `guildId` がそのまま使われ、そのギルドに保存されたメモリのみが検索対象
- **DM環境**: `dm-${userId}` が使われ、そのユーザーがDMで保存したメモリのみが検索対象

他ユーザーや他ギルドのメモリが混入することはない。

## 5. Dolphive キャラクター設定

`CHAT_RESPONSE_PROMPT`（`src/ai/prompts.ts`）で定義されるキャラクター設定：

| 項目 | 設定 |
|------|------|
| 名前 | Dolphive |
| 口調 | 丁寧だが堅すぎない |
| 絵文字 | 控えめ（🐬のみ時々） |
| 応答長 | 1-3文、最長5文以内 |
| メモリ言及 | 関連性がある時のみ自然に織り込む |
| 保存提案 | 保存すべき情報がありそうなら「覚えておきましょうか？」と提案 |

## 6. クールダウン制御

同一チャンネルへの連続応答を制限するクールダウン機構が `MemoryBot` クラスに実装されている。

```typescript
private chatCooldowns: Map<string, number> = new Map();
private static readonly CHAT_COOLDOWN_MS = 3000;
```

- `chatCooldowns`: チャンネルID → 最終応答時刻（`Date.now()`）の Map
- `CHAT_COOLDOWN_MS`: **3000ミリ秒（3秒）**
- クールダウン期間内のメッセージは無視される（応答を生成しない）
- クールダウンはチャンネル単位で管理される（チャンネルAのクールダウンはチャンネルBに影響しない）

## 7. 会話履歴のコンテキスト

`handleChatResponse` では、現在のメッセージの直前 **15件** のメッセージを会話履歴として取得する。

```typescript
const recentMessages = await channel.messages.fetch({ limit: 15, before: message.id });
const conversationHistory = Array.from(recentMessages.values())
  .filter((m) => m.content)
  .reverse()
  .map((m) => ({
    role: m.author.bot ? 'assistant' as const : 'user' as const,
    content: m.content,
  }));
```

- `limit: 15`: 直近15メッセージを取得
- `before: message.id`: 現在のメッセージより前のメッセージのみ
- Bot のメッセージは `role: 'assistant'`、ユーザーのメッセージは `role: 'user'` としてマッピング
- `content` が空のメッセージ（画像のみ等）は `filter` で除外
- `.reverse()` で時系列順（古い → 新しい）に並べ替え
- この履歴に現在のメッセージ（`userMessage`）を加えて `generateChatResponse()` に渡す

AI 呼び出し時の `temperature` は `0.7`（`src/ai/client.ts`）で、メモリ生成（`0.3`）より高めに設定されており、自然で多様な応答を生成する。
