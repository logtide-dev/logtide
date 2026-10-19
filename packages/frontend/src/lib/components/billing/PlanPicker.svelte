<script lang="ts">
  import type { BillingCurrentPlan, BillingInterval, BillingPlanInfo } from '@logtide/shared';
  import type { PaidPlanId } from '$lib/api/billing';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import TimeRangeButtons from '$lib/components/TimeRangeButtons.svelte';
  import {
    annualSavingPercent,
    formatBillingDate,
    formatPlanPrice,
    planCta,
    type PlanCta,
  } from '$lib/utils/billing';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Check from '@lucide/svelte/icons/check';
  import Info from '@lucide/svelte/icons/info';

  interface Props {
    plans: BillingPlanInfo[];
    current: BillingCurrentPlan;
    checkoutEnabled: boolean;
    interval?: BillingInterval;
    busy?: boolean;
    /** Wired to the embedded checkout; Subscribe stays disabled while absent. */
    onSubscribe?: (plan: PaidPlanId, interval: BillingInterval) => void;
    onSwitch: (plan: PaidPlanId, interval: BillingInterval) => void;
    onDowngrade: () => void;
  }

  let {
    plans,
    current,
    checkoutEnabled,
    interval = $bindable('month'),
    busy = false,
    onSubscribe,
    onSwitch,
    onDowngrade,
  }: Props = $props();

  const INTERVAL_OPTIONS = [
    { value: 'month', label: 'Monthly' },
    { value: 'year', label: 'Annual' },
  ];

  const maxSaving = $derived(
    Math.max(0, ...plans.map((p) => (p.prices ? annualSavingPercent(p.prices.month.amount, p.prices.year.amount) : 0)))
  );

  const subscribed = $derived(current.source === 'subscription');

  function monthlyPrice(plan: BillingPlanInfo): number {
    if (!plan.prices) return 0;
    return interval === 'year' ? Math.round(plan.prices.year.amount / 12) : plan.prices.month.amount;
  }

  function currency(plan: BillingPlanInfo): string {
    return plan.prices?.[interval].currency ?? 'usd';
  }

  function billedNote(plan: BillingPlanInfo): string {
    if (!plan.prices) return 'Free forever';
    if (interval === 'year') return `Billed annually at ${formatPlanPrice(plan.prices.year.amount, plan.prices.year.currency)}`;
    return 'Billed monthly';
  }

  /** Monthly-equivalent price of the current subscription, to tell upgrades from downgrades. */
  const currentMonthly = $derived.by(() => {
    if (!subscribed || !current.interval) return 0;
    const p = plans.find((x) => x.id === current.plan)?.prices;
    if (!p) return 0;
    return current.interval === 'year' ? p.year.amount / 12 : p.month.amount;
  });

  function switchLabel(plan: BillingPlanInfo): string {
    if (plan.id === current.plan) return interval === 'year' ? 'Switch to annual' : 'Switch to monthly';
    return `Switch to ${plan.name}`;
  }

  function noneNote(plan: BillingPlanInfo): string {
    if (subscribed && current.cancelAtPeriodEnd) {
      return plan.id === 'free'
        ? `Applies from ${formatBillingDate(current.currentPeriodEnd)}`
        : 'Resume your subscription to switch';
    }
    if (current.source === 'grandfathered' && plan.id === 'free') {
      return `Applies after ${formatBillingDate(current.grandfatheredUntil)} unless you subscribe`;
    }
    return '';
  }

  function ctaOf(plan: BillingPlanInfo): PlanCta {
    return planCta({ card: plan.id, current, checkoutEnabled, interval, isCustom: false });
  }
</script>

<Card id="billing-plans" class="scroll-mt-24">
  <CardHeader class="pb-3">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="space-y-1.5">
        <CardTitle class="text-base flex items-center gap-2">
          <Sparkles class="h-4 w-4 text-muted-foreground" />
          Plans
        </CardTitle>
        <CardDescription>Every plan includes unlimited users. Change or cancel any time.</CardDescription>
      </div>
      <div class="flex items-center gap-2">
        <TimeRangeButtons
          options={INTERVAL_OPTIONS}
          value={interval}
          onChange={(v) => {
            interval = v as BillingInterval;
          }}
        />
        {#if maxSaving > 0}
          <Badge variant="secondary" class="whitespace-nowrap">Save up to {maxSaving}%</Badge>
        {/if}
      </div>
    </div>
  </CardHeader>

  <CardContent class="space-y-4">
    {#if !checkoutEnabled && !subscribed}
      <Alert>
        <Info class="h-4 w-4" />
        <AlertDescription>
          Paid plans are opening soon. Everything on the Free plan keeps working in the meantime.
        </AlertDescription>
      </Alert>
    {/if}

    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      {#each plans as plan (plan.id)}
        {@const cta = ctaOf(plan)}
        {@const saving = plan.prices ? annualSavingPercent(plan.prices.month.amount, plan.prices.year.amount) : 0}
        <div
          class="flex flex-col rounded-lg border bg-card p-5 transition-colors {cta === 'current'
            ? 'border-primary ring-1 ring-primary'
            : ''}"
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-lg font-semibold">{plan.name}</h3>
            {#if cta === 'current'}
              <Badge>Current</Badge>
            {:else if interval === 'year' && saving > 0}
              <Badge variant="secondary">Save {saving}%</Badge>
            {/if}
          </div>
          <p class="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

          <div class="mt-5">
            <span class="text-3xl font-bold tracking-tight">{formatPlanPrice(monthlyPrice(plan), currency(plan))}</span>
            <span class="text-sm text-muted-foreground">/ month</span>
            <p class="mt-1 text-xs text-muted-foreground">{billedNote(plan)}</p>
          </div>

          <ul class="mt-5 flex-1 space-y-2 text-sm">
            {#each plan.highlights as highlight (highlight)}
              <li class="flex items-start gap-2">
                <Check class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{highlight}</span>
              </li>
            {/each}
          </ul>

          <div class="mt-6">
            {#if cta === 'current'}
              <Button variant="outline" class="w-full" disabled>Current plan</Button>
            {:else if cta === 'subscribe' && plan.id !== 'free'}
              <Button
                class="w-full"
                disabled={!onSubscribe || busy}
                onclick={() => onSubscribe?.(plan.id as PaidPlanId, interval)}
              >
                Subscribe to {plan.name}
              </Button>
            {:else if cta === 'switch' && plan.id !== 'free'}
              <Button
                variant={monthlyPrice(plan) > currentMonthly ? 'default' : 'outline'}
                class="w-full"
                disabled={busy}
                onclick={() => onSwitch(plan.id as PaidPlanId, interval)}
              >
                {switchLabel(plan)}
              </Button>
            {:else if cta === 'downgrade-to-free'}
              <Button variant="outline" class="w-full" disabled={busy} onclick={onDowngrade}>
                Downgrade to Free
              </Button>
            {:else if cta === 'opening-soon'}
              <Button variant="secondary" class="w-full" disabled>Opening soon</Button>
            {:else}
              <p class="flex h-10 items-center justify-center text-center text-xs text-muted-foreground">
                {noneNote(plan)}
              </p>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <p class="text-xs text-muted-foreground">
      Prices exclude VAT. Tax is calculated at checkout from your billing address.
    </p>
  </CardContent>
</Card>
