/**
 * Environment functions for conversation operations.
 * Allows dependency injection for testing and custom ID generation.
 */
export interface ConversationEnvironment {
  now: () => string;
  randomId: () => string;
}

/**
 * Default environment using Date.toISOString() and crypto.randomUUID().
 */
export const defaultConversationEnvironment: ConversationEnvironment = {
  now: () => new Date().toISOString(),
  randomId: () => crypto.randomUUID(),
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
  return typeof candidate.now === 'function' || typeof candidate.randomId === 'function';
}
