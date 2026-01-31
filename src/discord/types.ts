import type { Message } from 'discord.js';
import type { GeneratedMemory } from '../ai/types.js';
import type { MemoryCategory } from '../github/types.js';

/**
 * Discord Bot設定
 */
export interface BotConfig {
  /** Botトークン */
  token: string;
  /** 監視対象チャンネルID */
  channelId: string | undefined;
}

/**
 * 保存リクエスト
 */
export interface SaveRequest {
  /** リクエスト元メッセージ */
  message: Message;
  /** 会話コンテキスト（過去のメッセージ） */
  context: MessageContext[];
  /** 明示的コマンドか */
  isExplicitCommand: boolean;
}

/**
 * メッセージコンテキスト
 */
export interface MessageContext {
  /** 送信者ID */
  authorId: string;
  /** 送信者名 */
  authorName: string;
  /** メッセージ内容 */
  content: string;
  /** 送信日時 */
  timestamp: Date;
  /** Botのメッセージか */
  isBot: boolean;
}

/**
 * コマンド定義
 */
export interface CommandDefinition {
  /** コマンド名（!save等） */
  name: string;
  /** 説明 */
  description: string;
  /** 実行関数 */
  execute: (message: Message, args: string[]) => Promise<void>;
}

/**
 * Bot状態
 */
export interface BotState {
  /** 起動中か */
  isRunning: boolean;
  /** 最後のエラー */
  lastError?: Error;
  /** 処理中のリクエスト数 */
  pendingRequests: number;
}

export interface PendingMemory {
  memory: GeneratedMemory;
  message: Message;
  categoryOverride?: MemoryCategory;
}
