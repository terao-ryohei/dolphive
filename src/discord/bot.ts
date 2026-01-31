import { Client, GatewayIntentBits, Message, TextChannel, Partials } from 'discord.js';
import type { MemoryManager } from '../github/index.js';
import type { AIClient, ConversationMessage } from '../ai/index.js';
import { CommandHandler } from './commands.js';
import type { BotConfig, BotState, MessageContext } from './types.js';

/**
 * Discord Memory Bot
 */
export class MemoryBot {
  private client: Client;
  private config: BotConfig;
  private memoryManager: MemoryManager;
  private aiClient: AIClient;
  private commandHandler: CommandHandler;
  private state: BotState;

  constructor(
    config: BotConfig,
    memoryManager: MemoryManager,
    aiClient: AIClient
  ) {
    this.config = config;
    this.memoryManager = memoryManager;
    this.aiClient = aiClient;
    this.commandHandler = new CommandHandler(memoryManager, aiClient);
    this.state = {
      isRunning: false,
      pendingRequests: 0,
    };

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Message, Partials.Channel],
    });

    this.setupEventHandlers();
  }

  /**
   * イベントハンドラを設定
   */
  private setupEventHandlers(): void {
    this.client.on('ready', () => {
      console.log(`Logged in as ${this.client.user?.tag}`);
      this.state.isRunning = true;
    });

    this.client.on('messageCreate', async (message) => {
      await this.handleMessage(message);
    });

    this.client.on('error', (error) => {
      console.error('Discord client error:', error);
      this.state.lastError = error;
    });
  }

  /**
   * メッセージハンドラ
   */
  private async handleMessage(message: Message): Promise<void> {
    // 自分自身のメッセージは無視
    if (message.author.bot) return;

    // Guild外メッセージ（DM等）は無視
    if (!message.guild) return;

    // 指定チャンネルがある場合、それ以外は無視
    if (this.config.channelId && message.channel.id !== this.config.channelId) return;

    const content = message.content.trim();

    // コマンド処理
    if (content.startsWith('!')) {
      const [command, ...args] = content.slice(1).split(/\s+/);
      await this.commandHandler.execute(message, command.toLowerCase(), args);
      return;
    }

    // 自動保存トリガー検出
    await this.checkAutoSave(message);
  }

  /**
   * 自動保存トリガーをチェック
   */
  private async checkAutoSave(message: Message): Promise<void> {
    try {
      const decision = await this.aiClient.shouldSaveMemory(message.content);

      if (!decision.shouldSave) return;

      console.log(`Auto-save triggered: ${decision.reason}`);

      const channel = message.channel as TextChannel;

      // 直前のメッセージを取得
      const messages = await channel.messages.fetch({ limit: 20, before: message.id });
      const context = this.messagesToContext(messages);

      // 現在のメッセージも追加
      context.push({
        authorId: message.author.id,
        authorName: message.author.username,
        content: message.content,
        timestamp: message.createdAt,
        isBot: false,
      });

      if (context.length === 0) {
        await message.reply('保存する内容が見つかりませんでした。');
        return;
      }

      this.state.pendingRequests++;
      await message.reply('会話をメモリに保存中...');

      try {
        const memory = await this.aiClient.generateMemory({
          username: message.author.username,
          messages: context.map((c) => ({
            role: c.isBot ? 'bot' : 'user',
            content: c.content,
            timestamp: c.timestamp,
          } as ConversationMessage)),
        });

        const saved = await this.memoryManager.saveMemory({
          category: memory.category,
          title: memory.title,
          tags: memory.tags,
          summary: memory.summary,
          content: memory.content,
        });

        await message.reply(
          `メモリを保存しました\n` +
          `**${memory.title}**\n` +
          `カテゴリ: ${memory.category} | タグ: ${memory.tags.join(', ')}`
        );
      } finally {
        this.state.pendingRequests--;
      }
    } catch (error) {
      console.error('Auto-save error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await message.reply(`保存に失敗しました: ${errorMessage}`);
    }
  }

  /**
   * Discordメッセージをコンテキストに変換
   */
  private messagesToContext(messages: Map<string, Message>): MessageContext[] {
    return Array.from(messages.values())
      .filter((m) => m.content && !m.content.startsWith('!'))
      .map((m) => ({
        authorId: m.author.id,
        authorName: m.author.username,
        content: m.content,
        timestamp: m.createdAt,
        isBot: m.author.bot,
      }))
      .reverse(); // 古い順に
  }

  /**
   * Botを起動
   */
  async start(): Promise<void> {
    console.log('Starting Memory Bot...');
    await this.client.login(this.config.token);
  }

  /**
   * Botを停止
   */
  async stop(): Promise<void> {
    console.log('Stopping Memory Bot...');
    this.state.isRunning = false;
    await this.client.destroy();
  }

  /**
   * Bot状態を取得
   */
  getState(): BotState {
    return { ...this.state };
  }
}
