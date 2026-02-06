import OpenAI from 'openai';
import type { AIClientConfig, GeneratedMemory, ConversationContext, SaveDecision } from './types.js';
import { MEMORY_GENERATION_PROMPT, SAVE_DECISION_PROMPT, CHAT_RESPONSE_PROMPT, formatConversationContext, formatMemoryContext } from './prompts.js';
import { withRetry } from '../utils/retry.js';

export interface ImageAttachment {
  url: string;
  filename: string;
  size: number;
  contentType: string;
}

/**
 * AIクライアント
 * GLM-4 API（OpenAI互換）を使用
 */
export class AIClient {
  private client: OpenAI;
  private model: string;

  constructor(config: AIClientConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.model = config.model;
  }

  /**
   * 会話からメモリを生成
   */
  async generateMemory(context: ConversationContext, imageAttachments?: ImageAttachment[]): Promise<GeneratedMemory> {
    const conversationText = formatConversationContext(context.messages);
    let prompt = `${MEMORY_GENERATION_PROMPT}\n${conversationText}`;

    if (imageAttachments && imageAttachments.length > 0) {
      const imageInfo = imageAttachments
        .map((img, i) =>
          `画像${i + 1}: ${img.filename} (${img.contentType}, ${Math.round(img.size / 1024)}KB)\nURL: ${img.url}`
        )
        .join('\n');
      prompt += `\n\n## 添付画像\n${imageInfo}\n\n※画像が添付されています。カテゴリは "images" を推奨します。`;
    }

    const response = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'あなたは会話からメモリを抽出するアシスタントです。必ずJSON形式のみで回答してください。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 512,
      }),
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AI response is empty');
    }

    return this.parseMemoryResponse(content);
  }

  /**
   * メッセージが保存トリガーを含むか判定
   */
  async shouldSaveMemory(message: string): Promise<SaveDecision> {
    // 明示的なコマンドは即座にtrue
    if (message.trim().startsWith('!save')) {
      return { shouldSave: true, reason: '!saveコマンド検出' };
    }

    // 簡易的なキーワードマッチング（AI呼び出しを減らす）
    const triggers = ['覚えといて', '覚えておいて', 'メモして', 'メモしといて', '保存して', '記録して', '忘れないように'];
    for (const trigger of triggers) {
      if (message.includes(trigger)) {
        return { shouldSave: true, reason: `トリガー検出: ${trigger}` };
      }
    }

    // 不明確な場合はAIで判定
    const prompt = `${SAVE_DECISION_PROMPT}\n${message}`;

    const response = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: '保存意図の判定を行います。必ずJSON形式のみで回答してください。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 64,
      }),
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { shouldSave: false, reason: 'AI応答なし' };
    }

    return this.parseSaveDecision(content);
  }

  /**
   * 会話応答を生成
   */
  async generateChatResponse(
    userMessage: string,
    conversationHistory: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
    relatedMemories: ReadonlyArray<{ title: string; summary: string; category: string }>,
  ): Promise<{ content: string }> {
    const memoryContext = formatMemoryContext(relatedMemories);
    const systemPrompt = `${CHAT_RESPONSE_PROMPT}${memoryContext}`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system' as const, content: systemPrompt },
      ...conversationHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: userMessage },
    ];

    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: this.model,
          messages,
          temperature: 0.7,
          max_tokens: 256,
        }),
      { maxRetries: 2, initialDelayMs: 500 },
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { content: '🐬 ごめんなさい、うまく返事ができませんでした。' };
    }

    return { content };
  }

  /**
   * メモリ生成レスポンスをパース
   */
  private parseMemoryResponse(content: string): GeneratedMemory {
    // コードブロックからJSONを抽出
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

    try {
      const parsed = JSON.parse(jsonStr);

      // バリデーション
      if (!parsed.title || !parsed.summary || !parsed.tags || !parsed.category || !parsed.content) {
        throw new Error('Missing required fields in AI response');
      }

      // カテゴリのバリデーション
      const validCategories = ['daily', 'ideas', 'research', 'images', 'logs', 'schedule', 'tasks'];
      if (!validCategories.includes(parsed.category)) {
        parsed.category = 'ideas'; // デフォルト
      }

      return {
        title: String(parsed.title).slice(0, 100),
        summary: String(parsed.summary).slice(0, 200),
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5).map(String) : [],
        category: parsed.category,
        content: String(parsed.content),
        // Schedule fields
        startDate: parsed.start_date ? String(parsed.start_date) : undefined,
        endDate: parsed.end_date ? String(parsed.end_date) : undefined,
        startTime: parsed.start_time ? String(parsed.start_time) : undefined,
        endTime: parsed.end_time ? String(parsed.end_time) : undefined,
        location: parsed.location ? String(parsed.location) : undefined,
        recurring: parsed.recurring ? String(parsed.recurring) : undefined,
        // Task fields
        status: parsed.status ? String(parsed.status) : undefined,
        dueDate: parsed.due_date ? String(parsed.due_date) : undefined,
        priority: parsed.priority ? String(parsed.priority) : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to parse AI response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 保存判定レスポンスをパース
   */
  private parseSaveDecision(content: string): SaveDecision {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        shouldSave: Boolean(parsed.shouldSave),
        reason: String(parsed.reason || ''),
      };
    } catch {
      return { shouldSave: false, reason: 'パース失敗' };
    }
  }
}
