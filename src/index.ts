// Multi-modal types and helpers (re-exported from @lasercat/homogenaize)
export type { ImageContent, TextContent } from './multi-modal';
export { copyContent, copyMultiModalContent } from './multi-modal';
export type {
  Message as ExternalMessage,
  MultiModalContent,
} from '@lasercat/homogenaize';

// Types
export type {
  Conversation,
  ConversationJSON,
  ConversationStatus,
  Message,
  MessageInput,
  MessageJSON,
  MessageRole,
  TokenUsage,
  ToolCall,
  ToolResult,
} from './types';

// Schemas
export {
  conversationSchema,
  conversationShape,
  messageInputSchema,
  messageJSONSchema,
  messageRoleSchema,
  multiModalContentSchema,
  tokenUsageSchema,
  toolCallSchema,
  toolResultSchema,
} from './schemas';

// Functional conversation API
export type { ConversationEnvironment } from './conversation';
export {
  appendAssistantMessage,
  appendMessages,
  appendSystemMessage,
  appendUserMessage,
  collapseSystemMessages,
  computeConversationStatistics,
  createConversation,
  deserializeConversation,
  getConversationMessages,
  getFirstSystemMessage,
  getMessageAtPosition,
  getMessageByIdentifier,
  getSystemMessages,
  hasSystemMessage,
  prependSystemMessage,
  redactMessageAtPosition,
  replaceSystemMessage,
  searchConversationMessages,
  serializeConversation,
  toChatMessages,
} from './conversation';
export { withEnvironment } from './environment';

// Message helpers
export { createMessage } from './utilities';

// Errors
export type { ConversationalistErrorCode } from './errors';
export {
  ConversationalistError,
  createDuplicateIdError,
  createInvalidInputError,
  createInvalidPositionError,
  createInvalidToolReferenceError,
  createLockedError,
  createNotFoundError,
  createSerializationError,
  createValidationError,
} from './errors';

// Utilities
export type { ToolCallPair } from './utilities';
export {
  normalizeContent,
  pairToolCallsWithResults,
  toMultiModalArray,
} from './utilities';

// Builder utility
export type { ConversationDraft } from './with-conversation';
export { pipeConversation, withConversation } from './with-conversation';

// History utility
export { bindToConversationHistory, ConversationHistory } from './history';
export type { ConversationHistoryJSON, HistoryNodeJSON } from './types';

// Streaming utilities
export {
  appendStreamingMessage,
  cancelStreamingMessage,
  finalizeStreamingMessage,
  getStreamingMessage,
  isStreamingMessage,
  updateStreamingMessage,
} from './streaming';

// Context window utilities
export {
  estimateConversationTokens,
  getRecentMessages,
  simpleTokenEstimator,
  truncateFromPosition,
  truncateToTokenLimit,
} from './context';
