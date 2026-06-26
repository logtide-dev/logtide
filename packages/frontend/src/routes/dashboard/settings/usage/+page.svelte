<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { organizationStore } from '$lib/stores/organization';
  import { getUsage, getUsageBreakdown, getStorageUsage, getCapabilityUsage, type UsageRecord, type UsageBreakdown, type StorageUsageResponse, type CapabilityUsage } from '$lib/api/usage';
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
  } from '$lib/components/ui/card';
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from '$lib/components/ui/table';
  import { Button } from '$lib/components/ui/button';
  import Spinner from '$lib/components/Spinner.svelte';
  import type { OrganizationWithRole } from '@logtide/shared';
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Gauge from '@lucide/svelte/icons/gauge';

  // TODO(#214): entitlements/limits editor goes here once feature #214 backend is shipped

  const RANGES = [
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 30 days', days: 30 },
    { label: 'Last 90 days', days: 90 },
  ] as const;

  type RangeDays = (typeof RANGES)[number]['days'];

  let currentOrg = $state<OrganizationWithRole | null>(null);
  let selectedDays = $state<RangeDays>(30);

  let loading = $state(false);
  let error = $state('');

  // Raw API data per groupBy
  let byDayEvents = $state<UsageRecord[]>([]);
  let byDayBytes = $state<UsageRecord[]>([]);
  let breakdown = $state<UsageBreakdown | null>(null);
  let storage = $state<StorageUsageResponse | null>(null);
  let capabilities = $state<CapabilityUsage[]>([]);

  let lastLoadedOrgId = $state<string | null>(null);
  let lastLoadedDays = $state<number | null>(null);

  const unsubOrg = organizationStore.subscribe((state) => {
    currentOrg = state.currentOrganization;
  });

  onDestroy(() => {
    unsubOrg();
  });

  $effect(() => {
    if (
      browser &&
      currentOrg &&
      (currentOrg.id !== lastLoadedOrgId || selectedDays !== lastLoadedDays)
    ) {
      lastLoadedOrgId = currentOrg.id;
      lastLoadedDays = selectedDays;
      void load();
    }
  });

  async function load() {
    if (!currentOrg) return;
    loading = true;
    error = '';
    storage = null;
    try {
      const to = new Date().toISOString();
      const from = new Date(Date.now() - selectedDays * 86_400_000).toISOString();
      const orgId = currentOrg.id;

      const [dayEvt, dayByt, bd, stor, caps] = await Promise.all([
        getUsage({ organizationId: orgId, from, to, groupBy: 'day', type: 'logs.ingested.events' }),
        getUsage({ organizationId: orgId, from, to, groupBy: 'day', type: 'logs.ingested.bytes' }),
        getUsageBreakdown({ organizationId: orgId, from, to }),
        getStorageUsage({ organizationId: orgId, from, to }).catch(() => null),
        getCapabilityUsage(orgId).catch(() => ({ capabilities: [] })),
      ]);

      byDayEvents = dayEvt.usage;
      byDayBytes = dayByt.usage;
      breakdown = bd.breakdown;
      storage = stor;
      capabilities = caps.capabilities;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load usage data';
    } finally {
      loading = false;
    }
  }

  // Totals
  let totalEvents = $derived(byDayEvents.reduce((s, r) => s + r.quantity, 0));
  let totalBytes = $derived(byDayBytes.reduce((s, r) => s + r.quantity, 0));

  // By-day table: merge events + bytes into one row per date
  interface DayRow {
    date: string;
    events: number;
    bytes: number;
  }

  let dailyRows = $derived.by<DayRow[]>(() => {
    const map = new Map<string, DayRow>();
    for (const r of byDayEvents) {
      const d = r.bucket ?? '';
      if (!map.has(d)) map.set(d, { date: d, events: 0, bytes: 0 });
      map.get(d)!.events += r.quantity;
    }
    for (const r of byDayBytes) {
      const d = r.bucket ?? '';
      if (!map.has(d)) map.set(d, { date: d, events: 0, bytes: 0 });
      map.get(d)!.bytes += r.quantity;
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  });

  function formatBytes(n: number): string {
    if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
    if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MB`;
    if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB`;
    return `${n} B`;
  }

  function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString('en-US');
  }

  function formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatTypeQty(type: string, qty: number): string {
    return type.endsWith('.bytes') ? formatBytes(qty) : formatCount(qty);
  }

  // Friendly labels + unit per measurable capability. Bytes-kind caps format as
  // bytes; everything else as a count.
  const CAP_META: Record<string, { label: string; unit: 'count' | 'bytes' }> = {
    'alerts.max_rules': { label: 'Alert rules', unit: 'count' },
    'notifications.max_channels': { label: 'Notification channels', unit: 'count' },
    'apikeys.max': { label: 'API keys', unit: 'count' },
    'sigma.max_active_rules': { label: 'Active Sigma rules', unit: 'count' },
    'dashboards.max_custom': { label: 'Custom dashboards', unit: 'count' },
    'ingestion.max_events_monthly': { label: 'Events (this month)', unit: 'count' },
    'ingestion.max_bytes_monthly': { label: 'Ingested bytes (this month)', unit: 'bytes' },
    'storage.max_bytes': { label: 'Storage used', unit: 'bytes' },
    'tracing.max_spans_monthly': { label: 'Spans (this month)', unit: 'count' },
  };

  function capLabel(c: CapabilityUsage): string {
    return CAP_META[c.capability]?.label ?? c.capability;
  }

  function capFormat(c: CapabilityUsage, n: number): string {
    return CAP_META[c.capability]?.unit === 'bytes' ? formatBytes(n) : formatCount(n);
  }

  // Only a null limit means unlimited (no percentage). A limit of 0 is the
  // opposite (fully restricted), so it must render as at/over limit, not unlimited.
  // Capped at 999 to avoid runaway labels.
  function capPercent(c: CapabilityUsage): number | null {
    if (c.limit === null) return null;
    if (c.limit <= 0) return c.current > 0 ? 999 : 100;
    return Math.min(999, Math.round((c.current / c.limit) * 100));
  }

  // green < 80%, amber 80-99%, red >= 100% (over limit).
  function capBarColor(pct: number): string {
    if (pct >= 100) return 'bg-destructive';
    if (pct >= 80) return 'bg-amber-500';
    return 'bg-green-500';
  }

  // Capabilities with a configured limit come first (the actionable ones),
  // unlimited ones after; stable within each group by registry order.
  let sortedCapabilities = $derived(
    [...capabilities].sort((a, b) => {
      const al = a.limit === null ? 1 : 0;
      const bl = b.limit === null ? 1 : 0;
      return al - bl;
    })
  );

  let hasAnyLimit = $derived(capabilities.some((c) => c.limit !== null));
</script>

<svelte:head>
  <title>Usage - LogTide</title>
</svelte:head>

<div class="space-y-6">
  <!-- Header row with range selector -->
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div class="flex items-center gap-1 rounded-md border p-1 bg-muted/50">
      {#each RANGES as range}
        <button
          type="button"
          onclick={() => { selectedDays = range.days; }}
          class="px-3 py-1 rounded text-sm font-medium transition-colors {selectedDays === range.days
            ? 'bg-background shadow-sm text-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
        >
          {range.label}
        </button>
      {/each}
    </div>
    <Button variant="outline" size="sm" onclick={() => load()} disabled={loading}>
      <RotateCcw class="h-4 w-4 mr-1.5 {loading ? 'animate-spin' : ''}" />
      Refresh
    </Button>
  </div>

  {#if error}
    <p class="text-sm text-destructive">{error}</p>
  {/if}

  <!-- Summary cards -->
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">Events ingested</CardTitle>
        <BarChart3 class="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {#if loading}
          <Spinner size="sm" />
        {:else}
          <div class="text-2xl font-bold">{formatCount(totalEvents)}</div>
          <p class="text-xs text-muted-foreground mt-1">
            {RANGES.find((r) => r.days === selectedDays)?.label ?? ''}
          </p>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">Bytes ingested</CardTitle>
        <BarChart3 class="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {#if loading}
          <Spinner size="sm" />
        {:else}
          <div class="text-2xl font-bold">{formatBytes(totalBytes)}</div>
          <p class="text-xs text-muted-foreground mt-1">
            {RANGES.find((r) => r.days === selectedDays)?.label ?? ''}
          </p>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">Current storage (estimated)</CardTitle>
        <BarChart3 class="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {#if loading}
          <Spinner size="sm" />
        {:else}
          <div class="text-2xl font-bold">{storage ? formatBytes(storage.current) : '—'}</div>
          <p class="text-xs text-muted-foreground mt-1">
            Logical bytes within retention · daily snapshot
          </p>
        {/if}
      </CardContent>
    </Card>
  </div>

  <!-- Capability usage vs plan limits -->
  <Card>
    <CardHeader class="pb-3">
      <CardTitle class="text-base flex items-center gap-2">
        <Gauge class="h-4 w-4 text-muted-foreground" />
        Plan limits
      </CardTitle>
      <CardDescription>
        Current usage against your organization's configured capability limits
      </CardDescription>
    </CardHeader>
    <CardContent>
      {#if loading}
        <div class="flex justify-center py-10">
          <Spinner />
        </div>
      {:else if capabilities.length === 0}
        <div class="py-10 text-center">
          <Gauge class="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p class="mt-3 text-sm text-muted-foreground">No capability data available.</p>
        </div>
      {:else}
        {#if !hasAnyLimit}
          <p class="mb-4 text-sm text-muted-foreground">
            No limits configured - all capabilities are unlimited on this plan.
          </p>
        {/if}
        <div class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {#each sortedCapabilities as cap (cap.capability)}
            {@const pct = capPercent(cap)}
            <div class="space-y-1.5">
              <div class="flex items-center justify-between gap-2 text-sm">
                <span class="font-medium truncate" title={cap.description}>{capLabel(cap)}</span>
                <span class="text-muted-foreground whitespace-nowrap">
                  {capFormat(cap, cap.current)} / {cap.limit === null ? '∞' : capFormat(cap, cap.limit)}
                  {#if pct !== null}
                    <span class="ml-1 font-semibold text-foreground">({pct}%)</span>
                  {/if}
                </span>
              </div>
              {#if pct !== null}
                <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    class="h-full rounded-full transition-all {capBarColor(pct)}"
                    style="width: {Math.min(100, pct)}%"
                  ></div>
                </div>
              {:else}
                <p class="text-xs text-muted-foreground">Unlimited</p>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </CardContent>
  </Card>

  <!-- Storage trend -->
  <Card>
    <CardHeader class="pb-3">
      <CardTitle class="text-base">Storage trend (estimated)</CardTitle>
      <CardDescription>Daily storage snapshot within retention window</CardDescription>
    </CardHeader>
    <CardContent class="p-0">
      {#if loading}
        <div class="flex justify-center py-10">
          <Spinner />
        </div>
      {:else if !storage || storage.series.length === 0}
        <div class="py-12 text-center">
          <BarChart3 class="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p class="mt-3 text-sm text-muted-foreground">No storage data for this period.</p>
        </div>
      {:else}
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead class="text-right">Storage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each [...storage.series].sort((a, b) => b.bucket.localeCompare(a.bucket)) as row (row.bucket)}
                <TableRow>
                  <TableCell class="text-sm">{formatDate(row.bucket)}</TableCell>
                  <TableCell class="text-right font-mono text-sm">{formatBytes(row.quantity)}</TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </div>
      {/if}
    </CardContent>
  </Card>

  <!-- By event type (metering signal) -->
  <Card>
    <CardHeader class="pb-3">
      <CardTitle class="text-base">By event type</CardTitle>
      <CardDescription>Volume per ingested signal type</CardDescription>
    </CardHeader>
    <CardContent class="p-0">
      {#if loading}
        <div class="flex justify-center py-10"><Spinner /></div>
      {:else if !breakdown || breakdown.byType.length === 0}
        <div class="py-12 text-center">
          <BarChart3 class="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p class="mt-3 text-sm text-muted-foreground">No data for this period.</p>
        </div>
      {:else}
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead class="text-right">Quantity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each breakdown.byType as row (row.type)}
                <TableRow>
                  <TableCell class="font-mono text-sm">{row.type}</TableCell>
                  <TableCell class="text-right font-mono text-sm">{formatTypeQty(row.type, row.quantity)}</TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </div>
      {/if}
    </CardContent>
  </Card>

  <!-- Daily breakdown -->
  <Card>
    <CardHeader class="pb-3">
      <CardTitle class="text-base">Daily breakdown</CardTitle>
      <CardDescription>Ingestion per day for the selected range</CardDescription>
    </CardHeader>
    <CardContent class="p-0">
      {#if loading}
        <div class="flex justify-center py-10">
          <Spinner />
        </div>
      {:else if dailyRows.length === 0}
        <div class="py-12 text-center">
          <BarChart3 class="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p class="mt-3 text-sm text-muted-foreground">No usage data for this period.</p>
        </div>
      {:else}
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead class="text-right">Events</TableHead>
                <TableHead class="text-right">Bytes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each dailyRows as row (row.date)}
                <TableRow>
                  <TableCell class="text-sm">{formatDate(row.date)}</TableCell>
                  <TableCell class="text-right font-mono text-sm">{formatCount(row.events)}</TableCell>
                  <TableCell class="text-right font-mono text-sm">{formatBytes(row.bytes)}</TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </div>
      {/if}
    </CardContent>
  </Card>

  <!-- By project (with name) -->
  <Card>
    <CardHeader class="pb-3">
      <CardTitle class="text-base">Breakdown by project</CardTitle>
      <CardDescription>Ingestion totals per project for the selected range</CardDescription>
    </CardHeader>
    <CardContent class="p-0">
      {#if loading}
        <div class="flex justify-center py-10">
          <Spinner />
        </div>
      {:else if !breakdown || breakdown.byProject.length === 0}
        <div class="py-12 text-center">
          <BarChart3 class="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p class="mt-3 text-sm text-muted-foreground">No project data for this period.</p>
        </div>
      {:else}
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead class="text-right">Events</TableHead>
                <TableHead class="text-right">Bytes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each breakdown.byProject as row (row.projectId)}
                <TableRow>
                  <TableCell class="text-sm">{row.projectName}</TableCell>
                  <TableCell class="text-right font-mono text-sm">{formatCount(row.events)}</TableCell>
                  <TableCell class="text-right font-mono text-sm">{formatBytes(row.bytes)}</TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </div>
      {/if}
    </CardContent>
  </Card>

  <!-- By service / by level -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-base">By service</CardTitle>
        <CardDescription>Which services produced the logs</CardDescription>
      </CardHeader>
      <CardContent class="p-0">
        {#if loading}
          <div class="flex justify-center py-10"><Spinner /></div>
        {:else if !breakdown || breakdown.byService.length === 0}
          <div class="py-12 text-center">
            <p class="text-sm text-muted-foreground">No data for this period.</p>
          </div>
        {:else}
          <div class="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead class="text-right">Events</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#each breakdown.byService as row (row.value)}
                  <TableRow>
                    <TableCell class="text-sm">{row.value}</TableCell>
                    <TableCell class="text-right font-mono text-sm">{formatCount(row.count)}</TableCell>
                  </TableRow>
                {/each}
              </TableBody>
            </Table>
          </div>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-base">By level</CardTitle>
        <CardDescription>Log level distribution</CardDescription>
      </CardHeader>
      <CardContent class="p-0">
        {#if loading}
          <div class="flex justify-center py-10"><Spinner /></div>
        {:else if !breakdown || breakdown.byLevel.length === 0}
          <div class="py-12 text-center">
            <p class="text-sm text-muted-foreground">No data for this period.</p>
          </div>
        {:else}
          <div class="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Level</TableHead>
                  <TableHead class="text-right">Events</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#each breakdown.byLevel as row (row.value)}
                  <TableRow>
                    <TableCell class="text-sm capitalize">{row.value}</TableCell>
                    <TableCell class="text-right font-mono text-sm">{formatCount(row.count)}</TableCell>
                  </TableRow>
                {/each}
              </TableBody>
            </Table>
          </div>
        {/if}
      </CardContent>
    </Card>
  </div>
</div>
