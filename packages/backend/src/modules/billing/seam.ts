import { config } from '../../config/index.js';

type BillingApiConfig = { LOGTIDE_BILLING_API_URL?: string; LOGTIDE_BILLING_API_TOKEN?: string };

/**
 * The in-app billing proxy is active only when BOTH the billing service URL
 * and its bearer token are configured. Read at call time so the answer always
 * reflects config.
 */
export function isBillingApiActive(): boolean {
  const c = config as BillingApiConfig;
  return Boolean(c.LOGTIDE_BILLING_API_URL && c.LOGTIDE_BILLING_API_TOKEN);
}
