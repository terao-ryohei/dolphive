/**
 * メモリ生成プロンプト
 * 会話からメモリを抽出してJSON形式で出力
 */
export const MEMORY_GENERATION_PROMPT = `あなたはユーザーの会話から重要な情報を抽出し、メモリとして保存するアシスタントです。

以下の会話から、保存すべき情報を抽出してJSON形式で出力してください。

## 出力形式（必ずこの形式で）
\`\`\`json
{
  "title": "簡潔なタイトル",
  "summary": "1-2文の要約",
  "tags": ["タグ1", "タグ2"],
  "category": "カテゴリ名",
  "content": "本文（Markdown形式）",
  "start_date": "(scheduleの場合) YYYY-MM-DD",
  "end_date": "(scheduleの場合) YYYY-MM-DD",
  "start_time": "(scheduleの場合) HH:MM",
  "end_time": "(scheduleの場合) HH:MM",
  "location": "(scheduleの場合) 場所",
  "recurring": "(scheduleの場合) none/daily/weekly/monthly/yearly",
  "status": "(tasksの場合) todo/doing/done",
  "due_date": "(tasksの場合) YYYY-MM-DD",
  "priority": "(tasksの場合) high/medium/low"
}
\`\`\`

## カテゴリの選択基準
- daily: 日常の出来事、日記的な内容
- ideas: アイデア、思いつき、企画
- research: 調査結果、学んだこと、技術メモ
- images: 画像に関するメモ（画像URLがある場合）
- logs: 作業ログ、進捗記録
- schedule: スケジュール、予定、約束、イベント
- tasks: タスク、TODO、やること、やるべきこと

## ルール
1. titleは20文字以内で簡潔に
2. summaryは50文字以内
3. tagsは最大5個まで、関連キーワードを抽出
4. contentは会話の重要部分をMarkdown形式で整理
5. 必ず有効なJSONのみを出力（説明文なし）
6. scheduleの場合はstart_dateを必ず含める
7. tasksの場合はstatusを必ず含める（デフォルト: todo）

## 会話内容
`;

/**
 * 保存判定プロンプト
 * メッセージが保存トリガーを含むか判定
 */
export const SAVE_DECISION_PROMPT = `以下のメッセージが「保存してほしい」という意図を含むか判定してください。

## 保存トリガーの例
- 「覚えといて」「覚えておいて」
- 「メモして」「メモしといて」
- 「保存して」「記録して」
- 「忘れないように」
- 「!save」コマンド

## 出力形式（JSONのみ）
\`\`\`json
{
  "shouldSave": true/false,
  "reason": "判定理由"
}
\`\`\`

## メッセージ
`;

/**
 * 会話コンテキストをフォーマット
 */
export function formatConversationContext(
  messages: Array<{ role: 'user' | 'bot'; content: string; timestamp: Date }>
): string {
  return messages
    .map((m) => {
      const time = m.timestamp.toLocaleTimeString('ja-JP');
      const role = m.role === 'user' ? 'ユーザー' : 'Bot';
      return `[${time}] ${role}: ${m.content}`;
    })
    .join('\n');
}
