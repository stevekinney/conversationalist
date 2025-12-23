import { createInvalidPositionError, createSerializationError } from '../errors';
import { copyContent } from '../multi-modal';
import type { Conversation, ConversationJSON, Message } from '../types';
import { createMessage, toReadonly } from '../utilities';
import { assertToolReference, registerToolUse, type ToolUseIndex } from './tool-tracking';

/**
 * Converts a conversation to a plain JSON-serializable object.
 * Creates deep copies of all nested objects to ensure immutability.
 */
export function serializeConversation(conversation: Conversation): ConversationJSON {
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    metadata: { ...conversation.metadata },
    tags: [...conversation.tags],
    messages: conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: copyContent(m.content),
      position: m.position,
      createdAt: m.createdAt,
      metadata: { ...m.metadata },
      hidden: m.hidden,
      toolCall: m.toolCall ? { ...m.toolCall } : undefined,
      toolResult: m.toolResult ? { ...m.toolResult } : undefined,
      tokenUsage: m.tokenUsage ? { ...m.tokenUsage } : undefined,
      goalCompleted: m.goalCompleted,
    })),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

/**
 * Reconstructs a conversation from a JSON object.
 * Validates message positions are contiguous and tool results reference valid calls.
 * Throws a serialization error if validation fails.
 */
export function deserializeConversation(json: ConversationJSON): Conversation {
  try {
    json.messages.reduce<{ toolUses: ToolUseIndex }>(
      (state, message, index) => {
        if (message.position !== index) {
          throw createInvalidPositionError(index, message.position);
        }

        if (message.role === 'tool-use' && message.toolCall) {
          return {
            toolUses: registerToolUse(state.toolUses, message.toolCall),
          };
        }

        if (message.role === 'tool-result' && message.toolResult) {
          assertToolReference(state.toolUses, message.toolResult.callId);
        }

        return state;
      },
      { toolUses: new Map<string, { name: string }>() },
    );

    const messages: Message[] = json.messages.map((m) => createMessage(m));
    const conv: Conversation = {
      id: json.id,
      title: json.title,
      status: json.status,
      metadata: { ...json.metadata },
      tags: [...json.tags],
      messages,
      createdAt: json.createdAt,
      updatedAt: json.updatedAt,
    };
    return toReadonly(conv);
  } catch (error) {
    throw createSerializationError(
      `failed to deserialize conversation: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error as Error,
    );
  }
}
