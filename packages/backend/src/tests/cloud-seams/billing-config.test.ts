/**
 * Billing API seam (LOGTIDE_BILLING_API_URL + LOGTIDE_BILLING_API_TOKEN).
 * Active only when both are set. The HTTP checks run against the REAL app builder.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { reservoirReady } from '../../database/reservoir.js';
import { config, configSchema } from '../../config/index.js';
import { build } from '../../server.js';
import { isBillingApiActive } from '../../modules/billing/seam.js';

const URL_OK = 'http://logtide-billing:8090';
const TOKEN = 't'.repeat(40);

const cfg = config as unknown as { LOGTIDE_BILLING_API_URL?: string; LOGTIDE_BILLING_API_TOKEN?: string };

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  API_KEY_SECRET: 'x'.repeat(32),
};
const parse = (extra: Record<string, string>) => configSchema.safeParse({ ...base, ...extra });

describe('billing api env validation', () => {
  it('both unset is inactive', () => {
    const r = parse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.LOGTIDE_BILLING_API_URL).toBeUndefined();
      expect(r.data.LOGTIDE_BILLING_API_TOKEN).toBeUndefined();
    }
  });

  it('empty strings are unset', () => {
    const r = parse({ LOGTIDE_BILLING_API_URL: '', LOGTIDE_BILLING_API_TOKEN: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.LOGTIDE_BILLING_API_URL).toBeUndefined();
  });

  it('only URL set aborts with a message naming both vars', () => {
    const r = parse({ LOGTIDE_BILLING_API_URL: URL_OK });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = JSON.stringify(r.error.issues);
      expect(msg).toContain('LOGTIDE_BILLING_API_URL');
      expect(msg).toContain('LOGTIDE_BILLING_API_TOKEN');
      expect(msg).toContain('must be set together');
    }
  });

  it('only token set aborts', () => {
    expect(parse({ LOGTIDE_BILLING_API_TOKEN: TOKEN }).success).toBe(false);
  });

  it('token shorter than 32 aborts', () => {
    const r = parse({ LOGTIDE_BILLING_API_URL: URL_OK, LOGTIDE_BILLING_API_TOKEN: 'short' });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('at least 32');
  });

  it('relative or non-http URL aborts', () => {
    expect(parse({ LOGTIDE_BILLING_API_URL: '/billing', LOGTIDE_BILLING_API_TOKEN: TOKEN }).success).toBe(false);
    expect(parse({ LOGTIDE_BILLING_API_URL: 'ftp://billing:8090', LOGTIDE_BILLING_API_TOKEN: TOKEN }).success).toBe(false);
  });

  it('http://logtide-billing:8090 and https are accepted', () => {
    expect(parse({ LOGTIDE_BILLING_API_URL: URL_OK, LOGTIDE_BILLING_API_TOKEN: TOKEN }).success).toBe(true);
    expect(
      parse({ LOGTIDE_BILLING_API_URL: 'https://billing.example.com', LOGTIDE_BILLING_API_TOKEN: TOKEN }).success,
    ).toBe(true);
  });

  it('a partial env fails the boot', async () => {
    const before = process.env.LOGTIDE_BILLING_API_URL;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.resetModules();
      process.env.LOGTIDE_BILLING_API_URL = URL_OK;
      await expect(import('../../config/index.js')).rejects.toThrow(/Invalid configuration/);
      const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toContain('LOGTIDE_BILLING_API_URL');
      expect(printed).toContain('must be set together');
    } finally {
      if (before === undefined) delete process.env.LOGTIDE_BILLING_API_URL;
      else process.env.LOGTIDE_BILLING_API_URL = before;
      errorSpy.mockRestore();
      vi.resetModules();
    }
  });
});

describe('billing api seam (real app)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await reservoirReady;
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    delete cfg.LOGTIDE_BILLING_API_URL;
    delete cfg.LOGTIDE_BILLING_API_TOKEN;
  });

  it('inactive: isBillingApiActive false and no billingEnabled key', async () => {
    expect(isBillingApiActive()).toBe(false);
    const body = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
    expect(body).not.toHaveProperty('billingEnabled');
  });

  it('only one of the pair set is still inactive', () => {
    cfg.LOGTIDE_BILLING_API_URL = URL_OK;
    expect(isBillingApiActive()).toBe(false);
  });

  it('both set makes it active and /auth/config returns billingEnabled: true', async () => {
    cfg.LOGTIDE_BILLING_API_URL = URL_OK;
    cfg.LOGTIDE_BILLING_API_TOKEN = TOKEN;
    expect(isBillingApiActive()).toBe(true);
    const body = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
    expect(body.billingEnabled).toBe(true);
  });
});
