import type { MultiModalContent } from '@lasercat/homogenaize';

import {
  type ConversationEnvironment,
  isConversationEnvironmentParameter,
  resolveConversationEnvironment,
} from '../environment';
import type {
  AssistantMessage,
  Conversation,
  JSONValue,
  Message,
  MessageInput,
} from '../types';
import { createMessage, normalizeContent, toReadonly } from '../utilities';
import { getOrderedMessages, toIdRecord } from '../utilities/message-store';
import {
  assertToolReference,
  buildToolUseIndex,
  registerToolUse,
  type ToolUseIndex,
} from './tool-tracking';

/**
 * Separates message inputs from an optional trailing environment argument.
 */
function partitionAppendArgs(
  args: Array<MessageInput | Partial<ConversationEnvironment> | undefined>,
): {
  inputs: MessageInput[];
  environment?: Partial<ConversationEnvironment> | undefined;
} {
  const filtered = args.filter((arg) => arg !== undefined);

  if (filtered.length === 0) {
    return { inputs: [] };
  }

  const last = filtered[filtered.length - 1];
  if (isConversationEnvironmentParameter(last)) {
    return {
      inputs: filtered.slice(0, -1) as MessageInput[],
      environment: last,
    };
  }

  return { inputs: filtered as MessageInput[] };
}

/**
 * Appends one or more messages to a conversation.
 * Validates that tool results reference existing function calls.
 * Returns a new immutable conversation with the messages added.
 */
export function appendMessages(
  conversation: Conversation,
  ...inputs: MessageInput[]
): Conversation;
export function appendMessages(
  conversation: Conversation,
  ...inputsAndEnvironment: [
    ...MessageInput[],
    Partial<ConversationEnvironment> | undefined,
  ]
): Conversation;
export function appendMessages(
  conversation: Conversation,
  ...args: (MessageInput | Partial<ConversationEnvironment> | undefined)[]
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
      if (input.role === 'tool-result' && input.toolResult) {
        assertToolReference(state.toolUses, input.toolResult.callId);
      }

      const normalizedContent = normalizeContent(input.content) as
        | string
        | MultiModalContent[];

      const baseMessage = {
        id: resolvedEnvironment.randomId(),
        role: input.role,
        content: normalizedContent,
        position: startPosition + index,
        createdAt: now,
        metadata: { ...(input.metadata ?? {}) },
        hidden: input.hidden ?? false,
        toolCall: input.toolCall,
        toolResult: input.toolResult,
        tokenUsage: input.tokenUsage,
      };

      let message: Message;
      if (input.role === 'assistant') {
        const assistantMessage: AssistantMessage = {
          ...baseMessage,
          role: 'assistant',
          goalCompleted: input.goalCompleted,
        };
        message = createMessage(assistantMessage);
      } else {
        message = createMessage(baseMessage);
      }

      const toolUses =
        input.role === 'tool-use' && input.toolCall
          ? registerToolUse(state.toolUses, input.toolCall)
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
  return appendMessages(conversation, { role: 'user', content, metadata }, environment);
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
  return appendMessages(
    conversation,
    { role: 'assistant', content, metadata },
    environment,
  );
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
  return appendMessages(conversation, { role: 'system', content, metadata }, environment);
}
