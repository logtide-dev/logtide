import type { BillingCurrentPlan, BillingInterval, BillingPlanId } from '@logtide/shared';

/** What a plan card offers, given the org's current plan. */
export type PlanCta = 'current' | 'subscribe' | 'switch' | 'downgrade-to-free' | 'opening-soon' | 'none';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export interface BadgeInfo {
  label: string;
  variant: BadgeVariant;
}

/** The combined quota of hosted plans, used to tell a custom plan apart. */
export const TELEMETRY_QUOTA = 'telemetry.max_bytes_monthly';

/**
 * CTA of one plan card.
 *
 * - No subscription (free or grandfathered): paid cards offer Subscribe, or
 *   "opening soon" while sales are closed or the billing service has no
 *   Stripe publishable key (the embedded checkout cannot mount without one,
 *   and checkout would answer 503 billing_not_configured). A grandfathered org buys Pro through
 *   the same checkout (the billing service defers the first charge to the end
 *   of the grant).
 * - Subscription: the same plan and interval is "current", the free card
 *   cancels at period end, any other paid card switches. Switching is not a
 *   checkout, so it does not depend on checkoutEnabled.
 * - A subscription already set to cancel offers nothing but its own card:
 *   switching would keep the pending cancellation and end the new plan at the
 *   period end, so the user resumes first (Resume lives on the plan card).
 * - A subscription that is not active or trialing (past due, unpaid, ...)
 *   cannot change plan (billing answers 409 subscription_not_active): paid
 *   cards offer nothing until the card is fixed; cancelling stays possible.
 * - Custom plans (limits set by LogTide) offer nothing.
 */
export function planCta(input: {
  card: BillingPlanId;
  current: BillingCurrentPlan;
  checkoutEnabled: boolean;
  publishableKey: string | null;
  interval: BillingInterval;
  isCustom: boolean;
}): PlanCta {
  const { card, current, interval, isCustom } = input;
  if (isCustom) return 'none';

  if (current.source !== 'subscription') {
    if (card === 'free') return current.source === 'free' ? 'current' : 'none';
    return salesOpen(input) ? 'subscribe' : 'opening-soon';
  }

  if (card === current.plan && interval === current.interval) return 'current';
  if (current.cancelAtPeriodEnd) return 'none';
  if (card === 'free') return 'downgrade-to-free';
  return canChangePlan(current) ? 'switch' : 'none';
}

/** New subscriptions need sales open and a Stripe publishable key to mount the checkout. */
export function salesOpen(input: { checkoutEnabled: boolean; publishableKey: string | null }): boolean {
  return input.checkoutEnabled && Boolean(input.publishableKey);
}

/** Plan and interval changes need an active or trialing subscription. */
export function canChangePlan(current: BillingCurrentPlan): boolean {
  return current.source === 'subscription' && (current.status === 'active' || current.status === 'trialing');
}

/** Money from minor units, en-US, honoring the currency's decimal places. */
export function formatMoney(amountMinor: number, currency: string): string {
  const code = currency.toUpperCase();
  try {
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    return fmt.format(amountMinor / 10 ** digits);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${code}`;
  }
}

/** Whole percent saved by paying yearly instead of twelve months. */
export function annualSavingPercent(month: number, year: number): number {
  if (month <= 0) return 0;
  return Math.max(0, Math.round((1 - year / (month * 12)) * 100));
}

/** "Jan 17, 2027", in the viewer's time zone. */
export function formatBillingDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Status badge of the current plan. */
export function statusBadge(current: BillingCurrentPlan): BadgeInfo {
  if (current.source === 'free') return { label: 'Active', variant: 'secondary' };
  if (current.source === 'grandfathered') {
    const until = formatBillingDate(current.grandfatheredUntil);
    return { label: until ? `Free until ${until}` : 'Included', variant: 'secondary' };
  }

  switch (current.status) {
    case 'past_due':
      return { label: 'Past due', variant: 'destructive' };
    case 'unpaid':
      return { label: 'Unpaid', variant: 'destructive' };
    case 'incomplete':
      return { label: 'Payment pending', variant: 'outline' };
  }

  // Any other Stripe status (paused, canceled, ...) is shown as it is rather
  // than passing for Active.
  if (current.status && current.status !== 'active' && current.status !== 'trialing') {
    const words = current.status.replace(/_/g, ' ');
    return { label: words.charAt(0).toUpperCase() + words.slice(1), variant: 'outline' };
  }

  const end = formatBillingDate(current.currentPeriodEnd);
  if (current.cancelAtPeriodEnd && end) return { label: `Cancels on ${end}`, variant: 'outline' };

  // A grandfathered org that bought Pro is in a trial that ends with the grant.
  const until = formatBillingDate(current.grandfatheredUntil);
  if (current.status === 'trialing' && until) return { label: `Free until ${until}`, variant: 'secondary' };

  return { label: 'Active', variant: 'default' };
}

const ERROR_MESSAGES: Record<string, string> = {
  checkout_disabled: 'Paid plans are opening soon',
  billing_unavailable: 'Billing is temporarily unavailable',
  subscription_exists: 'This organization already has a subscription',
  payment_action_required: 'Your bank needs to confirm the payment',
  billing_forbidden: 'Only organization owners and admins can manage billing',
  billing_not_configured: 'Billing is not fully set up yet',
  no_subscription: 'This organization has no active subscription',
  no_customer: 'Subscribe to a plan before adding a card',
  same_plan: 'You are already on this plan',
  subscription_not_active: 'Update your payment method before changing plans.',
  billing_busy: 'Another billing change is in progress. Try again in a moment.',
  rate_limited: 'Too many requests. Try again in a minute.',
  payment_pending:
    'A plan change is waiting for payment. Complete that payment or wait for it to expire before cancelling.',
};

/**
 * Plain message for a billing error code (toasts, inline errors). Known codes
 * always get our wording; an unknown code falls back to the server's human
 * message when there is one, else to a generic line.
 */
export function billingErrorMessage(code: string, serverMessage?: string | null): string {
  return ERROR_MESSAGES[code] ?? (serverMessage || 'Something went wrong with billing');
}

/** Ends a message with a period unless it already ends with punctuation. */
export function asSentence(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

const CARD_BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  cartes_bancaires: 'Cartes Bancaires',
};

export function formatCardBrand(brand: string): string {
  if (!brand) return 'Card';
  return CARD_BRANDS[brand.toLowerCase()] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** Badge of a Stripe invoice status. */
export function invoiceStatusBadge(status: string | null): BadgeInfo {
  switch (status) {
    case 'paid':
      return { label: 'Paid', variant: 'secondary' };
    case 'open':
      return { label: 'Open', variant: 'outline' };
    case 'draft':
      return { label: 'Draft', variant: 'outline' };
    case 'void':
      return { label: 'Void', variant: 'outline' };
    case 'uncollectible':
      return { label: 'Uncollectible', variant: 'destructive' };
    default:
      return { label: 'Unknown', variant: 'outline' };
  }
}

/**
 * A "custom" plan is one LogTide manages by hand: the billing service reports
 * plain Free (no subscription, no grant) but the org's combined telemetry quota
 * is unlimited. Unknown capabilities (not loaded, or no telemetry row) are
 * never custom, so a failed usage call cannot hide the plan picker.
 */
export function isCustomPlan(
  current: BillingCurrentPlan,
  capabilities: Array<{ capability: string; limit: number | null }> | null
): boolean {
  if (current.source !== 'free' || current.plan !== 'free') return false;
  const telemetry = capabilities?.find((c) => c.capability === TELEMETRY_QUOTA);
  return telemetry !== undefined && telemetry.limit === null;
}

export interface PlanTimeline {
  label: string;
  value: string;
  note: string;
}

/** Third tile of the current plan card: what happens next, and when. */
export function planTimeline(current: BillingCurrentPlan): PlanTimeline {
  if (current.source === 'free') {
    return { label: 'Next invoice', value: 'None', note: 'Upgrade any time' };
  }
  if (current.source === 'grandfathered') {
    return {
      label: 'Free until',
      value: formatBillingDate(current.grandfatheredUntil) || 'Not set',
      note: 'Subscribe before then to keep Pro',
    };
  }

  const end = formatBillingDate(current.currentPeriodEnd) || 'Not set';
  if (current.status === 'past_due' || current.status === 'unpaid') {
    return {
      label: 'Overdue since',
      value: formatBillingDate(current.pastDueSince) || end,
      note: 'Update your card to keep your plan',
    };
  }
  if (current.status === 'incomplete') {
    return { label: 'First payment', value: 'Pending', note: 'Waiting for the payment to complete' };
  }
  if (current.cancelAtPeriodEnd) {
    return { label: 'Ends on', value: end, note: 'Then the Free plan limits apply' };
  }
  if (current.status === 'trialing') {
    return { label: 'First charge on', value: end, note: 'No charge until then' };
  }
  return { label: 'Renews on', value: end, note: 'Renews automatically' };
}

/** Plan card price: "$29" for whole amounts, "$24.50" otherwise. */
export function formatPlanPrice(amountMinor: number, currency: string): string {
  const full = formatMoney(amountMinor, currency);
  return full.replace(/\.00(?=\D*$)/, '');
}

/** Only https links from the billing service are rendered as hrefs. */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Cards are valid through the last day of their expiry month. */
export function isCardExpired(card: { expMonth: number; expYear: number }, now: Date = new Date()): boolean {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return card.expYear < year || (card.expYear === year && card.expMonth < month);
}
