import type { MultiModalContent } from '@lasercat/homogenaize';

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
