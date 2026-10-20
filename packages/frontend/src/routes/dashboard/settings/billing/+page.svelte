<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { organizationStore } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import { billingAPI, BillingApiError, billingErrorText, type PaidPlanId } from '$lib/api/billing';
  import { getCapabilityUsage, type CapabilityUsage } from '$lib/api/usage';
  import {
    canManageMembers,
    type BillingInterval,
    type BillingInvoice,
    type BillingOverview,
    type OrganizationWithRole,
  } from '@logtide/shared';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from '$lib/components/ui/alert-dialog';
  import Spinner from '$lib/components/Spinner.svelte';
  import QuotaStateBadge from '$lib/components/QuotaStateBadge.svelte';
  import CurrentPlanCard from '$lib/components/billing/CurrentPlanCard.svelte';
  import PlanPicker from '$lib/components/billing/PlanPicker.svelte';
  import InvoicesCard from '$lib/components/billing/InvoicesCard.svelte';
  import ChangePlanDialog from '$lib/components/billing/ChangePlanDialog.svelte';
  import EmbeddedCheckoutDialog from '$lib/components/billing/EmbeddedCheckoutDialog.svelte';
  import { asSentence, formatBillingDate, isCustomPlan, TELEMETRY_QUOTA } from '$lib/utils/billing';
  import { capBarColor, capPercent, formatBytes } from '$lib/utils/usage-capabilities';
  import Gauge from '@lucide/svelte/icons/gauge';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Lock from '@lucide/svelte/icons/lock';
  import CloudOff from '@lucide/svelte/icons/cloud-off';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Check from '@lucide/svelte/icons/check';

  let currentOrg = $state<OrganizationWithRole | null>(null);
  const unsubOrg = organizationStore.subscribe((state) => {
    currentOrg = state.currentOrganization;
  });
  onDestroy(unsubOrg);

  const canManage = $derived(currentOrg ? canManageMembers(currentOrg.role) : false);

  let overview = $state<BillingOverview | null>(null);
  let overviewError = $state<string | null>(null);
  // 404 on the overview: the seam is off (page opened by URL). Not retryable.
  let billingMissing = $state(false);
  let capabilities = $state<CapabilityUsage[] | null>(null);

  let invoices = $state<BillingInvoice[]>([]);
  let invoicesLoading = $state(false);
  let invoicesError = $state<string | null>(null);

  let interval = $state<BillingInterval>('month');
  let busy = $state(false);
  let cancelOpen = $state(false);
  let changeOpen = $state(false);
  let checkoutOpen = $state(false);
  let checkoutKind = $state<'subscribe' | 'payment-method'>('subscribe');
  let checkoutTarget = $state<{ plan: PaidPlanId; interval: BillingInterval } | null>(null);
  let changeTarget = $state<{ plan: PaidPlanId; interval: BillingInterval } | null>(null);

  // Responses for an org the user already switched away from are dropped.
  let lastLoadedOrgId: string | null = null;
  let overviewSeq = 0;
  let invoicesSeq = 0;

  $effect(() => {
    if (browser && currentOrg && canManage && currentOrg.id !== lastLoadedOrgId) {
      lastLoadedOrgId = currentOrg.id;
      void loadAll(currentOrg.id);
    }
  });

  function isCurrentOrg(orgId: string): boolean {
    return currentOrg?.id === orgId;
  }

  async function loadAll(orgId: string) {
    void loadInvoices(orgId);
    const seq = ++overviewSeq;
    overview = null;
    overviewError = null;
    billingMissing = false;
    try {
      // Capabilities decide "custom plan", so they land together with the
      // overview (no flash of the plan picker). Their failure only hides the
      // usage bar.
      const [o, caps] = await Promise.all([
        billingAPI.getOverview(orgId),
        getCapabilityUsage(orgId)
          .then((r) => r.capabilities)
          .catch(() => null),
      ]);
      if (seq !== overviewSeq) return;
      overview = o;
      capabilities = caps;
      interval = o.current.interval ?? 'month';
    } catch (e) {
      if (seq !== overviewSeq) return;
      billingMissing = e instanceof BillingApiError && e.status === 404;
      overviewError = billingErrorText(e);
    }
  }

  async function loadInvoices(orgId: string) {
    const seq = ++invoicesSeq;
    invoicesLoading = true;
    invoicesError = null;
    try {
      const r = await billingAPI.getInvoices(orgId);
      if (seq !== invoicesSeq) return;
      invoices = r.invoices;
    } catch (e) {
      if (seq !== invoicesSeq) return;
      invoicesError = `Invoices could not be loaded. ${asSentence(billingErrorText(e))}`;
    } finally {
      if (seq === invoicesSeq) invoicesLoading = false;
    }
  }

  function retry() {
    if (currentOrg) void loadAll(currentOrg.id);
  }

  const isCustom = $derived(overview ? isCustomPlan(overview.current, capabilities) : false);
  const telemetry = $derived(capabilities?.find((c) => c.capability === TELEMETRY_QUOTA) ?? null);
  const telemetryPct = $derived(telemetry ? capPercent(telemetry) : null);

  const currentPlanName = $derived(
    overview ? (overview.plans.find((p) => p.id === overview!.current.plan)?.name ?? overview.current.plan) : ''
  );
  const freePlan = $derived(overview?.plans.find((p) => p.id === 'free') ?? null);
  const periodEnd = $derived(formatBillingDate(overview?.current.currentPeriodEnd));

  function scrollToPlans() {
    document.getElementById('billing-plans')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function openChange(plan: PaidPlanId, target: BillingInterval) {
    changeTarget = { plan, interval: target };
    changeOpen = true;
  }

  function openSubscribe(plan: PaidPlanId, target: BillingInterval) {
    checkoutKind = 'subscribe';
    checkoutTarget = { plan, interval: target };
    checkoutOpen = true;
  }

  function openUpdateCard() {
    checkoutKind = 'payment-method';
    checkoutTarget = null;
    checkoutOpen = true;
  }

  function onCheckoutDone(next: BillingOverview) {
    overview = next;
    interval = next.current.interval ?? interval;
    if (checkoutKind === 'subscribe') {
      const name = next.plans.find((p) => p.id === next.current.plan)?.name ?? next.current.plan;
      toastStore.success(`Your plan is now ${name}`);
    } else {
      toastStore.success('Your payment card was updated');
    }
    if (currentOrg) void loadInvoices(currentOrg.id);
  }

  // Whatever happened in the dialog (a payment that is still settling, a
  // closed window), the page shows the server's current state afterwards.
  async function refreshOverview() {
    const orgId = currentOrg?.id;
    if (!orgId) return;
    try {
      const next = await billingAPI.getOverview(orgId);
      if (isCurrentOrg(orgId)) overview = next;
    } catch {
      // Keep what is on screen.
    }
  }

  function onChanged(next: BillingOverview) {
    overview = next;
    interval = next.current.interval ?? interval;
    const name = next.plans.find((p) => p.id === next.current.plan)?.name ?? next.current.plan;
    toastStore.success(`Your plan is now ${name}, billed ${next.current.interval === 'year' ? 'annually' : 'monthly'}`);
    // An upgrade issues a prorated invoice right away.
    if (currentOrg) void loadInvoices(currentOrg.id);
  }

  async function confirmCancel() {
    if (!currentOrg || busy) return;
    const orgId = currentOrg.id;
    busy = true;
    try {
      const next = await billingAPI.cancel(orgId);
      if (!isCurrentOrg(orgId)) return;
      overview = next;
      toastStore.success(`Your subscription ends on ${formatBillingDate(next.current.currentPeriodEnd)}`);
    } catch (e) {
      toastStore.error(billingErrorText(e));
    } finally {
      busy = false;
      cancelOpen = false;
    }
  }

  async function resume() {
    if (!currentOrg || busy) return;
    const orgId = currentOrg.id;
    busy = true;
    try {
      const next = await billingAPI.resume(orgId);
      if (!isCurrentOrg(orgId)) return;
      overview = next;
      toastStore.success(`Your subscription renews on ${formatBillingDate(next.current.currentPeriodEnd)}`);
    } catch (e) {
      toastStore.error(billingErrorText(e));
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Billing - LogTide</title>
</svelte:head>

<div class="space-y-6">
  {#if currentOrg && !canManage}
    <Card>
      <CardContent class="py-12 text-center">
        <Lock class="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p class="mt-3 font-medium">Only organization owners and admins can manage billing.</p>
        <p class="mt-1 text-sm text-muted-foreground">
          Ask an owner of {currentOrg.name} if you need a different plan.
        </p>
        <Button variant="outline" size="sm" class="mt-4" href="/dashboard/settings/usage">View usage</Button>
      </CardContent>
    </Card>
  {:else if billingMissing}
    <Card>
      <CardContent class="py-12 text-center">
        <CloudOff class="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p class="mt-3 font-medium">Billing is not available on this instance</p>
        <p class="mt-1 text-sm text-muted-foreground">
          Plans and limits on this LogTide instance are managed by its administrator.
        </p>
        <Button variant="outline" size="sm" class="mt-4" href="/dashboard/settings/usage">View usage</Button>
      </CardContent>
    </Card>
  {:else if overviewError}
    <Card>
      <CardContent class="py-12 text-center">
        <CloudOff class="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p class="mt-3 font-medium">{overviewError}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          Your plan and limits are not affected. Try again in a moment.
        </p>
        <Button variant="outline" size="sm" class="mt-4" onclick={retry}>
          <RotateCcw class="mr-1.5 h-4 w-4" />
          Retry
        </Button>
      </CardContent>
    </Card>
  {:else if !overview}
    <Card>
      <CardContent class="flex justify-center py-16">
        <Spinner />
      </CardContent>
    </Card>
  {:else}
    <CurrentPlanCard
      {overview}
      {isCustom}
      {busy}
      onChangePlan={scrollToPlans}
      onCancel={() => (cancelOpen = true)}
      onResume={resume}
      onUpdateCard={openUpdateCard}
    />

    <Card>
      <CardHeader class="pb-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1.5">
            <CardTitle class="text-base flex items-center gap-2">
              <Gauge class="h-4 w-4 text-muted-foreground" />
              Usage this month
            </CardTitle>
            <CardDescription>Logs, traces and metrics share one monthly quota</CardDescription>
          </div>
          <Button variant="outline" size="sm" href="/dashboard/settings/usage">
            View usage
            <ArrowRight class="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {#if telemetry}
          <div class="space-y-1.5">
            <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span class="font-medium">
                Telemetry (logs, traces and metrics)
                <QuotaStateBadge state={telemetry.state} />
              </span>
              <span class="whitespace-nowrap text-muted-foreground">
                {formatBytes(telemetry.current)} / {telemetry.limit === null ? '∞' : formatBytes(telemetry.limit)}
                {#if telemetryPct !== null}
                  <span class="ml-1 font-semibold text-foreground">({telemetryPct}%)</span>
                {/if}
              </span>
            </div>
            {#if telemetryPct !== null}
              <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full transition-all {capBarColor(telemetryPct)}"
                  style="width: {Math.min(100, telemetryPct)}%"
                ></div>
              </div>
            {:else}
              <p class="text-xs text-muted-foreground">Unlimited</p>
            {/if}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">Usage is not available right now.</p>
        {/if}
      </CardContent>
    </Card>

    {#if !isCustom}
      <PlanPicker
        plans={overview.plans}
        current={overview.current}
        checkoutEnabled={overview.checkoutEnabled}
        publishableKey={overview.publishableKey}
        bind:interval
        {busy}
        onSubscribe={openSubscribe}
        onSwitch={openChange}
        onDowngrade={() => (cancelOpen = true)}
      />
    {/if}

    <InvoicesCard
      {invoices}
      loading={invoicesLoading}
      error={invoicesError}
      onRetry={() => currentOrg && loadInvoices(currentOrg.id)}
    />

    <EmbeddedCheckoutDialog
      bind:open={checkoutOpen}
      orgId={currentOrg?.id ?? ''}
      kind={checkoutKind}
      plan={checkoutTarget?.plan}
      interval={checkoutTarget?.interval}
      onDone={onCheckoutDone}
      onClose={refreshOverview}
    />

    <ChangePlanDialog
      bind:open={changeOpen}
      orgId={currentOrg?.id ?? ''}
      target={changeTarget}
      current={overview.current}
      plans={overview.plans}
      {onChanged}
    />

    <AlertDialog bind:open={cancelOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel your {currentPlanName} subscription?</AlertDialogTitle>
          <AlertDialogDescription>
            Your organization keeps {currentPlanName} until {periodEnd}. After that the Free plan limits
            apply. You can resume any time before then.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {#if freePlan && freePlan.highlights.length > 0}
          <div class="rounded-lg bg-muted/50 p-4">
            <p class="text-xs font-medium text-muted-foreground">The Free plan includes</p>
            <ul class="mt-2 space-y-1.5 text-sm">
              {#each freePlan.highlights as highlight (highlight)}
                <li class="flex items-start gap-2">
                  <Check class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{highlight}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep subscription</AlertDialogCancel>
          <AlertDialogAction
            onclick={confirmCancel}
            disabled={busy}
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? 'Cancelling...' : 'Cancel subscription'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  {/if}
</div>
