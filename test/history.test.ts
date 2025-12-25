import { describe, expect, it } from 'bun:test';

import {
  appendUserMessage,
  bindToConversationHistory,
  computeConversationStatistics,
  ConversationHistory,
  createConversation,
  estimateConversationTokens,
  truncateToTokenLimit,
} from '../src';

describe('ConversationHistory', () => {
  it('should initialize with a conversation', () => {
    const conversation = createConversation({ title: 'Test' });
    const history = new ConversationHistory(conversation);
    expect(history.current).toBe(conversation);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('should support undo and redo', () => {
    const v1 = createConversation({ title: 'V1' });
    const history = new ConversationHistory(v1);

    const v2 = appendUserMessage(v1, 'Hello');
    history.push(v2);

    expect(history.current).toBe(v2);
    expect(history.canUndo).toBe(true);

    const undone = history.undo();
    expect(undone).toBe(v1);
    expect(history.current).toBe(v1);
    expect(history.canRedo).toBe(true);

    const redone = history.redo();
    expect(redone).toBe(v2);
    expect(history.current).toBe(v2);
  });

  it('should truncate redo history when pushing a new state', () => {
    const history = new ConversationHistory(createConversation({ title: 'V1' }));
    history.push(appendUserMessage(history.current, 'V2'));
    history.undo();

    const v3 = appendUserMessage(history.current, 'V3');
    history.push(v3);

    expect(history.canRedo).toBe(false);
    expect(history.current).toBe(v3);
  });

  it('should bind functions and automatically push updates', () => {
    const history = new ConversationHistory(createConversation());
    const boundAppend = history.bind(appendUserMessage);

    boundAppend('Hello');
    expect(history.current.messages.length).toBe(1);
    expect(history.current.messages[0].content).toBe('Hello');

    boundAppend('World');
    expect(history.current.messages.length).toBe(2);
    expect(history.canUndo).toBe(true);

    history.undo();
    expect(history.current.messages.length).toBe(1);
  });

  it('should bind functions that do not return a conversation without pushing', () => {
    const history = new ConversationHistory(createConversation());
    const boundStats = history.bind(computeConversationStatistics);

    const stats = boundStats();
    expect(stats.total).toBe(0);
    expect(history.current.messages.length).toBe(0); // Should not have pushed
  });

  it('should work with bindToConversationHistory utility', () => {
    const history = new ConversationHistory(createConversation());
    const boundAppend = bindToConversationHistory(history, appendUserMessage);

    boundAppend('Hello');
    expect(history.current.messages.length).toBe(1);
  });

  it('should not push non-conformant objects to history', () => {
    const original = createConversation({ id: 'original' });
    const history = new ConversationHistory(original);
    const boundIncomplete = history.bind(() => ({
      id: 'incomplete',
      messages: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      // missing status, metadata, tags
    }) as any);

    boundIncomplete();
    expect(history.current.id).toBe('original'); // Should NOT have pushed the incomplete object
  });

  it('should not push objects with null metadata to history', () => {
    const original = createConversation({ id: 'original' });
    const history = new ConversationHistory(original);
    const boundWithNullMetadata = history.bind(() => ({
      id: 'null-metadata',
      status: 'active',
      metadata: null,
      tags: [],
      messages: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }) as any);

    boundWithNullMetadata();
    expect(history.current.id).toBe('original'); // Should NOT have pushed the object with null metadata
  });

  it('should use custom token estimator from environment when bound', () => {
    const customEstimator = () => 100; // Every message is 100 tokens
    const history = new ConversationHistory(createConversation(), {
      estimateTokens: customEstimator,
    });

    const boundTruncate = history.bind(truncateToTokenLimit);

    history.push(appendUserMessage(history.current, 'Hello'));
    history.push(appendUserMessage(history.current, 'World'));

    // 2 messages + initial = 3 * 100 = 300 tokens
    // Truncate to 150 should leave 1 message + initial (if initial is empty/0 tokens, but we said every message is 100)
    // Wait, createConversation creates 0 messages.
    // So 2 messages * 100 = 200 tokens.
    // Truncate to 150 should leave 1 message.

    boundTruncate(150);
    expect(history.current.messages.length).toBe(1);
  });

  it('should use custom token estimator from environment for estimateConversationTokens when bound', () => {
    const customEstimator = () => 100;
    const history = new ConversationHistory(createConversation(), {
      estimateTokens: customEstimator,
    });

    const boundEstimate = history.bind(estimateConversationTokens);

    history.push(appendUserMessage(history.current, 'Hello'));
    history.push(appendUserMessage(history.current, 'World'));

    expect(boundEstimate()).toBe(200);
  });
});
