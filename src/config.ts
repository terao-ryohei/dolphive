import 'dotenv/config';

/**
 * アプリケーション設定
 */
export interface AppConfig {
  discord: {
    token: string;
    channelId: string;
  };
  ai: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  github: {
    token: string;
    owner: string;
    repo: string;
  };
}

/**
 * 必須環境変数の取得（未設定時はエラー）
 */
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * オプション環境変数の取得（未設定時はデフォルト値）
 */
function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

/**
 * 設定を読み込み
 */
export function loadConfig(): AppConfig {
  return {
    discord: {
      token: getRequiredEnv('DISCORD_TOKEN'),
      channelId: getRequiredEnv('DISCORD_CHANNEL_ID'),
    },
    ai: {
      apiKey: getRequiredEnv('GLM_API_KEY'),
      baseUrl: getOptionalEnv('GLM_BASE_URL', 'https://open.bigmodel.cn/api/paas/v4'),
      model: getOptionalEnv('GLM_MODEL', 'glm-4'),
    },
    github: {
      token: getRequiredEnv('GITHUB_TOKEN'),
      owner: getRequiredEnv('GITHUB_OWNER'),
      repo: getRequiredEnv('GITHUB_REPO'),
    },
  };
}

/**
 * 設定のバリデーション
 */
export function validateConfig(config: AppConfig): void {
  // Discord token format check
  if (!config.discord.token.match(/^[\w-]+\.[\w-]+\.[\w-]+$/)) {
    console.warn('Warning: DISCORD_TOKEN format may be invalid');
  }

  // GitHub token format check
  if (!config.github.token.startsWith('ghp_') && !config.github.token.startsWith('github_pat_')) {
    console.warn('Warning: GITHUB_TOKEN format may be invalid');
  }
}
