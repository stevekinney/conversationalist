import { describe, expect, expectTypeOf, it } from 'bun:test';

import {
  appendUserMessage,
  ConversationHistory,
  createConversation,
  estimateConversationTokens,
  getStatistics,
  truncateToTokenLimit,
} from '../src';
import { historyFromMarkdown, historyToMarkdown } from '../src/markdown';
import type { Conversation, Message } from '../src/types';

const getOrderedMessages = (conversation: Conversation): Message[] =>
  conversation.ids
    .map((id) => conversation.messages[id])
    .filter((message): message is Message => Boolean(message));

describe('ConversationHistory', () => {
  it('should implement EventTarget', () => {
    expectTypeOf<ConversationHistory>().toMatchTypeOf<EventTarget>();
    const history = new ConversationHistory(createConversation());
    expect(history instanceof EventTarget).toBe(true);
  });

  it('should initialize with a conversation', () => {
    const conversation = createConversation({ title: 'Test' });
    const history = new ConversationHistory(conversation);
    expect(history.current).toBe(conversation);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('should initialize with an empty conversation by default', () => {
    const history = new ConversationHistory();
    expect(history.current.ids).toHaveLength(0);
    expect(history.current.status).toBe('active');
    expect(history.canUndo).toBe(false);
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

  it('should support branching and switching between branches', () => {
    const v1 = createConversation({ title: 'V1' });
    const history = new ConversationHistory(v1);

    const v2 = appendUserMessage(v1, 'Message 2');
    history.push(v2);

    history.undo(); // back to v1

    const v3 = appendUserMessage(v1, 'Message 3');
    history.push(v3); // Creates a second branch from v1

    expect(history.current).toBe(v3);
    expect(history.branchCount).toBe(2);
    expect(history.branchIndex).toBe(1);

    history.switchToBranch(0);
    expect(history.current).toBe(v2);
    expect(history.branchIndex).toBe(0);

    history.undo();
    expect(history.current).toBe(v1);
    expect(history.redo(1)).toBe(v3);
  });

  it('should return path to current state', () => {
    const v1 = createConversation({ title: 'V1' });
    const history = new ConversationHistory(v1);
    const v2 = appendUserMessage(v1, 'V2');
    history.push(v2);
    const v3 = appendUserMessage(v2, 'V3');
    history.push(v3);

    const path = history.getPath();
    expect(path).toEqual([v1, v2, v3]);
  });

  it('should add a new branch instead of truncating history', () => {
    const history = new ConversationHistory(createConversation({ title: 'V1' }));
    const v1 = history.current;
    const v2 = appendUserMessage(v1, 'V2');
    history.push(v2);
    history.undo();

    const v3 = appendUserMessage(v1, 'V3');
    history.push(v3);

    expect(history.current).toBe(v3);
    expect(history.branchCount).toBe(2);

    history.undo();
    expect(history.canRedo).toBe(true);
    expect(history.redo(0)).toBe(v2);
  });

  it('should bind functions and automatically push updates', () => {
    const history = new ConversationHistory(createConversation());
    const boundAppend = history.bind(appendUserMessage);

    boundAppend('Hello');
    const afterFirst = getOrderedMessages(history.current);
    expect(afterFirst.length).toBe(1);
    expect(afterFirst[0].content).toBe('Hello');

    boundAppend('World');
    expect(history.current.ids.length).toBe(2);
    expect(history.canUndo).toBe(true);

    history.undo();
    expect(history.current.ids.length).toBe(1);
  });

  it('should bind functions that do not return a conversation without pushing', () => {
    const history = new ConversationHistory(createConversation());
    const boundStats = history.bind(getStatistics);

    const stats = boundStats();
    expect(stats.total).toBe(0);
    expect(history.current.ids.length).toBe(0); // Should not have pushed
  });

  it('should not push non-conformant objects to history', () => {
    const original = createConversation({ id: 'original' });
    const history = new ConversationHistory(original);
    const boundIncomplete = history.bind(
      () =>
        ({
          id: 'incomplete',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          // missing status, metadata, tags
        }) as any,
    );

    boundIncomplete();
    expect(history.current.id).toBe('original'); // Should NOT have pushed the incomplete object
  });

  it('should not push objects with null metadata to history', () => {
    const original = createConversation({ id: 'original' });
    const history = new ConversationHistory(original);
    const boundWithNullMetadata = history.bind(
      () =>
        ({
          id: 'null-metadata',
          status: 'active',
          metadata: null,
          tags: [],
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        }) as any,
    );

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
    expect(history.current.ids.length).toBe(1);
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

  it('should return 0 for redoCount on a leaf node', () => {
    const history = new ConversationHistory(createConversation());
    expect(history.redoCount).toBe(0);
  });

  it('should return undefined when undo is not possible', () => {
    const history = new ConversationHistory(createConversation());
    expect(history.undo()).toBeUndefined();
  });

  it('should return undefined when redo is not possible', () => {
    const history = new ConversationHistory(createConversation());
    expect(history.redo()).toBeUndefined();
  });

  it('should return undefined when switching to non-existent branch', () => {
    const history = new ConversationHistory(createConversation());
    expect(history.switchToBranch(1)).toBeUndefined();
  });

  it('should return 1 for branchCount and 0 for branchIndex on root node', () => {
    const history = new ConversationHistory(createConversation());
    expect(history.branchCount).toBe(1);
    expect(history.branchIndex).toBe(0);
  });

  describe('encapsulated utility methods', () => {
    it('should support query methods', () => {
      let conv = createConversation({ title: 'Query' });
      conv = appendUserMessage(conv, 'Hello');
      const history = new ConversationHistory(conv);

      expect(history.getMessages()).toHaveLength(1);
      expect(history.getMessageAtPosition(0)?.content).toBe('Hello');
      expect(history.getStatistics().total).toBe(1);
      expect(history.serialize().title).toBe('Query');
      expect(history.toChatMessages()).toHaveLength(1);
      expect(historyToMarkdown(history)).toContain('### User');
      expect(historyToMarkdown(history, { includeMetadata: true })).toContain('---');

      const restored = historyFromMarkdown(
        historyToMarkdown(history, { includeMetadata: true }),
      );
      const restoredMessages = getOrderedMessages(restored.current);
      expect(restoredMessages).toHaveLength(1);
      expect(restoredMessages[0].content).toBe('Hello');
      expect(history.estimateTokens()).toBeGreaterThan(0);
      expect(history.getRecentMessages(1)).toHaveLength(1);
      expect(history.hasSystemMessage()).toBe(false);
      expect(history.getFirstSystemMessage()).toBeUndefined();
      expect(history.getSystemMessages()).toHaveLength(0);
      expect(history.searchMessages((m) => m.role === 'user')).toHaveLength(1);
      const convMessages = getOrderedMessages(conv);
      expect(history.getMessageById(convMessages[0].id)).toBeDefined();
      expect(history.get(convMessages[0].id)).toBeDefined();
      expect(history.getMessageIds()).toEqual(conv.ids);
      expect(history.ids).toEqual(conv.ids);
    });

    it('should support mutation methods', () => {
      const history = new ConversationHistory(createConversation());

      history.appendMessages({ role: 'user', content: 'First' });
      expect(history.current.ids.length).toBe(1);

      history.appendUserMessage('User msg');
      expect(history.current.ids.length).toBe(2);
      expect(history.canUndo).toBe(true);

      history.appendAssistantMessage('Assistant msg');
      expect(history.current.ids.length).toBe(3);

      history.appendSystemMessage('System msg');
      expect(history.current.ids.length).toBe(4);

      history.prependSystemMessage('First system');
      expect(getOrderedMessages(history.current)[0].content).toBe('First system');

      history.replaceSystemMessage('New system');
      expect(history.getFirstSystemMessage()?.content).toBe('New system');

      history.collapseSystemMessages();
      expect(history.getSystemMessages()).toHaveLength(1);

      history.redactMessageAtPosition(1, '[REDACTED]');
      expect(history.getMessageAtPosition(1)?.content).toBe('[REDACTED]');

      history.truncateFromPosition(1);
      expect(history.current.ids.length).toBe(4); // system + messages from pos 1

      history.truncateToTokenLimit(10);
      expect(history.current.ids.length).toBeLessThan(4);
    });

    it('should support streaming mutation methods', () => {
      const history = new ConversationHistory(createConversation());

      const messageId = history.appendStreamingMessage('assistant');
      expect(history.getStreamingMessage()?.id).toBe(messageId);

      history.updateStreamingMessage(messageId, 'Partial...');
      expect(getOrderedMessages(history.current)[0].content).toBe('Partial...');

      history.finalizeStreamingMessage(messageId, {
        tokenUsage: { prompt: 1, completion: 1, total: 2 },
      });
      expect(history.getStreamingMessage()).toBeUndefined();
      expect(getOrderedMessages(history.current)[0].tokenUsage?.total).toBe(2);

      const nextId = history.appendStreamingMessage('user');
      history.cancelStreamingMessage(nextId);
      expect(history.current.ids.length).toBe(1);
    });

    it('should support serialization and deserialization of the full history tree', () => {
      const history = new ConversationHistory(createConversation({ title: 'Root' }));
      history.appendUserMessage('V1');
      history.undo();
      history.appendUserMessage('V2');
      history.appendAssistantMessage('V2-A');

      const json = history.snapshot();
      const restored = ConversationHistory.from(json);

      expect(restored.current.title).toBe('Root');
      const restoredMessages = getOrderedMessages(restored.current);
      expect(restoredMessages).toHaveLength(2);
      expect(restoredMessages[0].content).toBe('V2');
      expect(restoredMessages[1].content).toBe('V2-A');

      restored.undo();
      restored.undo();
      expect(restored.current.ids).toHaveLength(0);

      // Check the other branch
      restored.redo(0);
      const branchMessages = getOrderedMessages(restored.current);
      expect(branchMessages).toHaveLength(1);
      expect(branchMessages[0].content).toBe('V1');
    });

    it('should support EventTarget and dispatch events on mutations', () => {
      const history = new ConversationHistory(createConversation());
      let changeCount = 0;
      let lastType = '';

      const unsubscribe = history.addEventListener('change', (e: any) => {
        changeCount++;
        lastType = e.detail.type;
      }) as () => void;

      history.appendUserMessage('test');
      expect(changeCount).toBe(1);
      expect(lastType).toBe('push');

      history.undo();
      expect(changeCount).toBe(2);
      expect(lastType).toBe('undo');

      history.redo();
      expect(changeCount).toBe(3);
      expect(lastType).toBe('redo');

      history.undo();
      history.appendUserMessage('branch');
      history.switchToBranch(0);
      expect(changeCount).toBe(6); // push, undo, redo, undo, push, switch
      expect(lastType).toBe('switch');

      unsubscribe();
      history.appendUserMessage('after unsubscribe');
      expect(changeCount).toBe(6); // no increase
    });

    it('should support AbortSignal in addEventListener', () => {
      const history = new ConversationHistory(createConversation());
      let count = 0;
      const controller = new AbortController();

      history.addEventListener('change', () => count++, { signal: controller.signal });

      history.appendUserMessage('msg');
      expect(count).toBe(1);

      controller.abort();
      history.appendUserMessage('msg 2');
      expect(count).toBe(1);
    });

    it('should support cleanup via Symbol.dispose', () => {
      const history = new ConversationHistory(createConversation());
      history.appendUserMessage('msg');

      // Explicit cleanup
      history[Symbol.dispose]();

      // Node references should be cleared (verified via no crash on repeated dispose)
      expect(() => history[Symbol.dispose]()).not.toThrow();
    });

    it('should support Svelte store subscribe contract', () => {
      const history = new ConversationHistory(createConversation({ id: 'test' }));
      let current: Conversation | undefined;
      const unsubscribe = history.subscribe((v) => {
        current = v;
      });

      expect(current?.id).toBe('test');

      history.appendUserMessage('new message');
      expect(current?.ids.length).toBe(1);

      unsubscribe();
      history.appendUserMessage('another one');
      expect(current?.ids.length).toBe(1);
    });

    it('should support getSnapshot for React useSyncExternalStore', () => {
      const conversation = createConversation();
      const history = new ConversationHistory(conversation);
      expect(history.getSnapshot()).toBe(conversation);
    });

    it('should expose the environment via env getter', () => {
      const customEnv = { randomId: () => 'custom-id' };
      const history = new ConversationHistory(createConversation(), customEnv);
      expect(history.env.randomId()).toBe('custom-id');
    });

    it('should handle null callback in addEventListener', () => {
      const history = new ConversationHistory();
      const result = history.addEventListener('change', null);
      expect(result).toBeUndefined();
    });
  });
});
