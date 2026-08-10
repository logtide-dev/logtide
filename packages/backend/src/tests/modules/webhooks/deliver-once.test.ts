import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../config/index.js', () => ({
  config: { MONITOR_ALLOW_PRIVATE_TARGETS: false, WEBHOOK_REQUEST_TIMEOUT_MS: 10000 },
}));

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock('../../../utils/ssrf-guard.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/ssrf-guard.js')>(
    '../../../utils/ssrf-guard.js'
  );
  return { ...actual, safeFetch: safeFetchMock };
});

const hooksMock = vi.hoisted(() => ({
  hasHandlers: vi.fn(() => false),
  run: vi.fn(),
  runAfter: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../hooks/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../hooks/index.js')>(
    '../../../hooks/index.js'
  );
  return { ...actual, hooks: hooksMock };
});

import { deliverOnce } from '../../../modules/webhooks/dispatcher.js';
import { SsrfBlockedError } from '../../../utils/ssrf-guard.js';
import { verifySignature } from '../../../modules/webhooks/signing.js';

beforeEach(() => {
  safeFetchMock.mockReset();
  hooksMock.hasHandlers.mockReturnValue(false);
  hooksMock.run.mockReset();
  hooksMock.runAfter.mockClear();
  hooksMock.runAfter.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

function okResponse(status = 200, text = 'ok') {
  return { ok: status >= 200 && status < 300, status, statusText: 'OK', text: async () => text };
}

describe('deliverOnce', () => {
  it('always sends X-Logtide-Event-Version: 1 header', async () => {
    safeFetchMock.mockResolvedValue(okResponse());
    await deliverOnce({ url: 'https://example.com/hook', body: { a: 1 }, organizationId: 'org-1', eventType: 'alert' });
    const [, init] = safeFetchMock.mock.calls[0];
    expect(init.headers['X-Logtide-Event-Version']).toBe('1');
  });

  it('X-Logtide-Event-Version is present even without a signing secret', async () => {
    safeFetchMock.mockResolvedValue(okResponse());
    await deliverOnce({ url: 'https://example.com/hook', body: {}, organizationId: 'o', eventType: 'alert' });
    const [, init] = safeFetchMock.mock.calls[0];
    expect(init.headers['X-Logtide-Event-Version']).toBe('1');
  });

  it('signature still verifies when body is an envelope object', async () => {
    safeFetchMock.mockResolvedValue(okResponse());
    const envelopeBody = {
      id: 'evt_a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      type: 'alert.triggered',
      version: 1,
      occurredAt: new Date().toISOString(),
      organizationId: 'org-1',
      projectId: null,
      data: { alert_name: 'test', log_count: 1, threshold: 1, time_window: 60, baseline_metadata: null, link: 'https://x' },
    };
    await deliverOnce({
      url: 'https://example.com/hook',
      body: envelopeBody,
      organizationId: 'org-1',
      eventType: 'alert.triggered',
      signingSecret: 'whsec_envelope_test',
    });
    const [, init] = safeFetchMock.mock.calls[0];
    const ts = Number(init.headers['X-Logtide-Timestamp']);
    const sig = init.headers['X-Logtide-Signature'].split('v1=')[1];
    expect(verifySignature('whsec_envelope_test', ts, init.body, sig)).toBe(true);
    // The signed body is the serialized envelope
    expect(JSON.parse(init.body)).toMatchObject({ id: 'evt_a1b2c3d4-e5f6-7890-abcd-ef1234567890', version: 1 });
  });

  it('signs the body when a secret is provided', async () => {
    safeFetchMock.mockResolvedValue(okResponse());
    await deliverOnce({
      url: 'https://example.com/hook',
      body: { a: 1 },
      organizationId: 'org-1',
      eventType: 'alert',
      signingSecret: 'whsec_x',
    });
    const [, init] = safeFetchMock.mock.calls[0];
    const ts = Number(init.headers['X-Logtide-Timestamp']);
    const sig = init.headers['X-Logtide-Signature'].split('v1=')[1];
    expect(verifySignature('whsec_x', ts, init.body, sig)).toBe(true);
  });

  it('returns success for 2xx', async () => {
    safeFetchMock.mockResolvedValue(okResponse(204, ''));
    const r = await deliverOnce({ url: 'https://e.com', body: {}, organizationId: 'o', eventType: 'alert' });
    expect(r.success).toBe(true);
    expect(r.statusCode).toBe(204);
  });

  it('classifies 5xx as retryable and 4xx as non-retryable', async () => {
    safeFetchMock.mockResolvedValueOnce(okResponse(503, 'down'));
    const a = await deliverOnce({ url: 'https://e.com', body: {}, organizationId: 'o', eventType: 'alert' });
    expect(a.success).toBe(false);
    expect(a.retryable).toBe(true);

    safeFetchMock.mockResolvedValueOnce(okResponse(400, 'bad'));
    const b = await deliverOnce({ url: 'https://e.com', body: {}, organizationId: 'o', eventType: 'alert' });
    expect(b.retryable).toBe(false);
  });

  it('maps SSRF block to a non-retryable failure', async () => {
    safeFetchMock.mockRejectedValue(new SsrfBlockedError('blocked'));
    const r = await deliverOnce({ url: 'http://169.254.169.254', body: {}, organizationId: 'o', eventType: 'alert' });
    expect(r.success).toBe(false);
    expect(r.retryable).toBe(false);
    expect(r.error).toMatch(/private\/internal/);
  });

  it('treats hook rejection as a non-retryable failure', async () => {
    const { HookRejectionError } = await import('../../../hooks/index.js');
    hooksMock.hasHandlers.mockReturnValue(true);
    hooksMock.run.mockRejectedValue(new HookRejectionError('nope'));
    const r = await deliverOnce({ url: 'https://e.com', body: {}, organizationId: 'o', eventType: 'alert' });
    expect(r.success).toBe(false);
    expect(r.retryable).toBe(false);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  const DISCORD_URL = 'https://discord.com/api/webhooks/153199955952022743/token';

  it('formats the body for discord destinations', async () => {
    safeFetchMock.mockResolvedValue(okResponse());
    const body = {
      id: 'evt_a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      type: 'monitor.status_changed',
      version: 1,
      occurredAt: '2026-08-10T09:19:12.000Z',
      organizationId: '00000000-0000-0000-0000-000000000001',
      projectId: null,
      data: {
        title: 'Monitor down: api',
        message: 'api is not responding',
        severity: 'critical',
        status: 'down',
      },
    };
    await deliverOnce({
      url: DISCORD_URL,
      body,
      organizationId: 'org-1',
      eventType: 'monitor.status_changed',
    });
    const [, init] = safeFetchMock.mock.calls[0];
    const sent = JSON.parse(init.body);
    expect(sent.embeds[0].title).toBe('Monitor down: api');
    expect(sent.type).toBeUndefined();
  });

  it('leaves the envelope untouched for non-discord destinations', async () => {
    safeFetchMock.mockResolvedValue(okResponse());
    const body = { id: 'evt_x', type: 'monitor.status_changed', data: { title: 'x' } };
    await deliverOnce({
      url: 'https://example.com/hook',
      body,
      organizationId: 'org-1',
      eventType: 'monitor.status_changed',
    });
    const [, init] = safeFetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('signs the bytes actually sent to discord', async () => {
    safeFetchMock.mockResolvedValue(okResponse());
    await deliverOnce({
      url: DISCORD_URL,
      body: {
        id: 'evt_y',
        type: 'channel.test',
        occurredAt: '2026-08-10T09:19:12.000Z',
        data: { title: 'Test', message: 'hi' },
      },
      organizationId: 'org-1',
      eventType: 'channel.test',
      signingSecret: 'whsec_discord',
    });
    const [, init] = safeFetchMock.mock.calls[0];
    const ts = Number(init.headers['X-Logtide-Timestamp']);
    const sig = init.headers['X-Logtide-Signature'].split('v1=')[1];
    expect(verifySignature('whsec_discord', ts, init.body, sig)).toBe(true);
    expect(JSON.parse(init.body).embeds).toBeDefined();
  });

  it('runs the beforeWebhookDispatch hook on the envelope, not the discord body', async () => {
    safeFetchMock.mockResolvedValue(okResponse());
    hooksMock.hasHandlers.mockReturnValue(true);
    hooksMock.run.mockImplementation(async (_phase: string, ctx: any) => {
      ctx.body.data.title = 'mutated by hook';
    });
    await deliverOnce({
      url: DISCORD_URL,
      body: {
        id: 'evt_z',
        type: 'channel.test',
        occurredAt: '2026-08-10T09:19:12.000Z',
        data: { title: 'original', message: 'hi' },
      },
      organizationId: 'org-1',
      eventType: 'channel.test',
    });
    const [, hookCtx] = hooksMock.run.mock.calls[0];
    expect(hookCtx.body.type).toBe('channel.test');
    const [, init] = safeFetchMock.mock.calls[0];
    expect(JSON.parse(init.body).embeds[0].title).toBe('mutated by hook');
  });
});
