# Conversationalist

A TypeScript library for managing LLM conversation state with immutable data structures and type-safe APIs.

## Installation

```bash
bun add conversationalist
npm add conversationalist
```

## Core Concepts

### Conversation

A conversation is an immutable data structure containing messages, metadata, and timestamps:

```typescript
import {
  createConversation,
  appendUserMessage,
  appendAssistantMessage,
} from 'conversationalist';

let conversation = createConversation({ title: 'My Chat' });

conversation = appendUserMessage(conversation, 'Hello!');
conversation = appendAssistantMessage(conversation, 'Hi there!');
```

### Messages

Messages have roles (`user`, `assistant`, `system`, `tool-use`, `tool-result`, `developer`, `snapshot`) and can contain text or multi-modal content:

```typescript
import { appendMessages } from 'conversationalist';

// Text message
conversation = appendMessages(conversation, {
  role: 'user',
  content: 'What is in this image?',
});

// Multi-modal message with image
conversation = appendMessages(conversation, {
  role: 'user',
  content: [
    { type: 'text', text: 'Describe this:' },
    { type: 'image', url: 'https://example.com/image.png' },
  ],
});
```

### Tool Calls

Tool use is supported with linked tool calls and results:

```typescript
conversation = appendMessages(
  conversation,
  {
    role: 'tool-use',
    content: '',
    toolCall: { id: 'call_123', name: 'get_weather', arguments: '{"city":"NYC"}' },
  },
  {
    role: 'tool-result',
    content: '',
    toolResult: { callId: 'call_123', outcome: 'success', content: '72°F, sunny' },
  },
);
```

## API Reference

### Creating Conversations

```typescript
createConversation(options?: {
  id?: string;
  title?: string;
  status?: 'active' | 'archived' | 'deleted';
  metadata?: Record<string, unknown>;
  tags?: string[];
}): Conversation
```

### Appending Messages

```typescript
appendMessages(conversation: Conversation, ...inputs: MessageInput[]): Conversation
appendUserMessage(conversation: Conversation, content: string | MultiModalContent[]): Conversation
appendAssistantMessage(conversation: Conversation, content: string | MultiModalContent[]): Conversation
appendSystemMessage(conversation: Conversation, content: string): Conversation
prependSystemMessage(conversation: Conversation, content: string): Conversation
replaceSystemMessage(conversation: Conversation, content: string): Conversation
```

### Querying Messages

```typescript
getConversationMessages(conversation: Conversation, options?: { includeHidden?: boolean }): Message[]
getMessageAtPosition(conversation: Conversation, position: number): Message | undefined
getMessageByIdentifier(conversation: Conversation, id: string): Message | undefined
searchConversationMessages(conversation: Conversation, predicate: (m: Message) => boolean): Message[]
```

### System Messages

```typescript
hasSystemMessage(conversation: Conversation): boolean
getFirstSystemMessage(conversation: Conversation): Message | undefined
getSystemMessages(conversation: Conversation): Message[]
collapseSystemMessages(conversation: Conversation): Conversation
```

### Utilities

```typescript
computeConversationStatistics(conversation: Conversation): {
  total: number;
  byRole: Record<string, number>;
  hidden: number;
  withImages: number;
}

redactMessageAtPosition(conversation: Conversation, position: number, placeholder?: string): Conversation
```

### Serialization

```typescript
serializeConversation(conversation: Conversation): ConversationJSON
deserializeConversation(json: ConversationJSON): Conversation
toChatMessages(conversation: Conversation): ExternalMessage[]
```

### Builder Pattern

For fluent API style:

```typescript
import { createConversation } from 'conversationalist';
import { withConversation, pipeConversation } from 'conversationalist';
import { simpleTokenEstimator } from 'conversationalist';

// Draft pattern with callback
const conversation = withConversation(createConversation(), (draft) => {
  draft
    .appendSystemMessage('You are a helpful assistant.')
    .appendUserMessage('Hello!')
    .appendAssistantMessage('Hi there!');
});

// Streaming with the draft pattern
const streamedConversation = withConversation(createConversation(), (draft) => {
  const { draft: d, messageId } = draft.appendStreamingMessage('assistant');
  d.updateStreamingMessage(messageId, 'Partial response...').finalizeStreamingMessage(
    messageId,
    { tokenUsage: { prompt: 10, completion: 5, total: 15 } },
  );
});

// Context window management with the draft pattern
const truncatedConversation = withConversation(conversation, (draft) => {
  draft.truncateToTokenLimit(4000, simpleTokenEstimator, { preserveLastN: 2 });
});

// Pipe pattern
const conversation = pipeConversation(
  createConversation(),
  (c) => appendSystemMessage(c, 'You are helpful.'),
  (c) => appendUserMessage(c, 'Hello!'),
);
```

The `ConversationDraft` provides all conversation manipulation methods:

- **Message appending**: `appendMessages`, `appendUserMessage`, `appendAssistantMessage`, `appendSystemMessage`
- **System messages**: `prependSystemMessage`, `replaceSystemMessage`, `collapseSystemMessages`
- **Modification**: `redactMessageAtPosition`
- **Streaming**: `appendStreamingMessage`, `updateStreamingMessage`, `finalizeStreamingMessage`, `cancelStreamingMessage`
- **Context window**: `truncateFromPosition`, `truncateToTokenLimit`

### Tool Call Pairing

```typescript
import { pairToolCallsWithResults } from 'conversationalist';

const pairs = pairToolCallsWithResults(conversation.messages);
// Returns: [{ call: ToolCall, result?: ToolResult }, ...]
```

## Provider Adapters

Convert conversations to provider-specific formats using subpath exports:

### OpenAI

```typescript
import { toOpenAIMessages } from 'conversationalist/openai';

const messages = toOpenAIMessages(conversation);
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages,
});
```

### Anthropic

```typescript
import { toAnthropicMessages } from 'conversationalist/anthropic';

const { system, messages } = toAnthropicMessages(conversation);
const response = await anthropic.messages.create({
  model: 'claude-3-opus-20240229',
  system,
  messages,
});
```

### Google Gemini

```typescript
import { toGeminiMessages } from 'conversationalist/gemini';

const { systemInstruction, contents } = toGeminiMessages(conversation);
const response = await model.generateContent({
  systemInstruction,
  contents,
});
```

## Streaming Support

Handle streaming responses with pending message utilities:

```typescript
import {
  appendStreamingMessage,
  updateStreamingMessage,
  finalizeStreamingMessage,
  cancelStreamingMessage,
  isStreamingMessage,
  getStreamingMessage,
} from 'conversationalist';

// Start a streaming message
let { conversation, messageId } = appendStreamingMessage(conversation, 'assistant');

// Update content as chunks arrive
for await (const chunk of stream) {
  accumulatedContent += chunk;
  conversation = updateStreamingMessage(conversation, messageId, accumulatedContent);
}

// Finalize when complete
conversation = finalizeStreamingMessage(conversation, messageId, {
  tokenUsage: { prompt: 100, completion: 50, total: 150 },
});

// Or cancel if needed
conversation = cancelStreamingMessage(conversation, messageId);
```

## Context Window Utilities

Manage token limits and message truncation:

```typescript
import {
  getRecentMessages,
  truncateFromPosition,
  truncateToTokenLimit,
  estimateConversationTokens,
  simpleTokenEstimator,
} from 'conversationalist';

// Get last N messages (excluding system by default)
const recent = getRecentMessages(conversation, 10);

// Truncate to messages from position onwards
const truncated = truncateFromPosition(conversation, 5);

// Truncate to fit token limit
const fitted = truncateToTokenLimit(conversation, 4000, simpleTokenEstimator, {
  preserveSystemMessages: true,
  preserveLastN: 2,
});

// Estimate total tokens
const tokens = estimateConversationTokens(conversation, simpleTokenEstimator);
```

## Types

```typescript
import type {
  Conversation,
  ConversationJSON,
  ConversationStatus,
  Message,
  MessageInput,
  MessageJSON,
  MessageRole,
  TokenUsage,
  ToolCall,
  ToolResult,
  MultiModalContent,
  TextContent,
  ImageContent,
} from 'conversationalist';
```

## Validation Schemas

Zod schemas are exported for runtime validation:

```typescript
import {
  conversationSchema,
  messageInputSchema,
  messageJSONSchema,
  messageRoleSchema,
  multiModalContentSchema,
  tokenUsageSchema,
  toolCallSchema,
  toolResultSchema,
} from 'conversationalist';

const result = messageInputSchema.safeParse(data);
```

## Error Handling

Custom error types with codes:

```typescript
import {
  ConversationalistError,
  createInvalidInputError,
  createInvalidPositionError,
  createNotFoundError,
  createValidationError,
} from 'conversationalist';

try {
  // ...
} catch (error) {
  if (error instanceof ConversationalistError) {
    console.log(error.code); // e.g., 'INVALID_POSITION'
  }
}
```

## Development

```bash
bun install
bun test
bun run typecheck
bun run lint
bun run build
```

## License

MIT
