import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  conversationSchema,
  conversationShape,
  messageJSONSchema,
  messageRoleSchema,
  multiModalContentSchema,
} from '../src/schemas';

describe('schemas', () => {
  test('messageRoleSchema accepts tool-use literal', () => {
    const res = messageRoleSchema.safeParse('tool-use');
    expect(res.success).toBeTrue();
  });

  test('multiModalContentSchema validates url', () => {
    const ok = multiModalContentSchema.safeParse({
      type: 'image',
      url: 'https://example.com/a.png',
    });
    expect(ok.success).toBeTrue();
  });

  test('messageJSONSchema basic shape', () => {
    const m = {
      id: 'id',
      role: 'user',
      content: 'hi',
      position: 0,
      createdAt: new Date().toISOString(),
      metadata: {},
      hidden: false,
    } as const;
    const res = messageJSONSchema.safeParse(m);
    expect(res.success).toBeTrue();
  });

  test('conversationSchema basic shape', () => {
    const now = new Date().toISOString();
    const c = {
      id: 'c1',
      status: 'active',
      metadata: {},
      tags: [],
      messages: [],
      createdAt: now,
      updatedAt: now,
    } as const;
    const res = conversationSchema.safeParse(c);
    expect(res.success).toBeTrue();
  });

  test('conversationShape is exported', () => {
    expect(conversationShape).toBeDefined();
    expect(typeof conversationShape).toBe('object');
  });

  test('conversationShape has all required fields', () => {
    expect(conversationShape).toHaveProperty('id');
    expect(conversationShape).toHaveProperty('title');
    expect(conversationShape).toHaveProperty('status');
    expect(conversationShape).toHaveProperty('metadata');
    expect(conversationShape).toHaveProperty('tags');
    expect(conversationShape).toHaveProperty('messages');
    expect(conversationShape).toHaveProperty('createdAt');
    expect(conversationShape).toHaveProperty('updatedAt');
  });

  test('conversationShape includes id field', () => {
    expect('id' in conversationShape).toBe(true);
    // Verify id is a zod string schema
    expect(conversationShape.id).toBeDefined();
  });

  test('conversationShape can be used to create a ZodObject', () => {
    const schemaFromShape = z.object(conversationShape);
    expect(schemaFromShape).toBeDefined();

    const now = new Date().toISOString();
    const testData = {
      id: 'test-id',
      status: 'active' as const,
      metadata: {},
      tags: ['test'],
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = schemaFromShape.safeParse(testData);
    expect(result.success).toBe(true);
  });

  test('conversationSchema.shape matches conversationShape', () => {
    // The schema should be built from the shape
    const schemaShape = (conversationSchema as any).shape;

    // Check that the same fields exist
    expect('id' in schemaShape).toBe(true);
    expect('title' in schemaShape).toBe(true);
    expect('status' in schemaShape).toBe(true);
    expect('metadata' in schemaShape).toBe(true);
    expect('tags' in schemaShape).toBe(true);
    expect('messages' in schemaShape).toBe(true);
    expect('createdAt' in schemaShape).toBe(true);
    expect('updatedAt' in schemaShape).toBe(true);
  });

  test('conversationShape works with storage systems', () => {
    // Simulate what a storage system would do
    const hasIdField = 'id' in conversationShape;
    expect(hasIdField).toBe(true);

    // Storage system should detect this and not add its own id field
    const enhancedShape = {
      ...conversationShape,
      // Only add id if not present (simulating storage-unit behavior)
      ...(!hasIdField ? { id: z.string() } : {}),
      type: z.literal('conversation'),
    };

    const schema = z.object(enhancedShape);

    const now = new Date().toISOString();
    const testData = {
      id: 'original-id',
      type: 'conversation',
      status: 'active' as const,
      metadata: {},
      tags: [],
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = schema.safeParse(testData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('original-id');
    }
  });
});
