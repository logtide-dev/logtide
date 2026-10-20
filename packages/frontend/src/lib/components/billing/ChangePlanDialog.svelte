<script lang="ts">
  import type { BillingCurrentPlan, BillingInterval, BillingOverview, BillingPlanInfo, BillingPreview } from '@logtide/shared';
  import { billingAPI, BillingApiError, billingErrorText, type PaidPlanId } from '$lib/api/billing';
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
  import { asSentence, formatBillingDate, formatMoney, safeExternalUrl } from '$lib/utils/billing';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

  interface Props {
    open?: boolean;
    orgId: string;
    target: { plan: PaidPlanId; interval: BillingInterval } | null;
    current: BillingCurrentPlan;
    plans: BillingPlanInfo[];
    /** The change was accepted; `target` is what was asked for (the overview may still show the old plan). */
    onChanged: (overview: BillingOverview, target: { plan: PaidPlanId; interval: BillingInterval }) => void;
    /** Confirm failed. The change may still have gone through server side, so the page re-reads its state. */
    onError?: () => void;
  }

  let { open = $bindable(false), orgId, target, current, plans, onChanged, onError }: Props = $props();

  let preview = $state<BillingPreview | null>(null);
  let previewLoading = $state(false);
  let previewError = $state<string | null>(null);
  let changeError = $state<string | null>(null);
  let actionUrl = $state<string | null>(null);
  let submitting = $state(false);
  // Which (org, plan, interval) the shown preview belongs to; a stale answer
  // for an earlier target is dropped.
  let previewKey = '';

  const trialing = $derived(current.status === 'trialing');
  const periodEnd = $derived(formatBillingDate(current.currentPeriodEnd));

  function intervalWord(i: BillingInterval | null): string {
    return i === 'year' ? 'annually' : 'monthly';
  }

  function planName(id: string): string {
    return plans.find((p) => p.id === id)?.name ?? id;
  }

  function priceOf(plan: string, interval: BillingInterval): string {
    const p = plans.find((x) => x.id === plan)?.prices?.[interval];
    if (!p) return '';
    return `${formatMoney(p.amount, p.currency)} / ${interval === 'year' ? 'year' : 'month'}`;
  }

  async function loadPreview(t: { plan: PaidPlanId; interval: BillingInterval }, key: string) {
    previewLoading = true;
    previewError = null;
    try {
      const result = await billingAPI.preview(orgId, t.plan, t.interval);
      if (key !== previewKey) return;
      preview = result;
    } catch (e) {
      if (key !== previewKey) return;
      previewError = billingErrorText(e);
    } finally {
      if (key === previewKey) previewLoading = false;
    }
  }

  function retryPreview() {
    if (open && target && previewKey) void loadPreview(target, previewKey);
  }

  function reset() {
    preview = null;
    previewError = null;
    changeError = null;
    actionUrl = null;
  }

  $effect(() => {
    if (open && target) {
      const key = `${orgId}:${target.plan}:${target.interval}`;
      if (key !== previewKey) {
        previewKey = key;
        reset();
        void loadPreview(target, key);
      }
    } else if (!open) {
      previewKey = '';
      reset();
      previewLoading = false;
    }
  });

  async function confirm() {
    if (!target || submitting) return;
    const asked = { plan: target.plan, interval: target.interval };
    submitting = true;
    changeError = null;
    actionUrl = null;
    try {
      const overview = await billingAPI.changePlan(orgId, asked.plan, asked.interval);
      onChanged(overview, asked);
      open = false;
    } catch (e) {
      changeError = billingErrorText(e);
      actionUrl =
        e instanceof BillingApiError && e.code === 'payment_action_required' ? safeExternalUrl(e.hostedInvoiceUrl) : null;
      onError?.();
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog bind:open>
  <DialogContent class="sm:max-w-md">
    {#if target}
      <DialogHeader>
        <DialogTitle>
          Switch to {planName(target.plan)}, billed {intervalWord(target.interval)}
        </DialogTitle>
        <DialogDescription>
          You are on {planName(current.plan)}, billed {intervalWord(current.interval)}.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div class="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-4 text-sm">
          <div class="min-w-0">
            <p class="text-xs text-muted-foreground">Now</p>
            <p class="font-medium">{planName(current.plan)}</p>
            <p class="text-xs text-muted-foreground">{current.interval ? priceOf(current.plan, current.interval) : ''}</p>
          </div>
          <ArrowRight class="h-4 w-4 shrink-0 text-muted-foreground" />
          <div class="min-w-0 text-right">
            <p class="text-xs text-muted-foreground">New</p>
            <p class="font-medium">{planName(target.plan)}</p>
            <p class="text-xs text-muted-foreground">{priceOf(target.plan, target.interval)}</p>
          </div>
        </div>

        {#if previewLoading}
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" />
            Calculating the price...
          </div>
        {:else if previewError}
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 p-4">
            <p class="text-sm text-destructive">
              The price could not be calculated. {asSentence(previewError)}
            </p>
            <Button variant="outline" size="sm" onclick={retryPreview}>
              <RotateCcw class="mr-1.5 h-4 w-4" />
              Retry
            </Button>
          </div>
        {:else if preview}
          <div class="rounded-lg border p-4">
            {#if preview.immediate && preview.amountDue > 0}
              <p class="text-sm text-muted-foreground">Charged today</p>
              <p class="mt-1 text-2xl font-bold">{formatMoney(preview.amountDue, preview.currency)}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                Prorated, after the credit for your unused time, and charged to your card on file. The new
                plan applies as soon as the payment goes through.
              </p>
            {:else if preview.immediate}
              <p class="text-sm font-medium">Nothing to pay today. The new plan applies right away.</p>
              {#if trialing && periodEnd}
                <p class="mt-1 text-xs text-muted-foreground">
                  Your first charge at the new price is on {periodEnd}.
                </p>
              {/if}
            {:else}
              <p class="text-sm text-muted-foreground">
                Next invoice{periodEnd ? `, ${periodEnd}` : ''}
              </p>
              <p class="mt-1 text-2xl font-bold">{formatMoney(preview.amountDue, preview.currency)}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                Nothing is charged today. The unused time on your current plan is credited to your next
                invoice.
              </p>
            {/if}
          </div>
        {/if}

        {#if changeError}
          <Alert variant="destructive">
            <TriangleAlert class="h-4 w-4" />
            <AlertDescription>
              {asSentence(changeError)}
              {#if actionUrl}
                <a
                  href={actionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="ml-1 inline-flex items-center gap-1 font-medium underline underline-offset-4"
                >
                  Confirm the payment
                  <ExternalLink class="h-3.5 w-3.5" />
                </a>
                <span class="mt-1 block">Your plan changes once the payment is confirmed.</span>
              {/if}
            </AlertDescription>
          </Alert>
        {/if}
      </div>

      <DialogFooter class="gap-2">
        <Button variant="outline" disabled={submitting} onclick={() => (open = false)}>Keep current plan</Button>
        <Button disabled={!preview || submitting} onclick={confirm}>
          {submitting ? 'Switching...' : 'Confirm change'}
        </Button>
      </DialogFooter>
    {/if}
  </DialogContent>
</Dialog>
