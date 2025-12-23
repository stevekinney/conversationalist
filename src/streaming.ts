import type { MultiModalContent } from '@lasercat/homogenaize';

import {
  type ConversationEnvironment,
  resolveConversationEnvironment,
} from './environment';
import type { Conversation, Message, TokenUsage } from './types';
import { createMessage, toReadonly } from './utilities';

const STREAMING_KEY = '__streaming';

/**
 * Checks if a message is currently streaming (has the streaming metadata flag).
 */
export function isStreamingMessage(message: Message): boolean {
  return message.metadata[STREAMING_KEY] === true;
}

/**
 * Gets the currently streaming message from a conversation, if any.
 */
export function getStreamingMessage(conversation: Conversation): Message | undefined {
  return conversation.messages.find(isStreamingMessage);
}

/**
 * Creates a pending/streaming message placeholder and appends it to the conversation.
 * Returns both the updated conversation and the ID of the new streaming message.
 */
export function appendStreamingMessage(
  conversation: Conversation,
  role: 'assistant' | 'user',
  metadata?: Record<string, unknown>,
  environment?: Partial<ConversationEnvironment>,
): { conversation: Conversation; messageId: string } {
  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();
  const messageId = resolvedEnvironment.randomId();

  const newMessage = createMessage({
    id: messageId,
    role,
    content: '',
    position: conversation.messages.length,
    createdAt: now,
    metadata: { ...(metadata ?? {}), [STREAMING_KEY]: true },
    hidden: false,
    toolCall: undefined,
    toolResult: undefined,
    tokenUsage: undefined,
  });

  const updatedConversation = toReadonly({
    ...conversation,
    messages: [...conversation.messages, newMessage],
    updatedAt: now,
  });

  return { conversation: updatedConversation, messageId };
}

/**
 * Updates the content of a streaming message.
 * This replaces the existing content (use for accumulating streamed tokens).
 */
export function updateStreamingMessage(
  conversation: Conversation,
  messageId: string,
  content: string | MultiModalContent[],
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();

  const messageIndex = conversation.messages.findIndex((m) => m.id === messageId);
  if (messageIndex === -1) {
    return conversation;
  }

  const original = conversation.messages[messageIndex]!;
  const updated = createMessage({
    id: original.id,
    role: original.role,
    content: typeof content === 'string' ? content : [...content],
    position: original.position,
    createdAt: original.createdAt,
    metadata: { ...original.metadata },
    hidden: original.hidden,
    toolCall: original.toolCall ? { ...original.toolCall } : undefined,
    toolResult: original.toolResult ? { ...original.toolResult } : undefined,
    tokenUsage: original.tokenUsage ? { ...original.tokenUsage } : undefined,
    goalCompleted: original.goalCompleted,
  });

  const messages = conversation.messages.map((m, i) =>
    i === messageIndex ? updated : m,
  );

  return toReadonly({
    ...conversation,
    messages,
    updatedAt: now,
  });
}

/**
 * Marks a streaming message as complete, removing the streaming flag.
 * Optionally adds token usage and additional metadata.
 */
export function finalizeStreamingMessage(
  conversation: Conversation,
  messageId: string,
  options?: {
    tokenUsage?: TokenUsage;
    metadata?: Record<string, unknown>;
  },
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();

  const messageIndex = conversation.messages.findIndex((m) => m.id === messageId);
  if (messageIndex === -1) {
    return conversation;
  }

  const original = conversation.messages[messageIndex]!;

  // Remove the streaming flag and merge in any new metadata
  const { [STREAMING_KEY]: _, ...restMetadata } = original.metadata as Record<
    string,
    unknown
  >;
  const finalMetadata = { ...restMetadata, ...(options?.metadata ?? {}) };

  const updated = createMessage({
    id: original.id,
    role: original.role,
    content:
      typeof original.content === 'string'
        ? original.content
        : [...(original.content as MultiModalContent[])],
    position: original.position,
    createdAt: original.createdAt,
    metadata: finalMetadata,
    hidden: original.hidden,
    toolCall: original.toolCall ? { ...original.toolCall } : undefined,
    toolResult: original.toolResult ? { ...original.toolResult } : undefined,
    tokenUsage: options?.tokenUsage ? { ...options.tokenUsage } : undefined,
    goalCompleted: original.goalCompleted,
  });

  const messages = conversation.messages.map((m, i) =>
    i === messageIndex ? updated : m,
  );

  return toReadonly({
    ...conversation,
    messages,
    updatedAt: now,
  });
}

/**
 * Cancels a streaming message by removing it from the conversation.
 */
export function cancelStreamingMessage(
  conversation: Conversation,
  messageId: string,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();

  const messageIndex = conversation.messages.findIndex((m) => m.id === messageId);
  if (messageIndex === -1) {
    return conversation;
  }

  const messages = conversation.messages
    .filter((m) => m.id !== messageId)
    .map((message, index) =>
      message.position === index
        ? message
        : createMessage({
            id: message.id,
            role: message.role,
            content:
              typeof message.content === 'string'
                ? message.content
                : [...(message.content as MultiModalContent[])],
            position: index,
            createdAt: message.createdAt,
            metadata: { ...message.metadata },
            hidden: message.hidden,
            toolCall: message.toolCall ? { ...message.toolCall } : undefined,
            toolResult: message.toolResult ? { ...message.toolResult } : undefined,
            tokenUsage: message.tokenUsage ? { ...message.tokenUsage } : undefined,
            goalCompleted: message.goalCompleted,
          }),
    );

  return toReadonly({
    ...conversation,
    messages,
    updatedAt: now,
  });
}
