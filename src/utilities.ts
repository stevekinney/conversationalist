/**
 * This file re-exports all utilities from the utilities/ directory.
 * For new code, prefer importing directly from the specific modules:
 * - './utilities/content' for content normalization
 * - './utilities/deterministic' for deterministic output
 * - './utilities/markdown' for markdown conversion
 * - './utilities/message' for message utilities
 * - './utilities/tool-calls' for tool call pairing
 * - './utilities/transient' for transient metadata handling
 * - './utilities/type-helpers' for type guard helpers
 */

// Re-export types that were moved to types.ts for backward compatibility
export type { ToMarkdownOptions } from './types';

// Content normalization
export { normalizeContent, toMultiModalArray } from './utilities/content';

// Deterministic output
export { sortMessagesByPosition, sortObjectKeys } from './utilities/deterministic';

// Markdown conversion
export {
  fromMarkdown,
  getRoleFromLabel,
  getRoleLabel,
  LABEL_TO_ROLE,
  MarkdownParseError,
  ROLE_LABELS,
  toMarkdown,
} from './utilities/markdown';

// Message utilities
export {
  createMessage,
  messageHasImages,
  messageParts,
  messageText,
  messageToJSON,
  messageToString,
} from './utilities/message';

// Tool call pairing
export type { ToolCallPair } from './utilities/tool-calls';
export { pairToolCallsWithResults } from './utilities/tool-calls';

// Transient metadata
export {
  isTransientKey,
  stripTransientFromRecord,
  stripTransientMetadata,
} from './utilities/transient';

// Type helpers
export { hasOwnProperty, toReadonly } from './utilities/type-helpers';
