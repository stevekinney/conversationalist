import type {
  ToolCall as ArmorerToolCall,
  ToolCallInput as ArmorerToolCallInput,
  ToolResult as ArmorerToolResult,
} from 'armorer';
import { describe, expectTypeOf, it } from 'bun:test';

import type { ToolCall, ToolResult } from '../src/types';

describe('armorer type compatibility', () => {
  it('accepts armorer tool calls', () => {
    expectTypeOf<ArmorerToolCall>().toMatchTypeOf<ToolCall>();
    expectTypeOf<ToolCall>().toMatchTypeOf<ArmorerToolCall>();
  });

  it('feeds conversation tool calls into armorer execution', () => {
    expectTypeOf<ToolCall>().toMatchTypeOf<ArmorerToolCallInput>();
  });

  it('accepts armorer tool results', () => {
    expectTypeOf<ArmorerToolResult>().toMatchTypeOf<ToolResult>();
  });
});
