import type { MemoryCategory } from '../github/types.js';

const CATEGORY_KEYWORDS: Record<MemoryCategory, string[]> = {
  daily: ['daily', '日記'],
  ideas: ['ideas', 'idea', 'アイデア'],
  research: ['research', '調査'],
  images: ['images', 'image', '画像'],
  logs: ['logs', 'log', '作業ログ'],
  schedule: ['schedule', '予定'],
  tasks: ['tasks', 'task', 'タスク'],
};

export function normalizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/[^\p{L}\p{N}\-_]/gu, '');
}

const CHAT_KEYWORDS = ['雑談', '一般', 'general', 'chat', 'random', 'おしゃべり', 'フリートーク'];
const NORMALIZED_CHAT_KEYWORDS = CHAT_KEYWORDS.map((kw) => normalizeChannelName(kw));

export function isChatChannel(channelName: string, chatChannelIds: readonly string[], channelId: string): boolean {
  if (chatChannelIds.includes(channelId)) return true;
  const normalized = normalizeChannelName(channelName);
  return NORMALIZED_CHAT_KEYWORDS.some((kw) => normalized.includes(kw));
}

export function detectCategoryFromChannel(channelName: string): MemoryCategory | null {
  const name = normalizeChannelName(channelName);
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (name.includes(keyword.toLowerCase())) {
        return category as MemoryCategory;
      }
    }
  }
  return null;
}
