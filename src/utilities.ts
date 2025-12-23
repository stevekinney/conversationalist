import type { MultiModalContent } from '@lasercat/homogenaize';

import { copyContent } from './multi-modal';
import type { Message, MessageJSON, ToolCall, ToolResult } from './types';

/**
 * Represents a paired tool call with its optional result.
 */
export interface ToolCallPair {
  /** The tool call */
  call: ToolCall;
  /** The corresponding result, if available */
  result?: ToolResult | undefined;
}

/**
 * Pairs tool calls with their corresponding results from a list of messages.
 *
 * This is useful for UI rendering where tool calls and their results need
 * to be displayed together. The function performs two passes:
 * 1. Collects all tool results into a map by their callId
 * 2. Pairs each tool call with its matching result (if any)
 *
 * @param messages - Array of messages that may contain tool calls and results
 * @returns Array of tool call pairs, preserving the order of tool calls
 *
 * @example
 * ```ts
 * const pairs = pairToolCallsWithResults(conversation.messages);
 * // pairs: [{ call: ToolCall, result?: ToolResult }, ...]
 * ```
 */
export function pairToolCallsWithResults(
  messages: readonly MessageJSON[],
): ToolCallPair[] {
  const pairs: ToolCallPair[] = [];
  const resultsMap = new Map<string, ToolResult>();

  // First pass: collect all results
  for (const msg of messages) {
    if (msg.toolResult) {
      resultsMap.set(msg.toolResult.callId, msg.toolResult);
    }
  }

  // Second pass: pair calls with results
  for (const msg of messages) {
    if (msg.toolCall) {
      pairs.push({
        call: msg.toolCall,
        result: resultsMap.get(msg.toolCall.id),
      });
    }
  }

  return pairs;
}

/**
 * Type-safe hasOwnProperty check.
 * Narrows the type to include the checked property.
 */
export function hasOwnProperty<X extends object, Y extends PropertyKey>(
  obj: X,
  prop: Y,
): obj is X & Record<Y, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

/**
 * Casts a value to its readonly variant.
 * Used to enforce immutability at the type level.
 */
export function toReadonly<T>(value: T): Readonly<T> {
  return value as Readonly<T>;
}

/**
 * Creates an immutable Message from a JSON representation.
 * Deep copies nested objects and arrays to ensure immutability.
 */
export function createMessage(props: MessageJSON): Message {
  const content = Array.isArray(props.content)
    ? toReadonly([...props.content])
    : props.content;

  const message: Message = {
    id: props.id,
    role: props.role,
    content,
    position: props.position,
    createdAt: props.createdAt,
    metadata: toReadonly({ ...props.metadata }),
    hidden: props.hidden,
    toolCall: props.toolCall ? toReadonly({ ...props.toolCall }) : undefined,
    toolResult: props.toolResult ? toReadonly({ ...props.toolResult }) : undefined,
    tokenUsage: props.tokenUsage ? toReadonly({ ...props.tokenUsage }) : undefined,
    goalCompleted: props.goalCompleted,
  };

  return toReadonly(message);
}

/**
 * Converts content to a multi-modal array format.
 * Wraps strings in a text content object, normalizes single items to arrays.
 */
export function toMultiModalArray(
  input: string | MultiModalContent | MultiModalContent[],
): MultiModalContent[] {
  if (typeof input === 'string') return [{ type: 'text', text: input }];
  return Array.isArray(input) ? input : [input];
}

/**
 * Normalizes content to either a string or multi-modal array.
 * Single MultiModalContent items are wrapped in an array.
 */
export function normalizeContent(
  content?: string | MultiModalContent | MultiModalContent[],
): string | MultiModalContent[] | undefined {
  if (content === undefined) return undefined;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content : [content];
}

/**
 * Converts an immutable Message to a mutable JSON representation.
 * Creates deep copies of all nested objects.
 */
export function messageToJSON(message: Message): MessageJSON {
  return {
    id: message.id,
    role: message.role,
    content: copyContent(message.content),
    position: message.position,
    createdAt: message.createdAt,
    metadata: { ...message.metadata },
    hidden: message.hidden,
    toolCall: message.toolCall ? { ...message.toolCall } : undefined,
    toolResult: message.toolResult ? { ...message.toolResult } : undefined,
    tokenUsage: message.tokenUsage ? { ...message.tokenUsage } : undefined,
    goalCompleted: message.goalCompleted,
  };
}

/**
 * Extracts the content parts from a message as a multi-modal array.
 * String content is converted to a single text part.
 */
export function messageParts(message: Message): ReadonlyArray<MultiModalContent> {
  if (typeof message.content === 'string') {
    return message.content
      ? [{ type: 'text', text: message.content } as MultiModalContent]
      : [];
  }
  return message.content;
}

/**
 * Extracts all text content from a message, joined by the specified separator.
 * Non-text parts are excluded from the result.
 */
export function messageText(message: Message, joiner: string = '\n\n'): string {
  if (typeof message.content === 'string') return message.content;
  return messageParts(message)
    .filter((p) => p.type === 'text')
    .map((p: MultiModalContent) => (p.type === 'text' ? p.text : ''))
    .join(joiner);
}

/**
 * Checks if a message contains any image content.
 */
export function messageHasImages(message: Message): boolean {
  return messageParts(message).some((p) => p.type === 'image');
}

/**
 * Converts a message to a string representation.
 * Images are rendered as markdown image syntax.
 */
export function messageToString(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return messageParts(message)
    .map((part) =>
      part.type === 'text'
        ? part.text
        : `![${part.text ?? ''}](${(part as { url: string }).url})`,
    )
    .join('\n\n');
}
