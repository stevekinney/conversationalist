import {
  estimateConversationTokens,
  getRecentMessages,
  truncateFromPosition,
  type TruncateOptions,
  truncateToTokenLimit,
} from './context';
import {
  appendAssistantMessage,
  appendMessages,
  appendSystemMessage,
  appendUserMessage,
  collapseSystemMessages,
  computeConversationStatistics,
  createConversation,
  deserializeConversation,
  getConversationMessages,
  getFirstSystemMessage,
  getMessageAtPosition,
  getMessageByIdentifier,
  getSystemMessages,
  hasSystemMessage,
  prependSystemMessage,
  redactMessageAtPosition,
  replaceSystemMessage,
  searchConversationMessages,
  serializeConversation,
  toChatMessages,
} from './conversation';
import {
  type ConversationEnvironment,
  resolveConversationEnvironment,
} from './environment';
import {
  appendStreamingMessage,
  cancelStreamingMessage,
  finalizeStreamingMessage,
  getStreamingMessage,
  updateStreamingMessage,
} from './streaming';
import type {
  Conversation,
  ConversationHistoryJSON,
  HistoryNodeJSON,
  Message,
  MessageInput,
  TokenUsage,
} from './types';
import { fromMarkdown, toMarkdown, type ToMarkdownOptions } from './utilities';

/**
 * Event detail for conversation history changes.
 */
export interface ConversationHistoryEventDetail {
  type: string;
  conversation: Conversation;
}

/**
 * Custom event emitted by ConversationHistory.
 */
export class ConversationHistoryEvent extends CustomEvent<ConversationHistoryEventDetail> {
  constructor(type: string, detail: ConversationHistoryEventDetail) {
    super(type, { detail });
  }
}

interface HistoryNode {
  conversation: Conversation;
  parent: HistoryNode | null;
  children: HistoryNode[];
}

/**
 * Manages a stack of conversation versions to support undo, redo, and branching.
 */
export class ConversationHistory extends EventTarget {
  private currentNode: HistoryNode;
  private environment: ConversationEnvironment;

  constructor(
    initial: Conversation = createConversation(),
    environment?: Partial<ConversationEnvironment>,
  ) {
    super();
    this.environment = resolveConversationEnvironment(environment);
    this.currentNode = {
      conversation: initial,
      parent: null,
      children: [],
    };
  }

  /**
   * Dispatches a change event.
   */
  private notifyChange(type: string): void {
    const detail: ConversationHistoryEventDetail = {
      type,
      conversation: this.current,
    };
    this.dispatchEvent(new ConversationHistoryEvent('change', detail));
    this.dispatchEvent(new ConversationHistoryEvent(type, detail));
  }

  /**
   * Overrides addEventListener to optionally return an unsubscribe function.
   * This is a convenience for modern frontend frameworks.
   */
  override addEventListener(
    type: string,
    callback:
      | ((event: ConversationHistoryEvent) => void)
      | EventListenerOrEventListenerObject
      | null,
    options?: boolean | AddEventListenerOptions,
  ): void | (() => void) {
    if (!callback) return;
    super.addEventListener(type, callback as EventListenerOrEventListenerObject, options);
    const unsubscribe = () =>
      this.removeEventListener(
        type,
        callback as EventListenerOrEventListenerObject,
        options,
      );
    return unsubscribe;
  }

  /**
   * Subscribes to conversation changes.
   * This follows the Svelte store contract, making ConversationHistory a valid Svelte store.
   * @param run - Callback called with the current conversation whenever it changes.
   * @returns An unsubscribe function.
   */
  subscribe(run: (value: Conversation) => void): () => void {
    // Call immediately with current value (Svelte store contract)
    run(this.current);

    const handler = (event: Event) => {
      if (event instanceof ConversationHistoryEvent) {
        run(event.detail.conversation);
      }
    };

    const unsubscribe = this.addEventListener(
      'change',
      handler as (event: ConversationHistoryEvent) => void,
    );
    return (unsubscribe as () => void) || (() => {});
  }

  /**
   * Returns the current conversation.
   * Useful for useSyncExternalStore in React.
   */
  getSnapshot(): Conversation {
    return this.current;
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
    this.notifyChange('push');
  }

  /**
   * Reverts to the previous conversation state.
   * @returns The conversation state after undo, or undefined if not possible.
   */
  undo(): Conversation | undefined {
    if (this.currentNode.parent) {
      this.currentNode = this.currentNode.parent;
      this.notifyChange('undo');
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
      this.notifyChange('redo');
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
        this.notifyChange('switch');
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

  // --- QUERY METHODS ---

  getMessages(options?: { includeHidden?: boolean }): ReadonlyArray<Message> {
    return getConversationMessages(this.current, options);
  }

  getMessageAtPosition(position: number): Message | undefined {
    return getMessageAtPosition(this.current, position);
  }

  getMessageByIdentifier(id: string): Message | undefined {
    return getMessageByIdentifier(this.current, id);
  }

  searchMessages(predicate: (m: Message) => boolean): Message[] {
    return searchConversationMessages(this.current, predicate);
  }

  getStatistics() {
    return computeConversationStatistics(this.current);
  }

  hasSystemMessage(): boolean {
    return hasSystemMessage(this.current);
  }

  getFirstSystemMessage(): Message | undefined {
    return getFirstSystemMessage(this.current);
  }

  getSystemMessages(): ReadonlyArray<Message> {
    return getSystemMessages(this.current);
  }

  serialize() {
    return serializeConversation(this.current);
  }

  toChatMessages() {
    return toChatMessages(this.current);
  }

  toMarkdown(options?: ToMarkdownOptions): string {
    return toMarkdown(this.current, options);
  }

  estimateTokens(estimator?: (message: Message) => number): number {
    return estimateConversationTokens(this.current, estimator, this.env);
  }

  getRecentMessages(
    count: number,
    options?: { includeHidden?: boolean; includeSystem?: boolean },
  ): ReadonlyArray<Message> {
    return getRecentMessages(this.current, count, options);
  }

  getStreamingMessage(): Message | undefined {
    return getStreamingMessage(this.current);
  }

  // --- MUTATION METHODS ---

  appendMessages(...inputs: MessageInput[]): void {
    this.push(appendMessages(this.current, ...inputs, this.env));
  }

  appendUserMessage(
    content: MessageInput['content'],
    metadata?: Record<string, unknown>,
  ): void {
    this.push(appendUserMessage(this.current, content, metadata, this.env));
  }

  appendAssistantMessage(
    content: MessageInput['content'],
    metadata?: Record<string, unknown>,
  ): void {
    this.push(appendAssistantMessage(this.current, content, metadata, this.env));
  }

  appendSystemMessage(content: string, metadata?: Record<string, unknown>): void {
    this.push(appendSystemMessage(this.current, content, metadata, this.env));
  }

  prependSystemMessage(content: string, metadata?: Record<string, unknown>): void {
    this.push(prependSystemMessage(this.current, content, metadata, this.env));
  }

  replaceSystemMessage(content: string, metadata?: Record<string, unknown>): void {
    this.push(replaceSystemMessage(this.current, content, metadata, this.env));
  }

  collapseSystemMessages(): void {
    this.push(collapseSystemMessages(this.current, this.env));
  }

  redactMessageAtPosition(position: number, placeholder?: string): void {
    this.push(redactMessageAtPosition(this.current, position, placeholder, this.env));
  }

  truncateFromPosition(
    position: number,
    options?: { preserveSystemMessages?: boolean },
  ): void {
    this.push(truncateFromPosition(this.current, position, options, this.env));
  }

  truncateToTokenLimit(maxTokens: number, options?: TruncateOptions): void {
    this.push(truncateToTokenLimit(this.current, maxTokens, options, this.env));
  }

  appendStreamingMessage(
    role: 'assistant' | 'user',
    metadata?: Record<string, unknown>,
  ): string {
    const { conversation, messageId } = appendStreamingMessage(
      this.current,
      role,
      metadata,
      this.env,
    );
    this.push(conversation);
    return messageId;
  }

  updateStreamingMessage(messageId: string, content: string): void {
    this.push(updateStreamingMessage(this.current, messageId, content, this.env));
  }

  finalizeStreamingMessage(
    messageId: string,
    options?: { tokenUsage?: TokenUsage; metadata?: Record<string, unknown> },
  ): void {
    this.push(finalizeStreamingMessage(this.current, messageId, options, this.env));
  }

  cancelStreamingMessage(messageId: string): void {
    this.push(cancelStreamingMessage(this.current, messageId, this.env));
  }

  /**
   * Serializes the entire history tree and current state to JSON.
   */
  toJSON(): ConversationHistoryJSON {
    const getPath = (node: HistoryNode): number[] => {
      const path: number[] = [];
      let curr = node;
      while (curr.parent) {
        path.unshift(curr.parent.children.indexOf(curr));
        curr = curr.parent;
      }
      return path;
    };

    const serializeNode = (node: HistoryNode): HistoryNodeJSON => ({
      conversation: serializeConversation(node.conversation),
      children: node.children.map(serializeNode),
    });

    let root = this.currentNode;
    while (root.parent) {
      root = root.parent;
    }

    return {
      root: serializeNode(root),
      currentPath: getPath(this.currentNode),
    };
  }

  /**
   * Reconstructs a ConversationHistory instance from JSON.
   */
  static from(
    json: ConversationHistoryJSON,
    environment?: Partial<ConversationEnvironment>,
  ): ConversationHistory {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
    const rootConv = (deserializeConversation as any)(
      json.root.conversation,
    ) as Conversation;
    const history = new ConversationHistory(rootConv, environment);

    // Recursive function to build the tree
    const buildTree = (
      nodeJSON: HistoryNodeJSON,
      parentNode: HistoryNode,
    ): HistoryNode => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      const nodeConv = (deserializeConversation as any)(
        nodeJSON.conversation,
      ) as Conversation;
      const node: HistoryNode = {
        conversation: nodeConv,
        parent: parentNode,
        children: [],
      };
      node.children = nodeJSON.children.map((child) => buildTree(child, node));
      return node;
    };

    const h = history as unknown as { currentNode: HistoryNode };
    const rootNode = h.currentNode;
    rootNode.children = json.root.children.map((child) => buildTree(child, rootNode));

    // Traverse to find the current node
    let current: HistoryNode = rootNode;
    for (const index of json.currentPath) {
      const target = current.children[index];
      if (target) {
        current = target;
      }
    }
    h.currentNode = current;

    return history;
  }

  /**
   * Creates a ConversationHistory instance from a Markdown string.
   */
  static fromMarkdown(
    markdown: string,
    environment?: Partial<ConversationEnvironment>,
  ): ConversationHistory {
    const conversation = fromMarkdown(markdown);
    return new ConversationHistory(conversation, environment);
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

  /**
   * Cleans up all listeners and resources.
   */
  [Symbol.dispose](): void {
    // Clear references to help GC
    let root: HistoryNode | null = this.currentNode;
    while (root?.parent) {
      root = root.parent;
    }

    const clearNode = (node: HistoryNode) => {
      for (const child of node.children) {
        clearNode(child);
      }
      node.children = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const n = node as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      n.parent = null;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      n.conversation = null;
    };

    if (root) clearNode(root);
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
