import type { MessageInput, MessagePlugin } from '../types';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const API_KEY_REGEX =
  /(?:[a-zA-Z0-9_-]*(?:api|key|secret|token|password|auth)[a-zA-Z0-9_-]*[:=]\s*["']?)([a-zA-Z0-9._-]{16,})(?:["']?)/gi;

/**
 * Redacts PII from a string.
 */
export function redactPII(text: string): string {
  return text
    .replace(API_KEY_REGEX, (match: string, key: string) =>
      match.replace(key, '[KEY_REDACTED]'),
    )
    .replace(EMAIL_REGEX, '[EMAIL_REDACTED]')
    .replace(PHONE_REGEX, '[PHONE_REDACTED]');
}

/**
 * A plugin that redacts PII (emails, phone numbers, API keys) from message content.
 */
export const piiRedactionPlugin: MessagePlugin = (input: MessageInput): MessageInput => {
  if (typeof input.content === 'string') {
    return {
      ...input,
      content: redactPII(input.content),
    };
  }

  return {
    ...input,
    content: input.content.map((part) => {
      if (part.type === 'text' && part.text) {
        return {
          ...part,
          text: redactPII(part.text),
        };
      }
      return part;
    }),
  };
};
