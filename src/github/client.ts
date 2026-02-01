import { Octokit } from '@octokit/rest';
import type { GitHubClientConfig, CreateFileResult, FileInfo } from './types.js';
import { withRetry } from '../utils/retry.js';

/**
 * GitHub APIクライアント
 * Contents APIを使用してファイルの作成・取得を行う
 */
export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private templateOwner: string | undefined;
  private templateRepo: string | undefined;
  private repoPrivate: boolean;

  constructor(config: GitHubClientConfig) {
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner;
    this.repo = config.repo;
    this.templateOwner = config.templateOwner;
    this.templateRepo = config.templateRepo;
    this.repoPrivate = config.repoPrivate ?? true;
  }

  async repoExists(): Promise<boolean> {
    try {
      await withRetry(() => this.octokit.repos.get({ owner: this.owner, repo: this.repo }));
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 404) {
        return false;
      }
      throw error;
    }
  }

  async createFromTemplate(): Promise<void> {
    if (!this.templateOwner || !this.templateRepo) {
      throw new Error('Template owner and repo must be configured to create from template.');
    }
    const templateOwner = this.templateOwner;
    const templateRepo = this.templateRepo;
    try {
      await withRetry(() =>
        this.octokit.repos.createUsingTemplate({
          template_owner: templateOwner,
          template_repo: templateRepo,
          owner: this.owner,
          name: this.repo,
          private: this.repoPrivate,
          description: `Created from template ${this.templateOwner}/${this.templateRepo}`,
        }),
      );
    } catch (error: unknown) {
      if (error instanceof Error && 'status' in error) {
        const status = (error as { status: number }).status;
        if (status === 422) {
          const alreadyExists = await this.repoExists();
          if (alreadyExists) {
            console.log(`Repository '${this.owner}/${this.repo}' already exists.`);
            return;
          }
          throw new Error(
            `Failed to create '${this.owner}/${this.repo}' from template ` +
            `'${this.templateOwner}/${this.templateRepo}'. ` +
            `Verify the template repository exists and is marked as a template.`
          );
        }
        if (status === 403) {
          throw new Error(
            `Permission denied creating '${this.owner}/${this.repo}'. ` +
            `Ensure your token has 'repo' scope. For org repos, Admin permission is required.`
          );
        }
      }
      throw error;
    }
  }

  async ensureRepo(): Promise<void> {
    const exists = await this.repoExists();
    if (exists) return;

    console.log(`Repository '${this.owner}/${this.repo}' not found. Creating from template...`);
    await this.createFromTemplate();
    console.log(`Repository '${this.owner}/${this.repo}' created from template.`);

    const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      if (await this.repoExists()) return;
      console.log(`Waiting for repository to become available... (${i + 1}/5)`);
    }
    console.warn(`Warning: Repository '${this.owner}/${this.repo}' not yet available via API. Proceeding anyway.`);
  }

  /**
   * 新規ファイルを作成してコミット
   * 既存ファイルがある場合はエラー（上書き禁止）
   */
  async createFile(
    path: string,
    content: string,
    message: string
  ): Promise<CreateFileResult> {
    // 既存ファイルチェック
    const exists = await this.fileExists(path);
    if (exists) {
      throw new Error(`File already exists: ${path}. Overwriting is not allowed.`);
    }

    const response = await withRetry(() =>
      this.octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path,
        message,
        content: Buffer.from(content, 'utf-8').toString('base64'),
      }),
    );

    return {
      path: response.data.content?.path ?? path,
      sha: response.data.commit.sha ?? '',
      commitUrl: response.data.commit.html_url ?? '',
    };
  }

  /**
   * ファイルの存在確認
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      await withRetry(() =>
        this.octokit.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path,
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * ファイル内容を取得
   */
  async getFile(path: string): Promise<{ content: string; sha: string } | null> {
    try {
      const response = await withRetry(() =>
        this.octokit.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path,
        }),
      );

      const data = response.data;
      if (Array.isArray(data) || data.type !== 'file') {
        return null;
      }

      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return { content, sha: data.sha };
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * ディレクトリ内のファイル一覧を取得
   */
  async listFiles(dirPath: string): Promise<FileInfo[]> {
    try {
      const response = await withRetry(() =>
        this.octokit.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path: dirPath,
        }),
      );

      const data = response.data;
      if (!Array.isArray(data)) {
        return [];
      }

      return data
        .filter((item) => item.type === 'file')
        .map((item) => ({
          name: item.name,
          path: item.path,
          sha: item.sha,
          size: item.size,
          downloadUrl: item.download_url,
        }));
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * 複数ディレクトリからファイル一覧を取得
   */
  async listFilesRecursive(dirPaths: string[]): Promise<FileInfo[]> {
    const results = await Promise.all(dirPaths.map((dir) => this.listFiles(dir)));
    return results.flat();
  }

  /**
   * 既存ファイルを更新してコミット
   */
  async updateFile(
    path: string,
    content: string,
    message: string,
    sha: string,
  ): Promise<CreateFileResult> {
    const response = await withRetry(() =>
      this.octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path,
        message,
        content: Buffer.from(content, 'utf-8').toString('base64'),
        sha,
      }),
    );

    return {
      path: response.data.content?.path ?? path,
      sha: response.data.commit.sha ?? '',
      commitUrl: response.data.commit.html_url ?? '',
    };
  }

  /**
   * ファイルを削除してコミット
   */
  async deleteFile(path: string, message: string, sha: string): Promise<void> {
    await withRetry(() =>
      this.octokit.repos.deleteFile({
        owner: this.owner,
        repo: this.repo,
        path,
        message,
        sha,
      }),
    );
  }
}
