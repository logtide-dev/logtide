<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { getApiUrl } from '$lib/config';
  import { currentOrganization } from '$lib/stores/organization';
  import {
    monitoringStore,
    selectedMonitor,
    monitorResults,
    monitorUptime,
    monitorSummary,
    monitorResponseTimes,
    monitorResponseTimeRange,
    monitorOutages,
    monitorDetailLoading,
    monitorDetailError,
  } from '$lib/stores/monitoring';
  import { toastStore } from '$lib/stores/toast';
  import type { ResponseTimeRange } from '$lib/api/monitoring';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import MonitorForm from '$lib/components/monitoring/MonitorForm.svelte';
  import OutagesList from '$lib/components/monitoring/OutagesList.svelte';
  import ResponseTimeChart from '$lib/components/monitoring/ResponseTimeChart.svelte';
  import UptimeBars from '$lib/components/monitoring/UptimeBars.svelte';
  import UptimeWindows from '$lib/components/monitoring/UptimeWindows.svelte';
  import { buildDaySlots, weightedUptime } from '$lib/components/monitoring/uptime-bars';
  import {
    errorCodeLabel,
    formatResponseTime,
    monitorStateLabel,
    monitorStateTone,
    monitorTitle,
    monitorTypeLabel,
  } from '$lib/components/monitoring/monitor-meta';
  import CheckCircle from '@lucide/svelte/icons/check-circle';
  import Pause from '@lucide/svelte/icons/pause';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Play from '@lucide/svelte/icons/play';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import XCircle from '@lucide/svelte/icons/x-circle';

  const monitorId = $derived(page.params.id);
  const org = $derived($currentOrganization);
  const monitor = $derived($selectedMonitor);
  const results = $derived($monitorResults);
  const uptime = $derived($monitorUptime);
  const summary = $derived($monitorSummary);
  const responseTimes = $derived($monitorResponseTimes);
  const responseRange = $derived($monitorResponseTimeRange);
  const outages = $derived($monitorOutages);
  const loading = $derived($monitorDetailLoading);
  const error = $derived($monitorDetailError);

  let editOpen = $state(false);
  let deleteOpen = $state(false);
  let toggling = $state(false);

  // The store drops answers for a monitor that is no longer current, so
  // navigating quickly between monitors never shows stale data.
  $effect(() => {
    const id = monitorId;
    const organization = org;
    if (organization && id) monitoringStore.loadDetail(id, organization.id);
    return () => monitoringStore.clearDetail();
  });

  const title = $derived(monitor ? monitorTitle(monitor) : 'Monitor');
  const tone = $derived(
    monitor ? monitorStateTone(monitor.status?.status ?? 'unknown', monitor.enabled) : null
  );
  const slots = $derived(buildDaySlots(uptime, 90));
  const overall90 = $derived(weightedUptime(slots));
  const detail = $derived(monitor?.status?.detail ?? null);
  const heartbeatUrl = $derived(monitor ? `${getApiUrl()}/api/v1/monitors/${monitor.id}/heartbeat` : '');

  function refresh() {
    if (org && monitorId) monitoringStore.loadDetail(monitorId, org.id);
  }

  function changeRange(range: ResponseTimeRange) {
    if (org && monitorId) monitoringStore.loadResponseTimes(monitorId, org.id, range);
  }

  async function toggleEnabled() {
    if (!org || !monitor) return;
    toggling = true;
    try {
      await monitoringStore.update(monitor.id, org.id, { enabled: !monitor.enabled });
      toastStore.success(monitor.enabled ? 'Monitor paused' : 'Monitor resumed');
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not update the monitor');
    } finally {
      toggling = false;
    }
  }

  async function confirmDelete() {
    if (!org || !monitor) return;
    try {
      await monitoringStore.delete(monitor.id, org.id);
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not delete the monitor');
      throw err;
    }
    toastStore.success('Monitor deleted');
    goto('/dashboard/uptime');
  }
</script>

<svelte:head>
  <title>{title} - Uptime - LogTide</title>
</svelte:head>

<div class="flex flex-col gap-2 p-6">
  <PageHeader
    {title}
    breadcrumbs={[{ label: 'Uptime', href: '/dashboard/uptime' }, { label: title }]}
  >
    {#snippet actions()}
      {#if monitor}
        <Button variant="outline" size="sm" onclick={() => (editOpen = true)}>
          <Pencil class="mr-2 h-4 w-4" />
          Edit
        </Button>
        <Button variant="outline" size="sm" onclick={toggleEnabled} disabled={toggling}>
          {#if monitor.enabled}
            <Pause class="mr-2 h-4 w-4" />
            Pause
          {:else}
            <Play class="mr-2 h-4 w-4" />
            Resume
          {/if}
        </Button>
        <Button variant="outline" size="sm" onclick={() => (deleteOpen = true)}>
          <Trash2 class="mr-2 h-4 w-4 text-destructive-text" />
          Delete
        </Button>
      {/if}
      <Button variant="outline" size="sm" onclick={refresh} aria-label="Refresh">
        <RefreshCw class="h-4 w-4" />
      </Button>
    {/snippet}
  </PageHeader>

  {#if loading && !monitor}
    <div class="flex items-center justify-center py-16">
      <RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  {:else if error}
    <EmptyState variant="error" title="Could not load this monitor" description={error}>
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={refresh}>Try again</Button>
      {/snippet}
    </EmptyState>
  {:else if monitor && tone}
    <div class="flex flex-col gap-6">
      <!-- Status -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-lg border bg-card p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</p>
          <div class="mt-2 flex items-center gap-2">
            <span class="h-3 w-3 rounded-full {tone.dot}" aria-hidden="true"></span>
            <span class="text-lg font-semibold {tone.text}">
              {monitorStateLabel(monitor.status?.status, monitor.enabled)}
            </span>
          </div>
          {#if monitor.status?.incidentId}
            <a
              href="/dashboard/incidents/{monitor.status.incidentId}"
              class="mt-2 inline-block text-xs text-destructive-text hover:underline"
            >
              View incident
            </a>
          {/if}
        </div>
        <div class="rounded-lg border bg-card p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Response time</p>
          <p class="mt-2 text-lg font-semibold">{formatResponseTime(monitor.status?.responseTimeMs)}</p>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Last checked</p>
          <p class="mt-2 text-sm font-semibold">
            {#if monitor.status?.lastCheckedAt}
              <Timestamp value={monitor.status.lastCheckedAt} />
            {:else}
              -
            {/if}
          </p>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Last error</p>
          <p class="mt-2 text-sm font-semibold">
            {monitor.status?.status === 'down' || monitor.status?.lastErrorCode
              ? errorCodeLabel(monitor.status?.lastErrorCode)
              : 'None'}
          </p>
        </div>
      </div>

      {#if monitor.type === 'ssl' && detail}
        <div class="rounded-lg border bg-card p-4 text-sm" data-testid="ssl-detail">
          <p class="font-medium">
            {#if typeof detail.daysRemaining === 'number'}
              Certificate {detail.daysRemaining < 0 ? 'expired' : 'expires in'}
              {Math.abs(detail.daysRemaining).toLocaleString('en-US')}
              {Math.abs(detail.daysRemaining) === 1 ? 'day' : 'days'}{detail.daysRemaining < 0 ? ' ago' : ''}
            {:else}
              Certificate details
            {/if}
          </p>
          <dl class="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
            {#if detail.expiresAt}
              <div>
                <dt class="text-muted-foreground">Expires</dt>
                <dd><Timestamp value={detail.expiresAt} precision="minute" /></dd>
              </div>
            {/if}
            {#if detail.issuer}
              <div>
                <dt class="text-muted-foreground">Issuer</dt>
                <dd class="break-words">{detail.issuer}</dd>
              </div>
            {/if}
            {#if detail.subject}
              <div>
                <dt class="text-muted-foreground">Subject</dt>
                <dd class="break-words">{detail.subject}</dd>
              </div>
            {/if}
          </dl>
        </div>
      {:else if monitor.type === 'dns' && detail?.records}
        <div class="rounded-lg border bg-card p-4 text-sm" data-testid="dns-detail">
          <p class="font-medium">Records at the last check</p>
          {#if detail.records.length === 0}
            <p class="mt-1 text-xs text-muted-foreground">No records returned.</p>
          {:else}
            <ul class="mt-2 space-y-1 font-mono text-xs">
              {#each detail.records as record, i (i)}
                <li class="break-all">{record}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <!-- Uptime -->
      {#if summary}
        <UptimeWindows windows={summary.windows} />
      {/if}

      <div class="rounded-lg border bg-card p-4">
        <ResponseTimeChart points={responseTimes} range={responseRange} onRangeChange={changeRange} />
      </div>

      <div class="rounded-lg border bg-card p-4">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-medium">Last 90 days</h2>
          <span class="text-xs text-muted-foreground">
            {overall90 === null
              ? 'No data yet'
              : `${overall90.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% uptime`}
          </span>
        </div>
        <UptimeBars {slots} />
      </div>

      <div class="rounded-lg border bg-card p-4">
        <h2 class="mb-3 text-sm font-medium">Outages</h2>
        <OutagesList {outages} />
      </div>

      <!-- Configuration and recent checks -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div class="rounded-lg border bg-card p-4">
          <h2 class="mb-3 text-sm font-medium">Configuration</h2>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between gap-2">
              <dt class="text-muted-foreground">Type</dt>
              <dd class="font-medium">{monitorTypeLabel(monitor.type)}</dd>
            </div>
            {#if monitor.target}
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">
                  {monitor.type === 'log_heartbeat' ? 'Service' : 'Target'}
                </dt>
                <dd class="max-w-[180px] truncate font-mono text-xs" title={monitor.target}>
                  {monitor.target}
                </dd>
              </div>
            {/if}
            <div class="flex justify-between gap-2">
              <dt class="text-muted-foreground">Interval</dt>
              <dd class="font-medium">{monitor.intervalSeconds.toLocaleString('en-US')} s</dd>
            </div>
            {#if monitor.type !== 'heartbeat' && monitor.type !== 'log_heartbeat'}
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">Timeout</dt>
                <dd class="font-medium">{monitor.timeoutSeconds.toLocaleString('en-US')} s</dd>
              </div>
            {/if}
            <div class="flex justify-between gap-2">
              <dt class="text-muted-foreground">Failure threshold</dt>
              <dd class="font-medium">{monitor.failureThreshold.toLocaleString('en-US')}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted-foreground">Auto-resolve</dt>
              <dd class="font-medium">{monitor.autoResolve ? 'Yes' : 'No'}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted-foreground">Severity</dt>
              <dd class="font-medium capitalize">{monitor.severity}</dd>
            </div>
            {#if monitor.groupName}
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">Group</dt>
                <dd class="font-medium">{monitor.groupName}</dd>
              </div>
            {/if}
            {#if monitor.type === 'http' && monitor.httpConfig}
              {#if monitor.httpConfig.method && monitor.httpConfig.method !== 'GET'}
                <div class="flex justify-between gap-2">
                  <dt class="text-muted-foreground">HTTP method</dt>
                  <dd class="font-medium">{monitor.httpConfig.method}</dd>
                </div>
              {/if}
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">Expected status</dt>
                <dd class="font-medium">{monitor.httpConfig.expectedStatus ?? 'Any 2xx'}</dd>
              </div>
            {/if}
            {#if monitor.type === 'ssl' && monitor.checkConfig && 'warnDays' in monitor.checkConfig}
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">Warn before expiry</dt>
                <dd class="font-medium">{monitor.checkConfig.warnDays.toLocaleString('en-US')} days</dd>
              </div>
            {/if}
            {#if monitor.type === 'dns' && monitor.checkConfig && 'recordType' in monitor.checkConfig}
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">Record type</dt>
                <dd class="font-medium">{monitor.checkConfig.recordType}</dd>
              </div>
              {#if monitor.checkConfig.expectedValue}
                <div class="flex justify-between gap-2">
                  <dt class="text-muted-foreground">Expected value</dt>
                  <dd class="max-w-[180px] truncate font-mono text-xs" title={monitor.checkConfig.expectedValue}>
                    {monitor.checkConfig.expectedValue}
                  </dd>
                </div>
              {/if}
            {/if}
          </dl>

          {#if monitor.type === 'heartbeat'}
            <div class="mt-4 border-t pt-4">
              <p class="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Heartbeat endpoint
              </p>
              <p class="mb-1 text-xs text-muted-foreground">Send a POST request to:</p>
              <div class="flex items-center gap-1">
                <code class="flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
                  POST {heartbeatUrl}
                </code>
                <CopyButton value={heartbeatUrl} ariaLabel="Copy heartbeat URL" />
              </div>
            </div>
          {/if}
          {#if monitor.type === 'log_heartbeat'}
            <div class="mt-4 border-t pt-4">
              <p class="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Log heartbeat
              </p>
              <p class="text-xs text-muted-foreground">
                This monitor checks that the service
                <code class="rounded bg-muted px-1">{monitor.target}</code>
                sent logs within the last
                {(monitor.gracePeriodSeconds ?? Math.round(monitor.intervalSeconds * 1.5)).toLocaleString('en-US')} s.
              </p>
            </div>
          {/if}
        </div>

        <div class="rounded-lg border bg-card p-4 lg:col-span-2">
          <h2 class="mb-3 text-sm font-medium">Recent checks</h2>
          {#if results.length === 0}
            <p class="text-sm text-muted-foreground">No checks yet.</p>
          {:else}
            <ul class="max-h-80 space-y-1 overflow-y-auto">
              {#each results.slice(0, 50) as result (result.id)}
                {@const resultTone = monitorStateTone(result.status, true)}
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50">
                  {#if result.status === 'up'}
                    <CheckCircle class="h-3.5 w-3.5 shrink-0 {resultTone.text}" aria-hidden="true" />
                  {:else}
                    <XCircle class="h-3.5 w-3.5 shrink-0 {resultTone.text}" aria-hidden="true" />
                  {/if}
                  <span class="shrink-0 text-muted-foreground">
                    <Timestamp value={result.time} precision="ms" />
                  </span>
                  <span class="w-10 shrink-0 font-medium {resultTone.text}">
                    {result.status === 'up' ? 'Up' : 'Down'}
                  </span>
                  {#if result.responseTimeMs != null}
                    <span class="text-muted-foreground">{formatResponseTime(result.responseTimeMs)}</span>
                  {/if}
                  {#if result.statusCode}
                    <span class="text-muted-foreground">HTTP {result.statusCode}</span>
                  {/if}
                  {#if result.errorCode}
                    <span class="text-muted-foreground">{errorCodeLabel(result.errorCode)}</span>
                  {/if}
                  {#if result.isHeartbeat}
                    <Badge variant="outline" class="py-0 text-xs">Heartbeat</Badge>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

{#if monitor && org}
  <MonitorForm
    bind:open={editOpen}
    mode="edit"
    {monitor}
    orgId={org.id}
    projectId={monitor.projectId}
    projects={[]}
    onSaved={refresh}
  />
  <ConfirmDialog
    bind:open={deleteOpen}
    title="Delete monitor"
    description={`This permanently deletes "${title}" and its check history. Its open incident, if any, is resolved.`}
    confirmLabel="Delete monitor"
    onConfirm={confirmDelete}
  />
{/if}
