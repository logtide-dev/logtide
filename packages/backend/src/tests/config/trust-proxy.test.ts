import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../server.js';
import { config } from '../../config/index.js';
import { db } from '../../database/index.js';
import { parseTrustProxy } from '../../config/trust-proxy.js';
import { createTestUser } from '../helpers/factories.js';

describe('parseTrustProxy', () => {
  it('reads booleans, hop counts and proxy lists', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('172.16.0.0/12, 10.0.0.1')).toEqual(['172.16.0.0/12', '10.0.0.1']);
    expect(parseTrustProxy('fd00::/8')).toEqual(['fd00::/8']);
  });

  it('rejects values that would silently trust the wrong hops', () => {
    expect(() => parseTrustProxy('0')).toThrow('hop count');
    expect(() => parseTrustProxy('yes')).toThrow('not valid');
    expect(() => parseTrustProxy('10.0.0.0/40')).toThrow('not valid');
    expect(() => parseTrustProxy('nginx')).toThrow('not valid');
  });
});

/**
 * Client 81.2.69.142 behind Cloudflare (edge 104.16.0.1) and a reverse proxy
 * whose connection reaches the backend from the Docker gateway 172.31.0.1.
 * The client also sends its own X-Forwarded-For to pose as 6.6.6.6.
 */
const CHAIN = { remoteAddress: '172.31.0.1', xff: '6.6.6.6, 81.2.69.142, 104.16.0.1' };

describe('client IP behind proxies (real app)', () => {
  const original = config.TRUST_PROXY;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    config.TRUST_PROXY = original;
    await app?.close();
    app = undefined;
  });

  async function failedLoginIp(email: string): Promise<string | null> {
    await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: CHAIN.remoteAddress,
      headers: { 'x-forwarded-for': CHAIN.xff },
      payload: { email, password: 'wrong-password' },
    });
    const row = await db
      .selectFrom('audit_log')
      .select('ip_address')
      .where('action', '=', 'auth.login_failed')
      .orderBy('time', 'desc')
      .executeTakeFirst();
    return row?.ip_address ?? null;
  }

  it('records the proxy address when no proxy is trusted', async () => {
    config.TRUST_PROXY = false;
    app = await build();
    const user = await createTestUser();

    expect(await failedLoginIp(user.email)).toBe('172.31.0.1');
  });

  it('records the real client with a hop count, ignoring a forged header', async () => {
    config.TRUST_PROXY = 2;
    app = await build();
    const user = await createTestUser();

    expect(await failedLoginIp(user.email)).toBe('81.2.69.142');
  });

  it('records the real client with a list of proxies', async () => {
    config.TRUST_PROXY = ['172.16.0.0/12', '104.16.0.0/13'];
    app = await build();
    const user = await createTestUser();

    expect(await failedLoginIp(user.email)).toBe('81.2.69.142');
  });

  it('true takes the left-most entry, which the client controls', async () => {
    config.TRUST_PROXY = true;
    app = await build();
    const user = await createTestUser();

    expect(await failedLoginIp(user.email)).toBe('6.6.6.6');
  });
});
