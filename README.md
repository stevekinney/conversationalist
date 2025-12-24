# Conversationalist

A TypeScript-first library for managing LLM conversation state with **immutable updates**, **type-safe APIs**, and **provider-agnostic adapters**.

[![Tests](https://github.com/stevekinney/conversationalist/actions/workflows/test.yml/badge.svg)](https://github.com/stevekinney/conversationalist/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is Conversationalist?

**Conversationalist** is a state engine for LLM-driven applications. While most libraries focus on making the API calls themselves, Conversationalist focuses on the **state** that lives between those calls. It provides a unified, model-agnostic representation of a conversation that can be easily stored, serialized, and adapted for any major LLM provider (OpenAI, Anthropic, Gemini).

In a modern AI application, a conversation is more than just a list of strings. It involves:

- **Tool Use**: Pairing function calls with their results and ensuring they stay in sync.
- **Hidden Logic**: Internal "thought" messages or snapshots that should be saved but never sent to the provider.
- **Metadata**: Tracking tags, custom IDs, and tokens across different steps.
- **Streaming**: Gracefully handling partial messages in a UI without messy state transitions.

Conversationalist handles these complexities through a robust, type-safe API that treats your conversation as the "Single Source of Truth."

## Why Use It?

Managing LLM conversations manually often leads to "provider lock-in" or fragile glue code. Conversationalist solves this by:

- **Decoupling Logic from Providers**: Write your business logic once using Conversationalist's message model, and use adapters to talk to OpenAI, Anthropic, or Gemini.
- **Built-in Context Management**: Automatically handle context window limits by truncating history while preserving critical system instructions or recent messages.
- **Type Safety Out-of-the-Box**: Built with Zod and TypeScript, ensuring that your conversation data is valid at runtime and compile-time.
- **Unified Serialization**: One standard format (`ConversationJSON`) for your database, your frontend, and your backend.

## The Immutable Advantage

At its core, Conversationalist is **strictly immutable**. Every change to a conversation—whether appending a message, updating a stream, or redacting sensitive data—returns a _new_ conversation object.

This approach offers several critical advantages for modern application development:

1.  **React/Redux Friendly**: Because updates return new references, they trigger re-renders naturally and work seamlessly with state management libraries.
2.  **Concurrency Safe**: You can safely pass a conversation to multiple functions or async tasks without worrying about one part of your app mutating it out from under another.
3.  **Easy Branching & Replay**: Want to let a user "undo" an AI response or branch a conversation into two different paths? Simply keep a reference to the previous immutable state. No complex cloning required.
4.  **Auditability**: Timestamps and message positions are automatically managed and preserved, making it easy to reconstruct the exact state of a chat at any point in time.

## Real-World Use Cases

- **Multi-Model Chatbots**: Build a UI where users can switch between GPT-4o and Claude 3.5 Sonnet mid-conversation without losing history.
- **Chain-of-Thought Workflows**: Use `hidden` messages to store internal reasoning or intermediate steps that the AI uses to reach a final answer, without cluttering the user's view.
- **Agentic Workflows**: Track complex tool-use loops where multiple functions are called in sequence, ensuring every result is correctly paired with its corresponding call ID.
- **Token Budgeting**: Automatically trim old messages when a conversation gets too long, ensuring your API costs stay predictable and you never hit provider limits.
- **Deterministic Testing**: Use the custom `environment` parameter to mock IDs and timestamps, allowing you to write 100% deterministic tests for your chat logic.

---

## Installation

```bash
bun add conversationalist zod
npm add conversationalist zod
pnpm add conversationalist zod
```

This package is ESM-only. Use `import` syntax. Zod is a peer dependency and must be installed by your application.

## Quick Start

```ts
import {
  appendAssistantMessage,
  appendUserMessage,
  createConversation,
  serializeConversation,
} from 'conversationalist';
import { toOpenAIMessages } from 'conversationalist/openai';

// 1. Create a conversation
let conversation = createConversation({
  title: 'Order Support',
  metadata: { userId: 'user_123' },
});

// 2. Add messages (returns a new conversation object)
conversation = appendUserMessage(conversation, 'Where is my order?');
conversation = appendAssistantMessage(conversation, 'Let me check that for you.');

// 3. Adapt for a provider
const openAIMessages = toOpenAIMessages(conversation);
// [{ role: 'user', content: 'Where is my order?' }, ...]

// 4. Save to your database
const data = serializeConversation(conversation);
// db.save(data.id, JSON.stringify(data));
```

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

**Roles**: `user`, `assistant`, `system`, `developer`, `tool-use`, `tool-result`, `snapshot`.
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

**Hidden messages** remain in history but are skipped by default when querying or adapting to
providers. This is perfect for internal logging or "thinking" steps.

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

### Context Window Management

Automatically trim history to fit token budgets or to keep only recent messages.

```ts
import { simpleTokenEstimator, truncateToTokenLimit } from 'conversationalist';

conversation = truncateToTokenLimit(conversation, 4000, simpleTokenEstimator, {
  preserveSystemMessages: true,
  preserveLastN: 2,
});
```

## Provider Adapters

Convert the same conversation into provider-specific formats. Adapters automatically skip hidden/snapshot messages and map roles correctly.

```ts
import { toOpenAIMessages } from 'conversationalist/openai';
import { toAnthropicMessages } from 'conversationalist/anthropic';
import { toGeminiMessages } from 'conversationalist/gemini';
```

- **OpenAI**: Supports `toOpenAIMessages` and `toOpenAIMessagesGrouped` (which groups consecutive tool calls).
- **Anthropic**: Maps system messages and tool blocks to Anthropic's specific format.
- **Gemini**: Handles Gemini's unique content/part structure.

### Provider-Specific Examples

#### OpenAI (with Tool Calls)

```ts
import { appendAssistantMessage, appendMessages } from 'conversationalist';
import { toOpenAIMessages } from 'conversationalist/openai';

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: toOpenAIMessages(conversation),
  tools: [{ type: 'function', function: { name: 'getWeather', ... } }],
});

const toolCalls = response.choices[0]?.message?.tool_calls ?? [];
for (const call of toolCalls) {
  conversation = appendMessages(conversation, {
    role: 'tool-use',
    content: '',
    toolCall: { id: call.id, name: call.function.name, arguments: call.function.arguments },
  });

  const result = await getWeather(JSON.parse(call.function.arguments));
  conversation = appendMessages(conversation, {
    role: 'tool-result',
    content: '',
    toolResult: { callId: call.id, outcome: 'success', content: result },
  });
}
```

#### Anthropic (with Tool Calls)

```ts
import { appendAssistantMessage, appendMessages } from 'conversationalist';
import { toAnthropicMessages } from 'conversationalist/anthropic';

const { system, messages } = toAnthropicMessages(conversation);
const response = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20240620',
  system,
  messages,
  tools: [{ name: 'getWeather', ... }],
});

for (const block of response.content) {
  if (block.type !== 'tool_use') continue;
  conversation = appendMessages(conversation, {
    role: 'tool-use',
    content: '',
    toolCall: { id: block.id, name: block.name, arguments: block.input },
  });

  const result = await getWeather(block.input);
  conversation = appendMessages(conversation, {
    role: 'tool-result',
    content: '',
    toolResult: { callId: block.id, outcome: 'success', content: result },
  });
}
```

#### Gemini (with Tool Calls)

```ts
import { appendMessages } from 'conversationalist';
import { toGeminiMessages } from 'conversationalist/gemini';

const { systemInstruction, contents } = toGeminiMessages(conversation);
const response = await model.generateContent({
  systemInstruction,
  contents,
  tools: [{ functionDeclarations: [{ name: 'getWeather', ... }] }],
});

const parts = response.response.candidates?.[0]?.content?.parts ?? [];
for (const part of parts) {
  if (!('functionCall' in part)) continue;
  const callId = crypto.randomUUID(); // Gemini doesn't provide IDs, so we generate one
  const args = part.functionCall.args;

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
```

## Builder Pattern (Fluent API)

If you prefer a more fluent style, use `withConversation` or `pipeConversation`. These allow you to "mutate" a draft within a scope while still resulting in an immutable object.

```ts
import { withConversation, createConversation } from 'conversationalist';

const conversation = withConversation(createConversation(), (draft) => {
  draft
    .appendSystemMessage('You are a helpful assistant.')
    .appendUserMessage('Hello!')
    .appendAssistantMessage('Hi there!');
});
```

## Conversation History (Undo/Redo)

Use the `ConversationHistory` class to manage a stack of conversation states. Because every change returns a new immutable object, supporting undo/redo is built into the architecture.

```ts
import {
  ConversationHistory,
  createConversation,
  appendUserMessage,
} from 'conversationalist';

const history = new ConversationHistory(createConversation());

// You can bind methods to automatically update the history state
const appendUser = history.bind(appendUserMessage);

appendUser('Hello!');
appendUser('How are you?');

history.undo(); // State reverts to just "Hello!"
history.redo(); // State advances back to "How are you?"

console.log(history.current.messages.length); // 2
```

## API Overview

| Category         | Key Functions                                                                                            |
| :--------------- | :------------------------------------------------------------------------------------------------------- |
| **Creation**     | `createConversation`, `serializeConversation`, `deserializeConversation`                                 |
| **Appending**    | `appendUserMessage`, `appendAssistantMessage`, `appendSystemMessage`, `appendMessages`                   |
| **Streaming**    | `appendStreamingMessage`, `updateStreamingMessage`, `finalizeStreamingMessage`, `cancelStreamingMessage` |
| **Modification** | `redactMessageAtPosition`, `replaceSystemMessage`, `collapseSystemMessages`                              |
| **Context**      | `truncateToTokenLimit`, `getRecentMessages`, `estimateConversationTokens`                                |
| **Querying**     | `getConversationMessages`, `getMessageByIdentifier`, `computeConversationStatistics`                     |
| **History**      | `ConversationHistory`, `bindToConversationHistory`                                                       |

## Deterministic Environments (Testing)

Pass a custom environment to control timestamps and IDs, making your tests 100% predictable.

```ts
const testEnv = {
  now: () => '2024-01-01T00:00:00.000Z',
  randomId: () => 'fixed-id',
};

let conversation = createConversation({ title: 'Test' }, testEnv);
```

## Development

```bash
bun install
bun test
bun run build
```
