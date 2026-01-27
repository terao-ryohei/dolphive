import { Octokit } from '@octokit/rest';
import type { GitHubClientConfig, CreateFileResult, FileInfo } from './types.js';

/**
 * GitHub APIクライアント
 * Contents APIを使用してファイルの作成・取得を行う
 */
export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(config: GitHubClientConfig) {
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner;
    this.repo = config.repo;
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

    const response = await this.octokit.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
    });

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
      await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
      });
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
      const response = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
      });

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
      const response = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: dirPath,
      });

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
}
