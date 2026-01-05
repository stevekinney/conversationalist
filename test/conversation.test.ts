import { describe, expect, test } from 'bun:test';

import {
  appendAssistantMessage,
  appendMessages,
  appendSystemMessage,
  appendUserMessage,
  collapseSystemMessages,
  computeConversationStatistics,
  createConversation,
  deserializeConversation,
  getConversationMessages,
  getFirstSystemMessage,
  getMessageAtPosition,
  getMessageByIdentifier,
  getSystemMessages,
  hasSystemMessage,
  migrateConversationJSON,
  prependSystemMessage,
  redactMessageAtPosition,
  replaceSystemMessage,
  searchConversationMessages,
  serializeConversation,
  toChatMessages,
} from '../src/conversation';
import { ConversationalistError } from '../src/errors';
import { CURRENT_SCHEMA_VERSION } from '../src/types';

describe('conversation (functional)', () => {
  test('create, append, statistics and encode', () => {
    let c = createConversation({ title: 'Demo' });
    c = appendUserMessage(c, 'hello');
    c = appendAssistantMessage(c, [
      { type: 'text', text: 'ok' },
      { type: 'image', url: 'https://example.com/i.png' },
    ]);

    const stats = computeConversationStatistics(c);
    expect(stats.total).toBe(2);
    expect(stats.byRole['user']).toBe(1);
    expect(stats.withImages).toBe(1);

    const external = toChatMessages(c);
    expect(external.length).toBe(2);
    expect(external[0]!.role).toBe('user');
  });

  test('redact message by position', () => {
    let c = createConversation();
    c = appendUserMessage(c, 'secret');
    c = redactMessageAtPosition(c, 0, '[REDACTED]');
    expect(c.messages[0]!.content).toBe('[REDACTED]');
  });

  test('getConversationMessages includeHidden and lookup helpers', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'system', content: 's', metadata: { v: 1 } },
      { role: 'user', content: 'u', hidden: true },
    );
    const visible = getConversationMessages(c);
    expect(visible.length).toBe(1);
    const all = getConversationMessages(c, { includeHidden: true });
    expect(all.length).toBe(2);
    expect(getMessageAtPosition(c, 1)?.role).toBe('user');
    const id = all[0]!.id;
    expect(getMessageByIdentifier(c, id)?.id).toBe(id);
    expect(searchConversationMessages(c, (m) => m.role === 'system').length).toBe(1);
  });

  test('toChatMessages role mapping and filtering', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' },
      { role: 'system', content: 's' },
      { role: 'developer', content: 'd' },
      {
        role: 'tool-use',
        content: 'fc',
        toolCall: { id: 'c1', name: 't', arguments: {} },
      },
      {
        role: 'tool-result',
        content: 'tr',
        toolResult: { callId: 'c1', outcome: 'success', content: {} },
      },
      { role: 'snapshot', content: 'snap' },
      { role: 'user', content: 'hidden', hidden: true },
    );
    const ext = toChatMessages(c);
    // hidden filtered -> 7 messages
    expect(ext.length).toBe(7);
    // spot check some roles
    expect(ext[0]!.role).toBe('user');
    expect(ext[1]!.role).toBe('assistant');
    expect(ext[2]!.role).toBe('system');
  });

  test('redact out of range throws', () => {
    const c = createConversation();
    expect(() => redactMessageAtPosition(c, 0)).toThrow(ConversationalistError);
  });

  test('deserialize validation: position contiguity and tool references', () => {
    const now = new Date().toISOString();
    // Position mismatch
    const badPos = {
      id: 'c',
      status: 'active' as const,
      metadata: {},
      tags: [],
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'x',
          position: 2,
          createdAt: now,
          metadata: {},
          hidden: false,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    expect(() => deserializeConversation(badPos as any)).toThrow(ConversationalistError);

    // Missing tool reference
    const badTool = {
      id: 'c2',
      status: 'active' as const,
      metadata: {},
      tags: [],
      messages: [
        {
          id: 't',
          role: 'tool-result',
          content: 'x',
          position: 0,
          createdAt: now,
          metadata: {},
          hidden: false,
          toolResult: { callId: 'nope', outcome: 'error', content: {} },
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    expect(() => deserializeConversation(badTool as any)).toThrow(ConversationalistError);
  });

  test('serialize/deserialize round trip with metadata and tags', () => {
    let c = createConversation({
      title: 'T',
      status: 'active',
      metadata: { source: 'x' },
      tags: ['a', 'b'],
    });
    c = appendUserMessage(c, 'hi', { foo: 1 });
    const json = serializeConversation(c);
    const restored = deserializeConversation(json);
    expect(restored.title).toBe('T');
    expect(restored.tags.length).toBe(2);
    expect(restored.messages[0]!.metadata.foo).toBe(1);
  });
  test('tool linkage is validated across batch', () => {
    let c = createConversation();
    expect(() =>
      appendMessages(c, {
        role: 'tool-result',
        content: 'x',
        toolResult: { callId: 'missing', outcome: 'error', content: {} },
      }),
    ).toThrow(ConversationalistError);

    // Valid when tool-use precedes in batch
    c = appendMessages(
      c,
      {
        role: 'tool-use',
        content: 'call',
        toolCall: { id: 'call-1', name: 't', arguments: {} },
      },
      {
        role: 'tool-result',
        content: 'ok',
        toolResult: { callId: 'call-1', outcome: 'success', content: {} },
      },
    );
    expect(c.messages.length).toBe(2);
  });

  test('append tool referencing prior tool-use in existing conversation', () => {
    let c = createConversation();
    c = appendMessages(c, {
      role: 'tool-use',
      content: 'call',
      toolCall: { id: 'prev-call', name: 't', arguments: {} },
    });
    // Second append references tool-use from previous state
    c = appendMessages(c, {
      role: 'tool-result',
      content: 'ok',
      toolResult: { callId: 'prev-call', outcome: 'success', content: {} },
    });
    expect(c.messages.length).toBe(2);
    expect(c.messages[1]!.role).toBe('tool-result');
  });

  test('deserialize with tool-use and tool-result preserves linkage', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      {
        role: 'tool-use',
        content: 'call',
        toolCall: { id: 'dc1', name: 't', arguments: {} },
      },
      {
        role: 'tool-result',
        content: 'ok',
        toolResult: { callId: 'dc1', outcome: 'success', content: {} },
      },
    );
    const json = serializeConversation(c);
    const restored = deserializeConversation(json);
    expect(restored.messages.length).toBe(2);
    expect(restored.messages[0]!.toolCall?.id).toBe('dc1');
    expect(restored.messages[1]!.toolResult?.callId).toBe('dc1');
  });

  test('appendMessages respects injected environment for ids and timestamps', () => {
    const env = {
      now: () => '2000-01-01T00:00:00.000Z',
      randomId: () => 'custom-id',
    };
    const base = createConversation();
    const next = appendMessages(base, { role: 'user', content: 'hello' }, env);
    expect(next.messages[0]!.id).toBe('custom-id');
    expect(next.messages[0]!.createdAt).toBe('2000-01-01T00:00:00.000Z');
    expect(next.updatedAt).toBe('2000-01-01T00:00:00.000Z');
  });

  test('appendMessages can be invoked without inputs', () => {
    const base = createConversation();
    const next = appendMessages(base);
    expect(next.messages.length).toBe(0);
    expect(next).not.toBe(base);
  });

  test('appendMessages accepts only an environment argument', () => {
    const base = createConversation();
    const env = { now: () => '2024-05-05T05:05:05.000Z' };
    const next = appendMessages(base, env);
    expect(next.messages.length).toBe(0);
    expect(next.updatedAt).toBe('2024-05-05T05:05:05.000Z');
  });
});

describe('system message management', () => {
  test('hasSystemMessage returns true when system message exists', () => {
    let c = createConversation();
    expect(hasSystemMessage(c)).toBeFalse();

    c = appendSystemMessage(c, 'system prompt');
    expect(hasSystemMessage(c)).toBeTrue();
  });

  test('hasSystemMessage includes hidden system messages', () => {
    let c = createConversation();
    c = appendMessages(c, { role: 'system', content: 'hidden', hidden: true });
    expect(hasSystemMessage(c)).toBeTrue();
  });

  test('getFirstSystemMessage returns first system message', () => {
    let c = createConversation();
    expect(getFirstSystemMessage(c)).toBeUndefined();

    c = appendMessages(
      c,
      { role: 'user', content: 'u' },
      { role: 'system', content: 's1' },
      { role: 'system', content: 's2' },
    );

    const first = getFirstSystemMessage(c);
    expect(first).toBeDefined();
    expect(first!.content).toBe('s1');
    expect(first!.position).toBe(1);
  });

  test('getFirstSystemMessage includes hidden messages', () => {
    let c = createConversation();
    c = appendMessages(c, { role: 'system', content: 'hidden', hidden: true });

    const first = getFirstSystemMessage(c);
    expect(first).toBeDefined();
    expect(first!.hidden).toBeTrue();
  });

  test('getSystemMessages returns all system messages', () => {
    let c = createConversation();
    expect(getSystemMessages(c).length).toBe(0);

    c = appendMessages(
      c,
      { role: 'user', content: 'u' },
      { role: 'system', content: 's1' },
      { role: 'assistant', content: 'a' },
      { role: 'system', content: 's2' },
      { role: 'system', content: 's3', hidden: true },
    );

    const systemMsgs = getSystemMessages(c);
    expect(systemMsgs.length).toBe(3);
    expect(systemMsgs[0]!.content).toBe('s1');
    expect(systemMsgs[1]!.content).toBe('s2');
    expect(systemMsgs[2]!.content).toBe('s3');
    expect(systemMsgs[2]!.hidden).toBeTrue();
  });

  test('prependSystemMessage adds message at position 0', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' },
    );

    c = prependSystemMessage(c, 'system prompt', { key: 'value' });

    expect(c.messages.length).toBe(3);
    expect(c.messages[0]!.role).toBe('system');
    expect(c.messages[0]!.content).toBe('system prompt');
    expect(c.messages[0]!.position).toBe(0);
    expect(c.messages[0]!.metadata.key).toBe('value');

    // Check positions were renumbered
    expect(c.messages[1]!.role).toBe('user');
    expect(c.messages[1]!.position).toBe(1);
    expect(c.messages[2]!.role).toBe('assistant');
    expect(c.messages[2]!.position).toBe(2);
  });

  test('prependSystemMessage to empty conversation', () => {
    let c = createConversation();
    c = prependSystemMessage(c, 'first');

    expect(c.messages.length).toBe(1);
    expect(c.messages[0]!.content).toBe('first');
    expect(c.messages[0]!.position).toBe(0);
  });

  test('prependSystemMessage preserves immutability', () => {
    const c1 = createConversation();
    const c2 = appendUserMessage(c1, 'u');
    const c3 = prependSystemMessage(c2, 's');

    expect(c2.messages.length).toBe(1);
    expect(c3.messages.length).toBe(2);
    expect(c2.messages[0]!.position).toBe(0);
    expect(c3.messages[0]!.role).toBe('system');
  });

  test('replaceSystemMessage replaces first system message', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'system', content: 'old', metadata: { v: 1 } },
      { role: 'user', content: 'u' },
      { role: 'system', content: 'another' },
    );

    const originalId = c.messages[0]!.id;
    c = replaceSystemMessage(c, 'new system prompt', { v: 2 });

    expect(c.messages.length).toBe(3);
    expect(c.messages[0]!.id).toBe(originalId);
    expect(c.messages[0]!.content).toBe('new system prompt');
    expect(c.messages[0]!.metadata.v).toBe(2);
    expect(c.messages[2]!.content).toBe('another'); // Second system message unchanged
  });

  test('replaceSystemMessage preserves original metadata when not provided', () => {
    let c = createConversation();
    c = appendSystemMessage(c, 'old', { foo: 'bar', num: 42 });

    c = replaceSystemMessage(c, 'new');

    expect(c.messages[0]!.content).toBe('new');
    expect(c.messages[0]!.metadata.foo).toBe('bar');
    expect(c.messages[0]!.metadata.num).toBe(42);
  });

  test('replaceSystemMessage prepends when no system message exists', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' },
    );

    c = replaceSystemMessage(c, 'new system', { k: 'v' });

    expect(c.messages.length).toBe(3);
    expect(c.messages[0]!.role).toBe('system');
    expect(c.messages[0]!.content).toBe('new system');
    expect(c.messages[0]!.position).toBe(0);
    expect(c.messages[1]!.position).toBe(1);
    expect(c.messages[2]!.position).toBe(2);
  });

  test('collapseSystemMessages with no system messages returns same conversation', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' },
    );

    const collapsed = collapseSystemMessages(c);
    expect(collapsed).toBe(c); // Should be same reference if no changes
  });

  test('collapseSystemMessages with one system message returns same conversation', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    );

    const collapsed = collapseSystemMessages(c);
    expect(collapsed).toBe(c);
  });

  test('collapseSystemMessages combines multiple system messages', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'system', content: 'first' },
      { role: 'user', content: 'u1' },
      { role: 'system', content: 'second' },
      { role: 'assistant', content: 'a' },
      { role: 'system', content: 'third' },
    );

    c = collapseSystemMessages(c);

    expect(c.messages.length).toBe(3); // 1 system + user + assistant
    expect(c.messages[0]!.role).toBe('system');
    expect(c.messages[0]!.content).toBe('first\nsecond\nthird');
    expect(c.messages[1]!.role).toBe('user');
    expect(c.messages[2]!.role).toBe('assistant');

    // Check positions are renumbered
    expect(c.messages[0]!.position).toBe(0);
    expect(c.messages[1]!.position).toBe(1);
    expect(c.messages[2]!.position).toBe(2);
  });

  test('collapseSystemMessages deduplicates exact content', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'system', content: 'same' },
      { role: 'system', content: 'different' },
      { role: 'system', content: 'same' },
      { role: 'system', content: 'another' },
    );

    c = collapseSystemMessages(c);

    expect(c.messages.length).toBe(1);
    expect(c.messages[0]!.content).toBe('same\ndifferent\nanother');
  });

  test('collapseSystemMessages includes hidden messages', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'system', content: 'visible' },
      { role: 'system', content: 'hidden', hidden: true },
      { role: 'user', content: 'u' },
    );

    c = collapseSystemMessages(c);

    expect(c.messages.length).toBe(2);
    expect(c.messages[0]!.content).toBe('visible\nhidden');
  });

  test('collapseSystemMessages flattens multi-modal content to text', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      {
        role: 'system',
        content: [
          { type: 'text', text: 'Rules:' },
          { type: 'image', url: 'https://example.com/image.png', text: 'diagram' },
        ],
      },
      { role: 'system', content: 'Second' },
    );

    c = collapseSystemMessages(c);

    expect(c.messages[0]!.content).toBe('Rules:\nSecond');
  });

  test('collapseSystemMessages preserves first system message properties', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'system', content: 'first', metadata: { key: 'value' }, hidden: true },
      { role: 'system', content: 'second' },
      { role: 'user', content: 'u' },
    );

    const originalId = c.messages[0]!.id;
    const originalCreatedAt = c.messages[0]!.createdAt;

    c = collapseSystemMessages(c);

    expect(c.messages[0]!.id).toBe(originalId);
    expect(c.messages[0]!.createdAt).toBe(originalCreatedAt);
    expect(c.messages[0]!.metadata.key).toBe('value');
    expect(c.messages[0]!.hidden).toBeTrue();
  });

  test('collapseSystemMessages handles empty content correctly', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      { role: 'system', content: 'first' },
      { role: 'system', content: '' },
      { role: 'system', content: 'second' },
    );

    c = collapseSystemMessages(c);

    // Empty content should be filtered out
    expect(c.messages[0]!.content).toBe('first\nsecond');
  });

  test('mutation operations return new conversation instances', () => {
    const c1 = createConversation();
    const c2 = prependSystemMessage(c1, 'test');
    const c3 = replaceSystemMessage(c2, 'replaced');
    const c4 = appendSystemMessage(c3, 'another');
    const c5 = collapseSystemMessages(c4);

    // Verify immutability - each operation returns a new instance
    expect(c2).not.toBe(c1);
    expect(c3).not.toBe(c2);
    expect(c4).not.toBe(c3);
    expect(c5).not.toBe(c4);

    // Verify updatedAt is set and valid
    expect(c2.updatedAt).toBeDefined();
    expect(c3.updatedAt).toBeDefined();
    expect(c5.updatedAt).toBeDefined();
    expect(new Date(c2.updatedAt).toISOString()).toBe(c2.updatedAt);
  });
});

describe('migrateConversationJSON', () => {
  test('handles null input', () => {
    const result = migrateConversationJSON(null);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.id).toBe('');
    expect(result.status).toBe('active');
    expect(result.messages).toEqual([]);
  });

  test('handles array input', () => {
    const result = migrateConversationJSON([]);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.id).toBe('');
  });

  test('handles primitive input', () => {
    const result = migrateConversationJSON('string');
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.id).toBe('');
  });

  test('adds schemaVersion to legacy data', () => {
    const legacy = {
      id: 'conv-1',
      status: 'active',
      metadata: {},
      tags: [],
      messages: [],
      createdAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:00:00.000Z',
    };

    const result = migrateConversationJSON(legacy);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.id).toBe('conv-1');
  });

  test('preserves existing schemaVersion', () => {
    const data = {
      schemaVersion: 99,
      id: 'conv-1',
      status: 'active',
      metadata: {},
      tags: [],
      messages: [],
      createdAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:00:00.000Z',
    };

    const result = migrateConversationJSON(data);
    expect(result.schemaVersion).toBe(99);
  });
});

describe('serializeConversation options', () => {
  test('stripTransient removes transient metadata from conversation', () => {
    let c = createConversation();
    c = {
      ...c,
      metadata: { _temp: 1, permanent: 'value' },
    };

    const result = serializeConversation(c, { stripTransient: true });
    expect(result.metadata).toEqual({ permanent: 'value' });
    expect(result.metadata).not.toHaveProperty('_temp');
  });

  test('stripTransient removes transient metadata from messages', () => {
    let c = createConversation();
    c = appendUserMessage(c, 'hello');
    c = {
      ...c,
      messages: c.messages.map((m) => ({
        ...m,
        metadata: { ...m.metadata, _deliveryStatus: 'sent', source: 'web' },
      })),
    };

    const result = serializeConversation(c, { stripTransient: true });
    expect(result.messages[0].metadata).toEqual({ source: 'web' });
    expect(result.messages[0].metadata).not.toHaveProperty('_deliveryStatus');
  });

  test('deterministic sorts messages by position', () => {
    let c = createConversation();
    c = appendUserMessage(c, 'first');
    c = appendAssistantMessage(c, 'second');
    c = appendUserMessage(c, 'third');

    const result = serializeConversation(c, { deterministic: true });
    expect(result.messages[0].position).toBe(0);
    expect(result.messages[1].position).toBe(1);
    expect(result.messages[2].position).toBe(2);
  });

  test('deterministic sorts object keys', () => {
    let c = createConversation();
    c = {
      ...c,
      metadata: { z: 1, a: 2, m: 3 },
    };

    const result = serializeConversation(c, { deterministic: true });
    const keys = Object.keys(result.metadata);
    expect(keys).toEqual(['a', 'm', 'z']);
  });

  test('redactToolArguments replaces tool arguments with [REDACTED]', () => {
    let c = createConversation();
    c = appendMessages(c, {
      role: 'tool-use',
      content: 'Calling search',
      toolCall: { id: 'call-1', name: 'search', arguments: 'sensitive data' },
    });

    const result = serializeConversation(c, { redactToolArguments: true });
    expect(result.messages[0].toolCall?.arguments).toBe('[REDACTED]');
  });

  test('redactToolResults replaces tool result content with [REDACTED]', () => {
    let c = createConversation();
    c = appendMessages(
      c,
      {
        role: 'tool-use',
        content: 'Calling search',
        toolCall: { id: 'call-1', name: 'search', arguments: '{}' },
      },
      {
        role: 'tool-result',
        content: 'Result returned',
        toolResult: { callId: 'call-1', content: 'sensitive result data' },
      },
    );

    const result = serializeConversation(c, { redactToolResults: true });
    expect(result.messages[1].toolResult?.content).toBe('[REDACTED]');
  });

  test('all options can be combined', () => {
    let c = createConversation();
    c = {
      ...c,
      metadata: { _temp: 1, z: 2, a: 3 },
    };
    c = appendMessages(
      c,
      {
        role: 'tool-use',
        content: 'Calling func',
        metadata: { _tempMeta: 'x' },
        toolCall: { id: 'call-1', name: 'func', arguments: 'args' },
      },
      {
        role: 'tool-result',
        content: 'Result',
        toolResult: { callId: 'call-1', content: 'result' },
      },
    );

    const result = serializeConversation(c, {
      deterministic: true,
      stripTransient: true,
      redactToolArguments: true,
      redactToolResults: true,
    });

    // Check transient stripped
    expect(result.metadata).not.toHaveProperty('_temp');
    expect(result.messages[0].metadata).not.toHaveProperty('_tempMeta');

    // Check deterministic key sorting
    expect(Object.keys(result.metadata)).toEqual(['a', 'z']);

    // Check redaction
    expect(result.messages[0].toolCall?.arguments).toBe('[REDACTED]');
    expect(result.messages[1].toolResult?.content).toBe('[REDACTED]');
  });
});
