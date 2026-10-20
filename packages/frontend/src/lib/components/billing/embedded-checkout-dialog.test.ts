import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { BillingOverview } from '@logtide/shared';

const { billingAPI, loadStripeOnce, checkout, initEmbeddedCheckout } = vi.hoisted(() => {
  const checkout = { mount: vi.fn(), destroy: vi.fn(), unmount: vi.fn() };
  const initEmbeddedCheckout = vi.fn();
  return {
    checkout,
    initEmbeddedCheckout,
    billingAPI: {
      startCheckout: vi.fn(),
      startPaymentMethodUpdate: vi.fn(),
      getCheckoutStatus: vi.fn(),
      getOverview: vi.fn(),
    },
    loadStripeOnce: vi.fn(),
  };
});

vi.mock('$lib/api/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/api/billing')>()),
  billingAPI,
}));
vi.mock('$lib/utils/stripe-loader', () => ({ loadStripeOnce }));

import EmbeddedCheckoutDialog from './EmbeddedCheckoutDialog.svelte';
import { BillingApiError } from '$lib/api/billing';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const SESSION = 'cs_test_abc123';
const SECRET = `${SESSION}_secret_xyz`;

const overview = (source: 'free' | 'subscription'): BillingOverview =>
  ({
    checkoutEnabled: true,
    publishableKey: 'pk_test_1',
    current: {
      plan: source === 'free' ? 'free' : 'pro',
      source,
      interval: source === 'free' ? null : 'month',
      status: source === 'free' ? null : 'active',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      grandfatheredUntil: null,
      pastDueSince: null,
    },
    paymentMethod: null,
    plans: [],
  }) as BillingOverview;

function renderDialog(props: Record<string, unknown> = {}) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  const utils = render(EmbeddedCheckoutDialog, {
    open: true,
    orgId: ORG_ID,
    kind: 'subscribe',
    plan: 'pro',
    interval: 'month',
    onDone,
    onClose,
    ...props,
  });
  return { ...utils, onDone, onClose };
}

let completeCb: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  completeCb = undefined;
  billingAPI.startCheckout.mockResolvedValue({ clientSecret: SECRET, publishableKey: 'pk_test_1' });
  billingAPI.startPaymentMethodUpdate.mockResolvedValue({ clientSecret: SECRET, publishableKey: 'pk_test_1' });
  initEmbeddedCheckout.mockImplementation(async (opts: { onComplete: () => void }) => {
    completeCb = opts.onComplete;
    return checkout;
  });
  loadStripeOnce.mockResolvedValue({ initEmbeddedCheckout });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EmbeddedCheckoutDialog', () => {
  it('mounts embedded checkout with the client secret', async () => {
    renderDialog();
    await vi.waitFor(() => expect(checkout.mount).toHaveBeenCalledTimes(1));
    expect(billingAPI.startCheckout).toHaveBeenCalledWith(ORG_ID, 'pro', 'month');
    expect(loadStripeOnce).toHaveBeenCalledWith('pk_test_1');
    const opts = initEmbeddedCheckout.mock.calls[0][0];
    await expect(opts.fetchClientSecret()).resolves.toBe(SECRET);
    expect(checkout.mount.mock.calls[0][0]).toBeInstanceOf(HTMLElement);
  });

  it('uses the payment method session for kind payment-method', async () => {
    renderDialog({ kind: 'payment-method', plan: undefined, interval: undefined });
    await vi.waitFor(() => expect(checkout.mount).toHaveBeenCalled());
    expect(billingAPI.startPaymentMethodUpdate).toHaveBeenCalledWith(ORG_ID);
    expect(billingAPI.startCheckout).not.toHaveBeenCalled();
  });

  it('on complete it polls status then overview and calls onDone when the plan changed', async () => {
    const { onDone } = renderDialog();
    await vi.waitFor(() => expect(checkout.mount).toHaveBeenCalled());
    vi.useFakeTimers();
    billingAPI.getCheckoutStatus
      .mockResolvedValueOnce({ status: 'open', mode: 'subscription' })
      .mockResolvedValue({ status: 'complete', mode: 'subscription' });
    const done = overview('subscription');
    billingAPI.getOverview.mockResolvedValue(done);

    completeCb!();
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('Finishing up, activating your plan')).toBeTruthy();
    expect(screen.queryByText(/Payment received/)).toBeNull();
    expect(billingAPI.getCheckoutStatus).toHaveBeenCalledWith(ORG_ID, SESSION);
    expect(onDone).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(billingAPI.getOverview).toHaveBeenCalledWith(ORG_ID);
    expect(onDone).toHaveBeenCalledWith(done);
    expect(screen.getByText(/Your plan is active/)).toBeTruthy();
  });

  it('keeps polling while the overview still shows the free plan', async () => {
    const { onDone } = renderDialog();
    await vi.waitFor(() => expect(checkout.mount).toHaveBeenCalled());
    vi.useFakeTimers();
    billingAPI.getCheckoutStatus.mockResolvedValue({ status: 'complete', mode: 'subscription' });
    billingAPI.getOverview.mockResolvedValueOnce(overview('free')).mockResolvedValue(overview('subscription'));
    completeCb!();
    await vi.advanceTimersByTimeAsync(0);
    expect(onDone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('stops polling after 30 s and says the plan will update in a minute', async () => {
    const { onDone } = renderDialog();
    await vi.waitFor(() => expect(checkout.mount).toHaveBeenCalled());
    vi.useFakeTimers();
    billingAPI.getCheckoutStatus.mockResolvedValue({ status: 'open', mode: 'subscription' });
    completeCb!();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(screen.getByText('Checkout is complete. Your plan will update in a minute.')).toBeTruthy();
    const calls = billingAPI.getCheckoutStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(billingAPI.getCheckoutStatus.mock.calls.length).toBe(calls);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('the 30 s window is a deadline: slow status calls do not stretch it', async () => {
    const { onDone } = renderDialog();
    await vi.waitFor(() => expect(checkout.mount).toHaveBeenCalled());
    vi.useFakeTimers();
    billingAPI.getCheckoutStatus.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ status: 'open', mode: 'subscription' }), 10_000))
    );
    completeCb!();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(screen.getByText('Checkout is complete. Your plan will update in a minute.')).toBeTruthy();
    expect(billingAPI.getCheckoutStatus.mock.calls.length).toBeLessThanOrEqual(4);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('card update copy does not talk about a payment', async () => {
    renderDialog({ kind: 'payment-method', plan: undefined, interval: undefined });
    await vi.waitFor(() => expect(checkout.mount).toHaveBeenCalled());
    vi.useFakeTimers();
    billingAPI.getCheckoutStatus.mockResolvedValue({ status: 'open', mode: 'setup' });
    completeCb!();
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('Saving your card')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(screen.getByText('Your card was submitted. It will show on the Billing page in a minute.')).toBeTruthy();
    expect(screen.queryByText(/payment was received/i)).toBeNull();
  });

  it('closing the dialog destroys the checkout instance', async () => {
    const { rerender, onClose } = renderDialog();
    await vi.waitFor(() => expect(checkout.mount).toHaveBeenCalled());
    await rerender({ open: false });
    await vi.waitFor(() => expect(checkout.destroy).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('startCheckout 503 checkout_disabled shows Paid plans are opening soon', async () => {
    billingAPI.startCheckout.mockRejectedValue(new BillingApiError(503, 'checkout_disabled', 'x'));
    renderDialog();
    expect(await screen.findByText(/Paid plans are opening soon/)).toBeTruthy();
    expect(initEmbeddedCheckout).not.toHaveBeenCalled();
  });

  it('shows an error when Stripe cannot be loaded', async () => {
    loadStripeOnce.mockResolvedValue(null);
    renderDialog();
    expect(await screen.findByText(/payment form could not be loaded/i)).toBeTruthy();
  });
});
