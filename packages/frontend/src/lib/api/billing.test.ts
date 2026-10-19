import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BillingAPI, BillingApiError } from './billing';

const ORG = '11111111-1111-4111-8111-111111111111';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('billingAPI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: BillingAPI;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    api = new BillingAPI(() => 'session-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gets the overview with the session token', async () => {
    fetchMock.mockResolvedValue(json(200, { checkoutEnabled: true }));
    await expect(api.getOverview(ORG)).resolves.toEqual({ checkoutEnabled: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(new RegExp(`/organizations/${ORG}/billing$`));
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer session-token');
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('posts plan changes as JSON', async () => {
    fetchMock.mockResolvedValue(json(200, { amountDue: 100, currency: 'usd', immediate: true }));
    await api.preview(ORG, 'pro_plus', 'year');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/billing\/preview$/);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ plan: 'pro_plus', interval: 'year' });
  });

  it('sends cancel without a body so the JSON parser has nothing to reject', async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await api.cancel(ORG);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/billing\/cancel$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('turns a contract error body into a BillingApiError', async () => {
    fetchMock.mockResolvedValue(json(503, { error: 'checkout_disabled', message: 'Checkout is closed' }));
    const err = await api.startCheckout(ORG, 'pro', 'month').catch((e) => e);
    expect(err).toBeInstanceOf(BillingApiError);
    expect(err.status).toBe(503);
    expect(err.code).toBe('checkout_disabled');
    expect(err.message).toBe('Checkout is closed');
  });

  it('keeps the hosted invoice url of a payment that needs action', async () => {
    fetchMock.mockResolvedValue(
      json(402, { error: 'payment_action_required', message: 'Confirm', hostedInvoiceUrl: 'https://invoice.stripe.com/i/x' })
    );
    const err = await api.changePlan(ORG, 'pro_plus', 'month').catch((e) => e);
    expect(err.code).toBe('payment_action_required');
    expect(err.hostedInvoiceUrl).toBe('https://invoice.stripe.com/i/x');
  });

  it('maps a network failure to billing_unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await api.getOverview(ORG).catch((e) => e);
    expect(err).toBeInstanceOf(BillingApiError);
    expect(err.code).toBe('billing_unavailable');
  });

  it('maps a 5xx without a contract body to billing_unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    const err = await api.getInvoices(ORG).catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.code).toBe('billing_unavailable');
  });

  it('does not treat a framework error label as a code', async () => {
    fetchMock.mockResolvedValue(json(404, { statusCode: 404, error: 'Not Found', message: 'Route not found' }));
    const err = await api.getOverview(ORG).catch((e) => e);
    expect(err.code).toBe('http_404');
  });

  it('rejects a malformed checkout session id without calling the API', async () => {
    const err = await api.getCheckoutStatus(ORG, '../../admin').catch((e) => e);
    expect(err).toBeInstanceOf(BillingApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('puts a valid checkout session id in the path', async () => {
    fetchMock.mockResolvedValue(json(200, { status: 'open', mode: 'subscription' }));
    await api.getCheckoutStatus(ORG, 'cs_test_abc123');
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/billing\/checkout\/cs_test_abc123$/);
  });

  it('fails without a session token and never calls the API', async () => {
    const anon = new BillingAPI(() => null);
    const err = await anon.getOverview(ORG).catch((e) => e);
    expect(err).toBeInstanceOf(BillingApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
