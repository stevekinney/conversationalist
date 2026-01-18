import type { ConversationEnvironment } from '../environment';
import type {
  Conversation,
  JSONValue,
  MessageInput,
  TokenUsage,
  ToolCall,
  ToolResult,
} from '../types';
import { getOrderedMessages } from '../utilities/message-store';
import { pairToolCallsWithResults } from '../utilities/tool-calls';
import { appendMessages } from './append';

export interface AppendToolUseOptions {
  content?: MessageInput['content'];
  metadata?: Record<string, JSONValue>;
  hidden?: boolean;
  tokenUsage?: TokenUsage;
}

export interface AppendToolResultOptions {
  content?: MessageInput['content'];
  metadata?: Record<string, JSONValue>;
  hidden?: boolean;
  tokenUsage?: TokenUsage;
}

export interface ToolInteraction {
  call: ToolCall;
  result?: ToolResult | undefined;
}

/**
 * Appends a tool-use message with the provided tool call metadata.
 */
export function appendToolUse(
  conversation: Conversation,
  toolCall: ToolCall,
  options?: AppendToolUseOptions,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  return appendMessages(
    conversation,
    {
      role: 'tool-use',
      content: options?.content ?? '',
      metadata: options?.metadata,
      hidden: options?.hidden,
      toolCall,
      tokenUsage: options?.tokenUsage,
    },
    environment,
  );
}

/**
 * Appends a tool-result message with the provided tool result metadata.
 */
export function appendToolResult(
  conversation: Conversation,
  toolResult: ToolResult,
  options?: AppendToolResultOptions,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  return appendMessages(
    conversation,
    {
      role: 'tool-result',
      content: options?.content ?? '',
      metadata: options?.metadata,
      hidden: options?.hidden,
      toolResult,
      tokenUsage: options?.tokenUsage,
    },
    environment,
  );
}

/**
 * Returns tool calls that have no corresponding tool result yet.
 */
export function getPendingToolCalls(conversation: Conversation): ToolCall[] {
  const ordered = getOrderedMessages(conversation);
  const completed = new Set<string>();

  for (const message of ordered) {
    if (message.role === 'tool-result' && message.toolResult) {
      completed.add(message.toolResult.callId);
    }
  }

  const pending: ToolCall[] = [];
  for (const message of ordered) {
    if (message.role === 'tool-use' && message.toolCall) {
      if (!completed.has(message.toolCall.id)) {
        pending.push(message.toolCall);
      }
    }
  }

  return pending;
}

/**
 * Returns tool calls paired with their optional results in message order.
 */
export function getToolInteractions(conversation: Conversation): ToolInteraction[] {
  return pairToolCallsWithResults(getOrderedMessages(conversation));
}
