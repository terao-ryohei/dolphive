import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  SuccessButtonBuilder,
  DangerButtonBuilder,
  ComponentType,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import type { MemoryManager, CreateMemoryInput } from '../github/index.js';
import type { MemoryCategory } from '../github/types.js';
import type { AIClient, ConversationMessage } from '../ai/index.js';
import type { ImageAttachment } from '../ai/client.js';
import type { GeneratedMemory } from '../ai/types.js';
import { CommandHandler } from './commands.js';
import { detectCategoryFromChannel, isChatChannel } from './channel-category.js';
import { getScopeId } from './scope.js';
import { registerCommands, handleSearchInteraction, handleSearchButton, handleDeleteInteraction, handleEditInteraction, handleRemindInteraction } from './slash-commands.js';
import { initReminder, loadAllReminders, startReminderChecker } from '../reminder.js';
import type { GitHubClientConfig } from '../github/types.js';
import type { BotConfig, BotState, MessageContext } from './types.js';

/**
 * Discord Memory Bot
 */
export class MemoryBot {
  private client: Client;
  private config: BotConfig;
  private githubConfig: GitHubClientConfig;
  private memoryManager: MemoryManager;
  private aiClient: AIClient;
  private commandHandler: CommandHandler;
  private state: BotState;
  private pendingMemories: Map<string, { memory: GeneratedMemory; message: Message }> = new Map();
  private chatCooldowns: Map<string, number> = new Map();
  private static readonly CHAT_COOLDOWN_MS = 3000;

  constructor(
    config: BotConfig,
    memoryManager: MemoryManager,
    aiClient: AIClient,
    githubConfig: GitHubClientConfig,
  ) {
    this.config = config;
    this.githubConfig = githubConfig;
    this.memoryManager = memoryManager;
    this.aiClient = aiClient;
    this.commandHandler = new CommandHandler(memoryManager, aiClient, this.handleAutoSaveWithPreview.bind(this));
    this.state = {
      isRunning: false,
      pendingRequests: 0,
    };

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });

    this.setupEventHandlers();
  }

  /**
   * イベントハンドラを設定
   */
  private setupEventHandlers(): void {
    this.client.on('ready', async () => {
      console.log(`Logged in as ${this.client.user?.tag}`);
      this.state.isRunning = true;
      try {
        await registerCommands(this.client);
      } catch (error) {
        console.error('Failed to register slash commands:', error);
      }
      try {
        initReminder(this.client, this.githubConfig);
        const guildIds = Array.from(this.client.guilds.cache.keys());
        await loadAllReminders(guildIds);
        startReminderChecker();
        console.log('Reminder system initialized.');
      } catch (error) {
        console.error('Failed to initialize reminder system:', error);
      }
    });

    this.client.on('messageCreate', async (message) => {
      await this.handleMessage(message);
    });

    this.client.on('error', (error) => {
      console.error('Discord client error:', error);
      this.state.lastError = error;
    });

    // (A) サーバー招待時の自動挨拶
    this.client.on('guildCreate', async (guild) => {
      try {
        let channel = guild.systemChannel;
        if (!channel) {
          channel = guild.channels.cache.find(
            (ch) =>
              ch.type === ChannelType.GuildText &&
              ch.permissionsFor(guild.members.me!)?.has(PermissionFlagsBits.SendMessages) === true
          ) as TextChannel | undefined ?? null;
        }
        if (!channel) {
          console.warn(`No writable channel found in guild ${guild.id}`);
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('🐬 Dolphive へようこそ！')
          .setDescription(
            '🔍 `/search キーワード` で過去のメモを検索\n' +
            '📝 カテゴリ名チャンネル（#daily, #ideas 等）での発言は自動保存\n' +
            '💾 `!save` で会話を手動保存'
          )
          .setFooter({ text: '詳しくは !help で確認できます' })
          .setColor(0x00bfff);
        await channel.send({ embeds: [embed] });
        console.log(`[KPI] greeting_sent:${guild.id}`);
      } catch (error) {
        console.error('guildCreate greeting error:', error);
      }
    });

    // (D-3) 絵文字リアクションで保存トリガー
    this.client.on('messageReactionAdd', async (reaction, user) => {
      try {
        if (reaction.emoji.name !== '📝') return;
        if (reaction.partial) reaction = await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();
        if (user.bot) return;
        console.log('[KPI] save_reaction');
        await this.handleAutoSaveWithPreview(reaction.message as Message);
      } catch (error) {
        console.error('Reaction save error:', error);
      }
    });

    // interactionCreate（スラッシュコマンド + ボタン）
    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'search') {
          await handleSearchInteraction(interaction, this.memoryManager);
        } else if (interaction.commandName === 'delete') {
          await handleDeleteInteraction(interaction, this.memoryManager);
        } else if (interaction.commandName === 'edit') {
          await handleEditInteraction(interaction, this.memoryManager);
        } else if (interaction.commandName === 'remind') {
          await handleRemindInteraction(interaction);
        }
        return;
      }

      if (!interaction.isButton()) return;

      if (interaction.customId.startsWith('search_more:')) {
        await handleSearchButton(interaction, this.memoryManager);
        return;
      }

      const customId = interaction.customId;
      if (customId.startsWith('save_confirm:')) {
        const messageId = customId.slice('save_confirm:'.length);
        const pending = this.pendingMemories.get(messageId);
        if (!pending) {
          await interaction.reply({ content: 'この保存リクエストは期限切れです。', flags: [MessageFlags.Ephemeral] });
          return;
        }
        if (interaction.user.id !== pending.message.author.id) {
          await interaction.reply({ content: 'この操作は実行できません。', flags: [MessageFlags.Ephemeral] });
          return;
        }
        this.pendingMemories.delete(messageId);
        try {
          console.log('[KPI] save_attempt');
          const guildId = getScopeId(pending.message.guild?.id, pending.message.author.id);
          const saved = await this.memoryManager.saveMemory({
            category: pending.memory.category,
            title: pending.memory.title,
            tags: pending.memory.tags,
            summary: pending.memory.summary,
            content: pending.memory.content,
            startDate: pending.memory.startDate,
            endDate: pending.memory.endDate,
            startTime: pending.memory.startTime,
            endTime: pending.memory.endTime,
            location: pending.memory.location,
            recurring: pending.memory.recurring as CreateMemoryInput['recurring'],
            status: pending.memory.status as CreateMemoryInput['status'],
            dueDate: pending.memory.dueDate,
            priority: pending.memory.priority as CreateMemoryInput['priority'],
          }, guildId, pending.message.author.id);
          console.log('[KPI] save_success');
          await interaction.update({
            content:
              `📁 **${pending.memory.category}** として保存しました\n` +
              `**${pending.memory.title}** | ${pending.memory.tags.join(', ')}\n\n` +
              `🔍 検索: \`/search キーワード\`\n` +
              `📋 最近のメモ: \`!recent\`\n` +
              `📁 カテゴリ一覧: \`!categories\``,
            embeds: [],
            components: [],
          });
        } catch (error) {
          await interaction.update({
            content: this.formatUserFacingError(error),
            embeds: [],
            components: [],
          });
        }
      } else if (customId.startsWith('save_cancel:')) {
        const messageId = customId.slice('save_cancel:'.length);
        const pendingCancel = this.pendingMemories.get(messageId);
        if (pendingCancel && interaction.user.id !== pendingCancel.message.author.id) {
          await interaction.reply({ content: 'この操作は実行できません。', flags: [MessageFlags.Ephemeral] });
          return;
        }
        this.pendingMemories.delete(messageId);
        await interaction.update({ content: '保存をキャンセルしました。', embeds: [], components: [] });
      }
    });
  }

  /**
   * メッセージハンドラ
   */
  private async handleMessage(message: Message): Promise<void> {
    // 自分自身のメッセージは無視
    if (message.author.bot) return;

    // 指定チャンネルがある場合、それ以外は無視（DMは通す）
    if (this.config.channelId && message.guild && message.channel.id !== this.config.channelId) return;

    const content = message.content.trim();

    // コマンド処理
    if (content.startsWith('!')) {
      const [command, ...args] = content.slice(1).split(/\s+/);
      await this.commandHandler.execute(message, command.toLowerCase(), args);
      return;
    }

    // チャンネル名カテゴリ判定（サーバーのみ、DMではスキップ）
    if (message.guild) {
      const category = detectCategoryFromChannel((message.channel as TextChannel).name);
      if (category) {
        console.log('[KPI] save_auto');
        await this.handleAutoSaveWithPreview(message, category);
        return;
      }
    }

    // 会話応答チャンネル判定（排他条件: コマンド/カテゴリは上で処理済み、GuildTextのみ）
    if (message.guild && message.channel.type === ChannelType.GuildText &&
        isChatChannel((message.channel as TextChannel).name, this.config.chatChannelIds, message.channel.id)) {
      const decision = await this.aiClient.shouldSaveMemory(message.content);
      if (decision.shouldSave) {
        console.log(`[KPI] chat_channel_save_trigger: ${decision.reason}`);
        await this.handleAutoSaveWithPreview(message);
        return;
      }
      await this.handleChatResponse(message);
      return;
    }

    // 自動保存トリガー検出（従来フロー）
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
      await this.handleAutoSaveWithPreview(message);
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

  private async handleAutoSaveWithPreview(message: Message, category?: MemoryCategory, excludeCurrentMessage?: boolean): Promise<void> {
    try {
      const channel = message.channel as TextChannel;
      const messages = await channel.messages.fetch({ limit: 20, before: message.id });
      const context = this.messagesToContext(messages);

      if (!excludeCurrentMessage) {
        context.push({
          authorId: message.author.id,
          authorName: message.author.username,
          content: message.content,
          timestamp: message.createdAt,
          isBot: false,
        });
      }

      if (context.length === 0) return;

      // 画像添付ファイルのメタデータ抽出
      const imageAttachments: ImageAttachment[] = Array.from(message.attachments.values())
        .filter(a => a.contentType?.startsWith('image/'))
        .map(a => ({
          url: a.url,
          filename: a.name ?? 'unknown',
          size: a.size,
          contentType: a.contentType ?? 'image/unknown',
        }));

      this.state.pendingRequests++;
      try {
        const memory = await this.aiClient.generateMemory({
          username: message.author.username,
          messages: context.map((c) => ({
            role: c.isBot ? 'bot' : 'user',
            content: c.content,
            timestamp: c.timestamp,
          } as ConversationMessage)),
        }, imageAttachments.length > 0 ? imageAttachments : undefined);

        if (category) {
          memory.category = category;
        }

        this.pendingMemories.set(message.id, { memory, message });

        const embed = new EmbedBuilder()
          .setTitle(memory.title)
          .addFields(
            { name: 'カテゴリ', value: memory.category, inline: true },
            { name: 'タグ', value: memory.tags.join(', ') || 'なし', inline: true },
          )
          .setDescription(memory.summary)
          .setColor(0x00bfff);

        const row = new ActionRowBuilder().addComponents(
          new SuccessButtonBuilder().setCustomId(`save_confirm:${message.id}`).setLabel('💾 保存'),
          new DangerButtonBuilder().setCustomId(`save_cancel:${message.id}`).setLabel('❌ キャンセル'),
        );

        const reply = await message.reply({ embeds: [embed], components: [row] });

        try {
          await reply.awaitMessageComponent({
            componentType: ComponentType.Button,
            time: 30_000,
            filter: (i) => i.user.id === message.author.id,
          });
        } catch {
          // タイムアウト
          this.pendingMemories.delete(message.id);
          await reply.edit({ content: '保存をキャンセルしました（タイムアウト）。', embeds: [], components: [] });
        }
      } finally {
        this.state.pendingRequests--;
      }
    } catch (error) {
      console.error('Auto-save with preview error:', error);
      await message.reply(this.formatUserFacingError(error));
    }
  }

  private formatUserFacingError(error: unknown): string {
    if (error instanceof Error && 'status' in error) {
      const status = (error as { status: number }).status;
      if (status === 403) return 'Botに必要な権限を付与してください: メッセージ送信、埋め込みリンク';
      if (status === 401) return 'GITHUB_TOKENの有効期限を確認してください';
      if (status === 429) {
        const retryAfter = (error as { retryAfter?: number }).retryAfter
          ?? (error as { retry_after?: number }).retry_after;
        if (retryAfter) return `しばらくお待ちください。約${retryAfter}秒後に再試行できます`;
        return 'しばらくお待ちください。時間を置いて再試行してください';
      }
    }
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return `保存に失敗しました: ${msg}`;
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
   * 会話応答を処理
   */
  private async handleChatResponse(message: Message): Promise<void> {
    try {
      // クールダウン制御
      const now = Date.now();
      const lastResponse = this.chatCooldowns.get(message.channel.id);
      if (lastResponse && now - lastResponse < MemoryBot.CHAT_COOLDOWN_MS) {
        return;
      }

      console.log(`[KPI] chat_response_attempt channel:${message.channel.id}`);

      // 直近15メッセージを会話コンテキストとして取得
      const channel = message.channel as TextChannel;
      const recentMessages = await channel.messages.fetch({ limit: 15, before: message.id });
      const conversationHistory: { role: 'user' | 'assistant'; content: string }[] = Array.from(recentMessages.values())
        .filter((m) => m.content)
        .reverse()
        .map((m) => ({
          role: m.author.bot ? 'assistant' as const : 'user' as const,
          content: m.content,
        }));

      // RAG: memoryManager で関連メモリを検索（上限3件）
      const guildId = getScopeId(message.guild?.id, message.author.id);
      const searchResults = await this.memoryManager.searchMemories(message.content, guildId);
      const relatedMemories = searchResults.slice(0, 3).map((r) => ({
        title: r.frontmatter.title,
        summary: r.frontmatter.summary,
        category: r.frontmatter.type,
      }));

      // AI応答生成
      const response = await this.aiClient.generateChatResponse(
        message.content,
        conversationHistory,
        relatedMemories,
      );

      await message.reply(response.content);
      this.chatCooldowns.set(message.channel.id, Date.now());

      console.log(`[KPI] chat_response_success memories_used:${relatedMemories.length}`);
    } catch (error) {
      console.error('Chat response error:', error);
    }
  }

  /**
   * Bot状態を取得
   */
  getState(): BotState {
    return { ...this.state };
  }
}
