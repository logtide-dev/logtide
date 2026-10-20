import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/svelte';
import type { BillingOverview, BillingCurrentPlan, BillingInvoice } from '@logtide/shared';

const { billingAPI, getCapabilityUsage } = vi.hoisted(() => ({
  billingAPI: {
    getOverview: vi.fn(),
    getInvoices: vi.fn(),
    startCheckout: vi.fn(),
    getCheckoutStatus: vi.fn(),
    preview: vi.fn(),
    changePlan: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    startPaymentMethodUpdate: vi.fn(),
  },
  getCapabilityUsage: vi.fn(),
}));

vi.mock('$lib/api/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/api/billing')>()),
  billingAPI,
}));
vi.mock('$lib/api/usage', () => ({ getCapabilityUsage }));
const { initEmbeddedCheckout } = vi.hoisted(() => ({
  initEmbeddedCheckout: vi.fn(async () => ({ mount: vi.fn(), destroy: vi.fn() })),
}));
vi.mock('$lib/utils/stripe-loader', () => ({
  loadStripeOnce: vi.fn(async () => ({ initEmbeddedCheckout })),
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './+page.svelte';
import { BillingApiError } from '$lib/api/billing';
import { authStore } from '$lib/stores/auth';
import { toastStore } from '$lib/stores/toast';
import { organizationStore } from '$lib/stores/organization';
import { billingVat } from '$lib/stores/billing-vat';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD_END = '2027-01-17T12:00:00.000Z';
const GB = 1_073_741_824;

const org = (role: 'owner' | 'admin' | 'member') => ({
  id: ORG_ID,
  name: 'Acme',
  slug: 'acme',
  ownerId: 'user-1',
  role,
  retentionDays: 30,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

const PLANS: BillingOverview['plans'] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'For side projects and evaluation',
    prices: null,
    highlights: ['10 GB / month of logs, traces and metrics', '7-day retention'],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For production teams',
    prices: { month: { amount: 2900, currency: 'usd' }, year: { amount: 28800, currency: 'usd' } },
    highlights: ['100 GB / month of logs, traces and metrics', '30-day retention'],
  },
  {
    id: 'pro_plus',
    name: 'Pro Plus',
    tagline: 'For high-volume workloads',
    prices: { month: { amount: 9900, currency: 'usd' }, year: { amount: 94800, currency: 'usd' } },
    highlights: ['400 GB / month of logs, traces and metrics', '90-day retention'],
  },
];

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

function overview(current: BillingCurrentPlan, extra: Partial<BillingOverview> = {}): BillingOverview {
  return {
    checkoutEnabled: true,
    publishableKey: 'pk_test_123',
    current,
    paymentMethod: current.source === 'subscription' ? { brand: 'visa', last4: '4242', expMonth: 4, expYear: 2028 } : null,
    plans: PLANS,
    ...extra,
  };
}

const INVOICE: BillingInvoice = {
  id: 'in_1',
  number: 'LT-0001',
  createdAt: '2026-12-17T12:00:00.000Z',
  total: 2900,
  currency: 'usd',
  status: 'paid',
  hostedInvoiceUrl: 'https://invoice.stripe.com/i/1',
  invoicePdf: 'https://pay.stripe.com/invoice/1/pdf',
};

function telemetry(limit: number | null, current = 3 * GB) {
  return {
    capabilities: [
      { capability: 'telemetry.max_bytes_monthly', kind: 'quota', current, limit, description: '', state: 'ok' },
    ],
  };
}

function setup(role: 'owner' | 'admin' | 'member' = 'owner') {
  organizationStore.setCurrentOrganization(org(role) as never);
  return render(Page);
}

describe('billing settings page', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const fn of Object.values(billingAPI)) fn.mockReset();
    getCapabilityUsage.mockReset();
    authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
    organizationStore.clear();
    billingAPI.getInvoices.mockResolvedValue({ invoices: [] });
    getCapabilityUsage.mockResolvedValue(telemetry(100 * GB));
    vi.restoreAllMocks();
    vi.spyOn(toastStore, 'success').mockImplementation(() => undefined);
    vi.spyOn(toastStore, 'error').mockImplementation(() => undefined);
    // Deterministic VAT view: business outside the EU unless a test picks otherwise.
    localStorage.setItem('logtide_billing_vat', JSON.stringify({ audience: 'business', country: 'OUT' }));
    billingVat.reload();
  });

  it('renders current plan, plans and invoices', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(PRO_MONTH));
    billingAPI.getInvoices.mockResolvedValue({ invoices: [INVOICE] });

    setup('owner');

    expect(await screen.findByText('LT-0001')).toBeInTheDocument();
    expect(billingAPI.getOverview).toHaveBeenCalledWith(ORG_ID);
    expect(billingAPI.getInvoices).toHaveBeenCalledWith(ORG_ID);

    // Current plan card
    expect(screen.getByRole('heading', { name: 'Current plan' })).toBeInTheDocument();
    expect(screen.getByText('Visa ending in 4242')).toBeInTheDocument();
    expect(screen.getAllByText('Renews on').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Jan 17, 2027').length).toBeGreaterThan(0);

    // Usage summary
    expect(screen.getByText('3.00 GB / 100.00 GB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view usage/i }).getAttribute('href')).toBe('/dashboard/settings/usage');

    // Plans
    expect(screen.getByRole('heading', { name: 'Pro Plus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to Pro Plus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Downgrade to Free' })).toBeInTheDocument();
    expect(
      screen.getByText('Prices exclude taxes. Applicable taxes are calculated at checkout from your billing address.')
    ).toBeInTheDocument();

    // Invoices
    const row = screen.getByText('LT-0001').closest('tr')!;
    expect(within(row).getByText('$29.00')).toBeInTheDocument();
    expect(within(row).getByText('Paid')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /view/i }).getAttribute('href')).toBe(INVOICE.hostedInvoiceUrl);
    expect(within(row).getByRole('link', { name: /pdf/i }).getAttribute('href')).toBe(INVOICE.invoicePdf);
  });

  it('overview failure shows unavailable state', async () => {
    billingAPI.getOverview.mockRejectedValue(
      new BillingApiError(502, 'billing_unavailable', 'Billing is temporarily unavailable')
    );

    setup('owner');

    expect(await screen.findByText('Billing is temporarily unavailable')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });

    billingAPI.getOverview.mockResolvedValue(overview(FREE));
    await fireEvent.click(retry);

    await waitFor(() => expect(billingAPI.getOverview).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Pro Plus' })).toBeInTheDocument();
  });

  it('member sees no billing actions', async () => {
    setup('member');

    expect(
      await screen.findByText('Only organization owners and admins can manage billing.')
    ).toBeInTheDocument();
    expect(billingAPI.getOverview).not.toHaveBeenCalled();
    expect(billingAPI.getInvoices).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /cancel subscription/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull();
  });

  it('custom org hides the picker', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(FREE));
    getCapabilityUsage.mockResolvedValue(telemetry(null));

    setup('owner');

    expect(await screen.findByText(/Custom plan/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pro Plus' })).toBeNull();
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull();
  });

  it('cancel flow calls cancel after confirmation', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(PRO_MONTH));
    billingAPI.cancel.mockResolvedValue(overview({ ...PRO_MONTH, cancelAtPeriodEnd: true }));

    setup('owner');

    await fireEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/keeps Pro until Jan 17, 2027/)).toBeInTheDocument();
    expect(billingAPI.cancel).not.toHaveBeenCalled();

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }));

    await waitFor(() => expect(billingAPI.cancel).toHaveBeenCalledWith(ORG_ID));
    expect(billingAPI.cancel).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Cancels on Jan 17, 2027')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume subscription' })).toBeInTheDocument();
  });

  it('resume calls resume and shows the renewal again', async () => {
    billingAPI.getOverview.mockResolvedValue(overview({ ...PRO_MONTH, cancelAtPeriodEnd: true }));
    billingAPI.resume.mockResolvedValue(overview(PRO_MONTH));

    setup('owner');

    await fireEvent.click(await screen.findByRole('button', { name: 'Resume subscription' }));

    await waitFor(() => expect(billingAPI.resume).toHaveBeenCalledWith(ORG_ID));
    expect(await screen.findByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument();
  });

  it('switching plan previews the price, then applies the change on confirm', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(PRO_MONTH));
    billingAPI.preview.mockResolvedValue({ amountDue: 7000, currency: 'usd', immediate: true });
    billingAPI.changePlan.mockResolvedValue(overview({ ...PRO_MONTH, plan: 'pro_plus' }));

    setup('owner');

    await fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro Plus' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('$70.00')).toBeInTheDocument();
    expect(within(dialog).getByText(/prorated, after the credit for your unused time/i)).toBeInTheDocument();
    expect(billingAPI.preview).toHaveBeenCalledWith(ORG_ID, 'pro_plus', 'month');
    expect(billingAPI.changePlan).not.toHaveBeenCalled();

    await fireEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(billingAPI.changePlan).toHaveBeenCalledWith(ORG_ID, 'pro_plus', 'month'));
    expect(billingAPI.changePlan).toHaveBeenCalledTimes(1);
    // invoices are reloaded after a change (an upgrade creates one)
    await waitFor(() => expect(billingAPI.getInvoices).toHaveBeenCalledTimes(2));
    expect(toastStore.success).toHaveBeenCalledWith('Your plan is now Pro Plus, billed monthly');
  });

  it('a change that does not show yet says it was received', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(PRO_MONTH));
    billingAPI.preview.mockResolvedValue({ amountDue: 7000, currency: 'usd', immediate: true });
    // the billing service answered with the plan it could read: still the old one
    billingAPI.changePlan.mockResolvedValue(overview(PRO_MONTH));

    setup('owner');

    await fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro Plus' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('$70.00');
    await fireEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));

    await waitFor(() =>
      expect(toastStore.success).toHaveBeenCalledWith('Plan change received. It can take a minute to show.')
    );
    expect(toastStore.success).not.toHaveBeenCalledWith(expect.stringMatching(/^Your plan is now/));
  });

  it('a failed change refreshes the overview', async () => {
    billingAPI.getOverview
      .mockResolvedValueOnce(overview(PRO_MONTH))
      .mockResolvedValue(overview({ ...PRO_MONTH, plan: 'pro_plus' }));
    billingAPI.preview.mockResolvedValue({ amountDue: 7000, currency: 'usd', immediate: true });
    billingAPI.changePlan.mockRejectedValue(new BillingApiError(502, 'billing_unavailable', 'x'));

    setup('owner');

    await fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro Plus' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('$70.00');
    await fireEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));

    expect(await within(dialog).findByText(/Billing is temporarily unavailable/)).toBeInTheDocument();
    // the change may have gone through: the page asks again
    await waitFor(() => expect(billingAPI.getOverview).toHaveBeenCalledTimes(2));
  });

  it('checkout disabled shows opening soon instead of subscribe', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(FREE, { checkoutEnabled: false }));

    setup('owner');

    expect((await screen.findAllByRole('button', { name: 'Opening soon' })).length).toBe(2);
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull();
  });

  it('no publishable key shows opening soon instead of subscribe', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(FREE, { publishableKey: null }));

    setup('owner');

    expect((await screen.findAllByRole('button', { name: 'Opening soon' })).length).toBe(2);
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull();
    expect(screen.getByText(/Everything on the Free plan keeps working/)).toBeInTheDocument();
  });

  it('subscribe opens the embedded checkout dialog for that plan', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(FREE));
    billingAPI.startCheckout.mockResolvedValue({ clientSecret: 'cs_test_1_secret_x', publishableKey: 'pk_test_123' });

    setup('owner');

    const buttons = await screen.findAllByRole('button', { name: /^Subscribe/ });
    expect(buttons.length).toBe(2);
    await fireEvent.click(buttons[0]);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(billingAPI.startCheckout).toHaveBeenCalledWith(ORG_ID, 'pro', 'month'));
    await waitFor(() => expect(initEmbeddedCheckout).toHaveBeenCalled());
  });

  it('update card opens the payment method dialog', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(PRO_MONTH));
    billingAPI.startPaymentMethodUpdate.mockResolvedValue({ clientSecret: 'cs_test_2_secret_x', publishableKey: 'pk_test_123' });

    setup('owner');

    await fireEvent.click(await screen.findByRole('button', { name: 'Update card' }));
    await waitFor(() => expect(billingAPI.startPaymentMethodUpdate).toHaveBeenCalledWith(ORG_ID));
  });

  it('a free immediate change says nothing is due, and a trial says when the first charge happens', async () => {
    const trialing = { ...PRO_MONTH, status: 'trialing' };
    billingAPI.getOverview.mockResolvedValue(overview(trialing));
    billingAPI.preview.mockResolvedValue({ amountDue: 0, currency: 'usd', immediate: true });

    setup('owner');

    // the same plan offers an interval switch once the toggle is on Annual
    await fireEvent.click(await screen.findByRole('button', { name: 'Annual' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Switch to annual' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Nothing to pay today. The new plan applies right away.')).toBeInTheDocument();
    expect(within(dialog).getByText(/first charge at the new price is on Jan 17, 2027/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/charged today/i)).toBeNull();
    expect(billingAPI.preview).toHaveBeenCalledWith(ORG_ID, 'pro', 'year');
  });

  it('a failed preview offers a retry inside the dialog', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(PRO_MONTH));
    billingAPI.preview
      .mockRejectedValueOnce(new BillingApiError(409, 'billing_busy', 'locked'))
      .mockResolvedValueOnce({ amountDue: 7000, currency: 'usd', immediate: true });

    setup('owner');

    await fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro Plus' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/Another billing change is in progress. Try again in a moment./)
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /confirm/i })).toBeDisabled();

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));

    expect(await within(dialog).findByText('$70.00')).toBeInTheDocument();
    expect(billingAPI.preview).toHaveBeenCalledTimes(2);
    expect(within(dialog).getByRole('button', { name: /confirm/i })).not.toBeDisabled();
  });

  it('a past due subscription cannot change plan but can update the card', async () => {
    billingAPI.getOverview.mockResolvedValue(overview({ ...PRO_MONTH, status: 'past_due' }));

    setup('owner');

    expect(await screen.findByRole('button', { name: 'Update card' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Switch to/ })).toBeNull();
    expect(screen.getAllByText('Update your card to change plans').length).toBeGreaterThan(0);
    // cancelling stays possible
    expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument();
  });

  it('an unknown error code shows the server message', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(PRO_MONTH));
    billingAPI.preview.mockResolvedValue({ amountDue: 7000, currency: 'usd', immediate: true });
    billingAPI.changePlan.mockRejectedValue(new BillingApiError(409, 'something_new', 'The billing service explains it.'));

    setup('owner');

    await fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro Plus' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('$70.00');
    await fireEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));

    expect(await within(dialog).findByText(/The billing service explains it./)).toBeInTheDocument();
  });

  it('a 404 overview says billing is not available on this instance', async () => {
    billingAPI.getOverview.mockRejectedValue(new BillingApiError(404, 'http_404', 'Something went wrong with billing'));

    setup('owner');

    expect(await screen.findByText('Billing is not available on this instance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('opening soon wording follows the current plan', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(GRANDFATHERED, { checkoutEnabled: false }));

    setup('owner');

    expect(await screen.findByText(/Your organization keeps Pro until Jan 17, 2027/)).toBeInTheDocument();
    expect(screen.queryByText(/Everything on the Free plan keeps working/)).toBeNull();
  });

  it('opening soon on the free plan says Free keeps working', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(FREE, { checkoutEnabled: false }));

    setup('owner');

    expect(await screen.findByText(/Everything on the Free plan keeps working/)).toBeInTheDocument();
  });

  describe('VAT display toggle', () => {
    function choose(audience: 'personal' | 'business', country: string) {
      localStorage.setItem('logtide_billing_vat', JSON.stringify({ audience, country }));
      billingVat.reload();
    }

    it('personal in Italy shows prices with 22% VAT', async () => {
      choose('personal', 'IT');
      billingAPI.getOverview.mockResolvedValue(overview(PRO_MONTH));
      setup('owner');

      expect(await screen.findByText('Prices include 22% VAT (Italy). The exact tax is calculated at checkout from your billing address.')).toBeInTheDocument();
      // plan card (whole-dollar format does not apply to 35.38) and current plan card
      expect(screen.getAllByText('$35.38').length).toBe(2);
      expect(screen.getByText('$120.78')).toBeInTheDocument();
      expect(screen.getByText('Billed monthly, including VAT')).toBeInTheDocument();
      expect(screen.queryByText('$29')).not.toBeInTheDocument();
    });

    it('decimal rates keep their decimals', async () => {
      choose('personal', 'FI');
      billingAPI.getOverview.mockResolvedValue(overview(FREE));
      setup('owner');
      expect(await screen.findByText('Prices include 25.5% VAT (Finland)', { exact: false })).toBeInTheDocument();
      expect(screen.getByText('$124.25')).toBeInTheDocument();
    });

    it('switching to Business shows net prices and the reverse-charge note', async () => {
      choose('personal', 'IT');
      billingAPI.getOverview.mockResolvedValue(overview(PRO_MONTH));
      setup('owner');
      await screen.findByText(/Prices include 22% VAT/);

      await fireEvent.click(screen.getByRole('button', { name: 'Business' }));

      expect(screen.getByText('Prices exclude VAT. EU businesses with a valid VAT ID pay no VAT (reverse charge). Tax is calculated at checkout.')).toBeInTheDocument();
      expect(screen.getByText('$29')).toBeInTheDocument();
      expect(screen.getByText('$29.00')).toBeInTheDocument();
      expect(screen.getByText('Billed monthly, excluding VAT')).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('logtide_billing_vat')!)).toEqual({ audience: 'business', country: 'IT' });
    });

    it('outside the EU shows the taxes note and net prices', async () => {
      choose('business', 'OUT');
      billingAPI.getOverview.mockResolvedValue(overview(FREE));
      setup('owner');
      expect(await screen.findByText('Prices exclude taxes. Applicable taxes are calculated at checkout from your billing address.')).toBeInTheDocument();
      expect(screen.getByText('$29')).toBeInTheDocument();
    });

    it('annual view shows VAT-inclusive per-month and yearly figures', async () => {
      choose('personal', 'DE');
      billingAPI.getOverview.mockResolvedValue(overview(FREE));
      setup('owner');
      await screen.findByText('Prices include 19% VAT (Germany)', { exact: false });
      await fireEvent.click(screen.getByRole('button', { name: 'Annual' }));
      expect(screen.getByText('Billed annually at $342.72')).toBeInTheDocument();
      expect(screen.getByText('$28.56')).toBeInTheDocument();
    });

    it('does not change the real Stripe preview amount', async () => {
      choose('personal', 'IT');
      billingAPI.getOverview.mockResolvedValue(overview(PRO_MONTH));
      billingAPI.preview.mockResolvedValue({ amountDue: 7000, currency: 'usd', immediate: true });
      setup('owner');

      await fireEvent.click(await screen.findByRole('button', { name: 'Switch to Pro Plus' }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('$70.00')).toBeInTheDocument();
    });
  });
});
