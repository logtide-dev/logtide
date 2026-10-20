import { config } from '../../config/index.js';
import { hub } from '@logtide/core';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';

export const BILLING_TIMEOUT_MS = 15_000;

export interface ForwardToBillingOptions {
  method: 'GET' | 'POST';
  orgId: string;
  /** Path after `/billing`: '' or '/invoices', '/checkout/cs_x', ... */
  tail: string;
  body?: unknown;
  caller: { id: string; email: string; role: 'owner' | 'admin' };
  timeoutMs?: number;
}

export interface ForwardToBillingResult {
  status: number;
  body: unknown;
}

const UNAVAILABLE: ForwardToBillingResult = {
  status: 502,
  body: { error: 'billing_unavailable', message: 'Billing is temporarily unavailable' },
};

function unavailable(): ForwardToBillingResult {
  return { status: UNAVAILABLE.status, body: { ...(UNAVAILABLE.body as object) } };
}

/**
 * 503 codes that are part of the billing contract (the page has its own copy
 * for them). Any other 5xx stays a generic 502.
 */
const PASS_THROUGH_503_CODES = new Set(['checkout_disabled', 'billing_not_configured']);

function isContract503(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const code = (body as { error?: unknown }).error;
  return typeof code === 'string' && PASS_THROUGH_503_CODES.has(code);
}

/**
 * Forward one call to the external billing service. 2xx and 4xx pass through
 * with their status and body, except 401/403 (a broken service credential, see
 * below). A 503 whose JSON `error` is `checkout_disabled` or
 * `billing_not_configured` passes through unchanged; every other 5xx,
 * unexpected statuses, timeouts and network errors collapse into a generic 502
 * (the upstream detail is never leaked).
 */
export async function forwardToBilling(opts: ForwardToBillingOptions): Promise<ForwardToBillingResult> {
  const cfg = config as { LOGTIDE_BILLING_API_URL?: string; LOGTIDE_BILLING_API_TOKEN?: string };
  if (!cfg.LOGTIDE_BILLING_API_URL || !cfg.LOGTIDE_BILLING_API_TOKEN) return unavailable();

  const base = cfg.LOGTIDE_BILLING_API_URL.replace(/\/+$/, '');
  const tail = opts.tail
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const url = `${base}/api/v1/orgs/${encodeURIComponent(opts.orgId)}/billing${tail}`;

  const headers: Record<string, string> = {
    authorization: `Bearer ${cfg.LOGTIDE_BILLING_API_TOKEN}`,
    'x-logtide-user-id': opts.caller.id,
    'x-logtide-user-email': opts.caller.email,
    'x-logtide-user-role': opts.caller.role,
    accept: 'application/json',
  };
  let payload: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(opts.body);
  } else if (opts.method === 'POST') {
    headers['content-type'] = 'application/json';
    payload = '{}';
  }

  try {
    const res = await fetch(url, {
      method: opts.method,
      headers,
      body: payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? BILLING_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      // Service-to-service auth is broken (token mismatch). Never pass this to
      // the browser: it would read a 401 as an expired LogTide session.
      if (isInternalLoggingEnabled()) {
        hub.captureLog('error', 'billing service rejected the core credentials', { status: res.status, orgId: opts.orgId });
      }
      await res.body?.cancel().catch(() => undefined);
      return unavailable();
    }
    if (res.status === 503) {
      const text = await res.text().catch(() => '');
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        return unavailable();
      }
      return isContract503(body) ? { status: 503, body } : unavailable();
    }
    if (res.status < 200 || res.status >= 500 || (res.status >= 300 && res.status < 400)) {
      await res.body?.cancel().catch(() => undefined);
      return unavailable();
    }
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return unavailable();
      }
    }
    return { status: res.status, body };
  } catch {
    return unavailable();
  }
}
