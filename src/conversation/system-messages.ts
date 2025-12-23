import {
  type ConversationEnvironment,
  resolveConversationEnvironment,
} from '../environment';
import { copyContent } from '../multi-modal';
import type { Conversation, Message } from '../types';
import { createMessage, toReadonly } from '../utilities';

/**
 * Checks if a conversation contains any system messages.
 */
export function hasSystemMessage(conversation: Conversation): boolean {
  return conversation.messages.some((m) => m.role === 'system');
}

/**
 * Returns the first system message in the conversation.
 * Returns undefined if no system message exists.
 */
export function getFirstSystemMessage(conversation: Conversation): Message | undefined {
  return conversation.messages.find((m) => m.role === 'system');
}

/**
 * Returns all system messages in the conversation.
 */
export function getSystemMessages(conversation: Conversation): ReadonlyArray<Message> {
  return conversation.messages.filter((m) => m.role === 'system');
}

/**
 * Inserts a system message at the beginning of the conversation.
 * Renumbers all existing message positions.
 */
export function prependSystemMessage(
  conversation: Conversation,
  content: string,
  metadata?: Record<string, unknown>,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();

  const newMessage: Message = createMessage({
    id: resolvedEnvironment.randomId(),
    role: 'system',
    content,
    position: 0,
    createdAt: now,
    metadata: { ...(metadata ?? {}) },
    hidden: false,
    toolCall: undefined,
    toolResult: undefined,
    tokenUsage: undefined,
  });

  const renumberedMessages = conversation.messages.map((message) =>
    createMessage({
      id: message.id,
      role: message.role,
      content: copyContent(message.content),
      position: message.position + 1,
      createdAt: message.createdAt,
      metadata: { ...message.metadata },
      hidden: message.hidden,
      toolCall: message.toolCall,
      toolResult: message.toolResult,
      tokenUsage: message.tokenUsage,
    }),
  );

  return toReadonly({
    ...conversation,
    messages: [newMessage, ...renumberedMessages],
    updatedAt: now,
  });
}

/**
 * Replaces the first system message with new content.
 * If no system message exists, prepends a new one.
 */
export function replaceSystemMessage(
  conversation: Conversation,
  content: string,
  metadata?: Record<string, unknown>,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();
  const firstSystemIndex = conversation.messages.findIndex((m) => m.role === 'system');

  if (firstSystemIndex === -1) {
    return prependSystemMessage(conversation, content, metadata, resolvedEnvironment);
  }

  const original = conversation.messages[firstSystemIndex]!;
  const replaced: Message = createMessage({
    id: original.id,
    role: 'system',
    content,
    position: original.position,
    createdAt: original.createdAt,
    metadata: { ...(metadata ?? original.metadata) },
    hidden: original.hidden,
    toolCall: undefined,
    toolResult: undefined,
    tokenUsage: undefined,
  });

  const messages = conversation.messages.map((message, index) =>
    index === firstSystemIndex ? replaced : message,
  );

  const next: Conversation = { ...conversation, messages, updatedAt: now };
  return toReadonly(next);
}

/**
 * Merges all system messages into a single message at the first position.
 * Duplicate content is removed. Returns unchanged if 0 or 1 system messages.
 */
export function collapseSystemMessages(
  conversation: Conversation,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const systemMessages = conversation.messages.filter((m) => m.role === 'system');

  if (systemMessages.length <= 1) {
    return conversation;
  }

  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();

  const { parts } = systemMessages.reduce(
    (state, message) => {
      const contentStr =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('');

      if (!contentStr || state.seen.has(contentStr)) {
        return state;
      }

      const seen = new Set(state.seen);
      seen.add(contentStr);

      return { seen, parts: [...state.parts, contentStr] };
    },
    { seen: new Set<string>(), parts: [] as string[] },
  );

  const collapsedContent = parts.join('\n');
  const firstSystemMsg = systemMessages[0]!;

  const collapsed: Message = createMessage({
    id: firstSystemMsg.id,
    role: 'system',
    content: collapsedContent,
    position: firstSystemMsg.position,
    createdAt: firstSystemMsg.createdAt,
    metadata: { ...firstSystemMsg.metadata },
    hidden: firstSystemMsg.hidden,
    toolCall: undefined,
    toolResult: undefined,
    tokenUsage: undefined,
  });

  const systemIdsToRemove = systemMessages.slice(1).reduce((ids, message) => {
    const nextIds = new Set(ids);
    nextIds.add(message.id);
    return nextIds;
  }, new Set<string>());

  const messages = conversation.messages
    .filter((m) => !systemIdsToRemove.has(m.id))
    .map((m) => (m.id === firstSystemMsg.id ? collapsed : m));

  const renumbered = messages.map((message, index) => {
    if (message.position === index) return message;
    return createMessage({
      id: message.id,
      role: message.role,
      content: copyContent(message.content),
      position: index,
      createdAt: message.createdAt,
      metadata: { ...message.metadata },
      hidden: message.hidden,
      toolCall: message.toolCall,
      toolResult: message.toolResult,
      tokenUsage: message.tokenUsage,
    });
  });

  const next: Conversation = {
    ...conversation,
    messages: renumbered,
    updatedAt: now,
  };
  return toReadonly(next);
}
