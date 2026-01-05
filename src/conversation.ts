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
  Conversation,
  ConversationJSON,
  ConversationStatus,
  Message,
  MessageInput,
  MessageJSON,
  SerializeOptions,
} from './types';
import { CURRENT_SCHEMA_VERSION } from './types';
import {
  createMessage,
  messageHasImages,
  normalizeContent,
  sortMessagesByPosition,
  sortObjectKeys,
  stripTransientFromRecord,
  toReadonly,
} from './utilities';

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
  const startPosition = conversation.messages.length;
  const initialToolUses = buildToolUseIndex(conversation.messages);

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

      const message = createMessage({
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
        goalCompleted: processedInput.goalCompleted,
      });

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

  const next: Conversation = {
    ...conversation,
    messages: [...conversation.messages, ...messages],
    updatedAt: now,
  };
  return toReadonly(next);
}

export function appendUserMessage(
  conversation: Conversation,
  content: MessageInput['content'],
  metadata?: Record<string, unknown>,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  return environment
    ? appendMessages(conversation, { role: 'user', content, metadata }, environment)
    : appendMessages(conversation, { role: 'user', content, metadata });
}

export function appendAssistantMessage(
  conversation: Conversation,
  content: MessageInput['content'],
  metadata?: Record<string, unknown>,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  return environment
    ? appendMessages(conversation, { role: 'assistant', content, metadata }, environment)
    : appendMessages(conversation, { role: 'assistant', content, metadata });
}

export function appendSystemMessage(
  conversation: Conversation,
  content: string,
  metadata?: Record<string, unknown>,
  environment?: Partial<ConversationEnvironment>,
): Conversation {
  return environment
    ? appendMessages(conversation, { role: 'system', content, metadata }, environment)
    : appendMessages(conversation, { role: 'system', content, metadata });
}

export function getConversationMessages(
  conversation: Conversation,
  options?: { includeHidden?: boolean },
): ReadonlyArray<Message> {
  const includeHidden = options?.includeHidden ?? false;
  return includeHidden
    ? [...conversation.messages]
    : conversation.messages.filter((m) => !m.hidden);
}

export function getMessageAtPosition(
  conversation: Conversation,
  position: number,
): Message | undefined {
  return conversation.messages[position];
}

export function getMessageByIdentifier(
  conversation: Conversation,
  id: string,
): Message | undefined {
  return conversation.messages.find((m) => m.id === id);
}

export function searchConversationMessages(
  conversation: Conversation,
  predicate: (m: Message) => boolean,
): Message[] {
  return conversation.messages.filter(predicate);
}

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

export function hasSystemMessage(conversation: Conversation): boolean {
  return conversation.messages.some((m) => m.role === 'system');
}

export function getFirstSystemMessage(conversation: Conversation): Message | undefined {
  return conversation.messages.find((m) => m.role === 'system');
}

export function getSystemMessages(conversation: Conversation): ReadonlyArray<Message> {
  return conversation.messages.filter((m) => m.role === 'system');
}

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

/** Placeholder used when redacting sensitive data */
const REDACTED = '[REDACTED]';

/**
 * Migrates a conversation JSON object to the current schema version.
 * Handles data from older versions that may not have a schemaVersion field.
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
  for (const message of conversation.messages) {
    if (message.hidden) continue;
    const externalRole = roleMap[message.role] as 'user' | 'assistant' | 'system';
    result.push({
      role: externalRole,
      content: message.content as string | MultiModalContent[],
    });
  }
  return result;
}
