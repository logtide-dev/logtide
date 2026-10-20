import {
  BILLING_SESSION_ID_RE,
  type BillingCheckoutSession,
  type BillingCheckoutStatus,
  type BillingInterval,
  type BillingInvoice,
  type BillingOverview,
  type BillingPreview,
} from '@logtide/shared';
import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import { billingErrorMessage } from '$lib/utils/billing';

export type PaidPlanId = 'pro' | 'pro_plus';

/**
 * Error of an in-app billing call. `code` is the contract code from the
 * `{ error, message }` body (e.g. `checkout_disabled`), or `billing_unavailable`
 * when the service could not be reached, or `http_<status>` otherwise.
 */
export class BillingApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Set on 402 payment_action_required: where the customer confirms the payment. */
  readonly hostedInvoiceUrl: string | null;

  constructor(status: number, code: string, message: string, hostedInvoiceUrl: string | null = null) {
    super(message);
    this.name = 'BillingApiError';
    this.status = status;
    this.code = code;
    this.hostedInvoiceUrl = hostedInvoiceUrl;
  }
}

/** User-facing text for any error thrown by a billing call. */
export function billingErrorText(e: unknown): string {
  return e instanceof BillingApiError ? billingErrorMessage(e.code, e.message) : billingErrorMessage('');
}

const CODE_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Client of the core's /organizations/:id/billing routes.
 *
 * The core maps billing service auth failures to 502, so a 401 here is the
 * user's own expired session and the global fetch interceptor handles it like
 * any other API call.
 */
export class BillingAPI {
  constructor(private getToken: () => string | null) {}

  private async request<T>(orgId: string, tail: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
    const token = this.getToken();
    if (!token) {
      throw new BillingApiError(0, 'not_signed_in', 'You are not signed in');
    }

    let response: Response;
    try {
      response = await fetch(`${getApiBaseUrl()}/organizations/${encodeURIComponent(orgId)}/billing${tail}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${token}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new BillingApiError(0, 'billing_unavailable', billingErrorMessage('billing_unavailable'));
    }

    // The core's own rate limit (60 per minute per session): its body is the
    // framework's, not a billing contract code.
    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      throw new BillingApiError(429, 'rate_limited', billingErrorMessage('rate_limited'));
    }

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: unknown; message?: unknown; hostedInvoiceUrl?: unknown }
        | null;
      const contractCode = typeof data?.error === 'string' && CODE_RE.test(data.error) ? data.error : null;
      const code = contractCode ?? (response.status >= 500 ? 'billing_unavailable' : `http_${response.status}`);
      const message =
        contractCode && typeof data?.message === 'string' && data.message ? data.message : billingErrorMessage(code);
      const hostedInvoiceUrl = typeof data?.hostedInvoiceUrl === 'string' ? data.hostedInvoiceUrl : null;
      throw new BillingApiError(response.status, code, message, hostedInvoiceUrl);
    }

    return (await response.json()) as T;
  }

  getOverview(orgId: string): Promise<BillingOverview> {
    return this.request(orgId, '');
  }

  getInvoices(orgId: string): Promise<{ invoices: BillingInvoice[] }> {
    return this.request(orgId, '/invoices');
  }

  startCheckout(orgId: string, plan: PaidPlanId, interval: BillingInterval): Promise<BillingCheckoutSession> {
    return this.request(orgId, '/checkout', 'POST', { plan, interval });
  }

  async getCheckoutStatus(orgId: string, sessionId: string): Promise<BillingCheckoutStatus> {
    if (!BILLING_SESSION_ID_RE.test(sessionId)) {
      throw new BillingApiError(0, 'invalid_session', billingErrorMessage('invalid_session'));
    }
    return this.request(orgId, `/checkout/${sessionId}`);
  }

  preview(orgId: string, plan: PaidPlanId, interval: BillingInterval): Promise<BillingPreview> {
    return this.request(orgId, '/preview', 'POST', { plan, interval });
  }

  changePlan(orgId: string, plan: PaidPlanId, interval: BillingInterval): Promise<BillingOverview> {
    return this.request(orgId, '/change', 'POST', { plan, interval });
  }

  cancel(orgId: string): Promise<BillingOverview> {
    return this.request(orgId, '/cancel', 'POST');
  }

  resume(orgId: string): Promise<BillingOverview> {
    return this.request(orgId, '/resume', 'POST');
  }

  startPaymentMethodUpdate(orgId: string): Promise<BillingCheckoutSession> {
    return this.request(orgId, '/payment-method', 'POST');
  }
}

export const billingAPI = new BillingAPI(getAuthToken);
