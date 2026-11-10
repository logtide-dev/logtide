<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { HardwareEvent, HardwareHostDetailResponse } from '@logtide/shared';
  import { currentOrganization } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import {
    deleteHardwareHost,
    getHardwareHost,
    getHardwareHostEvents,
    updateHardwareHost,
  } from '$lib/api/hardware';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import ComponentChips from '$lib/components/hardware/ComponentChips.svelte';
  import HardwareComponentSections from '$lib/components/hardware/HardwareComponentSections.svelte';
  import HardwareEventsList from '$lib/components/hardware/HardwareEventsList.svelte';
  import HardwareFindings from '$lib/components/hardware/HardwareFindings.svelte';
  import HardwareStatusBadge from '$lib/components/hardware/HardwareStatusBadge.svelte';
  import {
    buildHardwareLogsUrl,
    collectorHint,
    HARDWARE_PACK_URL,
  } from '$lib/components/hardware/hardware-meta';
  import Bell from '@lucide/svelte/icons/bell';
  import BellOff from '@lucide/svelte/icons/bell-off';
  import Check from '@lucide/svelte/icons/check';
  import Info from '@lucide/svelte/icons/info';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  const REFRESH_MS = 60_000;
  const EVENTS_LIMIT = 50;

  const hostId = $derived(page.params.id);
  const org = $derived($currentOrganization);
  const canManage = $derived(org?.role === 'owner' || org?.role === 'admin');

  let data = $state<HardwareHostDetailResponse | null>(null);
  let events = $state<HardwareEvent[]>([]);
  let eventsError = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let muting = $state(false);
  let forgetOpen = $state(false);

  const host = $derived(data?.host ?? null);
  const unavailableCollectors = $derived((host?.collectors ?? []).filter((c) => !c.ok));

  // Newest request wins, so quick navigation between hosts never shows stale data.
  let seq = 0;

  async function load(id: string, silent: boolean) {
    const mine = ++seq;
    if (!silent) loading = true;
    const [detailRes, eventsRes] = await Promise.allSettled([
      getHardwareHost(id),
      getHardwareHostEvents(id, EVENTS_LIMIT),
    ]);
    if (mine !== seq) return;
    if (detailRes.status === 'fulfilled') {
      data = detailRes.value;
      error = null;
    } else if (!silent || !data) {
      error = detailRes.reason instanceof Error ? detailRes.reason.message : 'Could not load this host';
      if (!silent) data = null;
    }
    if (eventsRes.status === 'fulfilled') {
      events = eventsRes.value.events ?? [];
      eventsError = null;
    } else {
      eventsError = eventsRes.reason instanceof Error ? eventsRes.reason.message : 'Could not load events';
      if (!silent) events = [];
    }
    loading = false;
  }

  $effect(() => {
    const id = hostId;
    if (!id) return;
    data = null;
    events = [];
    error = null;
    void load(id, false);
    const timer = setInterval(() => void load(id, true), REFRESH_MS);
    return () => {
      clearInterval(timer);
      seq++;
    };
  });

  function refresh() {
    if (hostId) void load(hostId, false);
  }

  async function toggleMute() {
    if (!host) return;
    muting = true;
    const next = !host.muted;
    try {
      await updateHardwareHost(host.id, { muted: next });
      toastStore.success(next ? 'Host muted' : 'Host unmuted');
      await load(host.id, true);
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not update the host');
    } finally {
      muting = false;
    }
  }

  async function confirmForget() {
    if (!host) return;
    try {
      await deleteHardwareHost(host.id);
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not forget the host');
      throw err;
    }
    toastStore.success('Host forgotten');
    goto('/dashboard/hardware');
  }

  const title = $derived(host?.hostName ?? 'Host');
</script>

<svelte:head>
  <title>{title} - Hardware - LogTide</title>
</svelte:head>

<div class="flex flex-col gap-2 p-6">
  <PageHeader
    {title}
    breadcrumbs={[{ label: 'Hardware', href: '/dashboard/hardware' }, { label: title }]}
  >
    {#snippet actions()}
      {#if host && canManage}
        <Button variant="outline" size="sm" onclick={toggleMute} disabled={muting}>
          {#if host.muted}
            <Bell class="mr-2 h-4 w-4" />
            Unmute
          {:else}
            <BellOff class="mr-2 h-4 w-4" />
            Mute
          {/if}
        </Button>
        <Button variant="outline" size="sm" onclick={() => (forgetOpen = true)}>
          <Trash2 class="mr-2 h-4 w-4 text-destructive-text" />
          Forget host
        </Button>
      {/if}
      <Button variant="outline" size="sm" onclick={refresh} aria-label="Refresh">
        <RefreshCw class="h-4 w-4" />
      </Button>
    {/snippet}
  </PageHeader>

  {#if loading && !host}
    <div class="flex items-center justify-center py-16">
      <RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  {:else if error && !host}
    <EmptyState variant="error" title="Could not load this host" description={error}>
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={refresh}>Try again</Button>
        <Button variant="ghost" size="sm" href="/dashboard/hardware">Back to hosts</Button>
      {/snippet}
    </EmptyState>
  {:else if host && data}
    <div class="flex flex-col gap-4">
      <!-- Header -->
      <div class="rounded-lg border bg-card p-4" data-testid="host-header">
        <div class="flex flex-wrap items-center gap-2">
          <HardwareStatusBadge status={host.status} />
          {#if host.isVirtual}
            <Badge variant="outline" class="py-0 text-[11px]">VM</Badge>
          {/if}
          {#if host.muted}
            <Badge variant="secondary" class="gap-1 py-0 text-[11px]" data-testid="muted-badge">
              <BellOff class="h-3 w-3" aria-hidden="true" />
              Muted
            </Badge>
          {/if}
          <div class="ml-auto"><ComponentChips components={host.components} /></div>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <dt class="text-xs text-muted-foreground">Vendor</dt>
            <dd class="break-words">{host.info.vendor ?? '-'}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">Model</dt>
            <dd class="break-words">{host.info.model ?? '-'}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">Kernel</dt>
            <dd class="break-words font-mono text-xs">{host.info.kernel ?? '-'}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">Agent version</dt>
            <dd class="break-words font-mono text-xs">{host.info.agentVersion ?? '-'}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">Last seen</dt>
            <dd>
              {#if host.lastSeenAt}<Timestamp value={host.lastSeenAt} precision="minute" />{:else}Never{/if}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">Last evaluated</dt>
            <dd data-testid="last-evaluated">
              {#if host.lastEvaluatedAt}<Timestamp value={host.lastEvaluatedAt} precision="minute" />{:else}Not yet{/if}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">Status since</dt>
            <dd><Timestamp value={host.statusChangedAt} precision="minute" /></dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">First seen</dt>
            <dd><Timestamp value={host.firstSeenAt} precision="minute" /></dd>
          </div>
        </dl>
      </div>

      {#if host.status === 'stale'}
        <div
          class="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm"
          role="status"
          data-testid="stale-banner"
        >
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-warning-text" aria-hidden="true" />
          <p>
            This host stopped reporting{#if host.lastSeenAt}
              (last data <Timestamp value={host.lastSeenAt} relative />){/if}.
            The agent may be stopped or the host may be down. The values below are the last known ones.
          </p>
        </div>
      {/if}

      {#if host.isVirtual}
        <div
          class="flex items-start gap-3 rounded-lg border border-info/30 bg-info/10 p-4 text-sm"
          role="status"
          data-testid="vm-banner"
        >
          <Info class="mt-0.5 h-4 w-4 shrink-0 text-info-text" aria-hidden="true" />
          <p>
            This host is a virtual machine. Disk SMART data, temperatures, fans and power sensors are not
            exposed inside a VM, so those sections stay empty. Run the agent on the hypervisor to monitor the
            physical hardware.
          </p>
        </div>
      {/if}

      <HardwareFindings findings={host.findings} muted={host.muted} />

      <!-- Collectors -->
      <section class="rounded-lg border bg-card" aria-labelledby="hw-collectors-title" data-testid="collectors">
        <div class="px-4 py-3">
          <h2 id="hw-collectors-title" class="text-sm font-medium">Collectors</h2>
          {#if host.collectors.length === 0}
            <p class="mt-1 text-sm text-muted-foreground">The agent has not reported collector status yet.</p>
          {:else}
            <ul class="mt-2 flex flex-wrap gap-2">
              {#each host.collectors as c (c.collector)}
                <li
                  class="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs {c.ok
                    ? 'border-border text-muted-foreground'
                    : 'border-warning/30 bg-warning/15 text-warning-text'}"
                  data-testid="collector-{c.collector}"
                  data-ok={c.ok}
                  title={c.ok ? 'Working' : collectorHint(c.collector)}
                >
                  {#if c.ok}<Check class="h-3 w-3" aria-hidden="true" />{:else}<TriangleAlert class="h-3 w-3" aria-hidden="true" />{/if}
                  {c.collector}
                </li>
              {/each}
            </ul>
            {#if unavailableCollectors.length > 0}
              <ul class="mt-2 space-y-0.5 text-xs text-muted-foreground" data-testid="collector-hints">
                {#each unavailableCollectors as c (c.collector)}
                  <li><span class="font-mono">{c.collector}</span>: {collectorHint(c.collector)}</li>
                {/each}
              </ul>
            {/if}
          {/if}
        </div>
      </section>

      <HardwareComponentSections snapshot={host.snapshot} series={data.series ?? []} />

      <!-- Events -->
      <section class="rounded-lg border bg-card" aria-labelledby="hw-events-title" data-testid="events-section">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 id="hw-events-title" class="text-sm font-medium">Recent hardware events</h2>
          <a
            class="text-xs text-primary-text hover:underline"
            href={buildHardwareLogsUrl(host.projectId, host.hostName)}
          >
            View in Logs
          </a>
        </div>
        {#if eventsError}
          <p class="px-4 py-3 text-sm text-destructive-text" role="alert">Could not load events: {eventsError}</p>
        {:else if events.length === 0}
          <p class="px-4 py-3 text-sm text-muted-foreground" data-testid="no-events">
            No hardware events in the last 7 days.
          </p>
        {:else}
          <HardwareEventsList {events} />
        {/if}
        <div class="border-t px-4 py-3 text-xs text-muted-foreground">
          Get notified about kernel and BMC hardware events:
          <a class="text-primary-text hover:underline" href={HARDWARE_PACK_URL} data-testid="pack-link">
            enable the Hardware Health detection pack
          </a>
          in Alerts.
        </div>
      </section>
    </div>
  {/if}
</div>

{#if host}
  <ConfirmDialog
    bind:open={forgetOpen}
    title="Forget host"
    description={`This removes "${host.hostName}" and its health state from LogTide. The host reappears if the agent keeps sending data. Metrics and logs already stored are kept.`}
    confirmLabel="Forget host"
    onConfirm={confirmForget}
  />
{/if}
