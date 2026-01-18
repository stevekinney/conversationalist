import { describe, expect, it } from 'bun:test';

import {
  appendToolResult,
  appendToolUse,
  createConversation,
  getPendingToolCalls,
  getToolInteractions,
} from '../src/conversation/index';
import type { Conversation, Message } from '../src/types';

const getOrderedMessages = (conversation: Conversation): Message[] =>
  conversation.ids
    .map((id) => conversation.messages[id])
    .filter((message): message is Message => Boolean(message));

describe('tool interaction helpers', () => {
  it('appends tool-use and tool-result messages', () => {
    let conv = createConversation({ id: 'test' });
    conv = appendToolUse(conv, {
      id: 'call-1',
      name: 'tool',
      arguments: { input: 'value' },
    });
    conv = appendToolResult(conv, {
      callId: 'call-1',
      outcome: 'success',
      content: { ok: true },
    });

    const messages = getOrderedMessages(conv);
    expect(messages[0]?.role).toBe('tool-use');
    expect(messages[1]?.role).toBe('tool-result');
  });

  it('returns pending tool calls without results', () => {
    let conv = createConversation({ id: 'test' });
    conv = appendToolUse(conv, {
      id: 'call-1',
      name: 'tool',
      arguments: { input: 'value' },
    });

    const pending = getPendingToolCalls(conv);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('call-1');
  });

  it('pairs tool calls with results', () => {
    let conv = createConversation({ id: 'test' });
    conv = appendToolUse(conv, {
      id: 'call-1',
      name: 'tool',
      arguments: { input: 'value' },
    });
    conv = appendToolResult(conv, {
      callId: 'call-1',
      outcome: 'success',
      content: { ok: true },
    });

    const interactions = getToolInteractions(conv);
    expect(interactions).toHaveLength(1);
    expect(interactions[0]?.call.id).toBe('call-1');
    expect(interactions[0]?.result?.outcome).toBe('success');
  });
});
