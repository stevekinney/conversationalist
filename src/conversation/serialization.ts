import { createInvalidPositionError, createSerializationError } from '../errors';
import { copyContent } from '../multi-modal';
import type {
  Conversation,
  ConversationJSON,
  Message,
  MessageJSON,
  SerializeOptions,
} from '../types';
import { CURRENT_SCHEMA_VERSION } from '../types';
import { createMessage, toReadonly } from '../utilities';
import { sortMessagesByPosition, sortObjectKeys } from '../utilities/deterministic';
import { stripTransientFromRecord } from '../utilities/transient';
import { assertToolReference, registerToolUse, type ToolUseIndex } from './tool-tracking';

/** Placeholder used when redacting sensitive data */
const REDACTED = '[REDACTED]';

/**
 * Migrates a conversation JSON object to the current schema version.
 * Handles data from older versions that may not have a schemaVersion field.
 *
 * @param json - The conversation JSON to migrate (may be from an older version)
 * @returns A ConversationJSON with the current schema version
 *
 * @example
 * ```ts
 * // Old data without schemaVersion
 * const old = { id: 'conv-1', status: 'active', ... };
 * const migrated = migrateConversationJSON(old);
 * // migrated.schemaVersion === CURRENT_SCHEMA_VERSION
 * ```
 */
export function migrateConversationJSON(json: unknown): ConversationJSON {
  // Handle non-object input
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: '',
      status: 'active',
      metadata: {},
      tags: [],
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const data = json as ConversationJSON;

  // If no schemaVersion, assume pre-versioning data (version 0) and add it
  if (!('schemaVersion' in json)) {
    return {
      ...data,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }

  // Future: add migration logic between versions here
  return data;
}

/**
 * Converts a conversation to a plain JSON-serializable object.
 * Creates deep copies of all nested objects to ensure immutability.
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
 *   deterministic: true,
 *   stripTransient: true,
 *   redactToolArguments: true,
 * });
 * ```
 */
export function serializeConversation(
  conversation: Conversation,
  options: SerializeOptions = {},
): ConversationJSON {
  const {
    deterministic = false,
    stripTransient = false,
    redactToolArguments = false,
    redactToolResults = false,
  } = options;

  // Process conversation metadata
  let metadata = { ...conversation.metadata };
  if (stripTransient) {
    metadata = stripTransientFromRecord(metadata);
  }

  // Process messages
  let messages: MessageJSON[] = conversation.messages.map((m) => {
    let msgMetadata = { ...m.metadata };
    if (stripTransient) {
      msgMetadata = stripTransientFromRecord(msgMetadata);
    }

    return {
      id: m.id,
      role: m.role,
      content: copyContent(m.content),
      position: m.position,
      createdAt: m.createdAt,
      metadata: msgMetadata,
      hidden: m.hidden,
      toolCall: m.toolCall
        ? {
            ...m.toolCall,
            arguments: redactToolArguments ? REDACTED : m.toolCall.arguments,
          }
        : undefined,
      toolResult: m.toolResult
        ? {
            ...m.toolResult,
            content: redactToolResults ? REDACTED : m.toolResult.content,
          }
        : undefined,
      tokenUsage: m.tokenUsage ? { ...m.tokenUsage } : undefined,
      goalCompleted: m.goalCompleted,
    };
  });

  // Sort messages if deterministic
  if (deterministic) {
    messages = sortMessagesByPosition(messages);
  }

  let result: ConversationJSON = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    metadata,
    tags: [...conversation.tags],
    messages,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };

  // Sort keys if deterministic
  if (deterministic) {
    result = sortObjectKeys(result);
  }

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
  const migrated = migrateConversationJSON(json);

  try {
    migrated.messages.reduce<{ toolUses: ToolUseIndex }>(
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

    const messages: Message[] = migrated.messages.map((m) => createMessage(m));
    const conv: Conversation = {
      id: migrated.id,
      title: migrated.title,
      status: migrated.status,
      metadata: { ...migrated.metadata },
      tags: [...migrated.tags],
      messages,
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
