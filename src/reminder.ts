import type { Client, TextChannel } from 'discord.js';
import { GitHubClient } from './github/client.js';
import type { GitHubClientConfig } from './github/types.js';

type ReminderEntry = {
  readonly id: string;
  readonly userId: string;
  readonly channelId: string;
  readonly message: string;
  readonly triggerTime: string;
  readonly createdAt: string;
};

type RemindersFile = {
  readonly reminders: ReminderEntry[];
};

const MAX_FIRE_PER_TICK = 10;

const getRemindersPath = (guildId: string): string =>
  `memory/${guildId}/.reminders.json`;

const DM_SCOPES_PATH = 'memory/.dm_reminder_scopes.json';

type DmScopesFile = {
  readonly scopes: string[];
};

const generateId = (): string =>
  `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let discordClient: Client | null = null;
let githubClient: GitHubClient | null = null;
let cache = new Map<string, ReminderEntry[]>();
let cacheLoaded = new Set<string>();
let intervalId: ReturnType<typeof setInterval> | null = null;

const getGithubClient = (): GitHubClient => {
  if (!githubClient) throw new Error('Reminder not initialized. Call initReminder first.');
  return githubClient;
};

const loadDmScopes = async (): Promise<string[]> => {
  const client = getGithubClient();
  const fileData = await client.getFile(DM_SCOPES_PATH);
  if (!fileData) return [];
  try {
    const parsed = JSON.parse(fileData.content) as DmScopesFile;
    return Array.isArray(parsed.scopes) ? parsed.scopes : [];
  } catch {
    return [];
  }
};

const addDmScope = async (scopeId: string): Promise<void> => {
  const client = getGithubClient();
  const fileData = await client.getFile(DM_SCOPES_PATH);
  let scopes: string[] = [];
  let sha: string | undefined;

  if (fileData) {
    sha = fileData.sha;
    try {
      const parsed = JSON.parse(fileData.content) as DmScopesFile;
      scopes = Array.isArray(parsed.scopes) ? parsed.scopes : [];
    } catch {
      scopes = [];
    }
  }

  if (scopes.includes(scopeId)) return;

  scopes.push(scopeId);
  const content = JSON.stringify({ scopes } satisfies DmScopesFile, null, 2);

  if (sha) {
    await client.updateFile(DM_SCOPES_PATH, content, 'Update DM reminder scopes', sha);
  } else {
    await client.createFile(DM_SCOPES_PATH, content, 'Create DM reminder scopes');
  }
};

const loadRemindersForGuild = async (guildId: string): Promise<ReminderEntry[]> => {
  if (cacheLoaded.has(guildId)) {
    return cache.get(guildId) ?? [];
  }

  const client = getGithubClient();
  const fileData = await client.getFile(getRemindersPath(guildId));

  let entries: ReminderEntry[] = [];
  if (fileData) {
    try {
      const parsed = JSON.parse(fileData.content) as RemindersFile;
      if (Array.isArray(parsed.reminders)) {
        entries = parsed.reminders;
      }
    } catch {
      entries = [];
    }
  }

  cache.set(guildId, entries);
  cacheLoaded.add(guildId);
  return entries;
};

const saveRemindersForGuild = async (guildId: string, entries: ReminderEntry[]): Promise<void> => {
  const client = getGithubClient();
  const path = getRemindersPath(guildId);
  const content = JSON.stringify({ reminders: entries } satisfies RemindersFile, null, 2);

  const existing = await client.getFile(path);
  if (existing) {
    await client.updateFile(path, content, 'Update reminders', existing.sha);
  } else {
    await client.createFile(path, content, 'Create reminders');
  }

  cache.set(guildId, entries);
};

/**
 * リマインダーモジュールを初期化
 */
export const initReminder = (client: Client, githubConfig: GitHubClientConfig): void => {
  discordClient = client;
  githubClient = new GitHubClient(githubConfig);
};

/**
 * 起動時に全ギルドのリマインダーをキャッシュに読み込む
 */
export const loadAllReminders = async (guildIds: string[]): Promise<void> => {
  const dmScopes = await loadDmScopes();
  const allIds = [...new Set([...guildIds, ...dmScopes])];
  await Promise.all(allIds.map((id) => loadRemindersForGuild(id)));
};

/**
 * 定期チェックを開始（60秒間隔）
 */
export const startReminderChecker = (): void => {
  if (intervalId) return;
  intervalId = setInterval(() => {
    checkAndFireReminders().catch((err) =>
      console.error('Reminder check error:', err),
    );
  }, 60_000);
};

/**
 * リマインダーを登録
 */
export const setReminder = async (params: {
  guildId: string;
  userId: string;
  channelId: string;
  message: string;
  triggerTime: Date;
}): Promise<void> => {
  if (params.guildId.startsWith('dm-')) {
    await addDmScope(params.guildId);
  }
  const entries = await loadRemindersForGuild(params.guildId);
  const newEntry: ReminderEntry = {
    id: generateId(),
    userId: params.userId,
    channelId: params.channelId,
    message: params.message,
    triggerTime: params.triggerTime.toISOString(),
    createdAt: new Date().toISOString(),
  };
  await saveRemindersForGuild(params.guildId, [...entries, newEntry]);
};

/**
 * 発火時刻を超えたリマインダーを検出して通知
 */
export const checkAndFireReminders = async (): Promise<void> => {
  if (!discordClient) return;

  const now = new Date();
  let fired = 0;

  for (const [guildId, entries] of cache) {
    if (fired >= MAX_FIRE_PER_TICK) break;

    const dueEntries = entries.filter((e) => new Date(e.triggerTime) <= now);
    if (dueEntries.length === 0) continue;

    const toFire = dueEntries.slice(0, MAX_FIRE_PER_TICK - fired);

    for (const entry of toFire) {
      await fireReminder(entry);
      fired++;
    }

    const firedIds = new Set(toFire.map((e) => e.id));
    const remaining = entries.filter((e) => !firedIds.has(e.id));
    await saveRemindersForGuild(guildId, remaining);
  }
};

const fireReminder = async (entry: ReminderEntry): Promise<void> => {
  if (!discordClient) return;

  const content = `⏰ <@${entry.userId}> リマインダー: ${entry.message}`;

  try {
    const channel = await discordClient.channels.fetch(entry.channelId);
    if (channel && 'send' in channel) {
      await (channel as TextChannel).send(content);
      return;
    }
  } catch {
    // channel send failed, fallback to DM
  }

  try {
    const user = await discordClient.users.fetch(entry.userId);
    await user.send(`⏰ リマインダー: ${entry.message}`);
  } catch (dmError) {
    console.error(`Failed to send reminder ${entry.id}:`, dmError);
  }
};

/**
 * ユーザーのリマインダー一覧取得
 */
export const listReminders = async (
  guildId: string,
  userId: string,
): Promise<ReadonlyArray<ReminderEntry>> => {
  const entries = await loadRemindersForGuild(guildId);
  return entries.filter((e) => e.userId === userId);
};

/**
 * リマインダーキャンセル
 */
export const cancelReminder = async (
  guildId: string,
  reminderId: string,
): Promise<boolean> => {
  const entries = await loadRemindersForGuild(guildId);
  const remaining = entries.filter((e) => e.id !== reminderId);
  if (remaining.length === entries.length) return false;
  await saveRemindersForGuild(guildId, remaining);
  return true;
};
