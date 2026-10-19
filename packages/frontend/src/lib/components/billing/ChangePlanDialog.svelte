<script lang="ts">
  import type { BillingCurrentPlan, BillingInterval, BillingOverview, BillingPlanInfo, BillingPreview } from '@logtide/shared';
  import { billingAPI, BillingApiError, type PaidPlanId } from '$lib/api/billing';
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
  import { billingErrorMessage, formatBillingDate, formatMoney, safeExternalUrl } from '$lib/utils/billing';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import ExternalLink from '@lucide/svelte/icons/external-link';

  interface Props {
    open?: boolean;
    orgId: string;
    target: { plan: PaidPlanId; interval: BillingInterval } | null;
    current: BillingCurrentPlan;
    plans: BillingPlanInfo[];
    onChanged: (overview: BillingOverview) => void;
  }

  let { open = $bindable(false), orgId, target, current, plans, onChanged }: Props = $props();

  let preview = $state<BillingPreview | null>(null);
  let previewLoading = $state(false);
  let error = $state<string | null>(null);
  let actionUrl = $state<string | null>(null);
  let submitting = $state(false);
  // Which (org, plan, interval) the shown preview belongs to; a stale answer
  // for an earlier target is dropped.
  let previewKey = '';

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
    try {
      const result = await billingAPI.preview(orgId, t.plan, t.interval);
      if (key !== previewKey) return;
      preview = result;
    } catch (e) {
      if (key !== previewKey) return;
      error = e instanceof BillingApiError ? billingErrorMessage(e.code) : billingErrorMessage('');
    } finally {
      if (key === previewKey) previewLoading = false;
    }
  }

  $effect(() => {
    if (open && target) {
      const key = `${orgId}:${target.plan}:${target.interval}`;
      if (key !== previewKey) {
        previewKey = key;
        preview = null;
        error = null;
        actionUrl = null;
        void loadPreview(target, key);
      }
    } else if (!open) {
      previewKey = '';
      preview = null;
      error = null;
      actionUrl = null;
      previewLoading = false;
    }
  });

  async function confirm() {
    if (!target || submitting) return;
    submitting = true;
    error = null;
    actionUrl = null;
    try {
      const overview = await billingAPI.changePlan(orgId, target.plan, target.interval);
      onChanged(overview);
      open = false;
    } catch (e) {
      if (e instanceof BillingApiError) {
        error = billingErrorMessage(e.code);
        actionUrl = e.code === 'payment_action_required' ? safeExternalUrl(e.hostedInvoiceUrl) : null;
      } else {
        error = billingErrorMessage('');
      }
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
        {:else if preview}
          <div class="rounded-lg border p-4">
            {#if preview.immediate}
              <p class="text-sm text-muted-foreground">Charged today</p>
              <p class="mt-1 text-2xl font-bold">{formatMoney(preview.amountDue, preview.currency)}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                The difference for the rest of the current period, charged to your card on file. The new
                plan applies as soon as the payment goes through.
              </p>
            {:else}
              <p class="text-sm text-muted-foreground">
                Next invoice{current.currentPeriodEnd ? `, ${formatBillingDate(current.currentPeriodEnd)}` : ''}
              </p>
              <p class="mt-1 text-2xl font-bold">{formatMoney(preview.amountDue, preview.currency)}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                Nothing is charged today. The unused time on your current plan is credited to your next
                invoice.
              </p>
            {/if}
          </div>
        {/if}

        {#if error}
          <Alert variant="destructive">
            <TriangleAlert class="h-4 w-4" />
            <AlertDescription>
              {error}.
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
                <span class="block mt-1">Your plan changes once the payment is confirmed.</span>
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
