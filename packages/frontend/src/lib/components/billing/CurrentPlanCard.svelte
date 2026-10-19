<script lang="ts">
  import type { BillingOverview } from '@logtide/shared';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Separator } from '$lib/components/ui/separator';
  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
  import {
    formatCardBrand,
    formatMoney,
    formatBillingDate,
    isCardExpired,
    planTimeline,
    statusBadge,
  } from '$lib/utils/billing';
  import CreditCard from '@lucide/svelte/icons/credit-card';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import CalendarClock from '@lucide/svelte/icons/calendar-clock';

  interface Props {
    overview: BillingOverview;
    isCustom: boolean;
    /** A billing mutation is in flight: every action is disabled. */
    busy?: boolean;
    onChangePlan: () => void;
    onCancel: () => void;
    onResume: () => void;
    /** Wired to the embedded checkout (setup mode); disabled while absent. */
    onUpdateCard?: () => void;
  }

  let { overview, isCustom, busy = false, onChangePlan, onCancel, onResume, onUpdateCard }: Props = $props();

  const current = $derived(overview.current);
  const planInfo = $derived(overview.plans.find((p) => p.id === current.plan) ?? null);
  const planName = $derived(planInfo?.name ?? current.plan);
  const subscribed = $derived(current.source === 'subscription');
  const badge = $derived(isCustom ? { label: 'Custom', variant: 'outline' as const } : statusBadge(current));
  const timeline = $derived(planTimeline(current));
  const pastDue = $derived(subscribed && (current.status === 'past_due' || current.status === 'unpaid'));

  const price = $derived.by(() => {
    if (current.source === 'grandfathered') {
      return { value: 'Included', suffix: '', note: 'No charge during your free period' };
    }
    if (!subscribed || !current.interval || !planInfo?.prices) {
      return { value: formatMoney(0, 'usd'), suffix: '/ month', note: 'No card needed' };
    }
    const p = planInfo.prices[current.interval];
    return {
      value: formatMoney(p.amount, p.currency),
      suffix: current.interval === 'year' ? '/ year' : '/ month',
      note: `${current.interval === 'year' ? 'Billed annually' : 'Billed monthly'}, excluding VAT`,
    };
  });

  const card = $derived(overview.paymentMethod);
  const cardExpired = $derived(card ? isCardExpired(card) : false);
  const cardExpiry = $derived(card ? `${String(card.expMonth).padStart(2, '0')}/${card.expYear}` : '');
</script>

<Card>
  <CardHeader class="pb-3">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1.5">
        <CardTitle class="text-base flex items-center gap-2">
          <CreditCard class="h-4 w-4 text-muted-foreground" />
          Current plan
        </CardTitle>
        <CardDescription>Your organization's plan, billing period and payment method</CardDescription>
      </div>
      <Badge variant={badge.variant}>{badge.label}</Badge>
    </div>
  </CardHeader>

  <CardContent class="space-y-4">
    {#if isCustom}
      <div class="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
        <ShieldCheck class="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p class="font-medium">Custom plan, managed by LogTide</p>
          <p class="mt-1 text-sm text-muted-foreground">
            The limits of this organization are set by the LogTide team, so there is nothing to buy or
            change here. See the Usage page for the current limits.
          </p>
        </div>
      </div>
    {:else}
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div class="rounded-lg bg-muted/50 p-4">
          <p class="text-xs font-medium text-muted-foreground">Plan</p>
          <p class="mt-1 text-2xl font-bold">{planName}</p>
          <p class="mt-1 text-xs text-muted-foreground">{planInfo?.tagline ?? ''}</p>
        </div>
        <div class="rounded-lg bg-muted/50 p-4">
          <p class="text-xs font-medium text-muted-foreground">Price</p>
          <p class="mt-1 text-2xl font-bold">
            {price.value}
            {#if price.suffix}
              <span class="text-sm font-normal text-muted-foreground">{price.suffix}</span>
            {/if}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">{price.note}</p>
        </div>
        <div class="rounded-lg bg-muted/50 p-4">
          <p class="text-xs font-medium text-muted-foreground">{timeline.label}</p>
          <p class="mt-1 text-2xl font-bold">{timeline.value}</p>
          <p class="mt-1 text-xs text-muted-foreground">{timeline.note}</p>
        </div>
      </div>

      {#if pastDue}
        <Alert variant="destructive">
          <TriangleAlert class="h-4 w-4" />
          <AlertTitle>Your last payment failed</AlertTitle>
          <AlertDescription>
            Update your card so the {planName} plan stays active. Stripe retries the payment
            automatically.
          </AlertDescription>
        </Alert>
      {:else if subscribed && current.cancelAtPeriodEnd}
        <Alert>
          <CalendarClock class="h-4 w-4" />
          <AlertTitle>Your subscription ends on {formatBillingDate(current.currentPeriodEnd)}</AlertTitle>
          <AlertDescription>
            You keep {planName} until then. After that the Free plan limits apply. Resume to keep your
            plan without interruption.
          </AlertDescription>
        </Alert>
      {/if}

      <Separator />

      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {#if subscribed}
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-14 shrink-0 items-center justify-center rounded-md border bg-muted/50">
              <CreditCard class="h-5 w-5 text-muted-foreground" />
            </div>
            <div class="min-w-0">
              {#if card}
                <p class="text-sm font-medium">{formatCardBrand(card.brand)} ending in {card.last4}</p>
                <p class="text-xs {cardExpired ? 'text-destructive' : 'text-muted-foreground'}">
                  {cardExpired ? 'Expired' : 'Expires'} {cardExpiry}
                </p>
              {:else}
                <p class="text-sm font-medium">No card on file</p>
                <p class="text-xs text-muted-foreground">Add a card so your plan renews</p>
              {/if}
            </div>
          </div>
        {:else if current.source === 'grandfathered'}
          <p class="text-sm text-muted-foreground">
            Subscribe before {formatBillingDate(current.grandfatheredUntil)} to keep Pro without interruption.
          </p>
        {:else}
          <p class="text-sm text-muted-foreground">
            Upgrade for more data, longer retention and unlimited projects.
          </p>
        {/if}

        <div class="flex flex-wrap gap-2 sm:justify-end">
          {#if subscribed}
            <Button variant="outline" size="sm" disabled={!onUpdateCard || busy} onclick={() => onUpdateCard?.()}>
              Update card
            </Button>
            {#if current.cancelAtPeriodEnd}
              <Button size="sm" disabled={busy} onclick={onResume}>Resume subscription</Button>
            {:else}
              <Button variant="outline" size="sm" disabled={busy} onclick={onChangePlan}>Change plan</Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={busy}
                onclick={onCancel}
              >
                Cancel subscription
              </Button>
            {/if}
          {:else}
            <Button size="sm" disabled={busy} onclick={onChangePlan}>
              {current.source === 'grandfathered' ? 'Choose a plan' : 'Upgrade'}
            </Button>
          {/if}
        </div>
      </div>
    {/if}
  </CardContent>
</Card>
