// Types
export type {
  AIClientConfig,
  GeneratedMemory,
  ConversationContext,
  ConversationMessage,
  SaveDecision,
} from './types.js';

// Client
export { AIClient } from './client.js';

// Prompts
export { MEMORY_GENERATION_PROMPT, SAVE_DECISION_PROMPT, CHAT_RESPONSE_PROMPT, formatConversationContext, formatMemoryContext } from './prompts.js';
