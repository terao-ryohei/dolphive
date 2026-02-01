import {
  ChatInputCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  PrimaryButtonBuilder,
  SuccessButtonBuilder,
  DangerButtonBuilder,
  ButtonInteraction,
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  Client,
  TextChannel,
} from 'discord.js';
import type { MemoryManager, CreateMemoryInput } from '../github/index.js';
import type { MemoryCategory, SearchResult } from '../github/types.js';
import type { AIClient, ConversationMessage } from '../ai/index.js';
import type { ImageAttachment } from '../ai/client.js';
import type { GeneratedMemory } from '../ai/types.js';
import { detectCategoryFromChannel } from './channel-category.js';
import { setReminder } from '../reminder.js';
import { getScopeId } from './scope.js';

export const ALL_CATEGORIES: MemoryCategory[] = [
  'daily',
  'ideas',
  'research',
  'images',
  'logs',
  'schedule',
  'tasks',
];

export const commandData = new ChatInputCommandBuilder()
  .setName('search')
  .setDescription('メモリを検索')
  .addStringOptions((opt) =>
    opt.setName('query').setDescription('検索キーワード').setRequired(true)
  )
  .addStringOptions((opt) =>
    opt
      .setName('category')
      .setDescription('カテゴリで絞り込み')
      .setRequired(false)
      .addChoices(...ALL_CATEGORIES.map((c) => ({ name: c, value: c })))
  );

export const deleteCommandData = new ChatInputCommandBuilder()
  .setName('delete')
  .setDescription('メモリを削除')
  .addStringOptions((opt) =>
    opt.setName('keyword').setDescription('削除するメモリの検索キーワード').setRequired(true)
  );

export const editCommandData = new ChatInputCommandBuilder()
  .setName('edit')
  .setDescription('メモリを編集')
  .addStringOptions((opt) =>
    opt.setName('keyword').setDescription('編集するメモリの検索キーワード').setRequired(true)
  )
  .addStringOptions((opt) =>
    opt
      .setName('field')
      .setDescription('編集するフィールド')
      .setRequired(true)
      .addChoices(
        { name: 'title', value: 'title' },
        { name: 'summary', value: 'summary' },
        { name: 'tags', value: 'tags' },
      )
  )
  .addStringOptions((opt) =>
    opt.setName('value').setDescription('新しい値（tagsの場合はカンマ区切り）').setRequired(true)
  );

export const remindCommandData = new ChatInputCommandBuilder()
  .setName('remind')
  .setDescription('リマインダーを設定')
  .addStringOptions((opt) =>
    opt.setName('message').setDescription('リマインド内容').setRequired(true)
  )
  .addIntegerOptions((opt) =>
    opt.setName('minutes').setDescription('何分後にリマインドするか（1～10080）').setRequired(true).setMinValue(1).setMaxValue(10080)
  );

export const saveCommandData = new ChatInputCommandBuilder()
  .setName('save')
  .setDescription('直前の会話をメモリとして保存')
  .addStringOptions((opt) =>
    opt
      .setName('category')
      .setDescription('カテゴリを指定（省略時は自動判定）')
      .setRequired(false)
      .addChoices(...ALL_CATEGORIES.map((c) => ({ name: c, value: c })))
  );

export const recentCommandData = new ChatInputCommandBuilder()
  .setName('recent')
  .setDescription('最近のメモリを表示');

export const categoriesCommandData = new ChatInputCommandBuilder()
  .setName('categories')
  .setDescription('カテゴリ別メモリ件数を表示');

export const helpCommandData = new ChatInputCommandBuilder()
  .setName('help')
  .setDescription('コマンド一覧・使い方を表示');

export async function registerCommands(client: Client): Promise<void> {
  client.guilds.cache.forEach(async (guild) => {
    try {
      await guild.commands.set([
        commandData, deleteCommandData, editCommandData, remindCommandData,
        saveCommandData, recentCommandData, categoriesCommandData, helpCommandData,
      ]);
      console.log(`Registered slash commands for guild: ${guild.name}`);
    } catch (error) {
      console.error(
        `Failed to register commands for guild ${guild.name}:`,
        error
      );
    }
  });
}

export async function handleSearchInteraction(
  interaction: ChatInputCommandInteraction,
  memoryManager: MemoryManager
): Promise<void> {
  await interaction.deferReply();

  const query = interaction.options.getString('query', true);
  let category = interaction.options.getString('category') as
    | MemoryCategory
    | null;

  if (!category && interaction.channel instanceof TextChannel) {
    category = detectCategoryFromChannel(interaction.channel.name);
  }

  const categories = category ? [category] : undefined;
  const guildId = getScopeId(interaction.guildId, interaction.user.id);
  const results = await memoryManager.searchMemories(query, guildId, categories);

  console.log('[KPI] search_slash');

  if (results.length === 0) {
    await interaction.editReply('該当するメモリが見つかりませんでした。');
    return;
  }

  const embeds = results.slice(0, 5).map((r) =>
    new EmbedBuilder()
      .setTitle(r.frontmatter.title)
      .setDescription(r.frontmatter.summary)
      .addFields(
        { name: 'カテゴリ', value: r.frontmatter.type, inline: true },
        { name: '日付', value: r.frontmatter.date, inline: true }
      )
  );

  const components: ActionRowBuilder[] = [];

  if (results.length > 5) {
    const row = new ActionRowBuilder().addComponents(
      new PrimaryButtonBuilder()
        .setCustomId(`search_more:${query}:${category ?? 'all'}:5`)
        .setLabel('もっと見る')
    );
    components.push(row);
  }

  await interaction.editReply({ embeds, components });
}

export async function handleSearchButton(
  interaction: ButtonInteraction,
  memoryManager: MemoryManager
): Promise<void> {
  const parts = interaction.customId.split(':');
  const query = parts[1];
  const categoryRaw = parts[2];
  const offset = parseInt(parts[3], 10);

  const category: MemoryCategory | undefined =
    categoryRaw === 'all' ? undefined : (categoryRaw as MemoryCategory);
  const categories = category ? [category] : undefined;

  const guildId = getScopeId(interaction.guildId, interaction.user.id);
  const results = await memoryManager.searchMemories(query, guildId, categories);
  const page = results.slice(offset, offset + 5);

  const embeds = page.map((r) =>
    new EmbedBuilder()
      .setTitle(r.frontmatter.title)
      .setDescription(r.frontmatter.summary)
      .addFields(
        { name: 'カテゴリ', value: r.frontmatter.type, inline: true },
        { name: '日付', value: r.frontmatter.date, inline: true }
      )
  );

  const components: ActionRowBuilder[] = [];

  if (offset + 5 < results.length) {
    const row = new ActionRowBuilder().addComponents(
      new PrimaryButtonBuilder()
        .setCustomId(`search_more:${query}:${categoryRaw}:${offset + 5}`)
        .setLabel('もっと見る')
    );
    components.push(row);
  }

  await interaction.update({ embeds, components });
}

function formatSearchResultEmbed(r: SearchResult): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(r.frontmatter.title)
    .setDescription(r.frontmatter.summary)
    .addFields(
      { name: 'カテゴリ', value: r.frontmatter.type, inline: true },
      { name: '日付', value: r.frontmatter.date, inline: true },
    )
    .setColor(0x00bfff);
}

export async function handleDeleteInteraction(
  interaction: ChatInputCommandInteraction,
  memoryManager: MemoryManager
): Promise<void> {
  await interaction.deferReply();

  const keyword = interaction.options.getString('keyword', true);
  const guildId = getScopeId(interaction.guildId, interaction.user.id);
  const results = await memoryManager.searchMemories(keyword, guildId);

  if (results.length === 0) {
    await interaction.editReply('該当するメモリが見つかりませんでした。');
    return;
  }

  if (results.length > 1) {
    const list = results.slice(0, 10).map((r, i) =>
      `${i + 1}. **${r.frontmatter.title}** (${r.frontmatter.type}, ${r.frontmatter.date})`
    ).join('\n');
    await interaction.editReply(
      `複数のメモリが見つかりました（${results.length}件）。キーワードを絞り込んでください。\n\n${list}`
    );
    return;
  }

  const target = results[0];
  const authorId = target.frontmatter.author_id;
  const isAuthor = authorId === interaction.user.id;
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  const isDm = !interaction.guildId;

  if (authorId && !isAuthor && !isAdmin) {
    await interaction.editReply('このメモリを削除する権限がありません。作成者本人または管理者のみ削除できます。');
    return;
  }
  if (!authorId && !isAdmin && !isDm) {
    await interaction.editReply('author_id未設定の既存メモリは管理者のみ削除できます。');
    return;
  }

  const embed = formatSearchResultEmbed(target)
    .setFooter({ text: `パス: ${target.path}` });

  const row = new ActionRowBuilder().addComponents(
    new SuccessButtonBuilder().setCustomId('delete_confirm').setLabel('削除する'),
    new DangerButtonBuilder().setCustomId('delete_cancel').setLabel('キャンセル'),
  );

  const reply = await interaction.editReply({ embeds: [embed], components: [row] });

  try {
    const btnInteraction = await reply.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 30_000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    if (btnInteraction.customId === 'delete_confirm') {
      await memoryManager.deleteMemory(guildId, target.path);
      console.log('[KPI] delete_slash');
      await btnInteraction.update({
        content: `**${target.frontmatter.title}** を削除しました。`,
        embeds: [],
        components: [],
      });
    } else {
      await btnInteraction.update({
        content: '削除をキャンセルしました。',
        embeds: [],
        components: [],
      });
    }
  } catch {
    await interaction.editReply({
      content: '削除をキャンセルしました（タイムアウト）。',
      embeds: [],
      components: [],
    });
  }
}

export async function handleEditInteraction(
  interaction: ChatInputCommandInteraction,
  memoryManager: MemoryManager
): Promise<void> {
  await interaction.deferReply();

  const keyword = interaction.options.getString('keyword', true);
  const field = interaction.options.getString('field', true) as 'title' | 'summary' | 'tags';
  const value = interaction.options.getString('value', true);
  const guildId = getScopeId(interaction.guildId, interaction.user.id);
  const results = await memoryManager.searchMemories(keyword, guildId);

  if (results.length === 0) {
    await interaction.editReply('該当するメモリが見つかりませんでした。');
    return;
  }

  if (results.length > 1) {
    const list = results.slice(0, 10).map((r, i) =>
      `${i + 1}. **${r.frontmatter.title}** (${r.frontmatter.type}, ${r.frontmatter.date})`
    ).join('\n');
    await interaction.editReply(
      `複数のメモリが見つかりました（${results.length}件）。キーワードを絞り込んでください。\n\n${list}`
    );
    return;
  }

  const target = results[0];
  const editAuthorId = target.frontmatter.author_id;
  const isEditAuthor = editAuthorId === interaction.user.id;
  const isEditAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  const isEditDm = !interaction.guildId;

  if (editAuthorId && !isEditAuthor && !isEditAdmin) {
    await interaction.editReply('このメモリを編集する権限がありません。作成者本人または管理者のみ編集できます。');
    return;
  }
  if (!editAuthorId && !isEditAdmin && !isEditDm) {
    await interaction.editReply('author_id未設定の既存メモリは管理者のみ編集できます。');
    return;
  }

  const updates = field === 'tags'
    ? { tags: value.split(',').map((t) => t.trim()).filter((t) => t.length > 0) }
    : { [field]: value };

  const updated = await memoryManager.editMemory(guildId, target.path, updates);
  console.log('[KPI] edit_slash');

  const embed = formatSearchResultEmbed(updated)
    .setFooter({ text: `${field} を更新しました` });

  await interaction.editReply({ embeds: [embed] });
}

export async function handleSaveInteraction(
  interaction: ChatInputCommandInteraction,
  memoryManager: MemoryManager,
  aiClient: AIClient,
): Promise<void> {
  await interaction.deferReply();

  const categoryOverride = interaction.options.getString('category') as MemoryCategory | null;
  const channel = interaction.channel;

  if (!channel || !('messages' in channel)) {
    await interaction.editReply('このチャンネルでは保存機能を使用できません。');
    return;
  }

  console.log('[KPI] save_slash');

  const messages = await (channel as TextChannel).messages.fetch({ limit: 20 });
  const context = Array.from(messages.values())
    .filter((m) => m.content && !m.author.bot)
    .reverse()
    .map((m) => ({
      authorId: m.author.id,
      authorName: m.author.username,
      content: m.content,
      timestamp: m.createdAt,
      isBot: false,
    }));

  if (context.length === 0) {
    await interaction.editReply('保存できるメッセージが見つかりませんでした。');
    return;
  }

  const latestUserMessage = messages.find((m) => !m.author.bot);
  const imageAttachments: ImageAttachment[] = latestUserMessage
    ? Array.from(latestUserMessage.attachments.values())
        .filter(a => a.contentType?.startsWith('image/'))
        .map(a => ({
          url: a.url,
          filename: a.name ?? 'unknown',
          size: a.size,
          contentType: a.contentType ?? 'image/unknown',
        }))
    : [];

  const memory = await aiClient.generateMemory({
    username: interaction.user.username,
    messages: context.map((c) => ({
      role: 'user' as const,
      content: c.content,
      timestamp: c.timestamp,
    } as ConversationMessage)),
  }, imageAttachments.length > 0 ? imageAttachments : undefined);

  if (categoryOverride) {
    memory.category = categoryOverride;
  }

  const guildId = getScopeId(interaction.guildId, interaction.user.id);
  await memoryManager.saveMemory({
    category: memory.category,
    title: memory.title,
    tags: memory.tags,
    summary: memory.summary,
    content: memory.content,
    startDate: memory.startDate,
    endDate: memory.endDate,
    startTime: memory.startTime,
    endTime: memory.endTime,
    location: memory.location,
    recurring: memory.recurring as CreateMemoryInput['recurring'],
    status: memory.status as CreateMemoryInput['status'],
    dueDate: memory.dueDate,
    priority: memory.priority as CreateMemoryInput['priority'],
  }, guildId, interaction.user.id);

  console.log('[KPI] save_success');

  await interaction.editReply(
    `📁 **${memory.category}** として保存しました\n` +
    `**${memory.title}** | ${memory.tags.join(', ')}\n\n` +
    `🔍 検索: \`/search キーワード\`\n` +
    `📋 最近のメモ: \`/recent\`\n` +
    `📁 カテゴリ一覧: \`/categories\``
  );
}

export async function handleRecentInteraction(
  interaction: ChatInputCommandInteraction,
  memoryManager: MemoryManager,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = getScopeId(interaction.guildId, interaction.user.id);
  const results = await memoryManager.getRecentMemories(guildId, 5);

  if (results.length === 0) {
    await interaction.editReply('メモリがまだありません。');
    return;
  }

  const embeds = results.map((r) => formatSearchResultEmbed(r));
  await interaction.editReply({ embeds });
}

export async function handleCategoriesInteraction(
  interaction: ChatInputCommandInteraction,
  memoryManager: MemoryManager,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const categoryEmoji: Record<MemoryCategory, string> = {
    daily: '📅',
    ideas: '💡',
    research: '🔬',
    images: '🖼️',
    logs: '📋',
    schedule: '🗓️',
    tasks: '✅',
  };

  const guildId = getScopeId(interaction.guildId, interaction.user.id);

  const memoriesByCategory = await Promise.all(
    ALL_CATEGORIES.map(async (category) => ({
      category,
      count: (await memoryManager.listMemories(category, guildId)).length,
    })),
  );

  const total = memoriesByCategory.reduce((sum, c) => sum + c.count, 0);

  if (total === 0) {
    await interaction.editReply('保存されたメモリがまだありません。`/save` でメモリを保存してみましょう。');
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

  await interaction.editReply({ embeds: [embed] });
}

export async function handleHelpInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const helpText =
    '**Dolphive コマンド一覧**\n\n' +
    '`/save [category]` — 直前の会話をメモリとして保存\n' +
    '`/search <query> [category]` — メモリを検索\n' +
    '`/recent` — 最近のメモリを表示\n' +
    '`/categories` — カテゴリ別メモリ件数を表示\n' +
    '`/delete <keyword>` — メモリを削除（1件一致時）\n' +
    '`/edit <keyword> <field> <value>` — メモリを編集\n' +
    '`/remind <message> <minutes>` — リマインダーを設定\n' +
    '`/help` — このヘルプを表示\n\n' +
    '**自動保存トリガー**\n' +
    '「覚えておいて」「メモして」等のキーワードで自動保存\n' +
    '📝 リアクションでも保存できます';

  await interaction.reply({ content: helpText, flags: MessageFlags.Ephemeral });
}

export async function handleRemindInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const message = interaction.options.getString('message', true);
  const minutes = interaction.options.getInteger('minutes', true);
  const guildId = getScopeId(interaction.guildId, interaction.user.id);

  const triggerTime = new Date(Date.now() + minutes * 60_000);

  await setReminder({
    guildId,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    message,
    triggerTime,
  });

  console.log('[KPI] remind_slash');

  const embed = new EmbedBuilder()
    .setTitle('⏰ リマインダー設定完了')
    .addFields(
      { name: '内容', value: message },
      { name: 'リマインド時刻', value: `${minutes}分後（${triggerTime.toLocaleString('ja-JP')}）` },
    )
    .setColor(0x00bfff);

  await interaction.editReply({ embeds: [embed] });
}
