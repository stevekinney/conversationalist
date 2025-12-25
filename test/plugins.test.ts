import { describe, expect, it } from 'bun:test';

import {
  appendMessages,
  ConversationHistory,
  createConversation,
  createPIIRedactionPlugin,
  piiRedactionPlugin,
} from '../src';

describe('piiRedactionPlugin', () => {
  it('should redact emails', () => {
    const env = { plugins: [piiRedactionPlugin] };
    let conv = createConversation({}, env);
    conv = appendMessages(
      conv,
      { role: 'user', content: 'My email is test@example.com' },
      env,
    );

    expect(conv.messages[0].content).toBe('My email is [EMAIL_REDACTED]');
  });

  it('should redact phone numbers', () => {
    const env = { plugins: [piiRedactionPlugin] };
    let conv = createConversation({}, env);
    conv = appendMessages(
      conv,
      { role: 'user', content: 'Call me at 123-456-7890' },
      env,
    );

    expect(conv.messages[0].content).toBe('Call me at [PHONE_REDACTED]');
  });

  it('should redact API keys', () => {
    const env = { plugins: [piiRedactionPlugin] };
    let conv = createConversation({}, env);
    conv = appendMessages(
      conv,
      {
        role: 'user',
        content: 'My key is api_key: "sk-1234567890abcdef1234567890abcdef"',
      },
      env,
    );

    expect(conv.messages[0].content).toBe('My key is api_key: "[KEY_REDACTED]"');
  });

  it('should redact multi-modal content', () => {
    const env = { plugins: [piiRedactionPlugin] };
    let conv = createConversation({}, env);
    conv = appendMessages(
      conv,
      {
        role: 'user',
        content: [
          { type: 'text', text: 'My email is test@example.com' },
          { type: 'image', url: 'https://example.com/image.png' },
        ],
      },
      env,
    );

    expect(conv.messages[0].content).toEqual([
      { type: 'text', text: 'My email is [EMAIL_REDACTED]' },
      { type: 'image', url: 'https://example.com/image.png' },
    ]);
  });

  it('should not redact by default', () => {
    let conv = createConversation({});
    conv = appendMessages(conv, {
      role: 'user',
      content: 'My email is test@example.com',
    });

    expect(conv.messages[0].content).toBe('My email is test@example.com');
  });

  it('should work when bound to ConversationHistory', () => {
    const env = { plugins: [piiRedactionPlugin] };
    const history = new ConversationHistory(createConversation(), env);
    const boundAppend = history.bind(appendMessages);

    boundAppend({ role: 'user', content: 'My email is test@example.com' });

    expect(history.current.messages[0].content).toBe('My email is [EMAIL_REDACTED]');
  });

  it('should support custom redaction rules', () => {
    const customPlugin = createPIIRedactionPlugin({
      rules: {
        ssn: {
          regex: /\d{3}-\d{2}-\d{4}/g,
          replace: '[SSN_REDACTED]',
        },
      },
    });

    const env = { plugins: [customPlugin] };
    let conv = createConversation({}, env);
    conv = appendMessages(conv, { role: 'user', content: 'SSN: 123-45-6789' }, env);

    expect(conv.messages[0].content).toBe('SSN: [SSN_REDACTED]');
  });

  it('should support excluding default rules', () => {
    const customPlugin = createPIIRedactionPlugin({
      excludeRules: ['email'],
    });

    const env = { plugins: [customPlugin] };
    let conv = createConversation({}, env);
    conv = appendMessages(
      conv,
      { role: 'user', content: 'Email: test@example.com, Phone: 123-456-7890' },
      env,
    );

    expect(conv.messages[0].content).toBe(
      'Email: test@example.com, Phone: [PHONE_REDACTED]',
    );
  });

  it('should validate tool references after plugins are applied', () => {
    const maliciousPlugin = (input: MessageInput): MessageInput => {
      if (input.role === 'tool-result' && input.toolResult) {
        return {
          ...input,
          toolResult: { ...input.toolResult, callId: 'invalid-id' },
        };
      }
      return input;
    };

    const env = { plugins: [maliciousPlugin] };
    const conv = createConversation({ id: 'test' }, env);

    const action = () =>
      appendMessages(
        conv,
        {
          role: 'tool-use',
          content: '',
          toolCall: { id: 'valid-id', name: 'test', arguments: {} },
        },
        {
          role: 'tool-result',
          content: '',
          toolResult: { callId: 'valid-id', outcome: 'success', content: {} },
        },
        env,
      );

    // This should fail because the plugin changes the callId to 'invalid-id'
    // If it doesn't fail, it means validation happened before the plugin.
    expect(action).toThrow(/tool result references non-existent tool-use: invalid-id/);
  });
});
