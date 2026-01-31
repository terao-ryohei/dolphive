import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  Client,
  TextChannel,
} from 'discord.js';
import type { MemoryManager } from '../github/index.js';
import type { MemoryCategory } from '../github/types.js';
import { detectCategoryFromChannel } from './channel-category.js';

export const ALL_CATEGORIES: MemoryCategory[] = [
  'daily',
  'ideas',
  'research',
  'images',
  'logs',
  'schedule',
  'tasks',
];

export const commandData = new SlashCommandBuilder()
  .setName('search')
  .setDescription('メモリを検索')
  .addStringOption((opt) =>
    opt.setName('query').setDescription('検索キーワード').setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName('category')
      .setDescription('カテゴリで絞り込み')
      .setRequired(false)
      .addChoices(...ALL_CATEGORIES.map((c) => ({ name: c, value: c })))
  );

export async function registerCommands(client: Client): Promise<void> {
  client.guilds.cache.forEach(async (guild) => {
    try {
      await guild.commands.set([commandData]);
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
  const results = await memoryManager.searchMemories(query, categories);

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

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (results.length > 5) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`search_more:${query}:${category ?? 'all'}:5`)
        .setLabel('もっと見る')
        .setStyle(ButtonStyle.Primary)
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

  const results = await memoryManager.searchMemories(query, categories);
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

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (offset + 5 < results.length) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`search_more:${query}:${categoryRaw}:${offset + 5}`)
        .setLabel('もっと見る')
        .setStyle(ButtonStyle.Primary)
    );
    components.push(row);
  }

  await interaction.update({ embeds, components });
}
