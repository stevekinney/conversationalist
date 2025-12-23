import { describe, expect, test } from 'bun:test';

import { simpleTokenEstimator } from '../src/context';
import {
  appendAssistantMessage,
  appendUserMessage,
  createConversation,
} from '../src/conversation';
import { isStreamingMessage } from '../src/streaming';
import { pipeConversation, withConversation } from '../src/with-conversation';

describe('withConversation', () => {
  test('chains mutating methods and returns immutable conversation', () => {
    const base = createConversation({ title: 'Chain' });
    const result = withConversation(base, (c) => {
      c.appendUserMessage('hi')
        .appendAssistantMessage('hello')
        .appendSystemMessage('note')
        .redactMessageAtPosition(1, '[REDACTED]')
        .appendMessages({ role: 'user', content: 'final' });
    });

    // Synchronous path returns Conversation
    expect(result.createdAt).toBeDefined();
    expect(result.messages.length).toBe(4);
    expect(result.messages[1]!.content).toBe('[REDACTED]');

    expect(result).not.toBe(base);
  });

  test('supports async draft function and resolves to conversation', async () => {
    const base = createConversation({ title: 'Async' });
    const resultPromise = withConversation(base, async (c) => {
      await Promise.resolve();
      c.appendUserMessage('hi from async');
    });

    const result = await resultPromise;
    expect(result.messages.length).toBe(1);
    expect(result.messages[0]!.role).toBe('user');
  });

  test('exposes system message helpers on the draft', () => {
    const base = createConversation({ title: 'Systems' });
    const result = withConversation(base, (c) => {
      c.appendMessages(
        { role: 'system', content: 'First' },
        { role: 'system', content: 'Second' },
      )
        .prependSystemMessage('Intro')
        .replaceSystemMessage('Intro v2')
        .collapseSystemMessages();
    });

    const systemMessages = result.messages.filter((m) => m.role === 'system');
    expect(systemMessages.length).toBe(1);
    expect(systemMessages[0]!.content).toBe('Intro v2\nFirst\nSecond');
  });
});

describe('pipeConversation', () => {
  test('pipes the conversation through functional transforms', () => {
    const base = createConversation({ title: 'Pipe' });
    const piped = pipeConversation(
      base,
      (conv) => appendUserMessage(conv, 'hi'),
      (conv) => appendAssistantMessage(conv, 'hello'),
    );

    expect(piped.messages.length).toBe(2);
    expect(piped.messages[0]!.role).toBe('user');
    expect(piped.messages[1]!.role).toBe('assistant');
    expect(base.messages.length).toBe(0);
  });
});

describe('withConversation streaming support', () => {
  test('appendStreamingMessage returns messageId and allows chaining', () => {
    const base = createConversation({ title: 'Streaming' });
    let capturedId: string | undefined;

    const result = withConversation(base, (c) => {
      const { draft, messageId } = c.appendStreamingMessage('assistant');
      capturedId = messageId;
      draft.updateStreamingMessage(messageId, 'Hello...');
    });

    expect(capturedId).toBeDefined();
    expect(result.messages.length).toBe(1);
    expect(result.messages[0]!.content).toBe('Hello...');
    expect(isStreamingMessage(result.messages[0]!)).toBe(true);
  });

  test('finalizeStreamingMessage removes streaming flag', () => {
    const base = createConversation({ title: 'Finalize' });

    const result = withConversation(base, (c) => {
      const { draft, messageId } = c.appendStreamingMessage('assistant');
      draft
        .updateStreamingMessage(messageId, 'Complete response')
        .finalizeStreamingMessage(messageId, {
          tokenUsage: { prompt: 10, completion: 5, total: 15 },
        });
    });

    expect(result.messages.length).toBe(1);
    expect(result.messages[0]!.content).toBe('Complete response');
    expect(isStreamingMessage(result.messages[0]!)).toBe(false);
    expect(result.messages[0]!.tokenUsage?.total).toBe(15);
  });

  test('cancelStreamingMessage removes the message', () => {
    const base = createConversation({ title: 'Cancel' });

    const result = withConversation(base, (c) => {
      c.appendUserMessage('Hello');
      const { draft, messageId } = c.appendStreamingMessage('assistant');
      draft.cancelStreamingMessage(messageId);
    });

    expect(result.messages.length).toBe(1);
    expect(result.messages[0]!.role).toBe('user');
  });
});

describe('withConversation context window management', () => {
  test('truncateFromPosition keeps messages from position onwards', () => {
    const base = createConversation({ title: 'Truncate' });

    const result = withConversation(base, (c) => {
      c.appendUserMessage('Message 0')
        .appendAssistantMessage('Message 1')
        .appendUserMessage('Message 2')
        .appendAssistantMessage('Message 3')
        .truncateFromPosition(2);
    });

    expect(result.messages.length).toBe(2);
    expect(result.messages[0]!.content).toBe('Message 2');
    expect(result.messages[1]!.content).toBe('Message 3');
  });

  test('truncateFromPosition preserves system messages by default', () => {
    const base = createConversation({ title: 'TruncateSystem' });

    const result = withConversation(base, (c) => {
      c.appendSystemMessage('System prompt')
        .appendUserMessage('Message 1')
        .appendAssistantMessage('Message 2')
        .appendUserMessage('Message 3')
        .truncateFromPosition(3);
    });

    expect(result.messages.length).toBe(2);
    expect(result.messages[0]!.role).toBe('system');
    expect(result.messages[1]!.content).toBe('Message 3');
  });

  test('truncateToTokenLimit removes oldest messages to fit limit', () => {
    const base = createConversation({ title: 'TokenLimit' });

    const result = withConversation(base, (c) => {
      c.appendUserMessage('This is a longer message that takes more tokens')
        .appendAssistantMessage('Response one')
        .appendUserMessage('Short')
        .appendAssistantMessage('Response two')
        .truncateToTokenLimit(10, simpleTokenEstimator);
    });

    expect(result.messages.length).toBeLessThan(4);
  });

  test('truncateToTokenLimit preserves last N messages', () => {
    const base = createConversation({ title: 'PreserveLast' });

    const result = withConversation(base, (c) => {
      c.appendUserMessage('Old message one')
        .appendAssistantMessage('Old response')
        .appendUserMessage('New message')
        .appendAssistantMessage('New response')
        .truncateToTokenLimit(5, simpleTokenEstimator, { preserveLastN: 2 });
    });

    const lastTwo = result.messages.slice(-2);
    expect(lastTwo[0]!.content).toBe('New message');
    expect(lastTwo[1]!.content).toBe('New response');
  });
});
