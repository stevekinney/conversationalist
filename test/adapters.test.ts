import { describe, expect, it } from 'bun:test';

import { toAnthropicMessages } from '../src/adapters/anthropic';
import { toGeminiMessages } from '../src/adapters/gemini';
import { toOpenAIMessages, toOpenAIMessagesGrouped } from '../src/adapters/openai';
import { appendMessages, createConversation } from '../src/conversation';
import type { Conversation } from '../src/types';

const testEnvironment = {
  now: () => '2024-01-01T00:00:00.000Z',
  randomId: (() => {
    let counter = 0;
    return () => `test-id-${++counter}`;
  })(),
};

function createBasicConversation(): Conversation {
  let conv = createConversation({ id: 'test' }, testEnvironment);
  conv = appendMessages(
    conv,
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there! How can I help you?' },
    testEnvironment,
  );
  return conv;
}

function createToolCallConversation(): Conversation {
  let conv = createConversation({ id: 'test' }, testEnvironment);
  conv = appendMessages(
    conv,
    { role: 'user', content: 'What is the weather?' },
    {
      role: 'tool-use',
      content: '',
      toolCall: {
        id: 'call-123',
        name: 'get_weather',
        arguments: JSON.stringify({ location: 'NYC' }),
      },
    },
    {
      role: 'tool-result',
      content: '',
      toolResult: {
        callId: 'call-123',
        outcome: 'success',
        content: { temperature: 72, conditions: 'sunny' },
      },
    },
    { role: 'assistant', content: 'The weather in NYC is 72°F and sunny.' },
    testEnvironment,
  );
  return conv;
}

function createMultiModalConversation(): Conversation {
  let conv = createConversation({ id: 'test' }, testEnvironment);
  conv = appendMessages(
    conv,
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image', url: 'https://example.com/image.jpg' },
      ],
    },
    { role: 'assistant', content: 'I see a cat.' },
    testEnvironment,
  );
  return conv;
}

describe('OpenAI Adapter', () => {
  describe('toOpenAIMessages', () => {
    it('converts basic conversation', () => {
      const conv = createBasicConversation();
      const messages = toOpenAIMessages(conv);

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant.',
      });
      expect(messages[1]).toEqual({ role: 'user', content: 'Hello' });
      expect(messages[2]).toEqual({
        role: 'assistant',
        content: 'Hi there! How can I help you?',
      });
    });

    it('converts tool calls to OpenAI format', () => {
      const conv = createToolCallConversation();
      const messages = toOpenAIMessages(conv);

      // Should have: user, assistant (with tool_calls), tool, assistant
      expect(messages).toHaveLength(4);

      // Tool call message
      const toolCallMsg = messages[1];
      expect(toolCallMsg?.role).toBe('assistant');
      expect(toolCallMsg?.content).toBeNull();
      expect(toolCallMsg?.tool_calls).toHaveLength(1);
      expect(toolCallMsg?.tool_calls?.[0]?.id).toBe('call-123');
      expect(toolCallMsg?.tool_calls?.[0]?.function.name).toBe('get_weather');

      // Tool result message
      const toolResultMsg = messages[2];
      expect(toolResultMsg?.role).toBe('tool');
      expect(toolResultMsg?.tool_call_id).toBe('call-123');
    });

    it('converts multi-modal content', () => {
      const conv = createMultiModalConversation();
      const messages = toOpenAIMessages(conv);

      expect(messages).toHaveLength(2);
      const userMsg = messages[0];
      expect(Array.isArray(userMsg?.content)).toBe(true);
      expect((userMsg?.content as any)[0]).toEqual({
        type: 'text',
        text: 'What is in this image?',
      });
      expect((userMsg?.content as any)[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'https://example.com/image.jpg' },
      });
    });

    it('skips hidden messages', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Visible' },
        { role: 'user', content: 'Hidden', hidden: true },
        testEnvironment,
      );

      const messages = toOpenAIMessages(conv);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe('Visible');
    });

    it('maps developer role to system', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'developer', content: 'Developer instructions' },
        testEnvironment,
      );

      const messages = toOpenAIMessages(conv);
      expect(messages[0]?.role).toBe('system');
    });

    it('skips tool-use messages without toolCall', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Hello' },
        { role: 'tool-use', content: '' }, // No toolCall
        testEnvironment,
      );

      const messages = toOpenAIMessages(conv);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe('user');
    });

    it('skips tool-result messages without toolResult', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Hello' },
        { role: 'tool-result', content: '' }, // No toolResult
        testEnvironment,
      );

      const messages = toOpenAIMessages(conv);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe('user');
    });

    it('skips snapshot messages', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Hello' },
        { role: 'snapshot', content: 'snapshot data' },
        testEnvironment,
      );

      const messages = toOpenAIMessages(conv);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe('user');
    });

    it('handles tool results with string content', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Hello' },
        {
          role: 'tool-use',
          content: '',
          toolCall: { id: 'call-1', name: 'tool', arguments: '{}' },
        },
        {
          role: 'tool-result',
          content: '',
          toolResult: {
            callId: 'call-1',
            outcome: 'success',
            content: 'String result', // String content, not object
          },
        },
        testEnvironment,
      );

      const messages = toOpenAIMessages(conv);
      const toolMsg = messages.find((m) => m.role === 'tool');
      expect(toolMsg?.content).toBe('String result');
    });

    it('returns null for unknown roles in convertMessage', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      // @ts-expect-error - testing runtime behavior for invalid role
      conv = appendMessages(conv, { role: 'unknown', content: 'blah' }, testEnvironment);

      const messages = toOpenAIMessages(conv);
      expect(messages).toHaveLength(0);
    });
  });

  describe('toOpenAIMessagesGrouped', () => {
    it('groups consecutive tool calls into single message', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Do two things' },
        {
          role: 'tool-use',
          content: '',
          toolCall: { id: 'call-1', name: 'tool_one', arguments: '{}' },
        },
        {
          role: 'tool-use',
          content: '',
          toolCall: { id: 'call-2', name: 'tool_two', arguments: '{}' },
        },
        testEnvironment,
      );

      const messages = toOpenAIMessagesGrouped(conv);

      // Should be: user, assistant (with 2 tool_calls)
      expect(messages).toHaveLength(2);
      expect(messages[1]?.tool_calls).toHaveLength(2);
    });

    it('flushes pending tool calls before different message type', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Do something' },
        {
          role: 'tool-use',
          content: '',
          toolCall: { id: 'call-1', name: 'tool_one', arguments: '{}' },
        },
        {
          role: 'tool-result',
          content: '',
          toolResult: { callId: 'call-1', outcome: 'success', content: 'done' },
        },
        { role: 'assistant', content: 'Done!' },
        testEnvironment,
      );

      const messages = toOpenAIMessagesGrouped(conv);

      // Should be: user, assistant (with tool_calls), tool, assistant
      expect(messages).toHaveLength(4);
      expect(messages[1]?.role).toBe('assistant');
      expect(messages[1]?.tool_calls).toHaveLength(1);
    });

    it('skips hidden messages in grouped mode', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Visible' },
        {
          role: 'tool-use',
          content: '',
          toolCall: { id: 'call-1', name: 'tool', arguments: '{}' },
          hidden: true,
        },
        testEnvironment,
      );

      const messages = toOpenAIMessagesGrouped(conv);
      expect(messages).toHaveLength(1);
    });
  });
});

describe('Anthropic Adapter', () => {
  describe('toAnthropicMessages', () => {
    it('extracts system message separately', () => {
      const conv = createBasicConversation();
      const { system, messages } = toAnthropicMessages(conv);

      expect(system).toBe('You are a helpful assistant.');
      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe('user');
      expect(messages[1]?.role).toBe('assistant');
    });

    it('converts tool calls to tool_use blocks', () => {
      const conv = createToolCallConversation();
      const { messages } = toAnthropicMessages(conv);

      // Find the assistant message with tool_use
      const assistantMsg = messages.find(
        (m) => m.role === 'assistant' && Array.isArray(m.content),
      );
      expect(assistantMsg).toBeDefined();

      const toolUseBlock = (assistantMsg?.content as any[])?.find(
        (b: any) => b.type === 'tool_use',
      );
      expect(toolUseBlock).toBeDefined();
      expect(toolUseBlock.name).toBe('get_weather');
      expect(toolUseBlock.id).toBe('call-123');
    });

    it('converts tool results to tool_result blocks', () => {
      const conv = createToolCallConversation();
      const { messages } = toAnthropicMessages(conv);

      // Tool results go in user messages for Anthropic
      const userMsgWithResult = messages.find(
        (m) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          (m.content as any[]).some((b: any) => b.type === 'tool_result'),
      );
      expect(userMsgWithResult).toBeDefined();
    });

    it('merges consecutive same-role messages', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Part 1' },
        { role: 'user', content: 'Part 2' },
        testEnvironment,
      );

      const { messages } = toAnthropicMessages(conv);

      // Should be merged into one user message with content blocks
      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe('user');
    });

    it('handles multi-modal content with base64 images', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            { type: 'image', url: 'data:image/png;base64,iVBORw0KGgo=' },
          ],
        },
        testEnvironment,
      );

      const { messages } = toAnthropicMessages(conv);
      const content = messages[0]?.content as any[];

      expect(content).toHaveLength(2);
      expect(content[1].type).toBe('image');
      expect(content[1].source.type).toBe('base64');
    });

    it('handles multi-modal content with URL images', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            { type: 'image', url: 'https://example.com/image.jpg' },
          ],
        },
        testEnvironment,
      );

      const { messages } = toAnthropicMessages(conv);
      const content = messages[0]?.content as any[];

      expect(content).toHaveLength(2);
      expect(content[1].type).toBe('image');
      expect(content[1].source.type).toBe('url');
      expect(content[1].source.url).toBe('https://example.com/image.jpg');
    });

    it('handles tool results with error outcome', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Do something' },
        {
          role: 'tool-use',
          content: '',
          toolCall: { id: 'call-1', name: 'tool', arguments: '{}' },
        },
        {
          role: 'tool-result',
          content: '',
          toolResult: {
            callId: 'call-1',
            outcome: 'error',
            content: 'Something went wrong',
          },
        },
        testEnvironment,
      );

      const { messages } = toAnthropicMessages(conv);
      const userMsg = messages.find(
        (m) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          (m.content as any[]).some((b: any) => b.type === 'tool_result'),
      );
      const toolResult = (userMsg?.content as any[]).find(
        (b: any) => b.type === 'tool_result',
      );
      expect(toolResult.is_error).toBe(true);
    });

    it('handles multi-modal system message content', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        {
          role: 'system',
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: 'Part 2' },
          ],
        },
        { role: 'user', content: 'Hello' },
        testEnvironment,
      );

      const { system, messages } = toAnthropicMessages(conv);
      expect(system).toBe('Part 1\n\nPart 2');
      expect(messages).toHaveLength(1);
    });

    it('handles assistant multi-modal content', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Response part 1' },
            { type: 'text', text: 'Response part 2' },
          ],
        },
        testEnvironment,
      );

      const { messages } = toAnthropicMessages(conv);
      expect(messages).toHaveLength(2);
      const assistantMsg = messages[1];
      expect(Array.isArray(assistantMsg?.content)).toBe(true);
      expect((assistantMsg?.content as any[]).length).toBe(2);
    });

    it('handles tool call with object arguments', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Do something' },
        {
          role: 'tool-use',
          content: '',
          toolCall: { id: 'call-1', name: 'tool', arguments: { key: 'value' } },
        },
        testEnvironment,
      );

      const { messages } = toAnthropicMessages(conv);
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      const toolUse = (assistantMsg?.content as any[]).find(
        (b: any) => b.type === 'tool_use',
      );
      expect(toolUse.input).toEqual({ key: 'value' });
    });

    it('handles data URLs with missing parts', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        {
          role: 'user',
          content: [{ type: 'image', url: 'data:image/png;base64' }], // Invalid data URL
        },
        testEnvironment,
      );

      const { messages } = toAnthropicMessages(conv);
      // If content becomes empty, the message might be skipped or have empty content
      if (messages.length > 0) {
        expect(messages[0].content).toEqual([]);
      } else {
        expect(messages).toHaveLength(0);
      }
    });

    it('skips unknown roles', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      // @ts-expect-error - testing runtime behavior for invalid role
      conv = appendMessages(conv, { role: 'unknown', content: 'blah' }, testEnvironment);

      const { messages } = toAnthropicMessages(conv);
      expect(messages).toHaveLength(0);
    });
  });
});

describe('Gemini Adapter', () => {
  describe('toGeminiMessages', () => {
    it('extracts system instruction separately', () => {
      const conv = createBasicConversation();
      const { systemInstruction, contents } = toGeminiMessages(conv);

      expect(systemInstruction).toBeDefined();
      expect(systemInstruction?.parts[0]).toEqual({
        text: 'You are a helpful assistant.',
      });
      expect(contents).toHaveLength(2);
    });

    it('maps assistant to model role', () => {
      const conv = createBasicConversation();
      const { contents } = toGeminiMessages(conv);

      const assistantMsg = contents.find((c) =>
        c.parts.some((p: any) => p.text === 'Hi there! How can I help you?'),
      );
      expect(assistantMsg?.role).toBe('model');
    });

    it('converts tool calls to functionCall parts', () => {
      const conv = createToolCallConversation();
      const { contents } = toGeminiMessages(conv);

      const modelContent = contents.find(
        (c) => c.role === 'model' && c.parts.some((p: any) => 'functionCall' in p),
      );
      expect(modelContent).toBeDefined();

      const functionCallPart = modelContent?.parts.find(
        (p: any) => 'functionCall' in p,
      ) as any;
      expect(functionCallPart.functionCall.name).toBe('get_weather');
    });

    it('converts tool results to functionResponse parts', () => {
      const conv = createToolCallConversation();
      const { contents } = toGeminiMessages(conv);

      const userContent = contents.find(
        (c) => c.role === 'user' && c.parts.some((p: any) => 'functionResponse' in p),
      );
      expect(userContent).toBeDefined();

      const responsePart = userContent?.parts.find(
        (p: any) => 'functionResponse' in p,
      ) as any;
      expect(responsePart.functionResponse.name).toBe('get_weather');
    });

    it('merges consecutive same-role messages', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Part 1' },
        { role: 'user', content: 'Part 2' },
        testEnvironment,
      );

      const { contents } = toGeminiMessages(conv);

      expect(contents).toHaveLength(1);
      expect(contents[0]?.parts).toHaveLength(2);
    });

    it('handles multi-modal content with inline data', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            { type: 'image', url: 'data:image/png;base64,iVBORw0KGgo=' },
          ],
        },
        testEnvironment,
      );

      const { contents } = toGeminiMessages(conv);
      const parts = contents[0]?.parts as any[];

      expect(parts).toHaveLength(2);
      expect(parts[1].inlineData).toBeDefined();
      expect(parts[1].inlineData.mimeType).toBe('image/png');
    });

    it('handles file URIs for images', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        {
          role: 'user',
          content: [
            {
              type: 'image',
              url: 'https://example.com/image.jpg',
              mimeType: 'image/jpeg',
            },
          ],
        },
        testEnvironment,
      );

      const { contents } = toGeminiMessages(conv);
      const parts = contents[0]?.parts as any[];

      expect(parts[0].fileData).toBeDefined();
      expect(parts[0].fileData.fileUri).toBe('https://example.com/image.jpg');
    });

    it('handles file URIs without mimeType', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        {
          role: 'user',
          content: [{ type: 'image', url: 'https://example.com/image.jpg' }],
        },
        testEnvironment,
      );

      const { contents } = toGeminiMessages(conv);
      const parts = contents[0]?.parts as any[];

      expect(parts[0].fileData).toBeDefined();
      expect(parts[0].fileData.fileUri).toBe('https://example.com/image.jpg');
      expect(parts[0].fileData.mimeType).toBeUndefined();
    });

    it('handles tool call with invalid JSON arguments', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Do something' },
        {
          role: 'tool-use',
          content: '',
          toolCall: { id: 'call-1', name: 'tool', arguments: 'invalid json {' },
        },
        testEnvironment,
      );

      const { contents } = toGeminiMessages(conv);
      const modelContent = contents.find(
        (c) => c.role === 'model' && c.parts.some((p: any) => 'functionCall' in p),
      );
      const functionCallPart = modelContent?.parts.find(
        (p: any) => 'functionCall' in p,
      ) as any;
      expect(functionCallPart.functionCall.args).toEqual({ _raw: 'invalid json {' });
    });

    it('handles tool call with object arguments', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'user', content: 'Do something' },
        {
          role: 'tool-use',
          content: '',
          toolCall: { id: 'call-1', name: 'tool', arguments: { key: 'value' } },
        },
        testEnvironment,
      );

      const { contents } = toGeminiMessages(conv);
      const modelContent = contents.find(
        (c) => c.role === 'model' && c.parts.some((p: any) => 'functionCall' in p),
      );
      const functionCallPart = modelContent?.parts.find(
        (p: any) => 'functionCall' in p,
      ) as any;
      expect(functionCallPart.functionCall.args).toEqual({ key: 'value' });
    });

    it('handles system message with empty content', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        { role: 'system', content: '' },
        { role: 'user', content: 'Hello' },
        testEnvironment,
      );

      const { systemInstruction, contents } = toGeminiMessages(conv);
      // Empty system message results in no systemInstruction
      expect(systemInstruction).toBeUndefined();
      expect(contents).toHaveLength(1);
    });

    it('handles tool results with missing tool call names', () => {
      // Create a conversation with a tool result but no tool-use message
      // We have to bypass appendMessages validation, so we'll mock the conversation structure
      const conv: Conversation = {
        id: 'test',
        status: 'active',
        metadata: {},
        tags: [],
        messages: [
          {
            id: 'm1',
            role: 'tool-result',
            content: '',
            position: 0,
            createdAt: '2024-01-01T00:00:00.000Z',
            metadata: {},
            hidden: false,
            toolResult: { callId: 'unknown-id', outcome: 'success', content: 'done' },
          },
        ],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      const { contents } = toGeminiMessages(conv);
      const part = contents[0].parts[0] as any;
      expect(part.functionResponse.name).toBe('unknown');
    });

    it('skips unknown roles', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      // @ts-expect-error - testing runtime behavior for invalid role
      conv = appendMessages(conv, { role: 'unknown', content: 'blah' }, testEnvironment);

      const { contents } = toGeminiMessages(conv);
      expect(contents).toHaveLength(0);
    });

    it('handles data URLs with missing parts', () => {
      let conv = createConversation({ id: 'test' }, testEnvironment);
      conv = appendMessages(
        conv,
        {
          role: 'user',
          content: [{ type: 'image', url: 'data:image/png;base64' }], // Invalid data URL
        },
        testEnvironment,
      );

      const { contents } = toGeminiMessages(conv);
      if (contents.length > 0) {
        expect(contents[0].parts).toHaveLength(0);
      } else {
        expect(contents).toHaveLength(0);
      }
    });
  });
});
