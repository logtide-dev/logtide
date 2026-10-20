import { describe, it, expect } from 'vitest';
import type { BillingCurrentPlan } from '@logtide/shared';
import {
  planCta,
  formatMoney,
  annualSavingPercent,
  statusBadge,
  billingErrorMessage,
  formatCardBrand,
  invoiceStatusBadge,
  isCustomPlan,
  planTimeline,
  formatPlanPrice,
  safeExternalUrl,
  isCardExpired,
  canChangePlan,
  asSentence,
} from './billing';

const PERIOD_END = '2027-01-17T12:00:00.000Z';

const FREE: BillingCurrentPlan = {
  plan: 'free',
  source: 'free',
  interval: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  grandfatheredUntil: null,
  pastDueSince: null,
};

const PRO_MONTH: BillingCurrentPlan = {
  plan: 'pro',
  source: 'subscription',
  interval: 'month',
  status: 'active',
  currentPeriodEnd: PERIOD_END,
  cancelAtPeriodEnd: false,
  grandfatheredUntil: null,
  pastDueSince: null,
};

const GRANDFATHERED: BillingCurrentPlan = {
  plan: 'pro',
  source: 'grandfathered',
  interval: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  grandfatheredUntil: PERIOD_END,
  pastDueSince: null,
};

const base = { checkoutEnabled: true, publishableKey: 'pk_test_1' as string | null, interval: 'month' as const, isCustom: false };

describe('planCta', () => {
  it('free org + pro card -> subscribe', () => {
    expect(planCta({ ...base, card: 'pro', current: FREE })).toBe('subscribe');
  });

  it('free org + pro card with checkout disabled -> opening-soon', () => {
    expect(planCta({ ...base, checkoutEnabled: false, card: 'pro', current: FREE })).toBe('opening-soon');
  });

  it('no publishable key: subscribe cards -> opening-soon even with checkout enabled', () => {
    expect(planCta({ ...base, publishableKey: null, card: 'pro', current: FREE })).toBe('opening-soon');
    expect(planCta({ ...base, publishableKey: null, card: 'pro_plus', current: GRANDFATHERED })).toBe('opening-soon');
    expect(planCta({ ...base, publishableKey: null, card: 'free', current: FREE })).toBe('current');
  });

  it('switching does not need a publishable key', () => {
    expect(planCta({ ...base, publishableKey: null, card: 'pro_plus', current: PRO_MONTH })).toBe('switch');
  });

  it('free org + free card -> current', () => {
    expect(planCta({ ...base, card: 'free', current: FREE })).toBe('current');
  });

  it('pro month subscription + pro card month -> current', () => {
    expect(planCta({ ...base, card: 'pro', current: PRO_MONTH })).toBe('current');
  });

  it('pro month subscription + pro card year -> switch', () => {
    expect(planCta({ ...base, interval: 'year', card: 'pro', current: PRO_MONTH })).toBe('switch');
  });

  it('pro month subscription + pro_plus card -> switch', () => {
    expect(planCta({ ...base, card: 'pro_plus', current: PRO_MONTH })).toBe('switch');
  });

  it('switching does not depend on checkoutEnabled (it is not a checkout)', () => {
    expect(planCta({ ...base, checkoutEnabled: false, card: 'pro_plus', current: PRO_MONTH })).toBe('switch');
  });

  it('pro month subscription + free card -> downgrade-to-free', () => {
    expect(planCta({ ...base, card: 'free', current: PRO_MONTH })).toBe('downgrade-to-free');
  });

  it('already cancelling + free card -> none', () => {
    expect(planCta({ ...base, card: 'free', current: { ...PRO_MONTH, cancelAtPeriodEnd: true } })).toBe('none');
  });

  it('already cancelling + another paid card -> none (resume first)', () => {
    expect(planCta({ ...base, card: 'pro_plus', current: { ...PRO_MONTH, cancelAtPeriodEnd: true } })).toBe('none');
  });

  it('already cancelling + its own card stays current', () => {
    expect(planCta({ ...base, card: 'pro', current: { ...PRO_MONTH, cancelAtPeriodEnd: true } })).toBe('current');
  });

  it('grandfathered + pro card -> subscribe', () => {
    expect(planCta({ ...base, card: 'pro', current: GRANDFATHERED })).toBe('subscribe');
  });

  it('grandfathered + pro_plus card -> subscribe', () => {
    expect(planCta({ ...base, card: 'pro_plus', current: GRANDFATHERED })).toBe('subscribe');
  });

  it('grandfathered + free card -> none (nothing to cancel)', () => {
    expect(planCta({ ...base, card: 'free', current: GRANDFATHERED })).toBe('none');
  });

  it('isCustom -> none for every card', () => {
    for (const card of ['free', 'pro', 'pro_plus'] as const) {
      for (const current of [FREE, PRO_MONTH, GRANDFATHERED]) {
        expect(planCta({ ...base, isCustom: true, card, current })).toBe('none');
      }
    }
  });

  it('trialing subscription can still switch', () => {
    const trialing = { ...PRO_MONTH, status: 'trialing' };
    expect(planCta({ ...base, card: 'pro_plus', current: trialing })).toBe('switch');
    expect(planCta({ ...base, interval: 'year', card: 'pro', current: trialing })).toBe('switch');
  });

  // Billing answers 409 subscription_not_active to a change unless the
  // subscription is active or trialing: paid cards offer nothing then.
  for (const status of ['past_due', 'unpaid', 'incomplete', 'paused']) {
    it(`${status} subscription: paid cards -> none, own card stays current, free still cancels`, () => {
      const current = { ...PRO_MONTH, status };
      expect(planCta({ ...base, card: 'pro_plus', current })).toBe('none');
      expect(planCta({ ...base, interval: 'year', card: 'pro', current })).toBe('none');
      expect(planCta({ ...base, card: 'pro', current })).toBe('current');
      expect(planCta({ ...base, card: 'free', current })).toBe('downgrade-to-free');
    });
  }
});

describe('canChangePlan', () => {
  it('only active and trialing subscriptions can change plan', () => {
    expect(canChangePlan(PRO_MONTH)).toBe(true);
    expect(canChangePlan({ ...PRO_MONTH, status: 'trialing' })).toBe(true);
    expect(canChangePlan({ ...PRO_MONTH, status: 'past_due' })).toBe(false);
    expect(canChangePlan({ ...PRO_MONTH, status: 'incomplete' })).toBe(false);
    expect(canChangePlan(FREE)).toBe(false);
    expect(canChangePlan(GRANDFATHERED)).toBe(false);
  });
});

describe('formatMoney', () => {
  it('formats USD minor units', () => {
    expect(formatMoney(2900, 'usd')).toBe('$29.00');
    expect(formatMoney(94800, 'usd')).toBe('$948.00');
    expect(formatMoney(0, 'usd')).toBe('$0.00');
  });

  it('formats thousands with en-US separators', () => {
    expect(formatMoney(123456, 'usd')).toBe('$1,234.56');
  });

  it('respects zero-decimal currencies', () => {
    expect(formatMoney(500, 'jpy')).toBe('¥500');
  });

  it('falls back to a plain amount for an unknown currency code', () => {
    expect(formatMoney(2900, 'not a code')).toBe('29.00 NOT A CODE');
  });
});

describe('annualSavingPercent', () => {
  it('rounds the saving of the annual price', () => {
    expect(annualSavingPercent(2900, 28800)).toBe(17);
    expect(annualSavingPercent(9900, 94800)).toBe(20);
  });

  it('never goes negative and survives a zero monthly price', () => {
    expect(annualSavingPercent(1000, 13000)).toBe(0);
    expect(annualSavingPercent(0, 0)).toBe(0);
  });
});

describe('statusBadge', () => {
  it('active subscription', () => {
    expect(statusBadge(PRO_MONTH)).toEqual({ label: 'Active', variant: 'default' });
  });

  it('cancel at period end shows the end date', () => {
    expect(statusBadge({ ...PRO_MONTH, cancelAtPeriodEnd: true }).label).toBe('Cancels on Jan 17, 2027');
  });

  it('past due is destructive', () => {
    expect(statusBadge({ ...PRO_MONTH, status: 'past_due' })).toEqual({ label: 'Past due', variant: 'destructive' });
  });

  it('past due wins over a pending cancellation', () => {
    expect(statusBadge({ ...PRO_MONTH, status: 'past_due', cancelAtPeriodEnd: true }).label).toBe('Past due');
  });

  it('grandfathered shows the grant end', () => {
    expect(statusBadge(GRANDFATHERED).label).toBe('Free until Jan 17, 2027');
  });

  it('a grandfathered org that bought pro stays free until the grant ends', () => {
    expect(
      statusBadge({ ...PRO_MONTH, status: 'trialing', grandfatheredUntil: PERIOD_END }).label
    ).toBe('Free until Jan 17, 2027');
  });

  it('free plan', () => {
    expect(statusBadge(FREE)).toEqual({ label: 'Active', variant: 'secondary' });
  });

  it('unknown Stripe statuses get a neutral label from the raw status', () => {
    expect(statusBadge({ ...PRO_MONTH, status: 'paused' })).toEqual({ label: 'Paused', variant: 'outline' });
    expect(statusBadge({ ...PRO_MONTH, status: 'canceled' })).toEqual({ label: 'Canceled', variant: 'outline' });
    expect(statusBadge({ ...PRO_MONTH, status: 'incomplete_expired' }).label).toBe('Incomplete expired');
  });
});

describe('billingErrorMessage', () => {
  it('maps the known codes', () => {
    expect(billingErrorMessage('checkout_disabled')).toBe('Paid plans are opening soon');
    expect(billingErrorMessage('billing_unavailable')).toBe('Billing is temporarily unavailable');
    expect(billingErrorMessage('subscription_exists')).toBe('This organization already has a subscription');
    expect(billingErrorMessage('payment_action_required')).toBe('Your bank needs to confirm the payment');
  });

  it('maps plan-change refusals', () => {
    expect(billingErrorMessage('subscription_not_active')).toBe('Update your payment method before changing plans.');
    expect(billingErrorMessage('billing_busy')).toBe('Another billing change is in progress. Try again in a moment.');
    expect(billingErrorMessage('payment_pending')).toBe(
      'A plan change is waiting for payment. Complete that payment or wait for it to expire before cancelling.'
    );
  });

  it('falls back to a generic message', () => {
    expect(billingErrorMessage('something_new')).toBe('Something went wrong with billing');
    expect(billingErrorMessage('')).toBe('Something went wrong with billing');
  });

  it('prefers the server message for unknown codes, never for known ones', () => {
    expect(billingErrorMessage('something_new', 'The server explains it')).toBe('The server explains it');
    expect(billingErrorMessage('something_new', '')).toBe('Something went wrong with billing');
    expect(billingErrorMessage('checkout_disabled', 'Checkout is closed')).toBe('Paid plans are opening soon');
  });
});

describe('asSentence', () => {
  it('adds a final period only when missing', () => {
    expect(asSentence('Billing is temporarily unavailable')).toBe('Billing is temporarily unavailable.');
    expect(asSentence('Try again in a moment.')).toBe('Try again in a moment.');
    expect(asSentence('Really?')).toBe('Really?');
  });
});

describe('formatCardBrand', () => {
  it('names the common brands', () => {
    expect(formatCardBrand('visa')).toBe('Visa');
    expect(formatCardBrand('amex')).toBe('American Express');
    expect(formatCardBrand('mastercard')).toBe('Mastercard');
  });

  it('capitalizes anything else', () => {
    expect(formatCardBrand('somecard')).toBe('Somecard');
    expect(formatCardBrand('')).toBe('Card');
  });
});

describe('invoiceStatusBadge', () => {
  it('maps Stripe invoice statuses', () => {
    expect(invoiceStatusBadge('paid')).toEqual({ label: 'Paid', variant: 'secondary' });
    expect(invoiceStatusBadge('open')).toEqual({ label: 'Open', variant: 'outline' });
    expect(invoiceStatusBadge('uncollectible')).toEqual({ label: 'Uncollectible', variant: 'destructive' });
    expect(invoiceStatusBadge(null)).toEqual({ label: 'Unknown', variant: 'outline' });
  });
});

describe('isCustomPlan', () => {
  const telemetry = (limit: number | null) => [
    { capability: 'telemetry.max_bytes_monthly', kind: 'quota' as const, current: 0, limit, description: '' },
  ];

  it('free with no subscription and an unlimited telemetry quota is custom', () => {
    expect(isCustomPlan(FREE, telemetry(null))).toBe(true);
  });

  it('a capped telemetry quota is the regular free plan', () => {
    expect(isCustomPlan(FREE, telemetry(10_737_418_240))).toBe(false);
  });

  it('unknown capabilities are never custom', () => {
    expect(isCustomPlan(FREE, null)).toBe(false);
    expect(isCustomPlan(FREE, [])).toBe(false);
  });

  it('subscribed and grandfathered orgs are never custom', () => {
    expect(isCustomPlan(PRO_MONTH, telemetry(null))).toBe(false);
    expect(isCustomPlan(GRANDFATHERED, telemetry(null))).toBe(false);
  });
});

describe('planTimeline', () => {
  it('active subscription renews', () => {
    expect(planTimeline(PRO_MONTH)).toEqual({
      label: 'Renews on',
      value: 'Jan 17, 2027',
      note: 'Renews automatically',
    });
  });

  it('cancelling subscription ends', () => {
    expect(planTimeline({ ...PRO_MONTH, cancelAtPeriodEnd: true })).toMatchObject({
      label: 'Ends on',
      value: 'Jan 17, 2027',
    });
  });

  it('grandfathered org that bought pro is first charged at the period end', () => {
    expect(planTimeline({ ...PRO_MONTH, status: 'trialing', grandfatheredUntil: PERIOD_END })).toMatchObject({
      label: 'First charge on',
      value: 'Jan 17, 2027',
    });
  });

  it('past due points at the overdue date', () => {
    expect(
      planTimeline({ ...PRO_MONTH, status: 'past_due', pastDueSince: '2026-12-20T12:00:00.000Z' })
    ).toMatchObject({ label: 'Overdue since', value: 'Dec 20, 2026' });
  });

  it('grandfathered and free', () => {
    expect(planTimeline(GRANDFATHERED)).toMatchObject({ label: 'Free until', value: 'Jan 17, 2027' });
    expect(planTimeline(FREE)).toMatchObject({ label: 'Next invoice', value: 'None' });
  });
});

describe('formatPlanPrice', () => {
  it('drops the cents of whole amounts', () => {
    expect(formatPlanPrice(2900, 'usd')).toBe('$29');
    expect(formatPlanPrice(0, 'usd')).toBe('$0');
  });

  it('keeps cents when there are any', () => {
    expect(formatPlanPrice(2450, 'usd')).toBe('$24.50');
  });
});

describe('safeExternalUrl', () => {
  it('keeps https links only', () => {
    expect(safeExternalUrl('https://invoice.stripe.com/i/1')).toBe('https://invoice.stripe.com/i/1');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('http://invoice.stripe.com/i/1')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe('isCardExpired', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');

  it('a card is valid through the end of its expiry month', () => {
    expect(isCardExpired({ expMonth: 10, expYear: 2026 }, now)).toBe(false);
    expect(isCardExpired({ expMonth: 9, expYear: 2026 }, now)).toBe(true);
    expect(isCardExpired({ expMonth: 1, expYear: 2027 }, now)).toBe(false);
  });
});
