import { describe, expect, test } from 'bun:test';

import type { MessageJSON } from '../src/types';
import {
  createMessage,
  messageHasImages,
  messageParts,
  messageText,
  messageToJSON,
  messageToString,
} from '../src/utilities';

function base(now = new Date().toISOString()): MessageJSON {
  return {
    id: 'm1',
    role: 'user',
    content: 'hello',
    position: 0,
    createdAt: now,
    metadata: {},
    hidden: false,
  };
}

describe('message helpers', () => {
  test('messageToJSON for string content', () => {
    const msg = createMessage(base());
    const json = messageToJSON(msg);
    expect(json.content).toBe('hello');
  });

  test('parts/text/hasImages/toString with multimodal content', () => {
    const now = new Date().toISOString();
    const json: MessageJSON = {
      id: 'm2',
      role: 'assistant',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image', url: 'https://example.com/x.png', text: 'alt' },
      ],
      position: 1,
      createdAt: now,
      metadata: {},
      hidden: false,
    };
    const msg = createMessage(json);
    expect(messageParts(msg).length).toBe(2);
    expect(messageText(msg)).toContain('hi');
    expect(messageHasImages(msg)).toBeTrue();
    expect(messageToString(msg)).toContain('![');
  });

  test('public message entry re-exports helpers', async () => {
    const mod = await import('../src/message');
    expect(typeof mod.createMessage).toBe('function');
  });

  test('messageParts handles empty string content', () => {
    const msg = createMessage({
      id: 'empty',
      role: 'user',
      content: '',
      position: 0,
      createdAt: new Date().toISOString(),
      metadata: {},
      hidden: false,
    });

    expect(messageParts(msg)).toEqual([]);
    expect(messageToString(msg)).toBe('');
    expect(messageText(msg)).toBe('');
  });
});
