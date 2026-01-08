import type { MultiModalContent } from '@lasercat/homogenaize';

import {
  type ConversationEnvironment,
  isConversationEnvironmentParameter,
  resolveConversationEnvironment,
  simpleTokenEstimator,
} from './environment';
import { copyContent } from './multi-modal';
import type { AssistantMessage, Conversation, Message, TokenEstimator } from './types';
import { createMessage, isAssistantMessage, toReadonly } from './utilities';
import { getOrderedMessages, toIdRecord } from './utilities/message-store';

export { simpleTokenEstimator };

const cloneMessageWithPosition = (
  message: Message,
  position: number,
  content: string | ReadonlyArray<MultiModalContent>,
): Message => {
  const baseMessage = {
    id: message.id,
    role: message.role,
    content,
    position,
    createdAt: message.createdAt,
    metadata: { ...message.metadata },
    hidden: message.hidden,
    toolCall: message.toolCall ? { ...message.toolCall } : undefined,
    toolResult: message.toolResult ? { ...message.toolResult } : undefined,
    tokenUsage: message.tokenUsage ? { ...message.tokenUsage } : undefined,
  };

  if (isAssistantMessage(message)) {
    const assistantMessage: AssistantMessage = {
      ...baseMessage,
      role: 'assistant',
      goalCompleted: message.goalCompleted,
    };
    return createMessage(assistantMessage);
  }

  return createMessage(baseMessage);
};

/**
 * Estimates total tokens in a conversation using the provided estimator function.
 * If no estimator is provided, the environment's default estimator is used.
 */
export function estimateConversationTokens(
  conversation: Conversation,
  estimateTokens?: TokenEstimator,
  environment?: Partial<ConversationEnvironment>,
): number {
  let estimator = estimateTokens;
  let env = environment;

  if (
    !environment &&
    estimateTokens &&
    isConversationEnvironmentParameter(estimateTokens)
  ) {
    env = estimateTokens;
    estimator = undefined;
  }

  const resolvedEnvironment = resolveConversationEnvironment(env);
  const finalEstimator =
    typeof estimator === 'function' ? estimator : resolvedEnvironment.estimateTokens;

  return getOrderedMessages(conversation).reduce(
    (total, message) => total + finalEstimator(message),
    0,
  );
}

/**
 * Options for truncateToTokenLimit.
 */
export interface TruncateOptions {
  estimateTokens?: TokenEstimator;
  preserveSystemMessages?: boolean;
  preserveLastN?: number;
}

/**
 * Truncates conversation to fit within an estimated token limit.
 * Removes oldest messages first while preserving system messages and optionally the last N messages.
 * If no estimator is provided, the environment's default estimator is used.
 */
export function truncateToTokenLimit(
  conversation: Conversation,
  maxTokens: number,
  optionsOrEstimator?: TruncateOptions | TokenEstimator,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  // Handle overloaded arguments
  let options: TruncateOptions = {};
  let env = environment;

  if (typeof optionsOrEstimator === 'function') {
    options = { estimateTokens: optionsOrEstimator };
  } else if (optionsOrEstimator) {
    // If environment was not explicitly passed, check if optionsOrEstimator IS the environment
    if (!environment && isConversationEnvironmentParameter(optionsOrEstimator)) {
      // Disambiguate between TruncateOptions and ConversationEnvironment.
      // Environment fields (now, randomId, non-empty plugins) take priority because they're
      // exclusive to ConversationEnvironment, while estimateTokens exists in both types.
      const candidate = optionsOrEstimator as Record<string, unknown>;
      const hasEnvFields = !!(
        candidate['now'] ||
        candidate['randomId'] ||
        (Array.isArray(candidate['plugins']) && candidate['plugins'].length > 0)
      );

      if (hasEnvFields) {
        // Treat as environment, not options
        env = optionsOrEstimator;
      } else {
        // Has estimateTokens but no exclusive environment fields, treat as options
        options = optionsOrEstimator;
      }
    } else {
      options = optionsOrEstimator;
    }
  }

  const resolvedEnvironment = resolveConversationEnvironment(env);
  const estimator = options.estimateTokens ?? resolvedEnvironment.estimateTokens;
  const preserveSystem = options.preserveSystemMessages ?? true;
  const preserveLastN = options.preserveLastN ?? 0;

  // Calculate current token count
  const currentTokens = estimateConversationTokens(
    conversation,
    estimator,
    resolvedEnvironment,
  );
  if (currentTokens <= maxTokens) {
    return conversation;
  }

  const now = resolvedEnvironment.now();

  // Separate messages into categories
  const orderedMessages = getOrderedMessages(conversation);
  const systemMessages = preserveSystem
    ? orderedMessages.filter((m) => m.role === 'system')
    : [];

  const nonSystemMessages = orderedMessages.filter((m) => m.role !== 'system');

  // Preserve the last N non-system messages
  const protectedMessages =
    preserveLastN > 0 ? nonSystemMessages.slice(-preserveLastN) : [];

  const removableMessages =
    preserveLastN > 0 ? nonSystemMessages.slice(0, -preserveLastN) : nonSystemMessages;

  // Calculate tokens for protected content
  const systemTokens = systemMessages.reduce((sum, m) => sum + estimator(m), 0);
  const protectedTokens = protectedMessages.reduce((sum, m) => sum + estimator(m), 0);
  const availableTokens = maxTokens - systemTokens - protectedTokens;

  if (availableTokens <= 0) {
    // Can only fit system and protected messages
    const allMessages = [...systemMessages, ...protectedMessages];
    const renumbered = allMessages.map((message, index) =>
      cloneMessageWithPosition(message, index, copyContent(message.content)),
    );

    return toReadonly({
      ...conversation,
      ids: renumbered.map((message) => message.id),
      messages: toIdRecord(renumbered),
      updatedAt: now,
    });
  }

  // Keep as many removable messages as possible, starting from the end (most recent)
  const keptRemovable: Message[] = [];
  let usedTokens = 0;

  for (let i = removableMessages.length - 1; i >= 0; i--) {
    const message = removableMessages[i]!;
    const messageTokens = estimator(message);
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
    cloneMessageWithPosition(message, index, copyContent(message.content)),
  );

  return toReadonly({
    ...conversation,
    ids: renumbered.map((message) => message.id),
    messages: toIdRecord(renumbered),
    updatedAt: now,
  });
}

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

  const filtered = getOrderedMessages(conversation).filter((m) => {
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

  const ordered = getOrderedMessages(conversation);
  const systemMessages = preserveSystem
    ? ordered.filter((m) => m.role === 'system' && m.position < position)
    : [];

  const keptMessages = ordered.filter((m) => m.position >= position);
  const allMessages = [...systemMessages, ...keptMessages];

  // Renumber positions
  const renumbered = allMessages.map((message, index) =>
    cloneMessageWithPosition(message, index, copyContent(message.content)),
  );

  return toReadonly({
    ...conversation,
    ids: renumbered.map((message) => message.id),
    messages: toIdRecord(renumbered),
    updatedAt: now,
  });
}
