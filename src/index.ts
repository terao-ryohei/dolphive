import { loadConfig, validateConfig } from './config.js';
import { MemoryManager } from './github/index.js';
import { AIClient } from './ai/index.js';
import { MemoryBot } from './discord/index.js';

async function main(): Promise<void> {
  console.log('Loading configuration...');

  // 設定読み込み
  const config = loadConfig();
  validateConfig(config);

  console.log('Initializing components...');

  // GitHub Memory Manager
  const memoryManager = new MemoryManager({
    token: config.github.token,
    owner: config.github.owner,
    repo: config.github.repo,
  });

  // AI Client (GLM-4)
  const aiClient = new AIClient({
    apiKey: config.ai.apiKey,
    baseUrl: config.ai.baseUrl,
    model: config.ai.model,
  });

  // Discord Bot
  const bot = new MemoryBot(
    {
      token: config.discord.token,
      channelId: config.discord.channelId,
    },
    memoryManager,
    aiClient
  );

  // シャットダウンハンドラ
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}. Shutting down...`);
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Bot起動
  console.log('Starting bot...');
  await bot.start();

  console.log('Memory Bot is running!');
  if (config.discord.channelId) {
    console.log(`Watching channel: ${config.discord.channelId}`);
  } else {
    console.log('Watching all guild text channels');
  }
  console.log('Press Ctrl+C to stop.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
