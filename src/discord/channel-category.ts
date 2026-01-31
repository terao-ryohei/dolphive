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

function normalizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/[^\p{L}\p{N}\-_]/gu, '');
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
