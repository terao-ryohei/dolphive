/**
 * メモリカテゴリ
 * - daily: 日記
 * - ideas: アイデア
 * - research: 調査結果
 * - images: 画像メモ
 * - logs: ログ
 * - schedule: スケジュール・予定
 * - tasks: タスク・TODO
 */
export type MemoryCategory = 'daily' | 'ideas' | 'research' | 'images' | 'logs' | 'schedule' | 'tasks';

/**
 * Markdown YAML frontmatter
 */
export interface MemoryFrontmatter {
  title: string;
  date: string;
  tags: string[];
  source: 'discord';
  type: MemoryCategory;
  summary: string;
  author_id?: string;
  drive_url?: string;
  // Schedule fields
  start_date?: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  // Task fields
  status?: 'todo' | 'doing' | 'done';
  due_date?: string;
  priority?: 'high' | 'medium' | 'low';
}

/**
 * メモリ作成時の入力
 */
export interface CreateMemoryInput {
  /** カテゴリ */
  category: MemoryCategory;
  /** タイトル */
  title: string;
  /** タグ配列 */
  tags: string[];
  /** 要約 */
  summary: string;
  /** 本文（Markdown） */
  content: string;
  /** Google DriveのURL（画像の場合） */
  driveUrl?: string;
  // Schedule fields
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  // Task fields
  status?: 'todo' | 'doing' | 'done';
  dueDate?: string;
  priority?: 'high' | 'medium' | 'low';
}

/**
 * 保存されたメモリの情報
 */
export interface SavedMemory {
  /** ファイルパス（memory/category/YYYY-MM-DD-uuid.md） */
  path: string;
  /** コミットSHA */
  sha: string;
  /** frontmatter */
  frontmatter: MemoryFrontmatter;
}

/**
 * GitHubクライアント設定
 */
export interface GitHubClientConfig {
  /** Personal Access Token */
  token: string;
  /** リポジトリオーナー */
  owner: string;
  /** リポジトリ名 */
  repo: string;
  templateOwner?: string;
  templateRepo?: string;
  repoPrivate?: boolean;
}

/**
 * ファイル作成結果
 */
export interface CreateFileResult {
  /** ファイルパス */
  path: string;
  /** コミットSHA */
  sha: string;
  /** コミットURL */
  commitUrl: string;
}

/**
 * ファイル情報
 */
export interface FileInfo {
  /** ファイル名 */
  name: string;
  /** ファイルパス */
  path: string;
  /** ファイルSHA */
  sha: string;
  /** ファイルサイズ */
  size: number;
  /** ダウンロードURL */
  downloadUrl: string | null;
}

/**
 * 検索結果
 */
export interface SearchResult {
  /** ファイルパス */
  path: string;
  /** frontmatter */
  frontmatter: MemoryFrontmatter;
  /** 本文 */
  content: string;
}
