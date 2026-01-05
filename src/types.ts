import type { MultiModalContent } from '@lasercat/homogenaize';

/**
 * Current schema version for ConversationJSON.
 * Increment when making breaking changes to the schema.
 */
export const CURRENT_SCHEMA_VERSION = 1;

export type MessageRole =
  | 'user'
  | 'assistant'
  | 'system'
  | 'developer'
  | 'tool-use'
  | 'tool-result'
  | 'snapshot';

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolResult {
  callId: string;
  outcome: 'success' | 'error';
  content: unknown;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface MessageInput {
  role: MessageRole;
  content: string | MultiModalContent[];
  metadata?: Record<string, unknown> | undefined;
  hidden?: boolean | undefined;
  toolCall?: ToolCall | undefined;
  toolResult?: ToolResult | undefined;
  tokenUsage?: TokenUsage | undefined;
  /** Indicates if this message represents goal completion (assistant only) */
  goalCompleted?: boolean | undefined;
}

export interface MessageJSON {
  id: string;
  role: MessageRole;
  content: string | MultiModalContent[];
  position: number;
  createdAt: string;
  metadata: Record<string, unknown>;
  hidden: boolean;
  toolCall?: ToolCall | undefined;
  toolResult?: ToolResult | undefined;
  tokenUsage?: TokenUsage | undefined;
  /** Indicates if this message represents goal completion (assistant only) */
  goalCompleted?: boolean | undefined;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string | ReadonlyArray<MultiModalContent>;
  position: number;
  createdAt: string;
  metadata: Readonly<Record<string, unknown>>;
  hidden: boolean;
  toolCall?: Readonly<ToolCall> | undefined;
  toolResult?: Readonly<ToolResult> | undefined;
  tokenUsage?: Readonly<TokenUsage> | undefined;
  /** Indicates if this message represents goal completion (assistant only) */
  goalCompleted?: boolean | undefined;
}

export type ConversationStatus = 'active' | 'archived' | 'deleted';

export interface ConversationJSON {
  schemaVersion: number;
  id: string;
  title?: string | undefined;
  status: ConversationStatus;
  metadata: Record<string, unknown>;
  tags: string[];
  messages: MessageJSON[];
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  title?: string | undefined;
  status: ConversationStatus;
  metadata: Readonly<Record<string, unknown>>;
  tags: ReadonlyArray<string>;
  messages: ReadonlyArray<Message>;
  createdAt: string;
  updatedAt: string;
}

/**
 * A function that estimates the number of tokens in a message.
 */
export type TokenEstimator = (message: Message) => number;

/**
 * A plugin that can transform a MessageInput before it is appended.
 */
export type MessagePlugin = (input: MessageInput) => MessageInput;

/**
 * Serialized form of a single node in the conversation history tree.
 */
export interface HistoryNodeJSON {
  conversation: ConversationJSON;
  children: HistoryNodeJSON[];
}

/**
 * Serialized form of the entire conversation history.
 */
export interface ConversationHistoryJSON {
  root: HistoryNodeJSON;
  currentPath: number[];
}

/**
 * Base options for all export operations.
 */
export interface ExportOptions {
  /**
   * When true, produces deterministic output with sorted keys and messages.
   * Useful for testing, diffing, and content-addressable storage.
   * @default false
   */
  deterministic?: boolean;

  /**
   * When true, strips transient metadata (keys starting with '_').
   * @default false
   */
  stripTransient?: boolean;

  /**
   * When true, redacts tool call arguments with '[REDACTED]'.
   * @default false
   */
  redactToolArguments?: boolean;

  /**
   * When true, redacts tool result content with '[REDACTED]'.
   * @default false
   */
  redactToolResults?: boolean;
}

/**
 * Options for exporting to markdown format.
 */
export interface ToMarkdownOptions extends ExportOptions {
  /**
   * When true, includes YAML frontmatter with full metadata for lossless round-trip.
   * Headers include message ID: `### Role (msg-id)`
   * @default false
   */
  includeMetadata?: boolean;
}

/**
 * Options for serializing conversations to JSON.
 * Alias for ExportOptions for API consistency.
 */
export type SerializeOptions = ExportOptions;
