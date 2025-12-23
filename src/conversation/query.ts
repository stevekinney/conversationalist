import type { Conversation, Message } from '../types';
import { messageHasImages } from '../utilities';

/**
 * Returns all messages from a conversation.
 * By default excludes hidden messages unless includeHidden is true.
 */
export function getConversationMessages(
  conversation: Conversation,
  options?: { includeHidden?: boolean },
): ReadonlyArray<Message> {
  const includeHidden = options?.includeHidden ?? false;
  return includeHidden
    ? [...conversation.messages]
    : conversation.messages.filter((m) => !m.hidden);
}

/**
 * Returns the message at the specified position index.
 * Returns undefined if no message exists at that position.
 */
export function getMessageAtPosition(
  conversation: Conversation,
  position: number,
): Message | undefined {
  return conversation.messages[position];
}

/**
 * Finds a message by its unique identifier.
 * Returns undefined if no message with that ID exists.
 */
export function getMessageByIdentifier(
  conversation: Conversation,
  id: string,
): Message | undefined {
  return conversation.messages.find((m) => m.id === id);
}

/**
 * Filters messages using a custom predicate function.
 * Returns all messages for which the predicate returns true.
 */
export function searchConversationMessages(
  conversation: Conversation,
  predicate: (m: Message) => boolean,
): Message[] {
  return conversation.messages.filter(predicate);
}

/**
 * Computes statistics about a conversation's messages.
 * Returns totals, counts by role, hidden message count, and image count.
 */
export function computeConversationStatistics(conversation: Conversation): {
  total: number;
  byRole: Record<string, number>;
  hidden: number;
  withImages: number;
} {
  const stats = conversation.messages.reduce(
    (acc, message) => {
      const byRole = {
        ...acc.byRole,
        [message.role]: (acc.byRole[message.role] ?? 0) + 1,
      };

      return {
        byRole,
        hidden: acc.hidden + (message.hidden ? 1 : 0),
        withImages: acc.withImages + (messageHasImages(message) ? 1 : 0),
      };
    },
    { byRole: {} as Record<string, number>, hidden: 0, withImages: 0 },
  );
  return { total: conversation.messages.length, ...stats };
}
