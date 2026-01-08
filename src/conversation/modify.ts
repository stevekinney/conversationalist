import {
  type ConversationEnvironment,
  resolveConversationEnvironment,
} from '../environment';
import { createInvalidPositionError } from '../errors';
import type { Conversation, Message } from '../types';
import { createMessage, toReadonly } from '../utilities';

/**
 * Replaces the content of a message at the specified position with a placeholder.
 * Preserves all other message properties except toolCall, toolResult, and tokenUsage.
 * Throws if the position is out of bounds.
 */
export function redactMessageAtPosition(
  conversation: Conversation,
  position: number,
  placeholder: string = '[REDACTED]',
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  if (position < 0 || position >= conversation.ids.length) {
    throw createInvalidPositionError(conversation.ids.length - 1, position);
  }

  const id = conversation.ids[position];
  const original = id ? conversation.messages[id] : undefined;
  if (!original) {
    throw createInvalidPositionError(conversation.ids.length - 1, position);
  }
  const redacted: Message = createMessage({
    id: original.id,
    role: original.role,
    content: placeholder,
    position: original.position,
    createdAt: original.createdAt,
    metadata: { ...original.metadata },
    hidden: original.hidden,
    toolCall: undefined,
    toolResult: undefined,
    tokenUsage: undefined,
  });

  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();
  const next: Conversation = {
    ...conversation,
    ids: [...conversation.ids],
    messages: { ...conversation.messages, [redacted.id]: redacted },
    updatedAt: now,
  };
  return toReadonly(next);
}
