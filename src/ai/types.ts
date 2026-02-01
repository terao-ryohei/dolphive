import type { MemoryCategory } from '../github/types.js';

/**
 * AIクライアント設定
 */
export interface AIClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * AIが生成するメモリ出力
 */
export interface GeneratedMemory {
  /** タイトル */
  title: string;
  /** 要約（1-2文） */
  summary: string;
  /** タグ配列 */
  tags: string[];
  /** カテゴリ */
  category: MemoryCategory;
  /** 本文（Markdown形式） */
  content: string;
  // Schedule fields
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  recurring?: string;
  // Task fields
  status?: string;
  dueDate?: string;
  priority?: string;
}

/**
 * 会話コンテキスト
 */
export interface ConversationContext {
  /** ユーザー名 */
  username: string;
  /** メッセージ履歴 */
  messages: ConversationMessage[];
}

/**
 * 会話メッセージ
 */
export interface ConversationMessage {
  /** 送信者（userまたはbot） */
  role: 'user' | 'bot';
  /** メッセージ内容 */
  content: string;
  /** タイムスタンプ */
  timestamp: Date;
}

/**
 * 保存判定結果
 */
export interface SaveDecision {
  /** 保存すべきか */
  shouldSave: boolean;
  /** 理由 */
  reason: string;
}

/**
 * 会話応答結果
 */
export interface ChatResponseResult {
  content: string;
}
