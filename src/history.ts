import {
  type ConversationEnvironment,
  resolveConversationEnvironment,
} from './environment';
import type { Conversation } from './types';

/**
 * Manages a stack of conversation versions to support undo and redo.
 */
export class ConversationHistory {
  private versions: Conversation[] = [];
  private index: number = -1;
  private environment: ConversationEnvironment;

  constructor(initial: Conversation, environment?: Partial<ConversationEnvironment>) {
    this.environment = resolveConversationEnvironment(environment);
    this.push(initial);
  }

  /**
   * The current conversation state.
   */
  get current(): Conversation {
    return this.versions[this.index]!;
  }

  /**
   * Whether an undo operation is possible.
   */
  get canUndo(): boolean {
    return this.index > 0;
  }

  /**
   * Whether a redo operation is possible.
   */
  get canRedo(): boolean {
    return this.index < this.versions.length - 1;
  }

  /**
   * Returns the environment associated with this history.
   */
  get env(): ConversationEnvironment {
    return this.environment;
  }

  /**
   * Pushes a new conversation state onto the history.
   * Any future versions (from redo) are cleared.
   */
  push(next: Conversation): void {
    // If we're pushing a new state, we truncate any redo history
    this.versions = this.versions.slice(0, this.index + 1);
    this.versions.push(next);
    this.index++;
  }

  /**
   * Reverts to the previous conversation state.
   * @returns The conversation state after undo, or undefined if not possible.
   */
  undo(): Conversation | undefined {
    if (this.canUndo) {
      this.index--;
      return this.current;
    }
    return undefined;
  }

  /**
   * Advances to the next conversation state.
   * @returns The conversation state after redo, or undefined if not possible.
   */
  redo(): Conversation | undefined {
    if (this.canRedo) {
      this.index++;
      return this.current;
    }
    return undefined;
  }

  /**
   * Binds a function to this history instance.
   * The first argument of the function must be a Conversation.
   * If the function returns a new Conversation, it is automatically pushed to the history.
   */
  bind<T extends unknown[], R>(
    fn: (
      conversation: Conversation,
      ...args: [...T, Partial<ConversationEnvironment>?]
    ) => R,
  ): (...args: T) => R {
    return bindToConversationHistory(this, fn);
  }
}

/**
 * Binds a function's first argument to a ConversationHistory's current state.
 * If the function returns a Conversation, it is pushed to the history.
 */
export function bindToConversationHistory<T extends unknown[], R>(
  history: ConversationHistory,
  fn: (
    conversation: Conversation,
    ...args: [...T, Partial<ConversationEnvironment>?]
  ) => R,
): (...args: T) => R {
  return (...args: T): R => {
    // We pass the history's environment as the last argument if the function supports it
    const boundFn = fn as (conversation: Conversation, ...args: unknown[]) => R;
    const result = boundFn(history.current, ...args, history.env);

    if (isConversation(result)) {
      history.push(result);
    }

    return result;
  };
}

/**
 * Simple type guard to check if a value is a Conversation.
 */
function isConversation(value: unknown): value is Conversation {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Conversation).id === 'string' &&
    typeof (value as Conversation).status === 'string' &&
    (value as Conversation).metadata !== null &&
    typeof (value as Conversation).metadata === 'object' &&
    Array.isArray((value as Conversation).tags) &&
    Array.isArray((value as Conversation).messages) &&
    typeof (value as Conversation).createdAt === 'string' &&
    typeof (value as Conversation).updatedAt === 'string'
  );
}
