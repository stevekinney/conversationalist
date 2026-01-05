/**
 * This file re-exports all utilities from the utilities/ directory.
 * For new code, prefer importing directly from the specific modules:
 * - './utilities/content' for content normalization
 * - './utilities/markdown' for markdown conversion
 * - './utilities/message' for message utilities
 * - './utilities/tool-calls' for tool call pairing
 * - './utilities/type-helpers' for type guard helpers
 */

// Content normalization
export { normalizeContent, toMultiModalArray } from './utilities/content';

// Markdown conversion
export type { ToMarkdownOptions } from './utilities/markdown';
export { fromMarkdown, MarkdownParseError, toMarkdown } from './utilities/markdown';

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

// Type helpers
export { hasOwnProperty, toReadonly } from './utilities/type-helpers';
