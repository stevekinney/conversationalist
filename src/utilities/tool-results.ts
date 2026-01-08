import type { ToolResult } from '../types';

/**
 * Returns a shallow copy of a tool result.
 */
export function copyToolResult(toolResult: ToolResult): ToolResult {
  return { ...toolResult };
}

/**
 * Redacts tool result payload fields while preserving the original shape.
 */
export function redactToolResult(
  toolResult: ToolResult,
  placeholder: string,
): ToolResult {
  const result = { ...toolResult, content: placeholder };
  if (result.result !== undefined) {
    result.result = placeholder;
  }
  if (result.error !== undefined) {
    result.error = placeholder;
  }
  return result;
}
