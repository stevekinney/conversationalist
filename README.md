# Conversationalist

A TypeScript-first library for managing LLM conversation state with immutable updates, type-safe APIs, and provider adapters.

The high-level value proposition:

- keep a single, model-agnostic conversation shape across UI, storage, and providers
- append messages without mutation (safe for React, concurrent updates, replay)
- handle tool calls, streaming responses, and hidden or internal messages
- trim context windows and estimate token budgets
- validate input with Zod schemas and typed errors

## Installation

```bash
bun add conversationalist zod
npm add conversationalist zod
pnpm add conversationalist zod
```

This package is ESM-only. Use `import` syntax.
Zod is a peer dependency and must be installed by your app.

## Quick Start

```ts
import {
  appendAssistantMessage,
  appendUserMessage,
  createConversation,
  deserializeConversation,
  serializeConversation,
} from 'conversationalist';
import { toOpenAIMessages } from 'conversationalist/openai';

let conversation = createConversation({
  title: 'Support chat',
  tags: ['support'],
});

conversation = appendUserMessage(conversation, 'Where is my order?');
conversation = appendAssistantMessage(conversation, 'Let me check that for you.');

const messages = toOpenAIMessages(conversation);
// send messages to your provider...

const stored = serializeConversation(conversation);
const restored = deserializeConversation(stored);
```

## End-to-End Example (Store + Resume)

```ts
import {
  appendAssistantMessage,
  appendSystemMessage,
  appendUserMessage,
  createConversation,
  deserializeConversation,
  serializeConversation,
} from 'conversationalist';
import { toOpenAIMessages } from 'conversationalist/openai';

let conversation = createConversation({ title: 'Order lookup' });
conversation = appendSystemMessage(conversation, 'You are a support agent.');
conversation = appendUserMessage(conversation, 'Where is order 123?');

const response = await openai.chat.completions.create({
  model: 'gpt-4.1-mini',
  messages: toOpenAIMessages(conversation),
});

conversation = appendAssistantMessage(
  conversation,
  response.choices[0]?.message?.content ?? '',
);

const stored = serializeConversation(conversation);
// await db.save(stored);

let restored = deserializeConversation(stored);
restored = appendUserMessage(restored, 'Can you email me the tracking link?');
```

## When to Use

- Build multi-provider chat apps with a consistent message model.
- Store and replay conversation history safely.
- Drive streaming UIs without ad-hoc state machines.
- Enforce tool call correctness and pair calls with results.
- Manage context windows and token limits in one place.

## Core Concepts

### Conversations

A conversation is an immutable record with metadata, tags, timestamps, and ordered messages.

```ts
import { createConversation } from 'conversationalist';

const conversation = createConversation({
  title: 'My Chat',
  status: 'active',
  metadata: { customerId: 'cus_123' },
  tags: ['support', 'vip'],
});
```

### Messages

Messages have roles and can contain text or multi-modal content. Optional fields include
`metadata`, `hidden`, `tokenUsage`, `toolCall`, `toolResult`, and `goalCompleted`.

Roles: `user`, `assistant`, `system`, `developer`, `tool-use`, `tool-result`, `snapshot`.
The `snapshot` role is for internal state and is skipped by adapters.

```ts
import { appendMessages } from 'conversationalist';

conversation = appendMessages(conversation, {
  role: 'user',
  content: [
    { type: 'text', text: 'Describe this:' },
    { type: 'image', url: 'https://example.com/image.png' },
  ],
});
```

Hidden messages remain in history but are skipped by default when querying or adapting to
providers.

### Tool Calls

Tool calls are represented as paired `tool-use` and `tool-result` messages. Tool results
are validated to ensure the referenced call exists.

```ts
conversation = appendMessages(
  conversation,
  {
    role: 'tool-use',
    content: '',
    toolCall: { id: 'call_123', name: 'getWeather', arguments: { city: 'NYC' } },
  },
  {
    role: 'tool-result',
    content: '',
    toolResult: {
      callId: 'call_123',
      outcome: 'success',
      content: { tempF: 72, condition: 'sunny' },
    },
  },
);
```

Use `pairToolCallsWithResults` to render tool calls alongside their results.

### Streaming

Streaming helpers let you append a placeholder, update it as chunks arrive, and finalize
when done.

```ts
import {
  appendStreamingMessage,
  finalizeStreamingMessage,
  updateStreamingMessage,
} from 'conversationalist';

let { conversation, messageId } = appendStreamingMessage(conversation, 'assistant');
let content = '';

for await (const chunk of stream) {
  content += chunk;
  conversation = updateStreamingMessage(conversation, messageId, content);
}

conversation = finalizeStreamingMessage(conversation, messageId, {
  tokenUsage: { prompt: 100, completion: 50, total: 150 },
});
```

### Context Window

Trim history to fit token budgets or to keep only recent messages.

```ts
import { simpleTokenEstimator, truncateToTokenLimit } from 'conversationalist';

conversation = truncateToTokenLimit(conversation, 4000, simpleTokenEstimator, {
  preserveSystemMessages: true,
  preserveLastN: 2,
});
```

### Provider Adapters

Convert the same conversation into provider-specific formats.

Adapters skip hidden and snapshot messages and map system or developer roles as needed.

```ts
import { toOpenAIMessages, toOpenAIMessagesGrouped } from 'conversationalist/openai';
import { toAnthropicMessages } from 'conversationalist/anthropic';
import { toGeminiMessages } from 'conversationalist/gemini';
```

- OpenAI: `toOpenAIMessages` and `toOpenAIMessagesGrouped` (groups consecutive tool calls)
- Anthropic: `toAnthropicMessages`
- Gemini: `toGeminiMessages`

### Tool Call Wiring Examples

#### OpenAI

```ts
import { appendAssistantMessage, appendMessages } from 'conversationalist';
import { toOpenAIMessages } from 'conversationalist/openai';

const tools = [
  {
    type: 'function',
    function: {
      name: 'getWeather',
      description: 'Get current weather by city.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  },
];

const response = await openai.chat.completions.create({
  model: 'gpt-4.1-mini',
  messages: toOpenAIMessages(conversation),
  tools,
});

const toolCalls = response.choices[0]?.message?.tool_calls ?? [];
for (const call of toolCalls) {
  conversation = appendMessages(conversation, {
    role: 'tool-use',
    content: '',
    toolCall: {
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    },
  });

  const result = await getWeather(JSON.parse(call.function.arguments));
  conversation = appendMessages(conversation, {
    role: 'tool-result',
    content: '',
    toolResult: { callId: call.id, outcome: 'success', content: result },
  });
}

const followUp = await openai.chat.completions.create({
  model: 'gpt-4.1-mini',
  messages: toOpenAIMessages(conversation),
  tools,
});

conversation = appendAssistantMessage(
  conversation,
  followUp.choices[0]?.message?.content ?? '',
);
```

#### Anthropic

```ts
import { appendAssistantMessage, appendMessages } from 'conversationalist';
import { toAnthropicMessages } from 'conversationalist/anthropic';

const tools = [
  {
    name: 'getWeather',
    description: 'Get current weather by city.',
    input_schema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
];

const { system, messages } = toAnthropicMessages(conversation);
const response = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20240620',
  system,
  messages,
  tools,
});

for (const block of response.content) {
  if (block.type !== 'tool_use') continue;
  conversation = appendMessages(conversation, {
    role: 'tool-use',
    content: '',
    toolCall: { id: block.id, name: block.name, arguments: block.input },
  });

  const result = await getWeather(block.input as { city: string });
  conversation = appendMessages(conversation, {
    role: 'tool-result',
    content: '',
    toolResult: { callId: block.id, outcome: 'success', content: result },
  });
}

const followUp = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20240620',
  ...toAnthropicMessages(conversation),
  tools,
});

const assistantText = followUp.content
  .filter((block) => block.type === 'text')
  .map((block) => block.text)
  .join('\n');

conversation = appendAssistantMessage(conversation, assistantText);
```

#### Gemini

Gemini does not include tool call IDs, so generate one to pair the tool result.

```ts
import { appendMessages } from 'conversationalist';
import { toGeminiMessages } from 'conversationalist/gemini';

const tools = [
  {
    functionDeclarations: [
      {
        name: 'getWeather',
        description: 'Get current weather by city.',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
  },
];

const { systemInstruction, contents } = toGeminiMessages(conversation);
const response = await model.generateContent({
  systemInstruction,
  contents,
  tools,
});

const parts = response.response.candidates?.[0]?.content?.parts ?? [];
for (const part of parts) {
  if (!('functionCall' in part)) continue;
  const callId = crypto.randomUUID();
  const args = part.functionCall.args as { city: string };

  conversation = appendMessages(conversation, {
    role: 'tool-use',
    content: '',
    toolCall: { id: callId, name: part.functionCall.name, arguments: args },
  });

  const result = await getWeather(args);
  conversation = appendMessages(conversation, {
    role: 'tool-result',
    content: '',
    toolResult: { callId, outcome: 'success', content: result },
  });
}

const followUp = await model.generateContent({
  ...toGeminiMessages(conversation),
  tools,
});
```

## Builder Pattern

Use the draft pattern for fluent, mutable-style updates that still return immutable
conversations.

```ts
import {
  appendSystemMessage,
  appendUserMessage,
  createConversation,
  pipeConversation,
  withConversation,
} from 'conversationalist';

const conversation = withConversation(createConversation(), (draft) => {
  draft
    .appendSystemMessage('You are a helpful assistant.')
    .appendUserMessage('Hello!')
    .appendAssistantMessage('Hi there!');
});

const piped = pipeConversation(
  createConversation(),
  (c) => appendSystemMessage(c, 'You are helpful.'),
  (c) => appendUserMessage(c, 'Hello!'),
);
```

`ConversationDraft` includes appending, system message helpers, streaming, redaction, and
context window utilities.

## API Overview

### Conversation Creation and Serialization

```ts
createConversation(options?, environment?)
serializeConversation(conversation)
deserializeConversation(json)
toChatMessages(conversation)
```

### Message Appending

```ts
appendMessages(conversation, ...inputs, environment?)
appendUserMessage(conversation, content, metadata?, environment?)
appendAssistantMessage(conversation, content, metadata?, environment?)
appendSystemMessage(conversation, content, metadata?, environment?)
```

### System Message Utilities

```ts
prependSystemMessage(conversation, content, metadata?, environment?)
replaceSystemMessage(conversation, content, metadata?, environment?)
collapseSystemMessages(conversation, environment?)
hasSystemMessage(conversation)
getFirstSystemMessage(conversation)
getSystemMessages(conversation)
```

### Querying and Stats

```ts
getConversationMessages(conversation, { includeHidden? })
getMessageAtPosition(conversation, position)
getMessageByIdentifier(conversation, id)
searchConversationMessages(conversation, predicate)
computeConversationStatistics(conversation)
```

### Modification

```ts
redactMessageAtPosition(conversation, position, placeholder?)
```

### Streaming

```ts
appendStreamingMessage(conversation, role, metadata?, environment?)
updateStreamingMessage(conversation, messageId, content, environment?)
finalizeStreamingMessage(conversation, messageId, { tokenUsage?, metadata? }, environment?)
cancelStreamingMessage(conversation, messageId, environment?)
isStreamingMessage(message)
getStreamingMessage(conversation)
```

### Context Window

```ts
getRecentMessages(conversation, count, { includeHidden?, includeSystem? })
truncateFromPosition(conversation, position, { preserveSystemMessages? }, environment?)
truncateToTokenLimit(
  conversation,
  maxTokens,
  estimateTokens,
  { preserveSystemMessages?, preserveLastN? },
  environment?,
)
estimateConversationTokens(conversation, estimateTokens)
simpleTokenEstimator(message)
```

### Utilities

```ts
pairToolCallsWithResults(messages);
normalizeContent(content);
toMultiModalArray(content);
createMessage(messageJSON);
copyContent(content);
copyMultiModalContent(item);
```

### Schemas

```ts
conversationSchema;
conversationShape;
messageInputSchema;
messageJSONSchema;
messageRoleSchema;
multiModalContentSchema;
tokenUsageSchema;
toolCallSchema;
toolResultSchema;
```

### Errors

```ts
ConversationalistError;
createDuplicateIdError;
createInvalidInputError;
createInvalidPositionError;
createInvalidToolReferenceError;
createLockedError;
createNotFoundError;
createSerializationError;
createValidationError;
```

## Deterministic Environments (Testing)

Pass a custom environment to control timestamps and IDs.

```ts
import { appendUserMessage, createConversation } from 'conversationalist';

const env = {
  now: () => '2024-01-01T00:00:00.000Z',
  randomId: () => 'fixed-id',
};

let conversation = createConversation({ title: 'Test' }, env);
conversation = appendUserMessage(conversation, 'Hello', undefined, env);
```

## Types

```ts
import type {
  Conversation,
  ConversationEnvironment,
  ConversationJSON,
  ConversationStatus,
  ExternalMessage,
  ImageContent,
  Message,
  MessageInput,
  MessageJSON,
  MessageRole,
  MultiModalContent,
  TextContent,
  TokenUsage,
  ToolCall,
  ToolResult,
} from 'conversationalist';
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
