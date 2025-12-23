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
  if (position < 0 || position >= conversation.messages.length) {
    throw createInvalidPositionError(conversation.messages.length - 1, position);
  }

  const original = conversation.messages[position]!;
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
  const messages = conversation.messages.map((message, index) =>
    index === position ? redacted : message,
  );

  const next: Conversation = { ...conversation, messages, updatedAt: now };
  return toReadonly(next);
}
