import { describe, expect, it } from 'bun:test';

import {
  estimateConversationTokens,
  getRecentMessages,
  simpleTokenEstimator,
  truncateFromPosition,
  truncateToTokenLimit,
} from '../src/context';
import { appendMessages, createConversation } from '../src/conversation';
import { createMessage } from '../src/utilities';

const testEnvironment = {
  now: () => '2024-01-01T00:00:00.000Z',
  randomId: (() => {
    let counter = 0;
    return () => `test-id-${++counter}`;
  })(),
};

describe('getRecentMessages', () => {
  it('returns the last N messages', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'system', content: 'System message' },
      { role: 'user', content: 'User 1' },
      { role: 'assistant', content: 'Assistant 1' },
      { role: 'user', content: 'User 2' },
      { role: 'assistant', content: 'Assistant 2' },
      testEnvironment,
    );

    const recent = getRecentMessages(conv, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.content).toBe('User 2');
    expect(recent[1]?.content).toBe('Assistant 2');
  });

  it('excludes system messages by default', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'system', content: 'System' },
      { role: 'user', content: 'User' },
      testEnvironment,
    );

    const recent = getRecentMessages(conv, 10);
    expect(recent.every((m) => m.role !== 'system')).toBe(true);
  });

  it('includes system messages when option is set', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'system', content: 'System' },
      { role: 'user', content: 'User' },
      testEnvironment,
    );

    const recent = getRecentMessages(conv, 10, { includeSystem: true });
    expect(recent.some((m) => m.role === 'system')).toBe(true);
  });

  it('excludes hidden messages by default', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'user', content: 'Visible' },
      { role: 'user', content: 'Hidden', hidden: true },
      testEnvironment,
    );

    const recent = getRecentMessages(conv, 10);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.content).toBe('Visible');
  });
});

describe('truncateFromPosition', () => {
  it('keeps messages from position onwards', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'user', content: 'Message 0' },
      { role: 'assistant', content: 'Message 1' },
      { role: 'user', content: 'Message 2' },
      { role: 'assistant', content: 'Message 3' },
      testEnvironment,
    );

    const truncated = truncateFromPosition(conv, 2, undefined, testEnvironment);
    expect(truncated.messages).toHaveLength(2);
    expect(truncated.messages[0]?.content).toBe('Message 2');
    expect(truncated.messages[1]?.content).toBe('Message 3');
  });

  it('preserves system messages by default', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Message 1' },
      { role: 'assistant', content: 'Message 2' },
      { role: 'user', content: 'Message 3' },
      testEnvironment,
    );

    const truncated = truncateFromPosition(conv, 2, undefined, testEnvironment);
    expect(truncated.messages.some((m) => m.role === 'system')).toBe(true);
    expect(truncated.messages[0]?.content).toBe('System prompt');
  });

  it('can exclude system messages', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Message 1' },
      { role: 'assistant', content: 'Message 2' },
      testEnvironment,
    );

    const truncated = truncateFromPosition(conv, 2, { preserveSystemMessages: false }, testEnvironment);
    expect(truncated.messages.every((m) => m.role !== 'system')).toBe(true);
  });

  it('renumbers positions correctly', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'user', content: 'Message 0' },
      { role: 'assistant', content: 'Message 1' },
      { role: 'user', content: 'Message 2' },
      testEnvironment,
    );

    const truncated = truncateFromPosition(conv, 1, undefined, testEnvironment);
    truncated.messages.forEach((m, i) => {
      expect(m.position).toBe(i);
    });
  });

  it('handles multi-modal content in truncateFromPosition', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'user', content: 'Msg 1' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Msg 2' }],
      },
      testEnvironment,
    );

    const truncated = truncateFromPosition(conv, 1, undefined, testEnvironment);
    expect(truncated.messages).toHaveLength(1);
    expect(Array.isArray(truncated.messages[0].content)).toBe(true);
  });
});

describe('estimateConversationTokens', () => {
  it('sums token estimates for all messages', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'user', content: 'Hello' }, // 5 chars
      { role: 'assistant', content: 'Hi there' }, // 8 chars
      testEnvironment,
    );

    const tokens = estimateConversationTokens(conv, simpleTokenEstimator);
    // simpleTokenEstimator uses ~4 chars per token
    expect(tokens).toBeGreaterThan(0);
  });

  it('uses estimator from environment when only environment is provided', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(conv, { role: 'user', content: 'Hello world' }, testEnvironment);

    const tokens = estimateConversationTokens(conv, testEnvironment);
    expect(tokens).toBe(3); // 'Hello world' is 11 chars -> 3 tokens
  });

  it('uses default estimator when no estimator or environment is provided', () => {
    let conv = createConversation({ id: 'test' });
    conv = appendMessages(conv, { role: 'user', content: 'Hello world' });

    const tokens = estimateConversationTokens(conv);
    expect(tokens).toBe(3);
  });
});

describe('simpleTokenEstimator', () => {
  it('estimates tokens based on character count', () => {
    const message = createMessage({
      id: 'test',
      role: 'user',
      content: 'Hello world', // 11 chars
      position: 0,
      createdAt: '2024-01-01T00:00:00.000Z',
      metadata: {},
      hidden: false,
    });

    const tokens = simpleTokenEstimator(message);
    // 11 chars / 4 = 2.75, ceil = 3
    expect(tokens).toBe(3);
  });
});

describe('truncateToTokenLimit', () => {
  it('returns unchanged if under limit', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(conv, { role: 'user', content: 'Hi' }, testEnvironment);

    const truncated = truncateToTokenLimit(conv, 1000, { estimateTokens: simpleTokenEstimator }, testEnvironment);
    expect(truncated.messages).toHaveLength(conv.messages.length);
  });

  it('removes oldest messages first to fit limit', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'user', content: 'This is a longer message that takes more tokens' },
      { role: 'assistant', content: 'Response one' },
      { role: 'user', content: 'Short' },
      { role: 'assistant', content: 'Response two' },
      testEnvironment,
    );

    // Set a low token limit that can't fit all messages
    const truncated = truncateToTokenLimit(conv, 10, { estimateTokens: simpleTokenEstimator }, testEnvironment);
    expect(truncated.messages.length).toBeLessThan(conv.messages.length);
  });

  it('preserves system messages', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User message' },
      { role: 'assistant', content: 'Assistant message' },
      testEnvironment,
    );

    const truncated = truncateToTokenLimit(conv, 5, { estimateTokens: simpleTokenEstimator }, testEnvironment);
    expect(truncated.messages.some((m) => m.role === 'system')).toBe(true);
  });

  it('preserves last N messages when specified', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'user', content: 'Old message one' },
      { role: 'assistant', content: 'Old response' },
      { role: 'user', content: 'New message' },
      { role: 'assistant', content: 'New response' },
      testEnvironment,
    );

    const truncated = truncateToTokenLimit(
      conv,
      10,
      {
        estimateTokens: simpleTokenEstimator,
        preserveLastN: 2,
      },
      testEnvironment,
    );

    // The last 2 messages should always be preserved
    const lastMessages = truncated.messages.slice(-2);
    expect(lastMessages[0]?.content).toBe('New message');
    expect(lastMessages[1]?.content).toBe('New response');
  });

  it('returns only system and protected messages when token limit is too low', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'system', content: 'Very long system prompt that takes many tokens' },
      { role: 'user', content: 'Old message' },
      { role: 'assistant', content: 'Old response' },
      { role: 'user', content: 'New message' },
      { role: 'assistant', content: 'New response' },
      testEnvironment,
    );

    // Token limit so low that only system + last N fit (or even just those)
    const truncated = truncateToTokenLimit(
      conv,
      1, // Very low limit
      {
        estimateTokens: simpleTokenEstimator,
        preserveLastN: 2,
      },
      testEnvironment,
    );

    // Should contain system message and last 2 protected messages
    expect(truncated.messages.some((m) => m.role === 'system')).toBe(true);
    // Positions should be renumbered
    truncated.messages.forEach((m, i) => {
      expect(m.position).toBe(i);
    });
  });

  it('handles messages with multi-modal content during truncation', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'system', content: 'System' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this' },
          { type: 'image', url: 'data:image/png;base64,abc' },
        ],
      },
      { role: 'assistant', content: 'I see it' },
      testEnvironment,
    );

    const truncated = truncateToTokenLimit(
      conv,
      1, // Very low limit to trigger the special path
      {
        estimateTokens: simpleTokenEstimator,
        preserveLastN: 1,
      },
      testEnvironment,
    );

    // Should preserve array content structure
    expect(truncated.messages.length).toBeGreaterThan(0);
  });

  it('handles messages with tool calls during truncation', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Do something' },
      {
        role: 'tool-use',
        content: '',
        toolCall: { id: 'call-1', name: 'tool', arguments: '{}' },
      },
      {
        role: 'tool-result',
        content: '',
        toolResult: { callId: 'call-1', outcome: 'success', content: 'done' },
      },
      { role: 'assistant', content: 'Done!' },
      testEnvironment,
    );

    const truncated = truncateToTokenLimit(
      conv,
      1, // Very low limit
      {
        estimateTokens: simpleTokenEstimator,
        preserveLastN: 2,
      },
      testEnvironment,
    );

    // Should handle toolCall and toolResult properties
    expect(truncated.messages.length).toBeGreaterThan(0);
  });

  it('handles messages with token usage during truncation', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(
      conv,
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: 'Hi there!',
        tokenUsage: { prompt: 10, completion: 5, total: 15 },
      },
      testEnvironment,
    );

    const truncated = truncateToTokenLimit(
      conv,
      1, // Very low limit
      {
        estimateTokens: simpleTokenEstimator,
        preserveLastN: 1,
      },
      testEnvironment,
    );

    // Should preserve tokenUsage in truncated messages
    const assistantMsg = truncated.messages.find((m) => m.role === 'assistant');
    if (assistantMsg) {
      expect(assistantMsg.tokenUsage).toBeDefined();
    }
  });

  it('works with a plain options object (not environment)', () => {
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(conv, { role: 'user', content: 'Hello' }, testEnvironment);
    conv = appendMessages(conv, { role: 'assistant', content: 'World' }, testEnvironment);

    // Tokens: Hello (2) + World (2) = 4
    const truncated = truncateToTokenLimit(conv, 2, { preserveLastN: 1 });
    expect(truncated.messages.length).toBe(1);
    expect(truncated.messages[0].content).toBe('World');
  });

  it('works with no options or estimator provided', () => {
    let conv = createConversation({ id: 'test' });
    conv = appendMessages(conv, { role: 'user', content: 'Hello world' });

    const truncated = truncateToTokenLimit(conv, 1);
    expect(truncated.messages.length).toBe(0);
  });

  it('accepts a function as the third argument (overload)', () => {
    let conv = createConversation({ id: 'test' });
    conv = appendMessages(conv, { role: 'user', content: 'Hello' });

    const truncated = truncateToTokenLimit(conv, 1, () => 100);
    expect(truncated.messages.length).toBe(0);
  });

  it('does not overwrite explicitly passed environment when options contain an estimator', () => {
    let conv = createConversation({ id: 'test' });
    conv = appendMessages(conv, { role: 'user', content: 'Hello' });

    const myEnv = {
      now: () => '2025-01-01T00:00:00.000Z',
      randomId: () => 'custom-id',
      estimateTokens: () => 1,
    };

    // If we pass an estimator in options AND an environment
    const truncated = truncateToTokenLimit(
      conv,
      10,
      { estimateTokens: () => 100 }, // This estimator should be used
      myEnv, // This environment should NOT be overwritten by the options object
    );

    // If it used myEnv.now(), the updatedAt should match.
    // truncateToTokenLimit re-creates messages if it truncates.
    // In this case, conv has 1 message.
    // If it uses options.estimateTokens (100), 100 > 10, so it truncates.
    // If it uses myEnv.estimateTokens (1), 1 <= 10, so it doesn't truncate.

    expect(truncated.messages.length).toBe(0); // Should have used the 100 tokens estimator
    expect(truncated.updatedAt).toBe('2025-01-01T00:00:00.000Z'); // Should have used myEnv.now()
  });
});
