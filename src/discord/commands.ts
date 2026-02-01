import { EmbedBuilder, type Message } from 'discord.js';
import type { MemoryManager, SearchResult } from '../github/index.js';
import type { AIClient } from '../ai/index.js';
import type { MemoryCategory } from '../github/types.js';
import { setReminder } from '../reminder.js';

const VALID_CATEGORIES: MemoryCategory[] = ['daily', 'ideas', 'research', 'images', 'logs', 'schedule', 'tasks'];

/**
 * コマンドハンドラ
 */
export class CommandHandler {
  private memoryManager: MemoryManager;
  private aiClient: AIClient;
  private onSaveRequest: (message: Message, category?: MemoryCategory, excludeCurrentMessage?: boolean) => Promise<void>;

  constructor(
    memoryManager: MemoryManager,
    aiClient: AIClient,
    onSaveRequest: (message: Message, category?: MemoryCategory, excludeCurrentMessage?: boolean) => Promise<void>,
  ) {
    this.memoryManager = memoryManager;
    this.aiClient = aiClient;
    this.onSaveRequest = onSaveRequest;
  }

  /**
   * コマンドを実行
   */
  async execute(message: Message, command: string, args: string[]): Promise<void> {
    switch (command) {
      case 'save':
        await this.handleSave(message, args);
        break;
      case 'search':
        await this.handleSearch(message, args);
        break;
      case 'recent':
        await this.handleRecent(message);
        break;
      case 'categories':
        await this.handleCategories(message);
        break;
      case 'delete':
        await this.handleDelete(message, args);
        break;
      case 'edit':
        await this.handleEdit(message, args);
        break;
      case 'remind':
        await this.handleRemind(message, args);
        break;
      case 'help':
        await this.handleHelp(message);
        break;
      default:
        await message.reply(`不明なコマンド: ${command}`);
    }
  }

  /**
   * !save - 直前の会話を保存
   */
  private async handleSave(message: Message, args: string[]): Promise<void> {
    console.log('[KPI] save_manual');

    const categoryOverride = args[0] && VALID_CATEGORIES.includes(args[0] as MemoryCategory)
      ? args[0] as MemoryCategory
      : undefined;

    await this.onSaveRequest(message, categoryOverride, true);
  }

  /**
   * !search <query> - メモリ検索
   */
  private async handleSearch(message: Message, args: string[]): Promise<void> {
    const query = args.join(' ').trim();
    if (!query) {
      await message.reply('検索キーワードを指定してください: `!search <キーワード>`');
      return;
    }

    await message.reply(`「${query}」で検索中...`);

    try {
      const guildId = message.guild?.id ?? 'dm';
      const results = await this.memoryManager.searchMemories(query, guildId);

      if (results.length === 0) {
        await message.reply('該当するメモリが見つかりませんでした。');
        return;
      }

      const resultText = this.formatSearchResults(results.slice(0, 5));
      await message.reply(`検索結果（${results.length}件中上位5件）:\n${resultText}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await message.reply(`検索に失敗しました: ${errorMessage}`);
    }
  }

  /**
   * !recent - 最近のメモリ一覧
   */
  private async handleRecent(message: Message): Promise<void> {
    try {
      const guildId = message.guild?.id ?? 'dm';
      const results = await this.memoryManager.getRecentMemories(guildId, 5);

      if (results.length === 0) {
        await message.reply('メモリがまだありません。');
        return;
      }

      const resultText = this.formatSearchResults(results);
      await message.reply(`最近のメモリ:\n${resultText}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await message.reply(`取得に失敗しました: ${errorMessage}`);
    }
  }

  /**
   * !categories - カテゴリ一覧表示（並列化済み）
   */
  private async handleCategories(message: Message): Promise<void> {
    const categoryEmoji: Record<MemoryCategory, string> = {
      daily: '📅',
      ideas: '💡',
      research: '🔬',
      images: '🖼️',
      logs: '📋',
      schedule: '🗓️',
      tasks: '✅',
    };

    try {
      const guildId = message.guild?.id ?? 'dm';

      const memoriesByCategory = await Promise.all(
        VALID_CATEGORIES.map(async (category) => ({
          category,
          count: (await this.memoryManager.listMemories(category, guildId)).length,
        })),
      );

      const total = memoriesByCategory.reduce((sum, c) => sum + c.count, 0);

      if (total === 0) {
        await message.reply('保存されたメモリがまだありません。`!save` でメモリを保存してみましょう。');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📂 メモリカテゴリ一覧')
        .setColor(0x5865F2)
        .setDescription(`全 ${total} 件のメモリ`)
        .addFields(
          memoriesByCategory
            .filter(c => c.count > 0)
            .map(c => ({
              name: `${categoryEmoji[c.category]} ${c.category}`,
              value: `${c.count} 件`,
              inline: true,
            }))
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await message.reply(`カテゴリ一覧の取得に失敗しました: ${errorMessage}`);
    }
  }

  /**
   * !delete <keyword> - メモリを削除
   * 検索して1件ならそのまま削除、複数なら一覧表示
   */
  private async handleDelete(message: Message, args: string[]): Promise<void> {
    const query = args.join(' ').trim();
    if (!query) {
      await message.reply('削除するメモリを指定してください: `!delete <キーワード>`');
      return;
    }

    try {
      const guildId = message.guild?.id ?? 'dm';
      const results = await this.memoryManager.searchMemories(query, guildId);

      if (results.length === 0) {
        await message.reply('該当するメモリが見つかりませんでした。');
        return;
      }

      if (results.length > 1) {
        const resultText = this.formatSearchResults(results.slice(0, 5));
        await message.reply(
          `複数のメモリが見つかりました（${results.length}件）。もう少し具体的なキーワードで指定してください:\n${resultText}`,
        );
        return;
      }

      const target = results[0];
      await this.memoryManager.deleteMemory(guildId, target.path);
      await message.reply(`削除しました: **${target.frontmatter.title}** (${target.frontmatter.date})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await message.reply(`削除に失敗しました: ${errorMessage}`);
    }
  }

  /**
   * !edit <keyword> | <field>=<value> - メモリを編集
   * 例: !edit 買い物メモ | title=新しいタイトル
   * 例: !edit 買い物メモ | summary=更新された要約
   * 例: !edit 買い物メモ | tags=tag1,tag2,tag3
   */
  private async handleEdit(message: Message, args: string[]): Promise<void> {
    const fullArgs = args.join(' ');
    const pipeIndex = fullArgs.indexOf('|');

    if (pipeIndex === -1) {
      await message.reply(
        '編集形式: `!edit <キーワード> | <フィールド>=<値>`\n' +
        '例: `!edit 買い物メモ | title=新しいタイトル`\n' +
        '編集可能: `title`, `summary`, `tags`（カンマ区切り）',
      );
      return;
    }

    const query = fullArgs.slice(0, pipeIndex).trim();
    const updateStr = fullArgs.slice(pipeIndex + 1).trim();

    if (!query || !updateStr) {
      await message.reply('キーワードと編集内容の両方を指定してください。');
      return;
    }

    const eqIndex = updateStr.indexOf('=');
    if (eqIndex === -1) {
      await message.reply('編集内容は `フィールド=値` の形式で指定してください。');
      return;
    }

    const field = updateStr.slice(0, eqIndex).trim();
    const value = updateStr.slice(eqIndex + 1).trim();

    const validFields = ['title', 'summary', 'tags'] as const;
    if (!validFields.includes(field as typeof validFields[number])) {
      await message.reply(`編集可能なフィールド: ${validFields.join(', ')}`);
      return;
    }

    try {
      const guildId = message.guild?.id ?? 'dm';
      const results = await this.memoryManager.searchMemories(query, guildId);

      if (results.length === 0) {
        await message.reply('該当するメモリが見つかりませんでした。');
        return;
      }

      if (results.length > 1) {
        const resultText = this.formatSearchResults(results.slice(0, 5));
        await message.reply(
          `複数のメモリが見つかりました（${results.length}件）。もう少し具体的なキーワードで指定してください:\n${resultText}`,
        );
        return;
      }

      const target = results[0];
      const updates = field === 'tags'
        ? { tags: value.split(',').map((t) => t.trim()).filter((t) => t.length > 0) }
        : { [field]: value };

      const updated = await this.memoryManager.editMemory(guildId, target.path, updates);
      await message.reply(`編集しました: **${updated.frontmatter.title}** の ${field} を更新`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await message.reply(`編集に失敗しました: ${errorMessage}`);
    }
  }

  /**
   * !remind <minutes>m <message> - リマインダー登録
   */
  private async handleRemind(message: Message, args: string[]): Promise<void> {
    if (args.length < 2) {
      await message.reply('形式: `!remind <分>m <メッセージ>`\n例: `!remind 30m ミーティング`');
      return;
    }

    const timeArg = args[0];
    const match = timeArg.match(/^(\d+)m$/);
    if (!match) {
      await message.reply('時間は `<分>m` の形式で指定してください（例: `30m`, `60m`）');
      return;
    }

    const minutes = parseInt(match[1], 10);
    if (minutes <= 0 || minutes > 10080) {
      await message.reply('1分～10080分（7日）の範囲で指定してください。');
      return;
    }

    const reminderMessage = args.slice(1).join(' ').trim();
    if (!reminderMessage) {
      await message.reply('リマインダーのメッセージを指定してください。');
      return;
    }

    try {
      const guildId = message.guild?.id ?? 'dm';
      const triggerTime = new Date(Date.now() + minutes * 60_000);

      await setReminder({
        guildId,
        userId: message.author.id,
        channelId: message.channel.id,
        message: reminderMessage,
        triggerTime,
      });

      const embed = new EmbedBuilder()
        .setTitle('⏰ リマインダー登録')
        .setColor(0x00bfff)
        .addFields(
          { name: 'メッセージ', value: reminderMessage },
          { name: '通知時刻', value: `${minutes}分後（<t:${Math.floor(triggerTime.getTime() / 1000)}:R>）` },
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await message.reply(`リマインダー登録に失敗しました: ${errorMessage}`);
    }
  }

  /**
   * !help - ヘルプ表示
   */
  private async handleHelp(message: Message): Promise<void> {
    const helpText = `
**Memory Bot コマンド**
\`!save\` - 直前の会話をメモリとして保存
\`!search <キーワード>\` - メモリを検索
\`!recent\` - 最近のメモリを表示
\`!delete <キーワード>\` - メモリを削除（1件一致時）
\`!edit <キーワード> | <フィールド>=<値>\` - メモリを編集
\`!remind <分>m <メッセージ>\` - リマインダーを設定
\`!categories\` - カテゴリ別メモリ件数を表示
\`!help\` - このヘルプを表示

**自動保存トリガー**
「覚えといて」「メモして」等のキーワードで自動保存
    `.trim();

    await message.reply(helpText);
  }

  /**
   * 検索結果をフォーマット
   */
  private formatSearchResults(results: SearchResult[]): string {
    return results
      .map((r, i) => {
        const tags = r.frontmatter.tags.join(', ');
        return `${i + 1}. **${r.frontmatter.title}** (${r.frontmatter.date})\n   ${r.frontmatter.summary}\n   タグ: ${tags}`;
      })
      .join('\n\n');
  }
}
