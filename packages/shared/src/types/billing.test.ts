import { describe, it, expect } from 'vitest';
import {
  BILLING_PLAN_IDS,
  BILLING_INTERVALS,
  BILLING_SESSION_ID_RE,
  billingPlanChangeSchema,
} from './billing.js';

describe('billing contract', () => {
  it('exposes plan ids and intervals', () => {
    expect([...BILLING_PLAN_IDS]).toEqual(['free', 'pro', 'pro_plus']);
    expect([...BILLING_INTERVALS]).toEqual(['month', 'year']);
  });

  it('billingPlanChangeSchema accepts pro/year', () => {
    expect(billingPlanChangeSchema.safeParse({ plan: 'pro', interval: 'year' }).success).toBe(true);
    expect(billingPlanChangeSchema.safeParse({ plan: 'pro_plus', interval: 'month' }).success).toBe(true);
  });

  it('billingPlanChangeSchema rejects free', () => {
    expect(billingPlanChangeSchema.safeParse({ plan: 'free', interval: 'month' }).success).toBe(false);
  });

  it('billingPlanChangeSchema rejects unknown keys', () => {
    expect(billingPlanChangeSchema.safeParse({ plan: 'pro', interval: 'month', extra: 1 }).success).toBe(false);
  });

  it('BILLING_SESSION_ID_RE accepts Stripe session ids only', () => {
    expect(BILLING_SESSION_ID_RE.test('cs_live_a1B2')).toBe(true);
    expect(BILLING_SESSION_ID_RE.test('cs_')).toBe(false);
    expect(BILLING_SESSION_ID_RE.test('../x')).toBe(false);
  });
});
