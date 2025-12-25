import {
  type ConversationEnvironment,
  resolveConversationEnvironment,
} from './environment';
import type { Conversation } from './types';

interface HistoryNode {
  conversation: Conversation;
  parent: HistoryNode | null;
  children: HistoryNode[];
}

/**
 * Manages a stack of conversation versions to support undo, redo, and branching.
 */
export class ConversationHistory {
  private currentNode: HistoryNode;
  private environment: ConversationEnvironment;

  constructor(initial: Conversation, environment?: Partial<ConversationEnvironment>) {
    this.environment = resolveConversationEnvironment(environment);
    this.currentNode = {
      conversation: initial,
      parent: null,
      children: [],
    };
  }

  /**
   * The current conversation state.
   */
  get current(): Conversation {
    return this.currentNode.conversation;
  }

  /**
   * Whether an undo operation is possible.
   */
  get canUndo(): boolean {
    return this.currentNode.parent !== null;
  }

  /**
   * Whether a redo operation is possible.
   */
  get canRedo(): boolean {
    return this.currentNode.children.length > 0;
  }

  /**
   * Returns the environment associated with this history.
   */
  get env(): ConversationEnvironment {
    return this.environment;
  }

  /**
   * Returns the number of branches available at the current level.
   */
  get branchCount(): number {
    return this.currentNode.parent ? this.currentNode.parent.children.length : 1;
  }

  /**
   * Returns the index of the current branch at this level.
   */
  get branchIndex(): number {
    if (!this.currentNode.parent) return 0;
    return this.currentNode.parent.children.indexOf(this.currentNode);
  }

  /**
   * Returns the number of alternate paths available from the current state.
   */
  get redoCount(): number {
    return this.currentNode.children.length;
  }

  /**
   * Pushes a new conversation state onto the history.
   * If the current state is not a leaf, a new branch is created.
   */
  push(next: Conversation): void {
    const newNode: HistoryNode = {
      conversation: next,
      parent: this.currentNode,
      children: [],
    };
    this.currentNode.children.push(newNode);
    this.currentNode = newNode;
  }

  /**
   * Reverts to the previous conversation state.
   * @returns The conversation state after undo, or undefined if not possible.
   */
  undo(): Conversation | undefined {
    if (this.currentNode.parent) {
      this.currentNode = this.currentNode.parent;
      return this.current;
    }
    return undefined;
  }

  /**
   * Advances to the next conversation state.
   * @param childIndex - The index of the branch to follow (default: 0).
   * @returns The conversation state after redo, or undefined if not possible.
   */
  redo(childIndex: number = 0): Conversation | undefined {
    const next = this.currentNode.children[childIndex];
    if (next) {
      this.currentNode = next;
      return this.current;
    }
    return undefined;
  }

  /**
   * Switches to a different branch at the current level.
   * @param index - The index of the sibling branch to switch to.
   * @returns The new conversation state, or undefined if not possible.
   */
  switchToBranch(index: number): Conversation | undefined {
    if (this.currentNode.parent) {
      const target = this.currentNode.parent.children[index];
      if (target) {
        this.currentNode = target;
        return this.current;
      }
    }
    return undefined;
  }

  /**
   * Returns the sequence of conversations from root to current.
   */
  getPath(): Conversation[] {
    const path: Conversation[] = [];
    let curr: HistoryNode | null = this.currentNode;
    while (curr) {
      path.unshift(curr.conversation);
      curr = curr.parent;
    }
    return path;
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
