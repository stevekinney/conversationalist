import type { Message, MessagePlugin, TokenEstimator } from './types';
import { messageText } from './utilities';

/**
 * Environment functions for conversation operations.
 * Allows dependency injection for testing and custom ID generation.
 */
export interface ConversationEnvironment {
  now: () => string;
  randomId: () => string;
  estimateTokens: TokenEstimator;
  plugins: MessagePlugin[];
}

/**
 * Simple character-based token estimator.
 * Approximates ~4 characters per token (rough average for English text).
 */
export function simpleTokenEstimator(message: Message): number {
  const text = messageText(message);
  return Math.ceil(text.length / 4);
}

/**
 * Default environment using Date.toISOString(), crypto.randomUUID(), and simple token estimation.
 */
export const defaultConversationEnvironment: ConversationEnvironment = {
  now: () => new Date().toISOString(),
  randomId: () => crypto.randomUUID(),
  estimateTokens: simpleTokenEstimator,
  plugins: [],
};

/**
 * Merges a partial environment with defaults.
 * Returns a complete environment with all required functions.
 */
export function resolveConversationEnvironment(
  environment?: Partial<ConversationEnvironment>,
): ConversationEnvironment {
  return {
    now: environment?.now ?? defaultConversationEnvironment.now,
    randomId: environment?.randomId ?? defaultConversationEnvironment.randomId,
    estimateTokens:
      environment?.estimateTokens ?? defaultConversationEnvironment.estimateTokens,
    plugins: [...(environment?.plugins ?? defaultConversationEnvironment.plugins)],
  };
}

/**
 * Type guard to distinguish environment objects from message inputs.
 * Returns true if the value has environment functions but no role property.
 */
export function isConversationEnvironmentParameter(
  value: unknown,
): value is Partial<ConversationEnvironment> {
  if (!value || typeof value !== 'object') return false;
  if ('role' in (value as Record<string, unknown>)) return false;

  const candidate = value as Partial<ConversationEnvironment>;
  return (
    typeof candidate.now === 'function' ||
    typeof candidate.randomId === 'function' ||
    Array.isArray(candidate.plugins)
  );
}
