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
    monitorDetailLoading,
    monitorDetailError,
  } from '$lib/stores/monitoring';
  import { toastStore } from '$lib/stores/toast';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Activity from '@lucide/svelte/icons/activity';
  import Globe from '@lucide/svelte/icons/globe';
  import Wifi from '@lucide/svelte/icons/wifi';
  import Heart from '@lucide/svelte/icons/heart';
  import CheckCircle from '@lucide/svelte/icons/check-circle';
  import XCircle from '@lucide/svelte/icons/x-circle';
  import Copy from '@lucide/svelte/icons/copy';

  const monitorId = $derived(page.params.id);
  const org = $derived($currentOrganization);
  const monitor = $derived($selectedMonitor);
  const results = $derived($monitorResults);
  const uptime = $derived($monitorUptime);
  const loading = $derived($monitorDetailLoading);
  const error = $derived($monitorDetailError);

  // File-local request-sequence guard: each load captures a sequence value and
  // the monitor id it was started for. When the user navigates quickly between
  // monitors the in-flight Promise.all from the previous monitor can resolve
  // after the new one started; bailing out here keeps a stale response from
  // being treated as the current monitor's data.
  let loadSeq = 0;

  function loadDetail(id: string, organizationId: string) {
    const seq = ++loadSeq;
    monitoringStore.loadDetail(id, organizationId).then(() => {
      if (seq !== loadSeq || page.params.id !== id) {
        // A newer load has started; re-load the monitor that is now current so
        // the rendered store state always matches the URL.
        const current = $currentOrganization;
        const currentId = page.params.id;
        if (current && currentId && currentId !== id) {
          loadDetail(currentId, current.id);
        }
      }
    });
  }

  $effect(() => {
    if (org && monitorId) {
      loadDetail(monitorId, org.id);
    }
    return () => monitoringStore.clearDetail();
  });

  function statusColor(status?: string) {
    if (status === 'up') return 'bg-green-500';
    if (status === 'down') return 'bg-red-500';
    return 'bg-gray-400';
  }

  function statusLabel(status?: string) {
    if (status === 'up') return 'Operational';
    if (status === 'down') return 'Down';
    return 'Unknown';
  }

  function uptimeColor(pct: number) {
    if (pct >= 99) return 'bg-green-500';
    if (pct >= 95) return 'bg-yellow-400';
    return 'bg-red-500';
  }

  function formatDate(d: string | null | undefined) {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-US');
  }

  function formatResponseTime(ms: number | null | undefined) {
    if (ms == null) return '-';
    return `${ms}ms`;
  }

  // Group uptime by last 30 days (most recent 30 buckets)
  const recentUptime = $derived(uptime.slice(-30));

  const overallUptime = $derived.by(() => {
    if (recentUptime.length === 0) return null;
    const total = recentUptime.reduce((sum, b) => sum + b.totalChecks, 0);
    const success = recentUptime.reduce((sum, b) => sum + b.successfulChecks, 0);
    return total > 0 ? ((success / total) * 100).toFixed(2) : null;
  });

  async function toggleEnabled() {
    if (!org || !monitor) return;
    try {
      await monitoringStore.update(monitor.id, org.id, { enabled: !monitor.enabled });
      toastStore.success(monitor.enabled ? 'Monitor paused' : 'Monitor resumed');
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Failed to update monitor');
    }
  }

  function refresh() {
    if (org && monitorId) {
      loadDetail(monitorId, org.id);
    }
  }

  async function copyHeartbeatUrl() {
    if (!monitor) return;
    const url = `${getApiUrl()}/api/v1/monitors/${monitor.id}/heartbeat`;
    try {
      await navigator.clipboard.writeText(url);
      toastStore.success('Heartbeat URL copied');
    } catch {
      toastStore.error('Failed to copy URL');
    }
  }
</script>

<svelte:head>
  <title>{monitor?.name ?? 'Monitor'} - LogTide</title>
</svelte:head>

<div class="flex flex-col gap-6 p-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-4">
      <Button variant="ghost" size="sm" onclick={() => goto('/dashboard/monitoring')}>
        <ArrowLeft class="h-4 w-4" />
      </Button>
      <h1 class="text-xl font-semibold">{monitor?.name ?? 'Monitor'}</h1>
    </div>
    <Button variant="outline" size="sm" onclick={refresh}>
      <RefreshCw class="h-4 w-4" />
    </Button>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-16">
      <RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  {:else if error}
    <div class="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
      {error}
    </div>
  {:else if monitor}
    <!-- Status card -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</p>
        <div class="mt-2 flex items-center gap-2">
          <span class="h-3 w-3 rounded-full {statusColor(monitor.status?.status)}"></span>
          <span class="text-lg font-semibold">{statusLabel(monitor.status?.status)}</span>
        </div>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Response time</p>
        <p class="mt-2 text-lg font-semibold">{formatResponseTime(monitor.status?.responseTimeMs)}</p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">30-day uptime</p>
        <p class="mt-2 text-lg font-semibold">
          {overallUptime != null ? `${overallUptime}%` : '-'}
        </p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Last checked</p>
        <p class="mt-2 text-sm font-semibold">{formatDate(monitor.status?.lastCheckedAt)}</p>
      </div>
    </div>

    <!-- Uptime history -->
    {#if recentUptime.length > 0}
      <div class="rounded-lg border bg-card p-4">
        <div class="mb-3 flex items-center justify-between">
          <p class="text-sm font-medium">30-day uptime</p>
          <span class="text-xs text-muted-foreground">
            {recentUptime[0]?.bucket ? new Date(recentUptime[0].bucket).toLocaleDateString('en-US') : ''} – today
          </span>
        </div>
        <div class="flex items-end gap-0.5 h-12">
          {#each recentUptime as bucket}
            <div
              class="flex-1 rounded-sm {uptimeColor(Number(bucket.uptimePct))} transition-all"
              style="height: {Math.max(8, (Number(bucket.uptimePct) / 100) * 48)}px; min-height: 4px"
              title="{new Date(bucket.bucket).toLocaleDateString('en-US')} - {Number(bucket.uptimePct).toFixed(1)}%"
            ></div>
          {/each}
        </div>
        <div class="mt-1.5 flex justify-between text-xs text-muted-foreground">
          <span>30 days ago</span>
          <span>Today</span>
        </div>
      </div>
    {/if}

    <!-- Config and recent results -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <!-- Config -->
      <div class="rounded-lg border bg-card p-4">
        <p class="mb-3 text-sm font-medium">Configuration</p>
        <dl class="space-y-2 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted-foreground">Type</dt>
            <dd class="font-medium">{monitor.type === 'log_heartbeat' ? 'Log Based' : monitor.type === 'heartbeat' ? 'Heartbeat (Push)' : monitor.type.toUpperCase()}</dd>
          </div>
          {#if monitor.type === 'log_heartbeat' && monitor.target}
            <div class="flex justify-between gap-2">
              <dt class="text-muted-foreground">Service</dt>
              <dd class="font-mono text-xs">{monitor.target}</dd>
            </div>
          {:else if monitor.target}
            <div class="flex justify-between gap-2">
              <dt class="text-muted-foreground">Target</dt>
              <dd class="font-mono text-xs truncate max-w-[180px]" title={monitor.target}>{monitor.target}</dd>
            </div>
          {/if}
          <div class="flex justify-between">
            <dt class="text-muted-foreground">Interval</dt>
            <dd class="font-medium">{monitor.intervalSeconds}s</dd>
          </div>
          {#if monitor.type !== 'heartbeat' && monitor.type !== 'log_heartbeat'}
            <div class="flex justify-between">
              <dt class="text-muted-foreground">Timeout</dt>
              <dd class="font-medium">{monitor.timeoutSeconds}s</dd>
            </div>
          {/if}
          <div class="flex justify-between">
            <dt class="text-muted-foreground">Failure threshold</dt>
            <dd class="font-medium">{monitor.failureThreshold}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted-foreground">Auto-resolve</dt>
            <dd class="font-medium">{monitor.autoResolve ? 'Yes' : 'No'}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted-foreground">Severity</dt>
            <dd class="font-medium capitalize">{monitor.severity}</dd>
          </div>
          {#if monitor.type === 'http' && monitor.httpConfig}
            {#if monitor.httpConfig.method && monitor.httpConfig.method !== 'GET'}
              <div class="flex justify-between">
                <dt class="text-muted-foreground">HTTP method</dt>
                <dd class="font-medium">{monitor.httpConfig.method}</dd>
              </div>
            {/if}
            {#if monitor.httpConfig.expectedStatus && monitor.httpConfig.expectedStatus !== 200}
              <div class="flex justify-between">
                <dt class="text-muted-foreground">Expected status</dt>
                <dd class="font-medium">{monitor.httpConfig.expectedStatus}</dd>
              </div>
            {/if}
          {/if}
        </dl>
        <div class="mt-4 pt-4 border-t flex justify-between items-center">
          <span class="text-sm text-muted-foreground">
            {monitor.enabled ? 'Active' : 'Paused'}
          </span>
          <Button variant="outline" size="sm" onclick={toggleEnabled}>
            {monitor.enabled ? 'Pause' : 'Resume'}
          </Button>
        </div>
        {#if monitor.type === 'heartbeat'}
          <div class="mt-4 pt-4 border-t">
            <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Heartbeat endpoint</p>
            <p class="text-xs text-muted-foreground mb-1">Send a POST request to:</p>
            <div class="flex items-center gap-1">
              <code class="flex-1 text-xs bg-muted rounded px-2 py-1.5 font-mono break-all">
                POST /api/v1/monitors/{monitor.id}/heartbeat
              </code>
              <Button variant="ghost" size="sm" onclick={copyHeartbeatUrl} title="Copy full URL">
                <Copy class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        {/if}
        {#if monitor.type === 'log_heartbeat'}
          <div class="mt-4 pt-4 border-t">
            <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Log-based monitoring</p>
            <p class="text-xs text-muted-foreground">
              This monitor checks if the service <code class="bg-muted rounded px-1">{monitor.target}</code> has sent logs within the last {monitor.gracePeriodSeconds ?? Math.round(monitor.intervalSeconds * 1.5)}s.
            </p>
          </div>
        {/if}
      </div>

      <!-- Recent results -->
      <div class="lg:col-span-2 rounded-lg border bg-card p-4">
        <p class="mb-3 text-sm font-medium">Recent checks</p>
        {#if results.length === 0}
          <p class="text-sm text-muted-foreground">No check results yet</p>
        {:else}
          <div class="space-y-1 max-h-80 overflow-y-auto">
            {#each results.slice(0, 50) as result (result.id)}
              <div class="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 text-xs">
                {#if result.status === 'up'}
                  <CheckCircle class="h-3.5 w-3.5 text-green-500 shrink-0" />
                {:else}
                  <XCircle class="h-3.5 w-3.5 text-red-500 shrink-0" />
                {/if}
                <span class="text-muted-foreground w-36 shrink-0">
                  {new Date(result.time).toLocaleString('en-US')}
                </span>
                <span class="{result.status === 'up' ? 'text-green-600' : 'text-red-600'} font-medium w-10 shrink-0">
                  {result.status === 'up' ? 'Up' : 'Down'}
                </span>
                {#if result.responseTimeMs != null}
                  <span class="text-muted-foreground w-16">{result.responseTimeMs}ms</span>
                {/if}
                {#if result.statusCode}
                  <span class="text-muted-foreground">HTTP {result.statusCode}</span>
                {/if}
                {#if result.errorCode}
                  <span class="text-muted-foreground italic">{result.errorCode}</span>
                {/if}
                {#if result.isHeartbeat}
                  <Badge variant="outline" class="text-xs py-0">heartbeat</Badge>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
