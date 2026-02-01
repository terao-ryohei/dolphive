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
  Client,
  TextChannel,
} from 'discord.js';
import type { MemoryManager } from '../github/index.js';
import type { MemoryCategory, SearchResult } from '../github/types.js';
import { detectCategoryFromChannel } from './channel-category.js';
import { setReminder } from '../reminder.js';

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

export async function registerCommands(client: Client): Promise<void> {
  client.guilds.cache.forEach(async (guild) => {
    try {
      await guild.commands.set([commandData, deleteCommandData, editCommandData, remindCommandData]);
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
  const guildId = interaction.guildId ?? 'dm';
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

  const guildId = interaction.guildId ?? 'dm';
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
  const guildId = interaction.guildId ?? 'dm';
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
  const guildId = interaction.guildId ?? 'dm';
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
  const updates = field === 'tags'
    ? { tags: value.split(',').map((t) => t.trim()).filter((t) => t.length > 0) }
    : { [field]: value };

  const updated = await memoryManager.editMemory(guildId, target.path, updates);
  console.log('[KPI] edit_slash');

  const embed = formatSearchResultEmbed(updated)
    .setFooter({ text: `${field} を更新しました` });

  await interaction.editReply({ embeds: [embed] });
}

export async function handleRemindInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const message = interaction.options.getString('message', true);
  const minutes = interaction.options.getInteger('minutes', true);
  const guildId = interaction.guildId ?? 'dm';

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
