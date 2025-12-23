import { describe, expectTypeOf, it } from 'bun:test';

import type { MultiModalContent } from '../src/multi-modal';
import type {
  Conversation,
  ConversationJSON,
  ConversationStatus,
  Message,
  MessageInput,
  MessageJSON,
  MessageRole,
  TokenUsage,
  ToolCall,
  ToolResult,
} from '../src/types';

describe('conversationalist types Type Inference', () => {
  describe('MessageRole', () => {
    it('is a union of literal string types', () => {
      expectTypeOf<MessageRole>().toEqualTypeOf<
        | 'user'
        | 'assistant'
        | 'system'
        | 'developer'
        | 'tool-use'
        | 'tool-result'
        | 'snapshot'
      >();
    });
  });

  describe('ToolCall', () => {
    it('has required properties', () => {
      expectTypeOf<ToolCall['id']>().toEqualTypeOf<string>();
      expectTypeOf<ToolCall['name']>().toEqualTypeOf<string>();
      expectTypeOf<ToolCall['arguments']>().toEqualTypeOf<unknown>();
    });
  });

  describe('ToolResult', () => {
    it('has required properties', () => {
      expectTypeOf<ToolResult['callId']>().toEqualTypeOf<string>();
      expectTypeOf<ToolResult['outcome']>().toEqualTypeOf<'success' | 'error'>();
      expectTypeOf<ToolResult['content']>().toEqualTypeOf<unknown>();
    });

    it('outcome is a discriminated union', () => {
      const success: ToolResult = {
        callId: 'call-1',
        outcome: 'success',
        content: 'data',
      };
      const error: ToolResult = {
        callId: 'call-1',
        outcome: 'error',
        content: 'Error message',
      };

      expectTypeOf(success.outcome).toEqualTypeOf<'success' | 'error'>();
      expectTypeOf(error.outcome).toEqualTypeOf<'success' | 'error'>();
    });
  });

  describe('TokenUsage', () => {
    it('has required numeric properties', () => {
      expectTypeOf<TokenUsage['prompt']>().toEqualTypeOf<number>();
      expectTypeOf<TokenUsage['completion']>().toEqualTypeOf<number>();
      expectTypeOf<TokenUsage['total']>().toEqualTypeOf<number>();
    });
  });

  describe('MessageInput', () => {
    it('has required properties', () => {
      expectTypeOf<MessageInput['role']>().toEqualTypeOf<MessageRole>();
      expectTypeOf<MessageInput['content']>().toEqualTypeOf<
        string | MultiModalContent[]
      >();
    });

    it('has optional properties', () => {
      expectTypeOf<MessageInput['metadata']>().toEqualTypeOf<
        Record<string, unknown> | undefined
      >();
      expectTypeOf<MessageInput['hidden']>().toEqualTypeOf<boolean | undefined>();
      expectTypeOf<MessageInput['toolCall']>().toEqualTypeOf<ToolCall | undefined>();
      expectTypeOf<MessageInput['toolResult']>().toEqualTypeOf<ToolResult | undefined>();
      expectTypeOf<MessageInput['tokenUsage']>().toEqualTypeOf<TokenUsage | undefined>();
      expectTypeOf<MessageInput['goalCompleted']>().toEqualTypeOf<boolean | undefined>();
    });
  });

  describe('MessageJSON', () => {
    it('has required properties for serialization', () => {
      expectTypeOf<MessageJSON['id']>().toEqualTypeOf<string>();
      expectTypeOf<MessageJSON['role']>().toEqualTypeOf<MessageRole>();
      expectTypeOf<MessageJSON['content']>().toEqualTypeOf<
        string | MultiModalContent[]
      >();
      expectTypeOf<MessageJSON['position']>().toEqualTypeOf<number>();
      expectTypeOf<MessageJSON['createdAt']>().toEqualTypeOf<string>();
      expectTypeOf<MessageJSON['metadata']>().toEqualTypeOf<Record<string, unknown>>();
      expectTypeOf<MessageJSON['hidden']>().toEqualTypeOf<boolean>();
    });
  });

  describe('Message', () => {
    it('has required properties with readonly modifiers', () => {
      expectTypeOf<Message['id']>().toEqualTypeOf<string>();
      expectTypeOf<Message['role']>().toEqualTypeOf<MessageRole>();
      expectTypeOf<Message['position']>().toEqualTypeOf<number>();
      expectTypeOf<Message['createdAt']>().toEqualTypeOf<string>();
      expectTypeOf<Message['hidden']>().toEqualTypeOf<boolean>();
    });

    it('has content as string or readonly array', () => {
      // Content is either string or ReadonlyArray<MultiModalContent>
      expectTypeOf<Message['content']>().toEqualTypeOf<
        string | ReadonlyArray<MultiModalContent>
      >();
    });

    it('has readonly metadata', () => {
      expectTypeOf<Message['metadata']>().toEqualTypeOf<
        Readonly<Record<string, unknown>>
      >();
    });

    it('has optional readonly tool properties', () => {
      expectTypeOf<Message['toolCall']>().toEqualTypeOf<Readonly<ToolCall> | undefined>();
      expectTypeOf<Message['toolResult']>().toEqualTypeOf<
        Readonly<ToolResult> | undefined
      >();
      expectTypeOf<Message['tokenUsage']>().toEqualTypeOf<
        Readonly<TokenUsage> | undefined
      >();
    });
  });

  describe('ConversationStatus', () => {
    it('is a union of literal string types', () => {
      expectTypeOf<ConversationStatus>().toEqualTypeOf<
        'active' | 'archived' | 'deleted'
      >();
    });
  });

  describe('ConversationJSON', () => {
    it('has required properties for serialization', () => {
      expectTypeOf<ConversationJSON['id']>().toEqualTypeOf<string>();
      expectTypeOf<ConversationJSON['status']>().toEqualTypeOf<ConversationStatus>();
      expectTypeOf<ConversationJSON['metadata']>().toEqualTypeOf<
        Record<string, unknown>
      >();
      expectTypeOf<ConversationJSON['tags']>().toEqualTypeOf<string[]>();
      expectTypeOf<ConversationJSON['messages']>().toEqualTypeOf<MessageJSON[]>();
      expectTypeOf<ConversationJSON['createdAt']>().toEqualTypeOf<string>();
      expectTypeOf<ConversationJSON['updatedAt']>().toEqualTypeOf<string>();
    });

    it('has optional title', () => {
      expectTypeOf<ConversationJSON['title']>().toEqualTypeOf<string | undefined>();
    });
  });

  describe('Conversation', () => {
    it('has required properties', () => {
      expectTypeOf<Conversation['id']>().toEqualTypeOf<string>();
      expectTypeOf<Conversation['status']>().toEqualTypeOf<ConversationStatus>();
      expectTypeOf<Conversation['createdAt']>().toEqualTypeOf<string>();
      expectTypeOf<Conversation['updatedAt']>().toEqualTypeOf<string>();
    });

    it('has readonly nested types', () => {
      // Metadata is readonly
      expectTypeOf<Conversation['metadata']>().toEqualTypeOf<
        Readonly<Record<string, unknown>>
      >();

      // Tags are readonly
      expectTypeOf<Conversation['tags']>().toEqualTypeOf<ReadonlyArray<string>>();

      // Messages are readonly
      expectTypeOf<Conversation['messages']>().toEqualTypeOf<ReadonlyArray<Message>>();
    });

    it('has optional title', () => {
      expectTypeOf<Conversation['title']>().toEqualTypeOf<string | undefined>();
    });

    it('is immutable (all nested arrays are readonly)', () => {
      // This verifies that the Conversation type enforces immutability
      const conv: Conversation = {
        id: 'conv-1',
        status: 'active',
        metadata: {},
        tags: ['test'],
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // @ts-expect-error - tags is readonly
      conv.tags.push('another');

      // @ts-expect-error - messages is readonly
      conv.messages.push({} as Message);

      // @ts-expect-error - cannot reassign readonly property
      conv.metadata['key'] = 'value';

      // Just to verify the test compiles (the errors above are expected)
      expectTypeOf(conv).toMatchTypeOf<Conversation>();
    });
  });

  describe('Message vs MessageJSON differences', () => {
    it('MessageJSON uses mutable arrays while Message uses readonly', () => {
      // MessageJSON content is mutable
      expectTypeOf<MessageJSON['content']>().toEqualTypeOf<
        string | MultiModalContent[]
      >();

      // Message content is readonly
      expectTypeOf<Message['content']>().toEqualTypeOf<
        string | ReadonlyArray<MultiModalContent>
      >();
    });

    it('MessageJSON metadata is mutable while Message metadata is readonly', () => {
      expectTypeOf<MessageJSON['metadata']>().toEqualTypeOf<Record<string, unknown>>();
      expectTypeOf<Message['metadata']>().toEqualTypeOf<
        Readonly<Record<string, unknown>>
      >();
    });
  });

  describe('Conversation vs ConversationJSON differences', () => {
    it('ConversationJSON uses mutable arrays while Conversation uses readonly', () => {
      // ConversationJSON arrays are mutable
      expectTypeOf<ConversationJSON['tags']>().toEqualTypeOf<string[]>();
      expectTypeOf<ConversationJSON['messages']>().toEqualTypeOf<MessageJSON[]>();

      // Conversation arrays are readonly
      expectTypeOf<Conversation['tags']>().toEqualTypeOf<ReadonlyArray<string>>();
      expectTypeOf<Conversation['messages']>().toEqualTypeOf<ReadonlyArray<Message>>();
    });
  });
});
