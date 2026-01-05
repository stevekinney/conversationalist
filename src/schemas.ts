import { z } from 'zod';

import type {
  ConversationJSON,
  ConversationStatus,
  MessageInput,
  MessageJSON,
  MessageRole,
  TokenUsage,
  ToolCall,
  ToolResult,
} from './types';

export const multiModalContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image'),
    url: z.string().url(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
  }),
]);

export const messageRoleSchema = z.enum([
  'user',
  'assistant',
  'system',
  'developer',
  'tool-use',
  'tool-result',
  'snapshot',
]) as unknown as z.ZodType<MessageRole>;

export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.unknown(),
}) as unknown as z.ZodType<ToolCall>;

export const toolResultSchema = z.object({
  callId: z.string(),
  outcome: z.enum(['success', 'error']),
  content: z.unknown(),
}) as unknown as z.ZodType<ToolResult>;

export const tokenUsageSchema = z.object({
  prompt: z.number().int().min(0),
  completion: z.number().int().min(0),
  total: z.number().int().min(0),
}) as unknown as z.ZodType<TokenUsage>;

export const messageInputSchema = z.object({
  role: messageRoleSchema,
  content: z.union([z.string(), z.array(multiModalContentSchema)]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  hidden: z.boolean().optional(),
  toolCall: toolCallSchema.optional(),
  toolResult: toolResultSchema.optional(),
  tokenUsage: tokenUsageSchema.optional(),
  goalCompleted: z.boolean().optional(),
}) as unknown as z.ZodType<MessageInput>;

export const messageJSONSchema = z
  .object({
    id: z.string(),
    role: messageRoleSchema,
    content: z.union([z.string(), z.array(multiModalContentSchema)]),
    position: z.number().int().min(0),
    createdAt: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    hidden: z.boolean(),
    toolCall: toolCallSchema.optional(),
    toolResult: toolResultSchema.optional(),
    tokenUsage: tokenUsageSchema.optional(),
    goalCompleted: z.boolean().optional(),
  })
  .passthrough() as unknown as z.ZodType<MessageJSON>;

export const conversationStatusSchema = z.enum([
  'active',
  'archived',
  'deleted',
]) as unknown as z.ZodType<ConversationStatus>;

// Export the raw shape for direct use with storage systems
export const conversationShape = {
  schemaVersion: z.number().int().min(1),
  id: z.string(),
  title: z.string().optional(),
  status: conversationStatusSchema,
  metadata: z.record(z.string(), z.unknown()),
  tags: z.array(z.string()),
  messages: z.array(messageJSONSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
} as const;

export const conversationSchema = z.object(
  conversationShape,
) as unknown as z.ZodType<ConversationJSON>;
