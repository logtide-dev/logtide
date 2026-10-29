import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { createTestContext } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

describe('SIEM SSE with a stream ticket, full server', () => {
  let app: FastifyInstance;
  let orgId: string;
  let sessionToken: string;

  beforeEach(async () => {
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    sessionToken = (await createTestSession(ctx.user.id)).token;
    app = await build();
    await app.ready();
  });

  it('accepts a freshly minted ticket', async () => {
    const minted = await app.inject({
      method: 'POST',
      url: '/api/v1/stream-tickets',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(minted.statusCode).toBe(200);
    const { ticket } = minted.json();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300);
    let status: number | undefined;
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/siem/events?organizationId=${orgId}&ticket=${ticket}`,
        signal: controller.signal as any,
      });
      status = res.statusCode;
    } catch (error: any) {
      if (error.name !== 'AbortError' && error.code !== 'ABORT_ERR') throw error;
    } finally {
      clearTimeout(timer);
    }
    // aborted means the stream was open; a response must not be a 401
    if (status !== undefined) expect(status).not.toBe(401);
  });
});
