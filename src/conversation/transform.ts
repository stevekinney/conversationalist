import type {
  Message as ExternalMessage,
  MultiModalContent,
} from '@lasercat/homogenaize';

import type { Conversation } from '../types';

/**
 * Converts conversation messages to the external chat message format.
 * Maps internal roles to standard user/assistant/system roles.
 * Hidden messages are excluded from the output.
 */
export function toChatMessages(conversation: Conversation): ExternalMessage[] {
  const roleMap: Record<string, 'user' | 'assistant' | 'system'> = {
    user: 'user',
    assistant: 'assistant',
    system: 'system',
    developer: 'system',
    'tool-use': 'assistant',
    'tool-result': 'user',
    snapshot: 'system',
  };

  const result: ExternalMessage[] = [];
  for (const message of conversation.messages) {
    if (message.hidden) continue;
    const externalRole = roleMap[message.role] as 'user' | 'assistant' | 'system';
    result.push({
      role: externalRole,
      content: message.content as string | MultiModalContent[],
    });
  }
  return result;
}
