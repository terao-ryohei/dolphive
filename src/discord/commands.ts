import type { Message } from 'discord.js';
import type { MemoryManager, SearchResult } from '../github/index.js';
import type { AIClient } from '../ai/index.js';
import type { MemoryCategory } from '../github/types.js';

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
      const results = await this.memoryManager.searchMemories(query);

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
      const results = await this.memoryManager.getRecentMemories(5);

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
   * !help - ヘルプ表示
   */
  private async handleHelp(message: Message): Promise<void> {
    const helpText = `
**Memory Bot コマンド**
\`!save\` - 直前の会話をメモリとして保存
\`!search <キーワード>\` - メモリを検索
\`!recent\` - 最近のメモリを表示
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
