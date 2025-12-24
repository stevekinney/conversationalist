import { describe, expect, it } from 'bun:test';

import {
  appendUserMessage,
  bindToConversationHistory,
  computeConversationStatistics,
  ConversationHistory,
  createConversation,
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
    expect(history.versions.length).toBe(1); // Should not have pushed
  });

  it('should work with bindToConversationHistory utility', () => {
    const history = new ConversationHistory(createConversation());
    const boundAppend = bindToConversationHistory(history, appendUserMessage);

    boundAppend('Hello');
    expect(history.current.messages.length).toBe(1);
  });
});
