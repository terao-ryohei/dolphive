import type { MemoryCategory } from '../github/types.js';

const CATEGORY_KEYWORDS: Record<MemoryCategory, string[]> = {
  daily: ['daily'],
  ideas: ['ideas', 'idea'],
  research: ['research'],
  schedule: ['schedule'],
  tasks: ['tasks', 'task'],
  logs: ['logs', 'log'],
  images: ['images', 'image'],
};

export function detectCategoryFromChannel(channelName: string): MemoryCategory | null {
  const name = channelName.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (name.includes(keyword.toLowerCase())) {
        return category as MemoryCategory;
      }
    }
  }
  return null;
}
