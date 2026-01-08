import { createInvalidPositionError, createSerializationError } from '../errors';
import { copyContent } from '../multi-modal';
import type { AssistantMessage, Conversation, Message, SerializeOptions } from '../types';
import { CURRENT_SCHEMA_VERSION } from '../types';
import { createMessage, isAssistantMessage, toReadonly } from '../utilities';
import { getOrderedMessages, toIdRecord } from '../utilities/message-store';
import { copyToolResult, redactToolResult } from '../utilities/tool-results';
import { stripTransientFromRecord } from '../utilities/transient';
import { assertToolReference, registerToolUse, type ToolUseIndex } from './tool-tracking';

/** Placeholder used when redacting sensitive data */
const DEFAULT_REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Migrates a serialized conversation object to the current schema version.
 * Handles data from older versions that may not have a schemaVersion field.
 *
 * @param json - The conversation data to migrate (may be from an older version)
 * @returns A Conversation with the current schema version
 *
 * @example
 * ```ts
 * // Old data without schemaVersion
 * const old = { id: 'conv-1', status: 'active', ... };
 * const migrated = migrateConversation(old);
 * // migrated.schemaVersion === CURRENT_SCHEMA_VERSION
 * ```
 */
export function migrateConversation(json: unknown): Conversation {
  // Handle non-object input
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: '',
      status: 'active',
      metadata: {},
      tags: [],
      ids: [],
      messages: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const data = json as Conversation & { messages?: unknown };
  const rawMessages = data.messages;

  let messages: Record<string, Message> = {};
  let ids: string[] = [];
  const rawIds = (data as { ids?: unknown }).ids;
  const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');

  if (Array.isArray(rawMessages)) {
    const rawMessageArray = rawMessages as Message[];
    ids = rawMessageArray.map((message) => message.id);
    messages = Object.fromEntries(
      rawMessageArray.map((message) => [message.id, message]),
    );
  } else if (rawMessages && typeof rawMessages === 'object') {
    messages = { ...(rawMessages as Record<string, Message>) };
    if (isStringArray(rawIds) && rawIds.length > 0) {
      ids = [...rawIds];
    } else {
      ids = Object.values(messages)
        .sort((a, b) => a.position - b.position)
        .map((message) => message.id);
    }
  }

  if (ids.length > 0) {
    ids = ids.filter((id) => id in messages);
    const missing = Object.keys(messages).filter((id) => !ids.includes(id));
    if (missing.length > 0) {
      const sortedMissing = missing.sort(
        (a, b) => (messages[a]?.position ?? 0) - (messages[b]?.position ?? 0),
      );
      ids = [...ids, ...sortedMissing];
    }
  }

  // If no schemaVersion, assume pre-versioning data (version 0) and add it
  if (!('schemaVersion' in json)) {
    return {
      ...data,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      ids,
      messages,
    };
  }

  // Future: add migration logic between versions here
  return { ...data, ids, messages };
}

/**
 * Produces a sanitized clone of a conversation with optional redaction and metadata stripping.
 * Conversations are already JSON-serializable; this helper makes export-safe copies.
 *
 * @param conversation - The conversation to serialize
 * @param options - Serialization options
 * @returns A JSON-serializable conversation object
 *
 * @example
 * ```ts
 * // Basic serialization
 * const json = serializeConversation(conversation);
 *
 * // With options
 * const json = serializeConversation(conversation, {
 *   stripTransient: true,
 *   redactToolArguments: true,
 * });
 * ```
 */
export function serializeConversation(
  conversation: Conversation,
  options: SerializeOptions = {},
): Conversation {
  const {
    stripTransient = false,
    includeHidden = true,
    redactHiddenContent = false,
    redactedPlaceholder = DEFAULT_REDACTED_PLACEHOLDER,
    redactToolArguments = false,
    redactToolResults = false,
  } = options;

  // Process conversation metadata
  let metadata = { ...conversation.metadata };
  if (stripTransient) {
    metadata = stripTransientFromRecord(metadata);
  }

  // Process messages in order
  const messages: Message[] = getOrderedMessages(conversation)
    .filter((message) => includeHidden || !message.hidden)
    .map((m) => {
      let msgMetadata = { ...m.metadata };
      if (stripTransient) {
        msgMetadata = stripTransientFromRecord(msgMetadata);
      }

      const content =
        redactHiddenContent && m.hidden ? redactedPlaceholder : copyContent(m.content);

      const baseMessage = {
        id: m.id,
        role: m.role,
        content,
        position: m.position,
        createdAt: m.createdAt,
        metadata: msgMetadata,
        hidden: m.hidden,
        toolCall: m.toolCall
          ? {
              ...m.toolCall,
              arguments: redactToolArguments ? redactedPlaceholder : m.toolCall.arguments,
            }
          : undefined,
        toolResult: m.toolResult
          ? redactToolResults
            ? redactToolResult(m.toolResult, redactedPlaceholder)
            : copyToolResult(m.toolResult)
          : undefined,
        tokenUsage: m.tokenUsage ? { ...m.tokenUsage } : undefined,
      };

      if (isAssistantMessage(m)) {
        const assistantMessage: AssistantMessage = {
          ...baseMessage,
          role: 'assistant',
          goalCompleted: m.goalCompleted,
        };
        return assistantMessage;
      }

      return baseMessage;
    });

  const ids = messages.map((message) => message.id);
  const messageRecord = toIdRecord(messages);

  const result: Conversation = {
    schemaVersion: conversation.schemaVersion,
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    metadata,
    tags: [...conversation.tags],
    ids,
    messages: messageRecord,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };

  return result;
}

/**
 * Reconstructs a conversation from a JSON object.
 * Automatically migrates data from older schema versions.
 * Validates message positions are contiguous and tool results reference valid calls.
 * Throws a serialization error if validation fails.
 *
 * @param json - The conversation JSON to deserialize (may be from an older version)
 * @returns A Conversation object
 * @throws {SerializationError} If validation fails
 */
export function deserializeConversation(json: unknown): Conversation {
  // Migrate to current schema version
  const migrated = migrateConversation(json);

  try {
    const orderedMessages = migrated.ids.map((id, index) => {
      const message = migrated.messages[id];
      if (!message) {
        throw createSerializationError(`missing message for id ${id}`);
      }
      if (message.position !== index) {
        throw createInvalidPositionError(index, message.position);
      }
      return message;
    });

    orderedMessages.reduce<{ toolUses: ToolUseIndex }>(
      (state, message) => {
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

    const messageInstances: Message[] = orderedMessages.map((m) => createMessage(m));
    const conv: Conversation = {
      schemaVersion: migrated.schemaVersion,
      id: migrated.id,
      title: migrated.title,
      status: migrated.status,
      metadata: { ...migrated.metadata },
      tags: [...migrated.tags],
      ids: orderedMessages.map((message) => message.id),
      messages: toIdRecord(messageInstances),
      createdAt: migrated.createdAt,
      updatedAt: migrated.updatedAt,
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
