<script lang="ts">
  import { tick, untrack, onDestroy } from 'svelte';
  import type { BillingInterval, BillingOverview } from '@logtide/shared';
  import type { StripeEmbeddedCheckout } from '@stripe/stripe-js';
  import { billingAPI, billingErrorText, type PaidPlanId } from '$lib/api/billing';
  import { loadStripeOnce } from '$lib/utils/stripe-loader';
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Spinner from '$lib/components/Spinner.svelte';
  import { asSentence } from '$lib/utils/billing';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

  type Phase = 'loading' | 'ready' | 'activating' | 'done' | 'pending' | 'error';

  interface Props {
    open?: boolean;
    orgId: string;
    kind: 'subscribe' | 'payment-method';
    plan?: PaidPlanId;
    interval?: BillingInterval;
    /** Called once the new state is confirmed by the billing service. */
    onDone: (overview: BillingOverview) => void;
    /** Called whenever the dialog closes, whatever the reason. */
    onClose?: () => void;
  }

  let { open = $bindable(false), orgId, kind, plan, interval, onDone, onClose }: Props = $props();

  const POLL_EVERY_MS = 2000;
  const POLL_FOR_MS = 30_000;

  let phase = $state<Phase>('loading');
  let errorText = $state('');
  let container = $state<HTMLElement | null>(null);

  let checkout: StripeEmbeddedCheckout | null = null;
  // Bumped on every start and on close; async steps of an older run bail out.
  let runId = 0;
  let started = false;

  const planName = $derived(plan === 'pro_plus' ? 'Pro Plus' : 'Pro');
  const title = $derived(kind === 'subscribe' ? `Subscribe to ${planName}` : 'Update payment card');
  const description = $derived(
    kind === 'subscribe'
      ? `Billed ${interval === 'year' ? 'annually' : 'monthly'}. Prices exclude VAT; tax is calculated from your billing address.`
      : 'Your new card is used for all future invoices. You are not charged now.'
  );

  function destroyCheckout() {
    try {
      checkout?.destroy();
    } catch {
      // Stripe may already have torn the iframe down.
    }
    checkout = null;
  }

  async function waitForContainer(run: number): Promise<HTMLElement | null> {
    for (let i = 0; i < 20; i++) {
      await tick();
      if (run !== runId) return null;
      if (container) return container;
      await new Promise((r) => setTimeout(r, 25));
    }
    return null;
  }

  function fail(text: string) {
    errorText = text;
    phase = 'error';
  }

  async function start() {
    const run = ++runId;
    phase = 'loading';
    errorText = '';
    destroyCheckout();
    try {
      const session =
        kind === 'subscribe' && plan && interval
          ? await billingAPI.startCheckout(orgId, plan, interval)
          : await billingAPI.startPaymentMethodUpdate(orgId);
      if (run !== runId) return;
      const stripe = await loadStripeOnce(session.publishableKey);
      if (run !== runId) return;
      if (!stripe) {
        fail('The secure payment form could not be loaded. Check your connection and try again.');
        return;
      }
      const instance = await stripe.initEmbeddedCheckout({
        fetchClientSecret: () => Promise.resolve(session.clientSecret),
        onComplete: () => void onComplete(run, session.clientSecret),
      });
      if (run !== runId) {
        instance.destroy();
        return;
      }
      checkout = instance;
      const el = await waitForContainer(run);
      if (run !== runId) return;
      if (!el) {
        destroyCheckout();
        fail('The secure payment form could not be shown. Close this window and try again.');
        return;
      }
      instance.mount(el);
      phase = 'ready';
    } catch (e) {
      if (run !== runId) return;
      fail(billingErrorText(e));
    }
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  async function onComplete(run: number, clientSecret: string) {
    if (run !== runId) return;
    // The checkout is finished: replace the form with our own state.
    destroyCheckout();
    phase = 'activating';
    // Stripe client secrets look like `cs_..._secret_...`; the session id is the first part.
    const sessionId = clientSecret.split('_secret_')[0];
    // A wall-clock deadline: slow status calls must not stretch the window.
    const deadline = Date.now() + POLL_FOR_MS;
    while (run === runId) {
      try {
        const status = await billingAPI.getCheckoutStatus(orgId, sessionId);
        if (run !== runId) return;
        if (status.status === 'complete') {
          const overview = await billingAPI.getOverview(orgId);
          if (run !== runId) return;
          if (kind === 'payment-method' || overview.current.source === 'subscription') {
            phase = 'done';
            onDone(overview);
            return;
          }
        }
      } catch {
        // A hiccup while the webhook is still landing; keep trying until the deadline.
      }
      if (Date.now() >= deadline) break;
      await sleep(Math.min(POLL_EVERY_MS, Math.max(0, deadline - Date.now())));
    }
    if (run === runId) phase = 'pending';
  }

  function teardown() {
    runId++;
    destroyCheckout();
  }

  $effect(() => {
    const isOpen = open;
    untrack(() => {
      if (isOpen && !started) {
        started = true;
        void start();
      } else if (!isOpen && started) {
        started = false;
        teardown();
        onClose?.();
      }
    });
  });

  onDestroy(() => {
    runId++;
    destroyCheckout();
  });
</script>

<Dialog bind:open>
  <DialogContent class="sm:max-w-2xl">
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>

    <div data-dialog-scroll-body class="max-h-[70vh] overflow-y-auto">
      {#if phase === 'loading'}
        <div class="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Spinner size="sm" />
          Preparing secure checkout...
        </div>
      {/if}

      <div
        bind:this={container}
        data-testid="embedded-checkout"
        class={phase === 'loading' || phase === 'ready' ? 'min-h-[12rem]' : 'hidden'}
      ></div>

      {#if phase === 'activating'}
        <div class="flex flex-col items-center gap-3 py-16 text-center">
          <Spinner />
          <p class="font-medium">
            {kind === 'subscribe' ? 'Finishing up, activating your plan' : 'Saving your card'}
          </p>
          <p class="text-sm text-muted-foreground">This usually takes a few seconds.</p>
        </div>
      {:else if phase === 'done'}
        <div class="flex flex-col items-center gap-3 py-16 text-center">
          <CircleCheck class="h-10 w-10 text-success-text" />
          <p class="font-medium">
            {kind === 'subscribe' ? `Your plan is active. Welcome to ${planName}.` : 'Your payment card was updated.'}
          </p>
          <p class="text-sm text-muted-foreground">
            {kind === 'subscribe' ? 'The new limits apply right away.' : 'It will be used for your next invoice.'}
          </p>
        </div>
      {:else if phase === 'pending'}
        <div class="flex flex-col items-center gap-3 py-16 text-center">
          <CircleCheck class="h-10 w-10 text-muted-foreground" />
          <p class="font-medium">
            {kind === 'subscribe'
              ? 'Checkout is complete. Your plan will update in a minute.'
              : 'Your card was submitted. It will show on the Billing page in a minute.'}
          </p>
          <p class="text-sm text-muted-foreground">You can close this window; the billing page refreshes on its own.</p>
        </div>
      {:else if phase === 'error'}
        <div class="space-y-4 py-4">
          <Alert variant="destructive">
            <TriangleAlert class="h-4 w-4" />
            <AlertDescription>{asSentence(errorText)}</AlertDescription>
          </Alert>
          <Button variant="outline" size="sm" onclick={() => void start()}>
            <RotateCcw class="mr-1.5 h-4 w-4" />
            Try again
          </Button>
        </div>
      {/if}
    </div>

    {#if phase === 'done' || phase === 'pending' || phase === 'error'}
      <DialogFooter>
        <Button variant={phase === 'done' ? 'default' : 'outline'} onclick={() => (open = false)}>
          {phase === 'done' ? 'Done' : 'Close'}
        </Button>
      </DialogFooter>
    {/if}
  </DialogContent>
</Dialog>
