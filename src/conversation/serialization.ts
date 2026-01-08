import { createInvalidPositionError, createSerializationError } from '../errors';
import type { Conversation, Message } from '../types';
import { CURRENT_SCHEMA_VERSION } from '../types';
import { createMessage, toReadonly } from '../utilities';
import { toIdRecord } from '../utilities/message-store';
import { assertToolReference, registerToolUse, type ToolUseIndex } from './tool-tracking';

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
