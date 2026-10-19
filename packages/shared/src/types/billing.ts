import { z } from 'zod';

/**
 * Contract between the core billing proxy, the frontend and an external
 * billing service (see docs/cloud-seams.md, "In-app billing").
 */

export const BILLING_PLAN_IDS = ['free', 'pro', 'pro_plus'] as const;
export type BillingPlanId = (typeof BILLING_PLAN_IDS)[number];

export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Body of checkout, preview and change. Only paid plans can be purchased. */
export const billingPlanChangeSchema = z
  .object({
    plan: z.enum(['pro', 'pro_plus']),
    interval: z.enum(['month', 'year']),
  })
  .strict();
export type BillingPlanChangeInput = z.infer<typeof billingPlanChangeSchema>;

/** Checkout session ids are validated before they are put into a URL path. */
export const BILLING_SESSION_ID_RE = /^cs_[A-Za-z0-9_]{1,200}$/;

export type BillingSource = 'free' | 'subscription' | 'grandfathered';

export interface BillingCurrentPlan {
  plan: BillingPlanId;
  source: BillingSource;
  interval: BillingInterval | null;
  /** Stripe subscription status when source is "subscription". */
  status: string | null;
  /** ISO timestamp. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** ISO timestamp, when a grant exists (may coexist with a subscription). */
  grandfatheredUntil: string | null;
  pastDueSince: string | null;
}

export interface BillingPaymentMethod {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface BillingPrice {
  /** Minor units (cents). */
  amount: number;
  currency: string;
}

export interface BillingPlanInfo {
  id: BillingPlanId;
  name: string;
  tagline: string;
  /** Null for the free plan. */
  prices: { month: BillingPrice; year: BillingPrice } | null;
  highlights: string[];
}

export interface BillingOverview {
  checkoutEnabled: boolean;
  /** Stripe publishable key, null when not configured. */
  publishableKey: string | null;
  current: BillingCurrentPlan;
  paymentMethod: BillingPaymentMethod | null;
  plans: BillingPlanInfo[];
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** Minor units. */
  total: number;
  currency: string;
  status: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

export interface BillingCheckoutSession {
  clientSecret: string;
  publishableKey: string;
}

export interface BillingCheckoutStatus {
  status: 'open' | 'complete' | 'expired';
  mode: 'subscription' | 'setup';
}

export interface BillingPreview {
  /** Minor units. */
  amountDue: number;
  currency: string;
  immediate: boolean;
}
