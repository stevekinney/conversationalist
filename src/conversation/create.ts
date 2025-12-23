import {
  type ConversationEnvironment,
  resolveConversationEnvironment,
} from '../environment';
import type { Conversation, ConversationStatus } from '../types';
import { toReadonly } from '../utilities';

/**
 * Creates a new empty conversation with the specified options.
 * Returns an immutable conversation object with timestamps set to the current time.
 */
export function createConversation(
  options?: {
    id?: string;
    title?: string;
    status?: ConversationStatus;
    metadata?: Record<string, unknown>;
    tags?: string[];
  },
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();
  const conv: Conversation = {
    id: options?.id ?? resolvedEnvironment.randomId(),
    title: options?.title,
    status: options?.status ?? 'active',
    metadata: { ...(options?.metadata ?? {}) },
    tags: [...(options?.tags ?? [])],
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  return toReadonly(conv);
}
