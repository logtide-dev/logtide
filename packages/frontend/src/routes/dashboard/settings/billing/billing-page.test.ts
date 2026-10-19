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
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './+page.svelte';
import { BillingApiError } from '$lib/api/billing';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';

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
      screen.getByText('Prices exclude VAT. Tax is calculated at checkout from your billing address.')
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
    expect(billingAPI.preview).toHaveBeenCalledWith(ORG_ID, 'pro_plus', 'month');
    expect(billingAPI.changePlan).not.toHaveBeenCalled();

    await fireEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(billingAPI.changePlan).toHaveBeenCalledWith(ORG_ID, 'pro_plus', 'month'));
    expect(billingAPI.changePlan).toHaveBeenCalledTimes(1);
    // invoices are reloaded after a change (an upgrade creates one)
    await waitFor(() => expect(billingAPI.getInvoices).toHaveBeenCalledTimes(2));
  });

  it('checkout disabled shows opening soon instead of subscribe', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(FREE, { checkoutEnabled: false }));

    setup('owner');

    expect((await screen.findAllByRole('button', { name: 'Opening soon' })).length).toBe(2);
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull();
  });

  it('subscribe stays a disabled placeholder until checkout is wired', async () => {
    billingAPI.getOverview.mockResolvedValue(overview(FREE));

    setup('owner');

    const buttons = await screen.findAllByRole('button', { name: /^Subscribe/ });
    expect(buttons.length).toBe(2);
    for (const b of buttons) expect(b).toBeDisabled();
  });
});
