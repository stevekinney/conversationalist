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
