import { describe, expect, it } from 'bun:test';

import { createConversation } from '../src/conversation';
import {
  appendStreamingMessage,
  cancelStreamingMessage,
  finalizeStreamingMessage,
  getStreamingMessage,
  isStreamingMessage,
  updateStreamingMessage,
} from '../src/streaming';

const testEnvironment = {
  now: () => '2024-01-01T00:00:00.000Z',
  randomId: (() => {
    let counter = 0;
    return () => `test-id-${++counter}`;
  })(),
};

describe('appendStreamingMessage', () => {
  it('creates a new streaming message', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation, messageId } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    expect(messageId).toMatch(/^test-id-\d+$/);
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]?.role).toBe('assistant');
    expect(conversation.messages[0]?.content).toBe('');
  });

  it('marks message as streaming via metadata', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    expect(isStreamingMessage(conversation.messages[0]!)).toBe(true);
  });

  it('preserves custom metadata', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation } = appendStreamingMessage(
      conv,
      'assistant',
      { custom: 'value' },
      testEnvironment,
    );

    expect(conversation.messages[0]?.metadata.custom).toBe('value');
  });
});

describe('updateStreamingMessage', () => {
  it('updates message content', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation, messageId } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    const updated = updateStreamingMessage(conversation, messageId, 'Hello', testEnvironment);
    expect(updated.messages[0]?.content).toBe('Hello');
  });

  it('replaces content on each update (for accumulation)', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation, messageId } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    let updated = updateStreamingMessage(conversation, messageId, 'Hello', testEnvironment);
    updated = updateStreamingMessage(updated, messageId, 'Hello world', testEnvironment);

    expect(updated.messages[0]?.content).toBe('Hello world');
  });

  it('returns unchanged conversation for unknown message ID', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    const updated = updateStreamingMessage(conversation, 'unknown-id', 'Content', testEnvironment);
    expect(updated).toBe(conversation);
  });

  it('supports multi-modal content updates', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation, messageId } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    const updated = updateStreamingMessage(
      conversation,
      messageId,
      [{ type: 'text', text: 'Hello' }],
      testEnvironment,
    );

    expect(Array.isArray(updated.messages[0]?.content)).toBe(true);
  });
});

describe('finalizeStreamingMessage', () => {
  it('removes the streaming flag', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation, messageId } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    const finalized = finalizeStreamingMessage(conversation, messageId, undefined, testEnvironment);
    expect(isStreamingMessage(finalized.messages[0]!)).toBe(false);
  });

  it('adds token usage when provided', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation, messageId } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    const finalized = finalizeStreamingMessage(
      conversation,
      messageId,
      { tokenUsage: { prompt: 10, completion: 20, total: 30 } },
      testEnvironment,
    );

    expect(finalized.messages[0]?.tokenUsage).toEqual({ prompt: 10, completion: 20, total: 30 });
  });

  it('merges additional metadata', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation, messageId } = appendStreamingMessage(
      conv,
      'assistant',
      { original: true },
      testEnvironment,
    );

    const finalized = finalizeStreamingMessage(
      conversation,
      messageId,
      { metadata: { finalized: true } },
      testEnvironment,
    );

    expect(finalized.messages[0]?.metadata.original).toBe(true);
    expect(finalized.messages[0]?.metadata.finalized).toBe(true);
  });

  it('returns unchanged conversation for unknown message ID', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    const finalized = finalizeStreamingMessage(conversation, 'unknown-id', undefined, testEnvironment);
    expect(finalized).toBe(conversation);
  });
});

describe('cancelStreamingMessage', () => {
  it('removes the streaming message', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation, messageId } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    const cancelled = cancelStreamingMessage(conversation, messageId, testEnvironment);
    expect(cancelled.messages).toHaveLength(0);
  });

  it('renumbers remaining messages', async () => {
    const { appendMessages } = await import('../src/conversation');
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(conv, { role: 'user', content: 'Hello' }, testEnvironment);

    const { conversation, messageId } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    // Add another message after the streaming one
    const withMore = appendMessages(conversation, { role: 'user', content: 'Another' }, testEnvironment);

    // Cancel the streaming message
    const cancelled = cancelStreamingMessage(withMore, messageId, testEnvironment);

    // Positions should be renumbered
    cancelled.messages.forEach((m, i) => {
      expect(m.position).toBe(i);
    });
  });

  it('returns unchanged conversation for unknown message ID', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    const cancelled = cancelStreamingMessage(conversation, 'unknown-id', testEnvironment);
    expect(cancelled).toBe(conversation);
  });
});

describe('isStreamingMessage', () => {
  it('returns true for streaming messages', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    expect(isStreamingMessage(conversation.messages[0]!)).toBe(true);
  });

  it('returns false for non-streaming messages', async () => {
    const { appendMessages } = await import('../src/conversation');
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(conv, { role: 'user', content: 'Hello' }, testEnvironment);

    expect(isStreamingMessage(conv.messages[0]!)).toBe(false);
  });

  it('returns false for finalized streaming messages', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation, messageId } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);
    const finalized = finalizeStreamingMessage(conversation, messageId, undefined, testEnvironment);

    expect(isStreamingMessage(finalized.messages[0]!)).toBe(false);
  });
});

describe('getStreamingMessage', () => {
  it('returns the streaming message if one exists', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation, messageId } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);

    const streaming = getStreamingMessage(conversation);
    expect(streaming?.id).toBe(messageId);
  });

  it('returns undefined if no streaming message exists', async () => {
    const { appendMessages } = await import('../src/conversation');
    let conv = createConversation({ id: 'test' }, testEnvironment);
    conv = appendMessages(conv, { role: 'user', content: 'Hello' }, testEnvironment);

    const streaming = getStreamingMessage(conv);
    expect(streaming).toBeUndefined();
  });

  it('returns undefined after message is finalized', () => {
    const conv = createConversation({ id: 'test' }, testEnvironment);
    const { conversation, messageId } = appendStreamingMessage(conv, 'assistant', undefined, testEnvironment);
    const finalized = finalizeStreamingMessage(conversation, messageId, undefined, testEnvironment);

    const streaming = getStreamingMessage(finalized);
    expect(streaming).toBeUndefined();
  });
});
