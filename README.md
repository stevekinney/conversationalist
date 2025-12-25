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

conversation = truncateToTokenLimit(conversation, 4000, {
  preserveSystemMessages: true,
  preserveLastN: 2,
});
```

#### Custom Token Counters

You can provide a custom token estimator (e.g. using `tiktoken` or `anthropic-tokenizer`) by passing it in the options or by binding it to your environment.

```ts
import { truncateToTokenLimit } from 'conversationalist';
// import { get_encoding } from 'tiktoken';

const tiktokenEstimator = (message) => {
  // Your logic here...
  return 100;
};

// 1. Pass directly in options
conversation = truncateToTokenLimit(conversation, 4000, {
  estimateTokens: tiktokenEstimator,
});

// 2. Or bind to a history instance/environment
const history = new ConversationHistory(conversation, {
  estimateTokens: tiktokenEstimator,
});

const boundTruncate = history.bind(truncateToTokenLimit);
boundTruncate(4000); // Uses tiktokenEstimator automatically
```

## Plugins

**Conversationalist** supports a plugin system that allows you to transform messages as they are appended to a conversation. Plugins are functions that take a `MessageInput` and return a modified `MessageInput`.

### PII Redaction Plugin

The library includes a built-in `piiRedactionPlugin` that can automatically redact emails, phone numbers, and common API key patterns.

```ts
import {
  appendUserMessage,
  createConversation,
  piiRedactionPlugin,
} from 'conversationalist';

// 1. Enable by adding to your environment
const env = {
  plugins: [piiRedactionPlugin],
};

// 2. Use the environment when appending messages
let conversation = createConversation({}, env);
conversation = appendUserMessage(
  conversation,
  'Contact me at test@example.com',
  undefined,
  env,
);

console.log(conversation.messages[0].content);
// "Contact me at [EMAIL_REDACTED]"
```

When using `ConversationHistory`, you only need to provide the plugin once during initialization:

```ts
const history = new ConversationHistory(createConversation(), {
  plugins: [piiRedactionPlugin],
});

const appendUser = history.bind(appendUserMessage);
appendUser('My key is sk-12345...'); // Automatically redacted
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

````ts
import {
  ConversationHistory,
  createConversation,
  appendUserMessage,
} from 'conversationalist';

const history = new ConversationHistory(createConversation());

// You can use convenience methods that automatically track state
history.appendUserMessage('Hello!');
history.appendAssistantMessage('How are you?');

history.undo(); // State reverts to just "Hello!"
history.redo(); // State advances back to "How are you?"

// Query methods are also available
const messages = history.getMessages();
const stats = history.getStatistics();

### Conversation Branching

The `ConversationHistory` class supports branching. When you undo to a previous state and push a new update, it creates an alternate path instead of deleting the old history.

```ts
const history = new ConversationHistory(createConversation());

history.push(appendUserMessage(history.current, "Path A"));
history.undo();

history.push(appendUserMessage(history.current, "Path B"));

console.log(history.branchCount); // 2
console.log(history.current.messages[0].content); // "Path B"

history.switchToBranch(0);
console.log(history.current.messages[0].content); // "Path A"
````

````

## Integration

### Using with React

Because **Conversationalist** is immutable, it works perfectly with React's `useState` or `useReducer`. Every update returns a new reference, which automatically triggers a re-render.

```tsx
import { useState } from 'react';
import { createConversation, appendUserMessage } from 'conversationalist';

export function ChatApp() {
  const [conversation, setConversation] = useState(() => createConversation());

  const handleSend = (text: string) => {
    // The new conversation object is set into state
    setConversation((prev) => appendUserMessage(prev, text));
  };

  return (
    <div>
      {conversation.messages.map((m) => (
        <div key={m.id}>{String(m.content)}</div>
      ))}
      <button onClick={() => handleSend('Hello!')}>Send</button>
    </div>
  );
}
````

#### Custom React Hook Example

For more complex applications, you can wrap the logic into a custom hook to provide a cleaner interface for your components.

```tsx
import { useState, useCallback } from 'react';
import {
  createConversation,
  appendUserMessage,
  appendAssistantMessage,
  toChatMessages,
} from 'conversationalist';

export function useChat(initialTitle?: string) {
  const [conversation, setConversation] = useState(() =>
    createConversation({ title: initialTitle }),
  );
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(
    async (text: string) => {
      // 1. Append user message
      const updated = appendUserMessage(conversation, text);
      setConversation(updated);
      setLoading(true);

      try {
        // 2. Call your LLM API (e.g. via your own backend)
        const response = await fetch('/api/chat', {
          method: 'POST',
          body: JSON.stringify({
            messages: toChatMessages(updated),
          }),
        });
        const data = await response.json();

        // 3. Append assistant response
        setConversation((prev) => appendAssistantMessage(prev, data.answer));
      } finally {
        setLoading(false);
      }
    },
    [conversation],
  );

  return {
    conversation,
    messages: conversation.messages,
    loading,
    sendMessage,
  };
}
```

### Using with Redux

Redux requires immutable state updates, making **Conversationalist** an ideal companion. You can store the conversation object directly in your store.

```ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { createConversation, appendUserMessage, Conversation } from 'conversationalist';

interface ChatState {
  conversation: Conversation;
}

const chatSlice = createSlice({
  name: 'chat',
  initialState: {
    conversation: createConversation(),
  } as ChatState,
  reducers: {
    userMessageReceived: (state, action: PayloadAction<string>) => {
      // Redux Toolkit's createSlice uses Immer, but since appendUserMessage
      // returns a new object, we can just replace the property.
      state.conversation = appendUserMessage(state.conversation, action.payload);
    },
  },
});
```

### Using with Svelte (Runes)

In Svelte 5, you can manage conversation state using the `$state` rune. Since **Conversationalist** is immutable, you update the state by re-assigning the variable with a new conversation object.

```svelte
<script lang="ts">
  import { createConversation, appendUserMessage } from 'conversationalist';

  let conversation = $state(createConversation());

  function handleSend(text: string) {
    conversation = appendUserMessage(conversation, text);
  }
</script>

<div>
  {#each conversation.messages as m (m.id)}
    <div>{String(m.content)}</div>
  {/each}
  <button onclick={() => handleSend('Hello!')}>Send</button>
</div>
```

#### Custom Svelte Rune Example

You can encapsulate your chat logic into a reusable class-based rune. Svelte 5's `$state` and `$derived` runes pair perfectly with **Conversationalist**'s immutable data and history utilities.

```ts
import {
  createConversation,
  appendUserMessage,
  appendAssistantMessage,
  toChatMessages,
  ConversationHistory,
} from 'conversationalist';

export class Chat {
  // Use history to get undo/redo for free
  #history = new ConversationHistory(createConversation());

  // Wrap the current state in a rune
  conversation = $state(this.#history.current);
  loading = $state(false);

  // Derived state for the UI
  messages = $derived(this.conversation.messages);
  canUndo = $derived(this.#history.canUndo);
  canRedo = $derived(this.#history.canRedo);

  async sendMessage(text: string) {
    // 1. Update history and state
    this.#history.push(appendUserMessage(this.conversation, text));
    this.conversation = this.#history.current;
    this.loading = true;

    try {
      // 2. Call your LLM API
      const response = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: toChatMessages(this.conversation) }),
      });
      const data = await response.json();

      // 3. Update history and state with response
      this.#history.push(appendAssistantMessage(this.conversation, data.answer));
      this.conversation = this.#history.current;
    } finally {
      this.loading = false;
    }
  }

  undo() {
    const prev = this.#history.undo();
    if (prev) this.conversation = prev;
  }

  redo() {
    const next = this.#history.redo();
    if (next) this.conversation = next;
  }
}
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
