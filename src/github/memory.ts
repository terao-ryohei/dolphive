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

/**
 * メモリマネージャ
 * AIの出力をMarkdownに変換してGitHubにコミット
 */
export class MemoryManager {
  private client: GitHubClient;

  constructor(config: GitHubClientConfig) {
    this.client = new GitHubClient(config);
  }

  /**
   * メモリを保存
   */
  async saveMemory(input: CreateMemoryInput): Promise<SavedMemory> {
    const date = new Date();
    const filePath = this.generateFilePath(input.category, date);
    const frontmatter = this.createFrontmatter(input, date);
    const markdown = this.formatMarkdown(frontmatter, input.content);

    const commitMessage = `Add ${input.category}: ${input.title}`;
    const result = await this.client.createFile(filePath, markdown, commitMessage);

    return {
      path: result.path,
      sha: result.sha,
      frontmatter,
    };
  }

  /**
   * ファイルパスを生成
   * 形式: memory/{category}/{YYYY-MM-DD}-{uuid}.md
   */
  generateFilePath(category: MemoryCategory, date: Date): string {
    const dateStr = format(date, 'yyyy-MM-dd');
    const uuid = uuidv7();
    return `${MEMORY_BASE_PATH}/${category}/${dateStr}-${uuid}.md`;
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

  /**
   * メモリを検索
   * summary/tagsからキーワード検索
   */
  async searchMemories(
    query: string,
    categories?: MemoryCategory[]
  ): Promise<SearchResult[]> {
    const targetCategories = categories ?? ALL_CATEGORIES;
    const dirPaths = targetCategories.map((c) => `${MEMORY_BASE_PATH}/${c}`);

    const files = await this.client.listFilesRecursive(dirPaths);
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const file of files) {
      if (!file.name.endsWith('.md')) continue;

      const fileData = await this.client.getFile(file.path);
      if (!fileData) continue;

      const parsed = this.parseMarkdown(fileData.content);
      if (!parsed) continue;

      // summary, tags, titleでキーワード検索
      const searchableText = [
        parsed.frontmatter.summary,
        parsed.frontmatter.title,
        ...parsed.frontmatter.tags,
      ]
        .join(' ')
        .toLowerCase();

      if (searchableText.includes(queryLower)) {
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
   */
  async getRecentMemories(limit: number = 10): Promise<SearchResult[]> {
    const dirPaths = ALL_CATEGORIES.map((c) => `${MEMORY_BASE_PATH}/${c}`);
    const files = await this.client.listFilesRecursive(dirPaths);
    const results: SearchResult[] = [];

    // ファイル名でソート（日付が含まれているため）
    const sortedFiles = files
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
   */
  async listMemories(category: MemoryCategory): Promise<SearchResult[]> {
    const dirPath = `${MEMORY_BASE_PATH}/${category}`;
    const files = await this.client.listFiles(dirPath);
    const results: SearchResult[] = [];

    for (const file of files) {
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
