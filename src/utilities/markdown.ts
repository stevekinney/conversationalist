import type { MultiModalContent } from '@lasercat/homogenaize';
import matter from 'gray-matter';

import { copyContent } from '../multi-modal';
import type {
  Conversation,
  ConversationStatus,
  Message,
  MessageRole,
  TokenUsage,
  ToMarkdownOptions,
  ToolCall,
  ToolResult,
} from '../types';
import { messageParts } from './message';
import { toReadonly } from './type-helpers';

/**
 * Maps message roles to human-readable display labels.
 *
 * @example
 * ```ts
 * ROLE_LABELS['tool-use']; // 'Tool Use'
 * ROLE_LABELS.assistant;   // 'Assistant'
 * ```
 */
export const ROLE_LABELS: Record<MessageRole, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  developer: 'Developer',
  'tool-use': 'Tool Use',
  'tool-result': 'Tool Result',
  snapshot: 'Snapshot',
};

// Internal alias for backward compatibility
const ROLE_DISPLAY_NAMES = ROLE_LABELS;

/**
 * Maps display labels back to message roles.
 *
 * @example
 * ```ts
 * LABEL_TO_ROLE['Tool Use']; // 'tool-use'
 * LABEL_TO_ROLE.User;        // 'user'
 * ```
 */
export const LABEL_TO_ROLE: Record<string, MessageRole> = {
  User: 'user',
  Assistant: 'assistant',
  System: 'system',
  Developer: 'developer',
  'Tool Use': 'tool-use',
  'Tool Result': 'tool-result',
  Snapshot: 'snapshot',
};

// Internal alias for backward compatibility
const DISPLAY_NAME_TO_ROLE = LABEL_TO_ROLE;

/**
 * Gets the human-readable display label for a message role.
 *
 * @param role - The message role
 * @returns The display label for the role
 *
 * @example
 * ```ts
 * getRoleLabel('assistant');  // 'Assistant'
 * getRoleLabel('tool-use');   // 'Tool Use'
 * ```
 */
export function getRoleLabel(role: MessageRole): string {
  return ROLE_LABELS[role];
}

/**
 * Gets the message role from a display label.
 *
 * @param label - The display label
 * @returns The message role, or undefined if the label is not recognized
 *
 * @example
 * ```ts
 * getRoleFromLabel('Assistant');  // 'assistant'
 * getRoleFromLabel('Tool Use');   // 'tool-use'
 * getRoleFromLabel('Unknown');    // undefined
 * ```
 */
export function getRoleFromLabel(label: string): MessageRole | undefined {
  return LABEL_TO_ROLE[label];
}

/**
 * Formats a message's content for markdown output.
 * Text parts are appended in order, images are rendered as markdown image syntax on their own lines.
 */
function formatMessageContent(message: Message): string {
  if (typeof message.content === 'string') return message.content;

  const parts = messageParts(message);
  const lines: string[] = [];

  for (const part of parts) {
    if (part.type === 'text' && part.text) {
      lines.push(part.text);
    } else if (part.type === 'image') {
      const imageUrl = (part as { url: string }).url;
      const altText = part.text ?? 'image';
      lines.push(`![${altText}](${imageUrl})`);
    }
  }

  return lines.join('\n\n');
}

/**
 * Metadata stored for each message in the YAML frontmatter.
 * Content is only included for multi-modal messages to preserve image metadata.
 */
interface MessageFrontmatter {
  position: number;
  createdAt: string;
  metadata: Record<string, unknown>;
  hidden: boolean;
  content?: MultiModalContent[];
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  tokenUsage?: TokenUsage;
  goalCompleted?: boolean;
}

/**
 * Metadata stored in YAML frontmatter for conversation-level data.
 */
interface ConversationFrontmatter {
  id: string;
  title?: string;
  status: ConversationStatus;
  metadata: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  messages: Record<string, MessageFrontmatter>;
}

/**
 * Converts a conversation to a Markdown string representation.
 *
 * By default, outputs clean, human-readable markdown with:
 * - Each message with a header containing only the role: `### Role`
 * - Message content rendered as markdown
 *
 * When `options.includeMetadata` is `true`, outputs markdown with full metadata
 * for lossless round-trip conversion:
 * - YAML frontmatter with conversation metadata and all message metadata keyed by message ID
 * - Headers include message ID: `### Role (msg-id)`
 * - Full content array preserved for multi-modal messages
 *
 * For multi-modal content:
 * - Text parts are appended in order
 * - Image parts are rendered as `![alt]({url})` on their own line
 *
 * @param conversation - The conversation to convert
 * @param options - Options for markdown output
 * @returns A Markdown string representation of the conversation
 */
export function toMarkdown(
  conversation: Conversation,
  options: ToMarkdownOptions = {},
): string {
  const { includeMetadata = false } = options;

  if (includeMetadata) {
    return toMarkdownWithMetadata(conversation);
  }

  return toMarkdownSimple(conversation);
}

/**
 * Outputs simple, human-readable markdown without metadata.
 */
function toMarkdownSimple(conversation: Conversation): string {
  const sections: string[] = [];

  for (const message of conversation.messages) {
    const roleName = ROLE_DISPLAY_NAMES[message.role];
    const header = `### ${roleName}`;
    const content = formatMessageContent(message);
    sections.push(`${header}\n\n${content}`);
  }

  return sections.join('\n\n');
}

/**
 * Outputs markdown with full metadata for lossless round-trip conversion.
 */
function toMarkdownWithMetadata(conversation: Conversation): string {
  // Build messages metadata map
  const messagesMetadata: Record<string, MessageFrontmatter> = {};

  for (const message of conversation.messages) {
    const messageMeta: MessageFrontmatter = {
      position: message.position,
      createdAt: message.createdAt,
      metadata: { ...message.metadata },
      hidden: message.hidden,
    };

    // Include content in metadata only for multi-modal messages
    if (Array.isArray(message.content)) {
      messageMeta.content = copyContent(message.content) as MultiModalContent[];
    }

    if (message.toolCall) {
      messageMeta.toolCall = { ...message.toolCall };
    }
    if (message.toolResult) {
      messageMeta.toolResult = { ...message.toolResult };
    }
    if (message.tokenUsage) {
      messageMeta.tokenUsage = { ...message.tokenUsage };
    }
    if (message.goalCompleted !== undefined) {
      messageMeta.goalCompleted = message.goalCompleted;
    }

    messagesMetadata[message.id] = messageMeta;
  }

  const frontmatterData: ConversationFrontmatter = {
    id: conversation.id,
    status: conversation.status,
    metadata: { ...conversation.metadata },
    tags: [...conversation.tags],
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: messagesMetadata,
  };

  // Only add title if it's defined
  if (conversation.title !== undefined) {
    frontmatterData.title = conversation.title;
  }

  // Build message body
  const messageSections: string[] = [];

  for (const message of conversation.messages) {
    const roleName = ROLE_DISPLAY_NAMES[message.role];
    const header = `### ${roleName} (${message.id})`;
    const content = formatMessageContent(message);
    messageSections.push(`${header}\n\n${content}`);
  }

  const body = messageSections.join('\n\n');

  // Use gray-matter to stringify with YAML frontmatter
  return matter.stringify(body, frontmatterData);
}

/**
 * Error thrown when markdown parsing fails.
 */
export class MarkdownParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarkdownParseError';
  }
}

/**
 * Generates a simple unique ID for use when metadata is not available.
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Parses a Markdown string back into a Conversation object.
 *
 * This is the inverse of `toMarkdown` and supports both:
 * - Lossless round-trip conversion when markdown includes metadata
 *   (generated by `toMarkdown` with `includeMetadata: true`)
 * - Best-effort parsing of simple markdown without metadata
 *   (generated by `toMarkdown` with `includeMetadata: false` or hand-written)
 *
 * When metadata is present:
 * - YAML frontmatter provides conversation and message metadata
 * - Headers include message ID: `### Role (msg-id)`
 * - Full fidelity is preserved
 *
 * When metadata is absent:
 * - Conversation ID and timestamps are generated
 * - Message IDs are generated, positions are inferred from order
 * - Content is parsed from markdown body
 * - Defaults: status='active', hidden=false, empty metadata/tags
 *
 * @param markdown - The markdown string to parse
 * @returns A Conversation object
 * @throws {MarkdownParseError} If the markdown format is invalid (e.g., unknown role)
 */
export function fromMarkdown(markdown: string): Conversation {
  const trimmed = markdown.trim();

  // Check if frontmatter exists
  const hasFrontmatter = trimmed.startsWith('---');

  if (hasFrontmatter) {
    return parseMarkdownWithMetadata(trimmed);
  }

  return parseMarkdownSimple(trimmed);
}

/**
 * Parses markdown with full metadata (YAML frontmatter with message metadata).
 */
function parseMarkdownWithMetadata(trimmed: string): Conversation {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(trimmed);
  } catch {
    throw new MarkdownParseError('Invalid frontmatter: failed to parse YAML');
  }

  const frontmatter = parsed.data as ConversationFrontmatter;
  const body = parsed.content.trim();

  // Validate required frontmatter fields
  if (!frontmatter.id) {
    throw new MarkdownParseError('Invalid frontmatter: missing required field "id"');
  }

  // Parse messages from body using header pattern: ### Role (message-id)
  const messages: Message[] = [];
  const messagePattern = /^### ([\w\s]+) \(([^)]+)\)\n\n([\s\S]*?)(?=\n\n### |\n*$)/gm;

  let match;
  while ((match = messagePattern.exec(body)) !== null) {
    const [, roleDisplay, messageId, contentBody] = match;

    const role = DISPLAY_NAME_TO_ROLE[roleDisplay!];
    if (!role) {
      throw new MarkdownParseError(`Unknown role: ${roleDisplay}`);
    }

    // Get message metadata from frontmatter
    const messageMeta = frontmatter.messages?.[messageId!];
    if (!messageMeta) {
      throw new MarkdownParseError(`Missing metadata for message: ${messageId}`);
    }

    // Determine content: use metadata.content if present (multi-modal), otherwise parse body
    let content: string | ReadonlyArray<MultiModalContent>;
    if (messageMeta.content) {
      content = toReadonly([...messageMeta.content]);
    } else {
      content = contentBody?.trim() ?? '';
    }

    const message: Message = {
      id: messageId!,
      role,
      content,
      position: messageMeta.position,
      createdAt: messageMeta.createdAt,
      metadata: toReadonly({ ...messageMeta.metadata }),
      hidden: messageMeta.hidden,
      toolCall: messageMeta.toolCall
        ? toReadonly({ ...messageMeta.toolCall })
        : undefined,
      toolResult: messageMeta.toolResult
        ? toReadonly({ ...messageMeta.toolResult })
        : undefined,
      tokenUsage: messageMeta.tokenUsage
        ? toReadonly({ ...messageMeta.tokenUsage })
        : undefined,
      goalCompleted: messageMeta.goalCompleted,
    };

    messages.push(toReadonly(message) as Message);
  }

  const conversation: Conversation = {
    id: frontmatter.id,
    title: frontmatter.title,
    status: frontmatter.status ?? 'active',
    metadata: toReadonly({ ...frontmatter.metadata }),
    tags: toReadonly([...(frontmatter.tags ?? [])]),
    messages: toReadonly(messages),
    createdAt: frontmatter.createdAt,
    updatedAt: frontmatter.updatedAt,
  };

  return toReadonly(conversation) as Conversation;
}

/**
 * Parses simple markdown without metadata, using sensible defaults.
 */
function parseMarkdownSimple(body: string): Conversation {
  const now = new Date().toISOString();
  const messages: Message[] = [];

  // Pattern for simple messages (no ID in header): ### Role
  // The role must end at the newline
  const messagePattern = /^### ([^\n]+)\n\n([\s\S]*?)(?=\n\n### |\n*$)/gm;

  let match;
  let position = 0;
  while ((match = messagePattern.exec(body)) !== null) {
    const [, roleDisplay, contentBody] = match;

    const role = DISPLAY_NAME_TO_ROLE[roleDisplay!];
    if (!role) {
      throw new MarkdownParseError(`Unknown role: ${roleDisplay}`);
    }

    const message: Message = {
      id: generateId(),
      role,
      content: contentBody?.trim() ?? '',
      position,
      createdAt: now,
      metadata: toReadonly({}),
      hidden: false,
    };

    messages.push(toReadonly(message) as Message);
    position++;
  }

  const conversation: Conversation = {
    id: generateId(),
    status: 'active',
    metadata: toReadonly({}),
    tags: toReadonly([]),
    messages: toReadonly(messages),
    createdAt: now,
    updatedAt: now,
  };

  return toReadonly(conversation) as Conversation;
}
