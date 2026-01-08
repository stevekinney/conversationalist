import type {
  Message as ExternalMessage,
  MultiModalContent,
} from '@lasercat/homogenaize';

import {
  type ConversationEnvironment,
  isConversationEnvironmentParameter,
  resolveConversationEnvironment,
} from './environment';
import {
  createInvalidPositionError,
  createInvalidToolReferenceError,
  createSerializationError,
} from './errors';
import { copyContent } from './multi-modal';
import type {
  AssistantMessage,
  Conversation,
  ConversationStatus,
  JSONValue,
  Message,
  MessageInput,
} from './types';
import { CURRENT_SCHEMA_VERSION } from './types';
import {
  createMessage,
  messageHasImages,
  normalizeContent,
  toReadonly,
} from './utilities';
import { getOrderedMessages, toIdRecord } from './utilities/message-store';

export type { ConversationEnvironment } from './environment';

type ToolUseIndex = Map<string, { name: string }>;

const buildToolUseIndex = (messages: ReadonlyArray<Message>): ToolUseIndex =>
  messages.reduce((index, message) => {
    if (message.role === 'tool-use' && message.toolCall) {
      index.set(message.toolCall.id, { name: message.toolCall.name });
    }
    return index;
  }, new Map<string, { name: string }>());

const registerToolUse = (
  index: ToolUseIndex,
  toolCall: { id: string; name: string },
): ToolUseIndex => {
  const next = new Map(index);
  next.set(toolCall.id, { name: toolCall.name });
  return next;
};

const assertToolReference = (index: ToolUseIndex, callId: string): void => {
  if (!index.has(callId)) {
    throw createInvalidToolReferenceError(callId);
  }
};

function partitionAppendArgs(
  args: Array<MessageInput | Partial<ConversationEnvironment>>,
): {
  inputs: MessageInput[];
  environment?: Partial<ConversationEnvironment> | undefined;
} {
  if (args.length === 0) {
    return { inputs: [] };
  }

  const last = args[args.length - 1];
  if (isConversationEnvironmentParameter(last)) {
    return {
      inputs: args.slice(0, -1) as MessageInput[],
      environment: last,
    };
  }

  return { inputs: args as MessageInput[] };
}

/**
 * Creates a new immutable conversation with optional metadata and environment overrides.
 */
export function createConversation(
  options?: {
    id?: string;
    title?: string;
    status?: ConversationStatus;
    metadata?: Record<string, JSONValue>;
  },
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();
  const conv: Conversation = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options?.id ?? resolvedEnvironment.randomId(),
    title: options?.title,
    status: options?.status ?? 'active',
    metadata: { ...(options?.metadata ?? {}) },
    ids: [],
    messages: {},
    createdAt: now,
    updatedAt: now,
  };
  return toReadonly(conv);
}

/**
 * Appends one or more messages to a conversation.
 * Validates tool-result references and returns a new immutable conversation.
 */
export function appendMessages(
  conversation: Conversation,
  ...inputs: MessageInput[]
): Conversation;
export function appendMessages(
  conversation: Conversation,
  ...inputsAndEnvironment: [...MessageInput[], Partial<ConversationEnvironment>]
): Conversation;
export function appendMessages(
  conversation: Conversation,
  ...args: (MessageInput | Partial<ConversationEnvironment>)[]
): Conversation {
  const { inputs, environment } = partitionAppendArgs(args);
  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();
  const startPosition = conversation.ids.length;
  const initialToolUses = buildToolUseIndex(getOrderedMessages(conversation));

  const { messages } = inputs.reduce<{
    toolUses: ToolUseIndex;
    messages: Message[];
  }>(
    (state, input, index) => {
      // Apply plugins to the input
      const processedInput = resolvedEnvironment.plugins.reduce(
        (acc, plugin) => plugin(acc),
        input,
      );

      if (processedInput.role === 'tool-result' && processedInput.toolResult) {
        assertToolReference(state.toolUses, processedInput.toolResult.callId);
      }

      const normalizedContent = normalizeContent(processedInput.content) as
        | string
        | MultiModalContent[];

      const baseMessage = {
        id: resolvedEnvironment.randomId(),
        role: processedInput.role,
        content: normalizedContent,
        position: startPosition + index,
        createdAt: now,
        metadata: { ...(processedInput.metadata ?? {}) },
        hidden: processedInput.hidden ?? false,
        toolCall: processedInput.toolCall,
        toolResult: processedInput.toolResult,
        tokenUsage: processedInput.tokenUsage,
      };

      let message: Message;
      if (processedInput.role === 'assistant') {
        const assistantMessage: AssistantMessage = {
          ...baseMessage,
          role: 'assistant',
          goalCompleted: processedInput.goalCompleted,
        };
        message = createMessage(assistantMessage);
      } else {
        message = createMessage(baseMessage);
      }

      const toolUses =
        processedInput.role === 'tool-use' && processedInput.toolCall
          ? registerToolUse(state.toolUses, processedInput.toolCall)
          : state.toolUses;

      return {
        toolUses,
        messages: [...state.messages, message],
      };
    },
    { toolUses: initialToolUses, messages: [] },
  );

  const messageIds = messages.map((message) => message.id);
  const next: Conversation = {
    ...conversation,
    ids: [...conversation.ids, ...messageIds],
    messages: { ...conversation.messages, ...toIdRecord(messages) },
    updatedAt: now,
  };
  return toReadonly(next);
}

/**
 * Appends a user message to the conversation.
 */
export function appendUserMessage(
  conversation: Conversation,
  content: MessageInput['content'],
  metadata?: Record<string, JSONValue>,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  return environment
    ? appendMessages(conversation, { role: 'user', content, metadata }, environment)
    : appendMessages(conversation, { role: 'user', content, metadata });
}

/**
 * Appends an assistant message to the conversation.
 */
export function appendAssistantMessage(
  conversation: Conversation,
  content: MessageInput['content'],
  metadata?: Record<string, JSONValue>,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  return environment
    ? appendMessages(conversation, { role: 'assistant', content, metadata }, environment)
    : appendMessages(conversation, { role: 'assistant', content, metadata });
}

/**
 * Appends a system message to the conversation.
 */
export function appendSystemMessage(
  conversation: Conversation,
  content: string,
  metadata?: Record<string, JSONValue>,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  return environment
    ? appendMessages(conversation, { role: 'system', content, metadata }, environment)
    : appendMessages(conversation, { role: 'system', content, metadata });
}

/**
 * Returns messages from a conversation in order.
 * Hidden messages are excluded by default.
 */
export function getMessages(
  conversation: Conversation,
  options?: { includeHidden?: boolean },
): Message[] {
  const includeHidden = options?.includeHidden ?? false;
  const ordered = getOrderedMessages(conversation);
  return includeHidden ? ordered : ordered.filter((m) => !m.hidden);
}

/**
 * Returns the message at a specific position index.
 */
export function getMessageAtPosition(
  conversation: Conversation,
  position: number,
): Message | undefined {
  const id = conversation.ids[position];
  return id ? conversation.messages[id] : undefined;
}

/**
 * Returns all message IDs for the conversation in order.
 */
export function getMessageIds(conversation: Conversation): string[] {
  return [...conversation.ids];
}

/**
 * Finds a message by its unique identifier.
 */
export function getMessageById(
  conversation: Conversation,
  id: string,
): Message | undefined {
  return conversation.messages[id];
}

/**
 * Filters messages using a predicate.
 */
export function searchConversationMessages(
  conversation: Conversation,
  predicate: (m: Message) => boolean,
): Message[] {
  return getOrderedMessages(conversation).filter(predicate);
}

/**
 * Computes basic statistics about a conversation's messages.
 */
export function getStatistics(conversation: Conversation): {
  total: number;
  byRole: Record<string, number>;
  hidden: number;
  withImages: number;
} {
  const ordered = getOrderedMessages(conversation);
  const stats = ordered.reduce(
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
  return { total: ordered.length, ...stats };
}

/**
 * Returns true if the conversation contains any system messages.
 */
export function hasSystemMessage(conversation: Conversation): boolean {
  return getOrderedMessages(conversation).some((m) => m.role === 'system');
}

/**
 * Returns the first system message in the conversation, if any.
 */
export function getFirstSystemMessage(conversation: Conversation): Message | undefined {
  return getOrderedMessages(conversation).find((m) => m.role === 'system');
}

/**
 * Returns all system messages in the conversation.
 */
export function getSystemMessages(conversation: Conversation): ReadonlyArray<Message> {
  return getOrderedMessages(conversation).filter((m) => m.role === 'system');
}

/**
 * Prepends a system message and renumbers existing messages.
 */
export function prependSystemMessage(
  conversation: Conversation,
  content: string,
  metadata?: Record<string, JSONValue>,
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

  const ordered = getOrderedMessages(conversation);
  const renumberedMessages = ordered.map((message) =>
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
    ids: [newMessage.id, ...ordered.map((message) => message.id)],
    messages: toIdRecord([newMessage, ...renumberedMessages]),
    updatedAt: now,
  });
}

/**
 * Replaces the first system message, or prepends one if none exist.
 */
export function replaceSystemMessage(
  conversation: Conversation,
  content: string,
  metadata?: Record<string, JSONValue>,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const resolvedEnvironment = resolveConversationEnvironment(environment);
  const now = resolvedEnvironment.now();
  const ordered = getOrderedMessages(conversation);
  const firstSystemIndex = ordered.findIndex((m) => m.role === 'system');

  if (firstSystemIndex === -1) {
    return prependSystemMessage(conversation, content, metadata, resolvedEnvironment);
  }

  const original = ordered[firstSystemIndex]!;
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

  const next: Conversation = {
    ...conversation,
    ids: [...conversation.ids],
    messages: { ...conversation.messages, [replaced.id]: replaced },
    updatedAt: now,
  };
  return toReadonly(next);
}

/**
 * Collapses multiple system messages into a single deduplicated message.
 */
export function collapseSystemMessages(
  conversation: Conversation,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  const ordered = getOrderedMessages(conversation);
  const systemMessages = ordered.filter((m) => m.role === 'system');

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

  const messages = ordered
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
    ids: renumbered.map((message) => message.id),
    messages: toIdRecord(renumbered),
    updatedAt: now,
  };
  return toReadonly(next);
}

/**
 * Replaces message content at the specified position with a placeholder.
 * Clears tool and token metadata for the redacted message.
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

/**
 * Migrates a conversation JSON object to the current schema version.
 * Handles data from older versions that may not have a schemaVersion field.
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

/**
 * Converts a conversation into a provider-agnostic external message array.
 * Hidden messages are skipped and roles are normalized.
 */
export function toChatMessages(conversation: Conversation): ExternalMessage[] {
  const roleMap: Record<string, 'user' | 'assistant' | 'system'> = {
    user: 'user',
    assistant: 'assistant',
    system: 'system',
    developer: 'system',
    'tool-use': 'assistant',
    'tool-result': 'user',
    snapshot: 'system',
  };

  const result: ExternalMessage[] = [];
  for (const message of getOrderedMessages(conversation)) {
    if (message.hidden) continue;
    const externalRole = roleMap[message.role] as 'user' | 'assistant' | 'system';
    result.push({
      role: externalRole,
      content: message.content as string | MultiModalContent[],
    });
  }
  return result;
}
