import { format } from 'date-fns';
import { uuidv7 } from 'uuidv7';
import { GitHubClient } from './client.js';
import type {
  MemoryCategory,
  MemoryFrontmatter,
  CreateMemoryInput,
  SavedMemory,
  SearchResult,
  GitHubClientConfig,
} from './types.js';

const MEMORY_BASE_PATH = 'memory';
const ALL_CATEGORIES: MemoryCategory[] = ['daily', 'ideas', 'research', 'images', 'logs', 'schedule', 'tasks'];
const INDEX_VERSION = 1;

type MemoryIndexEntry = {
  readonly path: string;
  readonly category: MemoryCategory;
  readonly title: string;
  readonly tags: readonly string[];
  readonly date: string;
  readonly summary: string;
};

type MemoryIndex = {
  readonly version: number;
  readonly entries: MemoryIndexEntry[];
};

export type MemoryUpdate = {
  readonly title?: string;
  readonly summary?: string;
  readonly tags?: string[];
  readonly content?: string;
};

const getMemoryBasePath = (guildId: string): string =>
  `${MEMORY_BASE_PATH}/${guildId}`;

const getLegacyBasePath = (): string => MEMORY_BASE_PATH;

const getIndexPath = (guildId: string): string =>
  `${getMemoryBasePath(guildId)}/.index.json`;

const createEmptyIndex = (): MemoryIndex => ({
  version: INDEX_VERSION,
  entries: [],
});

/**
 * メモリマネージャ
 * AIの出力をMarkdownに変換してGitHubにコミット
 */
export class MemoryManager {
  private client: GitHubClient;

  constructor(config: GitHubClientConfig) {
    this.client = new GitHubClient(config);
  }

  async ensureRepo(): Promise<void> {
    await this.client.ensureRepo();
  }

  /**
   * メモリを保存
   * 新規保存は常に memory/{guildId}/{category}/ に書き込む
   */
  async saveMemory(input: CreateMemoryInput, guildId: string): Promise<SavedMemory> {
    const date = new Date();
    const filePath = this.generateFilePath(input.category, date, guildId);
    const frontmatter = this.createFrontmatter(input, date);
    const markdown = this.formatMarkdown(frontmatter, input.content);

    const commitMessage = `Add ${input.category}: ${input.title}`;
    const result = await this.client.createFile(filePath, markdown, commitMessage);

    await this.addToIndex(guildId, {
      path: result.path,
      category: input.category,
      title: input.title,
      tags: input.tags,
      date: frontmatter.date,
      summary: input.summary,
    });

    return {
      path: result.path,
      sha: result.sha,
      frontmatter,
    };
  }

  /**
   * メモリを削除
   */
  async deleteMemory(guildId: string, memoryPath: string): Promise<void> {
    const fileData = await this.client.getFile(memoryPath);
    if (!fileData) {
      throw new Error(`Memory not found: ${memoryPath}`);
    }

    await this.client.deleteFile(memoryPath, `Delete memory: ${memoryPath}`, fileData.sha);
    await this.removeFromIndex(guildId, memoryPath);
  }

  /**
   * メモリを編集
   */
  async editMemory(guildId: string, memoryPath: string, updates: MemoryUpdate): Promise<SearchResult> {
    const fileData = await this.client.getFile(memoryPath);
    if (!fileData) {
      throw new Error(`Memory not found: ${memoryPath}`);
    }

    const parsed = this.parseMarkdown(fileData.content);
    if (!parsed) {
      throw new Error(`Failed to parse memory: ${memoryPath}`);
    }

    const newFrontmatter: MemoryFrontmatter = {
      ...parsed.frontmatter,
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.summary !== undefined && { summary: updates.summary }),
      ...(updates.tags !== undefined && { tags: updates.tags }),
    };
    const newContent = updates.content ?? parsed.content;
    const newMarkdown = this.formatMarkdown(newFrontmatter, newContent);

    await this.client.updateFile(
      memoryPath,
      newMarkdown,
      `Edit memory: ${newFrontmatter.title}`,
      fileData.sha,
    );

    await this.updateIndexEntry(guildId, memoryPath, {
      title: newFrontmatter.title,
      tags: newFrontmatter.tags,
      summary: newFrontmatter.summary,
    });

    return { path: memoryPath, frontmatter: newFrontmatter, content: newContent };
  }

  /**
   * ファイルパスを生成
   * 形式: memory/{guildId}/{category}/{YYYY-MM-DD}-{uuid}.md
   */
  generateFilePath(category: MemoryCategory, date: Date, guildId: string): string {
    const dateStr = format(date, 'yyyy-MM-dd');
    const uuid = uuidv7();
    return `${getMemoryBasePath(guildId)}/${category}/${dateStr}-${uuid}.md`;
  }

  /**
   * frontmatterを作成
   */
  private createFrontmatter(
    input: CreateMemoryInput,
    date: Date
  ): MemoryFrontmatter {
    const frontmatter: MemoryFrontmatter = {
      title: input.title,
      date: format(date, 'yyyy-MM-dd'),
      tags: input.tags,
      source: 'discord',
      type: input.category,
      summary: input.summary,
    };

    if (input.driveUrl) {
      frontmatter.drive_url = input.driveUrl;
    }
    // Schedule fields
    if (input.startDate) frontmatter.start_date = input.startDate;
    if (input.endDate) frontmatter.end_date = input.endDate;
    if (input.startTime) frontmatter.start_time = input.startTime;
    if (input.endTime) frontmatter.end_time = input.endTime;
    if (input.location) frontmatter.location = input.location;
    if (input.recurring) frontmatter.recurring = input.recurring;
    // Task fields
    if (input.status) frontmatter.status = input.status;
    if (input.dueDate) frontmatter.due_date = input.dueDate;
    if (input.priority) frontmatter.priority = input.priority;

    return frontmatter;
  }

  /**
   * Markdownを整形（YAML frontmatter + 本文）
   */
  formatMarkdown(frontmatter: MemoryFrontmatter, content: string): string {
    const yamlLines = [
      '---',
      `title: ${this.escapeYamlValue(frontmatter.title)}`,
      `date: ${frontmatter.date}`,
      `tags: [${frontmatter.tags.map((t) => this.escapeYamlValue(t)).join(', ')}]`,
      `source: ${frontmatter.source}`,
      `type: ${frontmatter.type}`,
    ];

    if (frontmatter.drive_url) {
      yamlLines.push(`drive_url: ${frontmatter.drive_url}`);
    }
    // Schedule fields
    if (frontmatter.start_date) yamlLines.push(`start_date: ${frontmatter.start_date}`);
    if (frontmatter.end_date) yamlLines.push(`end_date: ${frontmatter.end_date}`);
    if (frontmatter.start_time) yamlLines.push(`start_time: ${frontmatter.start_time}`);
    if (frontmatter.end_time) yamlLines.push(`end_time: ${frontmatter.end_time}`);
    if (frontmatter.location) yamlLines.push(`location: ${this.escapeYamlValue(frontmatter.location)}`);
    if (frontmatter.recurring) yamlLines.push(`recurring: ${frontmatter.recurring}`);
    // Task fields
    if (frontmatter.status) yamlLines.push(`status: ${frontmatter.status}`);
    if (frontmatter.due_date) yamlLines.push(`due_date: ${frontmatter.due_date}`);
    if (frontmatter.priority) yamlLines.push(`priority: ${frontmatter.priority}`);

    yamlLines.push(`summary: ${this.escapeYamlValue(frontmatter.summary)}`);
    yamlLines.push('---');
    yamlLines.push('');
    yamlLines.push(content);

    return yamlLines.join('\n');
  }

  /**
   * YAML値をエスケープ
   */
  private escapeYamlValue(value: string): string {
    if (value.includes(':') || value.includes('#') || value.includes('"') || value.includes("'")) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  // ─── インデックス管理 ───

  private async getIndex(guildId: string): Promise<{ index: MemoryIndex; sha: string | null }> {
    const indexPath = getIndexPath(guildId);
    const fileData = await this.client.getFile(indexPath);

    if (fileData) {
      try {
        const index = JSON.parse(fileData.content) as MemoryIndex;
        if (index.version === INDEX_VERSION && Array.isArray(index.entries)) {
          return { index, sha: fileData.sha };
        }
      } catch {
        // corrupted index, rebuild
      }
    }

    const rebuilt = await this.rebuildIndex(guildId);
    return rebuilt;
  }

  private async rebuildIndex(guildId: string): Promise<{ index: MemoryIndex; sha: string | null }> {
    const paths = ALL_CATEGORIES.map((c) => `${getMemoryBasePath(guildId)}/${c}`);
    const files = await this.client.listFilesRecursive(paths);

    const entries: MemoryIndexEntry[] = [];
    for (const file of files) {
      if (!file.name.endsWith('.md')) continue;
      const fileData = await this.client.getFile(file.path);
      if (!fileData) continue;

      const parsed = this.parseMarkdown(fileData.content);
      if (!parsed) continue;

      entries.push({
        path: file.path,
        category: parsed.frontmatter.type,
        title: parsed.frontmatter.title,
        tags: parsed.frontmatter.tags,
        date: parsed.frontmatter.date,
        summary: parsed.frontmatter.summary,
      });
    }

    const index: MemoryIndex = { version: INDEX_VERSION, entries };
    const sha = await this.saveIndex(guildId, index, null);
    return { index, sha };
  }

  private async saveIndex(guildId: string, index: MemoryIndex, currentSha: string | null): Promise<string> {
    const indexPath = getIndexPath(guildId);
    const content = JSON.stringify(index, null, 2);
    const message = 'Update memory index';

    if (currentSha) {
      const result = await this.client.updateFile(indexPath, content, message, currentSha);
      return result.sha;
    }

    // sha が不明だがファイルが存在するケース（破損/バージョン不一致から再構築時）
    const existing = await this.client.getFile(indexPath);
    if (existing) {
      const result = await this.client.updateFile(indexPath, content, message, existing.sha);
      return result.sha;
    }

    const result = await this.client.createFile(indexPath, content, message);
    return result.sha;
  }

  private async addToIndex(guildId: string, entry: MemoryIndexEntry): Promise<void> {
    const { index, sha } = await this.getIndex(guildId);
    index.entries.push(entry);
    await this.saveIndex(guildId, index, sha);
  }

  private async removeFromIndex(guildId: string, path: string): Promise<void> {
    const { index, sha } = await this.getIndex(guildId);
    const newEntries = index.entries.filter((e) => e.path !== path);
    await this.saveIndex(guildId, { ...index, entries: newEntries }, sha);
  }

  private async updateIndexEntry(
    guildId: string,
    path: string,
    updates: { title?: string; tags?: readonly string[]; summary?: string },
  ): Promise<void> {
    const { index, sha } = await this.getIndex(guildId);
    const newEntries = index.entries.map((e) => {
      if (e.path !== path) return e;
      return {
        ...e,
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.tags !== undefined && { tags: updates.tags }),
        ...(updates.summary !== undefined && { summary: updates.summary }),
      };
    });
    await this.saveIndex(guildId, { ...index, entries: newEntries }, sha);
  }

  // ─── 検索・一覧 ───

  /**
   * メモリを検索
   * インデックスから候補を絞り込み、該当ファイルのみGitHub APIで取得
   */
  async searchMemories(
    query: string,
    guildId: string,
    categories?: MemoryCategory[]
  ): Promise<SearchResult[]> {
    const targetCategories = categories ?? ALL_CATEGORIES;
    const queryLower = query.toLowerCase();

    const { index } = await this.getIndex(guildId);

    const matchedEntries = index.entries.filter((entry) => {
      if (!targetCategories.includes(entry.category)) return false;
      const searchable = [entry.title, entry.summary, ...entry.tags].join(' ').toLowerCase();
      return searchable.includes(queryLower);
    });

    const results: SearchResult[] = [];
    for (const entry of matchedEntries) {
      const fileData = await this.client.getFile(entry.path);
      if (!fileData) continue;

      const parsed = this.parseMarkdown(fileData.content);
      if (!parsed) continue;

      results.push({
        path: entry.path,
        frontmatter: parsed.frontmatter,
        content: parsed.content,
      });
    }

    // legacy path fallback (not in index)
    const legacyResults = await this.searchLegacyMemories(queryLower, targetCategories);
    const indexedPaths = new Set(index.entries.map((e) => e.path));
    for (const r of legacyResults) {
      if (!indexedPaths.has(r.path)) {
        results.push(r);
      }
    }

    return results;
  }

  private async searchLegacyMemories(
    queryLower: string,
    categories: MemoryCategory[],
  ): Promise<SearchResult[]> {
    const legacyPaths = categories.map((c) => `${getLegacyBasePath()}/${c}`);
    const legacyFiles = await this.client.listFilesRecursive(legacyPaths);
    const results: SearchResult[] = [];

    for (const file of legacyFiles) {
      if (!file.name.endsWith('.md')) continue;

      const fileData = await this.client.getFile(file.path);
      if (!fileData) continue;

      const parsed = this.parseMarkdown(fileData.content);
      if (!parsed) continue;

      const searchable = [
        parsed.frontmatter.summary,
        parsed.frontmatter.title,
        ...parsed.frontmatter.tags,
      ].join(' ').toLowerCase();

      if (searchable.includes(queryLower)) {
        results.push({
          path: file.path,
          frontmatter: parsed.frontmatter,
          content: parsed.content,
        });
      }
    }

    return results;
  }

  /**
   * 最近のメモリを取得
   * 新パス memory/{guildId}/ を先に探索し、旧パス memory/ をフォールバック
   */
  async getRecentMemories(guildId: string, limit: number = 10): Promise<SearchResult[]> {
    const newPaths = ALL_CATEGORIES.map((c) => `${getMemoryBasePath(guildId)}/${c}`);
    const legacyPaths = ALL_CATEGORIES.map((c) => `${getLegacyBasePath()}/${c}`);

    const [newFiles, legacyFiles] = await Promise.all([
      this.client.listFilesRecursive(newPaths),
      this.client.listFilesRecursive(legacyPaths),
    ]);

    const seenPaths = new Set<string>();
    const allFiles = [...newFiles, ...legacyFiles].filter((f) => {
      if (seenPaths.has(f.path)) return false;
      seenPaths.add(f.path);
      return true;
    });

    const results: SearchResult[] = [];

    const sortedFiles = allFiles
      .filter((f) => f.name.endsWith('.md'))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, limit);

    for (const file of sortedFiles) {
      const fileData = await this.client.getFile(file.path);
      if (!fileData) continue;

      const parsed = this.parseMarkdown(fileData.content);
      if (!parsed) continue;

      results.push({
        path: file.path,
        frontmatter: parsed.frontmatter,
        content: parsed.content,
      });
    }

    return results;
  }

  /**
   * 特定カテゴリのメモリ一覧を取得
   * 新パス memory/{guildId}/{category}/ を先に探索し、旧パスをフォールバック
   */
  async listMemories(category: MemoryCategory, guildId: string): Promise<SearchResult[]> {
    const newDirPath = `${getMemoryBasePath(guildId)}/${category}`;
    const legacyDirPath = `${getLegacyBasePath()}/${category}`;

    const [newFiles, legacyFiles] = await Promise.all([
      this.client.listFiles(newDirPath),
      this.client.listFiles(legacyDirPath),
    ]);

    const seenPaths = new Set<string>();
    const allFiles = [...newFiles, ...legacyFiles].filter((f) => {
      if (seenPaths.has(f.path)) return false;
      seenPaths.add(f.path);
      return true;
    });

    const results: SearchResult[] = [];

    for (const file of allFiles) {
      if (!file.name.endsWith('.md')) continue;

      const fileData = await this.client.getFile(file.path);
      if (!fileData) continue;

      const parsed = this.parseMarkdown(fileData.content);
      if (!parsed) continue;

      results.push({
        path: file.path,
        frontmatter: parsed.frontmatter,
        content: parsed.content,
      });
    }

    return results;
  }

  // ─── パース ───

  /**
   * Markdownをパース（frontmatter + 本文）
   */
  private parseMarkdown(
    markdown: string
  ): { frontmatter: MemoryFrontmatter; content: string } | null {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const [, yamlStr, content] = match;
    try {
      const frontmatter = this.parseYaml(yamlStr);
      return { frontmatter, content: content.trim() };
    } catch {
      return null;
    }
  }

  /**
   * 簡易YAMLパーサー
   */
  private parseYaml(yaml: string): MemoryFrontmatter {
    const lines = yaml.split('\n');
    const result: Record<string, unknown> = {};

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();

      // 配列の場合
      if (value.startsWith('[') && value.endsWith(']')) {
        const arrayContent = value.slice(1, -1);
        result[key] = arrayContent
          .split(',')
          .map((v) => this.unescapeYamlValue(v.trim()))
          .filter((v) => v.length > 0);
      } else {
        result[key] = this.unescapeYamlValue(value);
      }
    }

    return result as unknown as MemoryFrontmatter;
  }

  /**
   * YAMLエスケープを解除
   */
  private unescapeYamlValue(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1).replace(/\\"/g, '"');
    }
    return value;
  }
}
