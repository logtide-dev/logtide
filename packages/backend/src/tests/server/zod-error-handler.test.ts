import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { build } from '../../server.js';

describe('global error handler with a ZodError', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    app.post('/api/v1/ext/__test-zod', async (request) =>
      z.object({ name: z.string() }).strict().parse(request.body)
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 400 with the field details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ext/__test-zod',
      payload: { name: 1 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().details).toEqual([
      expect.objectContaining({ path: ['name'], code: 'invalid_type' }),
    ]);
  });
});
