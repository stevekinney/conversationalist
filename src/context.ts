import type { MultiModalContent } from '@lasercat/homogenaize';

import {
  type ConversationEnvironment,
  resolveConversationEnvironment,
} from './environment';
import type { Conversation, Message } from './types';
import { createMessage, messageText, toReadonly } from './utilities';

/**
 * Returns the last N messages from the conversation.
 * By default excludes system messages and hidden messages.
 */
export function getRecentMessages(
  conversation: Conversation,
  count: number,
  options?: {
    includeHidden?: boolean;
    includeSystem?: boolean;
  },
): ReadonlyArray<Message> {
  const includeHidden = options?.includeHidden ?? false;
  const includeSystem = options?.includeSystem ?? false;

  const filtered = conversation.messages.filter((m) => {
    if (!includeHidden && m.hidden) return false;
    if (!includeSystem && m.role === 'system') return false;
    return true;
  });

  return filtered.slice(-count);
}

/**
 * Truncates conversation to keep only messages from the specified position onwards.
 * Optionally preserves system messages regardless of position.
 */
export function truncateFromPosition(
  conversation: Conversation,
  position: number,
  options?: {
    preserveSystemMessages?: boolean;
  },
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const preserveSystem = options?.preserveSystemMessages ?? true;
  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();

  const systemMessages = preserveSystem
    ? conversation.messages.filter((m) => m.role === 'system' && m.position < position)
    : [];

  const keptMessages = conversation.messages.filter((m) => m.position >= position);
  const allMessages = [...systemMessages, ...keptMessages];

  // Renumber positions
  const renumbered = allMessages.map((message, index) =>
    createMessage({
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
    messages: renumbered,
    updatedAt: now,
  });
}

/**
 * Estimates total tokens in a conversation using the provided estimator function.
 */
export function estimateConversationTokens(
  conversation: Conversation,
  estimateTokens: (message: Message) => number,
): number {
  return conversation.messages.reduce(
    (total, message) => total + estimateTokens(message),
    0,
  );
}

/**
 * Simple character-based token estimator.
 * Approximates ~4 characters per token (rough average for English text).
 */
export function simpleTokenEstimator(message: Message): number {
  const text = messageText(message);
  return Math.ceil(text.length / 4);
}

/**
 * Truncates conversation to fit within an estimated token limit.
 * Removes oldest messages first while preserving system messages and optionally the last N messages.
 */
export function truncateToTokenLimit(
  conversation: Conversation,
  maxTokens: number,
  estimateTokens: (message: Message) => number,
  options?: {
    preserveSystemMessages?: boolean;
    preserveLastN?: number;
  },
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const preserveSystem = options?.preserveSystemMessages ?? true;
  const preserveLastN = options?.preserveLastN ?? 0;

  // Calculate current token count
  const currentTokens = estimateConversationTokens(conversation, estimateTokens);
  if (currentTokens <= maxTokens) {
    return conversation;
  }

  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();

  // Separate messages into categories
  const systemMessages = preserveSystem
    ? conversation.messages.filter((m) => m.role === 'system')
    : [];

  const nonSystemMessages = conversation.messages.filter((m) => m.role !== 'system');

  // Preserve the last N non-system messages
  const protectedMessages =
    preserveLastN > 0 ? nonSystemMessages.slice(-preserveLastN) : [];

  const removableMessages =
    preserveLastN > 0 ? nonSystemMessages.slice(0, -preserveLastN) : nonSystemMessages;

  // Calculate tokens for protected content
  const systemTokens = systemMessages.reduce((sum, m) => sum + estimateTokens(m), 0);
  const protectedTokens = protectedMessages.reduce(
    (sum, m) => sum + estimateTokens(m),
    0,
  );
  const availableTokens = maxTokens - systemTokens - protectedTokens;

  if (availableTokens <= 0) {
    // Can only fit system and protected messages
    const allMessages = [...systemMessages, ...protectedMessages];
    const renumbered = allMessages.map((message, index) =>
      createMessage({
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
      messages: renumbered,
      updatedAt: now,
    });
  }

  // Keep as many removable messages as possible, starting from the end (most recent)
  const keptRemovable: Message[] = [];
  let usedTokens = 0;

  for (let i = removableMessages.length - 1; i >= 0; i--) {
    const message = removableMessages[i]!;
    const messageTokens = estimateTokens(message);
    if (usedTokens + messageTokens <= availableTokens) {
      keptRemovable.unshift(message);
      usedTokens += messageTokens;
    } else {
      break;
    }
  }

  // Combine: system messages + kept removable + protected
  const allMessages = [...systemMessages, ...keptRemovable, ...protectedMessages];

  // Sort by original position then renumber
  allMessages.sort((a, b) => a.position - b.position);

  const renumbered = allMessages.map((message, index) =>
    createMessage({
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
    messages: renumbered,
    updatedAt: now,
  });
}
