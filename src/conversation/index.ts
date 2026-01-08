// Re-export environment type
export type { ConversationEnvironment } from '../environment';

// Create
export { createConversation } from './create';

// Append
export {
  appendAssistantMessage,
  appendMessages,
  appendSystemMessage,
  appendUserMessage,
} from './append';

// Query
export {
  getMessageAtPosition,
  getMessageById,
  getMessageIds,
  getMessages,
  getStatistics,
  searchConversationMessages,
} from './query';

// System messages
export {
  collapseSystemMessages,
  getFirstSystemMessage,
  getSystemMessages,
  hasSystemMessage,
  prependSystemMessage,
  replaceSystemMessage,
} from './system-messages';

// Modify
export { redactMessageAtPosition } from './modify';

// Serialization
export {
  deserializeConversation,
  migrateConversation,
  serializeConversation,
} from './serialization';

// Transform
export { toChatMessages } from './transform';
