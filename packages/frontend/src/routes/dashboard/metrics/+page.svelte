<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    HOST_THRESHOLDS,
    SERVICE_ERROR_THRESHOLDS,
    formatMetricValue,
    type HostSourceSummary,
    type MetricSourcesResponse,
    type ServiceSourceSummary,
  } from '@logtide/shared';
  import { currentOrganization } from '$lib/stores/organization';
  import { scopeStore, resolveRange } from '$lib/stores/scope';
  import { layoutStore } from '$lib/stores/layout';
  import { startVisiblePolling } from '$lib/utils/visible-polling';
  import { ProjectsAPI } from '$lib/api/projects';
  import { metricsV2API } from '$lib/api/metrics-v2';
  import { getAuthToken } from '$lib/utils/auth';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import Sparkline from '$lib/components/app/Sparkline.svelte';
  import type { DataTableColumn, DataTableSort } from '$lib/components/app/data-table';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import MetricsSubNav from '$lib/components/metrics/v2/MetricsSubNav.svelte';
  import SourceSignalCell from '$lib/components/metrics/v2/SourceSignalCell.svelte';
  import SourceStatusDot from '$lib/components/metrics/v2/SourceStatusDot.svelte';
  import {
    DEFAULT_SORT,
    SETUP_DOCS,
    filterHostRows,
    filterServiceRows,
    parseKind,
    sortHosts,
    sortServices,
    sourceHref,
    type KindFilter,
  } from '$lib/components/metrics/sources/source-model';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Search from '@lucide/svelte/icons/search';

  const REFRESH_MS = 60_000;

  let maxWidthClass = $state('max-w-7xl');
  let containerPadding = $state('px-6 py-8');
  $effect(() => {
    const a = layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v));
    const b = layoutStore.containerPadding.subscribe((v) => (containerPadding = v));
    return () => {
      a();
      b();
    };
  });

  const org = $derived($currentOrganization);
  const projectsAPI = new ProjectsAPI(getAuthToken);

  let projects = $state<{ id: string; name: string }[]>([]);
  let projectsLoaded = $state(false);

  $effect(() => {
    const orgId = org?.id;
    if (!orgId) return;
    let cancelled = false;
    projectsLoaded = false;
    projectsAPI
      .getProjects(orgId)
      .then((res) => {
        if (cancelled) return;
        projects = res.projects.map((p) => ({ id: p.id, name: p.name }));
        projectsLoaded = true;
      })
      .catch(() => {
        if (cancelled) return;
        projects = [];
        projectsLoaded = true;
      });
    return () => {
      cancelled = true;
    };
  });

  // Empty selection means every project of the organization.
  const projectIds = $derived.by(() => {
    const known = new Set(projects.map((p) => p.id));
    const ids = $scopeStore.projectIds.filter((id) => known.has(id));
    return ids.length > 0 ? ids : null;
  });
  const scopeKey = $derived(JSON.stringify([org?.id, projectIds, $scopeStore.range]));

  let data = $state<MetricSourcesResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Newest request wins.
  let seq = 0;

  async function load(silent: boolean) {
    const organizationId = org?.id;
    if (!organizationId) return;
    const mine = ++seq;
    if (!silent) loading = true;
    const { from, to } = resolveRange($scopeStore.range);
    try {
      const res = await metricsV2API.getSources({
        organizationId,
        projectIds,
        from: from.toISOString(),
        to: to.toISOString(),
      });
      if (mine !== seq) return;
      data = res;
      error = null;
    } catch (err) {
      if (mine !== seq) return;
      error = err instanceof Error ? err.message : 'Could not load sources';
      // A failed background refresh keeps the last good data on screen.
      if (!silent) data = null;
    } finally {
      if (mine === seq) loading = false;
    }
  }

  $effect(() => {
    scopeKey;
    if (!projectsLoaded || !org) return;
    untrack(() => void load(false));
    const stop = startVisiblePolling(() => void load(true), REFRESH_MS);
    return () => {
      stop();
      seq++;
    };
  });

  // Kind filter lives in the URL.
  const kind = $derived<KindFilter>(parseKind(page.url.searchParams.get('kind')));

  function setKind(next: KindFilter) {
    const url = new URL(page.url);
    if (next === 'all') url.searchParams.delete('kind');
    else url.searchParams.set('kind', next);
    void goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  let filter = $state('');
  let hostSort = $state<DataTableSort | undefined>(DEFAULT_SORT);
  let serviceSort = $state<DataTableSort | undefined>(DEFAULT_SORT);

  const allHosts = $derived(data?.hosts ?? []);
  const allServices = $derived(data?.services ?? []);
  const hosts = $derived(sortHosts(filterHostRows(allHosts, filter), hostSort));
  const services = $derived(sortServices(filterServiceRows(allServices, filter), serviceSort));
  const showHosts = $derived(kind !== 'service');
  const showServices = $derived(kind !== 'host');
  const total = $derived(allHosts.length + allServices.length);
  const nothingVisible = $derived((!showHosts || hosts.length === 0) && (!showServices || services.length === 0));

  const chips = $derived([
    { id: 'all' as const, label: 'All', count: total },
    { id: 'host' as const, label: 'Hosts', count: allHosts.length },
    { id: 'service' as const, label: 'Services', count: allServices.length },
  ]);

  function errorTone(value: number | null | undefined): string {
    if (value === null || value === undefined) return '';
    if (value >= SERVICE_ERROR_THRESHOLDS.critical) return 'text-destructive-text';
    if (value >= SERVICE_ERROR_THRESHOLDS.warning) return 'text-warning-text';
    return '';
  }

  // Snippets are typed by their own parameter; the table wants Snippet<[Row]>.
  const hostCell = (s: unknown) => s as Snippet<[HostSourceSummary]>;
  const svcCell = (s: unknown) => s as Snippet<[ServiceSourceSummary]>;

  const hostColumns: DataTableColumn<HostSourceSummary>[] = [
    { key: 'status', header: 'Status', sortable: true, class: 'w-16', cell: hostCell(hostStatusCell) },
    { key: 'name', header: 'Host', sortable: true, cell: hostCell(hostNameCell) },
    { key: 'cpu', header: 'CPU', sortable: true, cell: hostCell(hostCpuCell) },
    { key: 'memory', header: 'Memory', sortable: true, cell: hostCell(hostMemoryCell) },
    { key: 'disk', header: 'Disk', sortable: true, cell: hostCell(hostDiskCell) },
    { key: 'network', header: 'Network', sortable: true, cell: hostCell(hostNetworkCell) },
    { key: 'load', header: 'Load 5m', sortable: true, cell: hostCell(hostLoadCell) },
    { key: 'trend', header: 'CPU trend', cell: hostCell(hostTrendCell) },
    { key: 'services', header: 'Services', sortable: true, cell: hostCell(hostServicesCell) },
    { key: 'lastSeen', header: 'Last seen', sortable: true, cell: hostCell(lastSeenCell) },
  ];

  const serviceColumns: DataTableColumn<ServiceSourceSummary>[] = [
    { key: 'status', header: 'Status', sortable: true, class: 'w-16', cell: svcCell(serviceStatusCell) },
    { key: 'name', header: 'Service', sortable: true, cell: svcCell(serviceNameCell) },
    { key: 'requestRate', header: 'Requests/s', sortable: true, cell: svcCell(requestRateCell) },
    { key: 'errorRate', header: 'Errors', sortable: true, cell: svcCell(errorRateCell) },
    { key: 'p95', header: 'p95', sortable: true, cell: svcCell(p95Cell) },
    { key: 'hosts', header: 'Hosts', sortable: true, cell: svcCell(serviceHostsCell) },
    { key: 'lastSeen', header: 'Last seen', sortable: true, cell: svcCell(lastSeenCell) },
  ];

  const hostKey = (h: HostSourceSummary) => `host:${h.name}`;
  const serviceKey = (s: ServiceSourceSummary) => `service:${s.name}`;
  const hostHref = (h: HostSourceSummary) => sourceHref('host', h.name);
  const serviceHref = (s: ServiceSourceSummary) => sourceHref('service', s.name);

  function listPreview(names: string[]): string {
    if (names.length === 0) return '-';
    const shown = names.slice(0, 2).join(', ');
    return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
  }
</script>

{#snippet hostStatusCell(h: HostSourceSummary)}
  <SourceStatusDot status={h.status} reason={h.statusReason} />
{/snippet}

{#snippet hostNameCell(h: HostSourceSummary)}
  <div class="min-w-0">
    <a class="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={hostHref(h)}>{h.name}</a>
    {#if h.statusReason && h.status !== 'ok'}
      <p class="truncate text-xs text-muted-foreground" data-testid="status-reason">{h.statusReason}</p>
    {:else if h.os}
      <p class="truncate text-xs text-muted-foreground">{h.os}</p>
    {/if}
  </div>
{/snippet}

{#snippet hostCpuCell(h: HostSourceSummary)}
  <SourceSignalCell signal={h.cpu} label="CPU" thresholds={HOST_THRESHOLDS.cpu} />
{/snippet}
{#snippet hostMemoryCell(h: HostSourceSummary)}
  <SourceSignalCell signal={h.memory} label="Memory" thresholds={HOST_THRESHOLDS.memory} />
{/snippet}
{#snippet hostDiskCell(h: HostSourceSummary)}
  <SourceSignalCell signal={h.disk} label="Disk" thresholds={HOST_THRESHOLDS.disk} />
{/snippet}
{#snippet hostNetworkCell(h: HostSourceSummary)}
  <SourceSignalCell signal={h.network} label="Network" showSpark={false} />
{/snippet}
{#snippet hostLoadCell(h: HostSourceSummary)}
  <SourceSignalCell signal={h.load} label="Load" showSpark={false} />
{/snippet}

{#snippet hostTrendCell(h: HostSourceSummary)}
  {@const values = h.cpu.spark.map((v) => v ?? 0)}
  {#if values.length > 1}
    <Sparkline {values} label="CPU trend of {h.name}" width={90} height={22} />
  {:else}
    <span class="text-muted-foreground">-</span>
  {/if}
{/snippet}

{#snippet hostServicesCell(h: HostSourceSummary)}
  <span class="text-sm text-muted-foreground" title={h.services.join(', ')}>{listPreview(h.services)}</span>
{/snippet}

{#snippet lastSeenCell(row: { lastSeen: string })}
  <span class="whitespace-nowrap text-sm text-muted-foreground"><Timestamp value={row.lastSeen} relative /></span>
{/snippet}

{#snippet serviceStatusCell(s: ServiceSourceSummary)}
  <SourceStatusDot status={s.status} reason={s.statusReason} />
{/snippet}

{#snippet serviceNameCell(s: ServiceSourceSummary)}
  <div class="min-w-0">
    <a class="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={serviceHref(s)}>{s.name}</a>
    {#if s.statusReason && s.status !== 'ok'}
      <p class="truncate text-xs text-muted-foreground" data-testid="status-reason">{s.statusReason}</p>
    {:else if !s.hasTraces}
      <p class="truncate text-xs text-muted-foreground">No traces</p>
    {/if}
  </div>
{/snippet}

{#snippet requestRateCell(s: ServiceSourceSummary)}
  <SourceSignalCell signal={s.hasTraces ? s.requestRate : null} label="Requests per second" />
{/snippet}

{#snippet errorRateCell(s: ServiceSourceSummary)}
  {#if s.hasTraces && s.errorRate.value !== null}
    <span class="text-sm tabular-nums {errorTone(s.errorRate.value)}">{formatMetricValue(s.errorRate.value, s.errorRate.unit)}</span>
  {:else}
    <span class="text-muted-foreground" aria-label="Errors: no data">-</span>
  {/if}
{/snippet}

{#snippet p95Cell(s: ServiceSourceSummary)}
  <SourceSignalCell signal={s.hasTraces ? s.p95 : null} label="p95 latency" />
{/snippet}

{#snippet serviceHostsCell(s: ServiceSourceSummary)}
  <span class="text-sm text-muted-foreground" title={s.hosts.join(', ')}>{listPreview(s.hosts)}</span>
{/snippet}

{#snippet hostMobile(h: HostSourceSummary)}
  <div class="flex items-center gap-2">
    <SourceStatusDot status={h.status} reason={h.statusReason} />
    <a class="font-medium" href={hostHref(h)}>{h.name}</a>
  </div>
  <div class="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
    <span>CPU <b class="text-foreground">{formatMetricValue(h.cpu.value, h.cpu.unit)}</b></span>
    <span>Mem <b class="text-foreground">{formatMetricValue(h.memory.value, h.memory.unit)}</b></span>
    <span>Disk <b class="text-foreground">{formatMetricValue(h.disk.value, h.disk.unit)}</b></span>
  </div>
{/snippet}

{#snippet serviceMobile(s: ServiceSourceSummary)}
  <div class="flex items-center gap-2">
    <SourceStatusDot status={s.status} reason={s.statusReason} />
    <a class="font-medium" href={serviceHref(s)}>{s.name}</a>
  </div>
  <div class="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
    <span>Req <b class="text-foreground">{formatMetricValue(s.requestRate.value, s.requestRate.unit)}</b></span>
    <span>Err <b class="text-foreground">{formatMetricValue(s.errorRate.value, s.errorRate.unit)}</b></span>
    <span>p95 <b class="text-foreground">{formatMetricValue(s.p95.value, s.p95.unit)}</b></span>
  </div>
{/snippet}

<svelte:head>
  <title>Metrics - LogTide</title>
</svelte:head>

<div class="container mx-auto flex flex-col gap-4 {containerPadding} {maxWidthClass}">
  <PageHeader title="Metrics" description="Hosts and services that send metrics" appliesTo="organization">
    {#snippet actions()}
      <ScopeBar mode="multi" {projects} />
      <Button variant="outline" size="sm" onclick={() => void load(false)} aria-label="Refresh">
        <RefreshCw class="h-4 w-4" />
      </Button>
    {/snippet}
  </PageHeader>

  <MetricsSubNav />

  {#if !projectsLoaded || (loading && !data)}
    <div class="py-16 text-center text-sm text-muted-foreground" role="status">Loading sources</div>
  {:else if projects.length === 0}
    <EmptyState variant="setup" title="Create a project first" description="Hosts and services send their metrics to a project.">
      {#snippet actions()}
        <Button size="sm" href="/dashboard/projects">Go to projects</Button>
      {/snippet}
    </EmptyState>
  {:else if error && !data}
    <EmptyState variant="error" title="Could not load sources" description={error}>
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={() => void load(false)}>Try again</Button>
      {/snippet}
    </EmptyState>
  {:else if total === 0}
    <EmptyState
      variant="setup"
      title="No metrics yet"
      description="Run the LogTide hardware agent on a host, or send OTLP metrics from your services. Hosts are listed by host.name and services by service.name."
    >
      {#snippet actions()}
        <Button size="sm" href={SETUP_DOCS.hardware} target="_blank" rel="noopener noreferrer">Hardware agent docs</Button>
        <Button variant="outline" size="sm" href={SETUP_DOCS.otlp} target="_blank" rel="noopener noreferrer">OTLP docs</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex items-center gap-1.5" role="group" aria-label="Kind">
        {#each chips as chip (chip.id)}
          <button
            type="button"
            class="rounded-full px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {kind === chip.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:text-foreground'}"
            aria-pressed={kind === chip.id}
            onclick={() => setKind(chip.id)}
          >
            {chip.label}
            <span class="ml-1 tabular-nums opacity-80">{chip.count}</span>
          </button>
        {/each}
      </div>
      <div class="relative min-w-48 flex-1">
        <Search class="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input class="h-9 pl-8" placeholder="Filter by name, OS or service" aria-label="Filter sources" bind:value={filter} />
      </div>
    </div>

    {#if error}
      <p class="text-sm text-destructive-text" role="alert">Could not refresh the list: {error}</p>
    {/if}

    {#if nothingVisible}
      <EmptyState variant="no-results" title="No sources match" description="Change the filter or the kind to see more.">
        {#snippet actions()}
          <Button
            variant="outline"
            size="sm"
            onclick={() => {
              filter = '';
              setKind('all');
            }}>Clear filters</Button
          >
        {/snippet}
      </EmptyState>
    {:else}
      {#if showHosts && hosts.length > 0}
        <section aria-labelledby="sources-hosts" class="space-y-2" data-testid="hosts-section">
          <h2 id="sources-hosts" class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Hosts <span class="tabular-nums">{hosts.length}</span>
          </h2>
          <DataTable
            columns={hostColumns}
            rows={hosts}
            rowKey={hostKey}
            rowHref={hostHref}
            bind:sort={hostSort}
            mobileRow={hostCell(hostMobile)}
          />
        </section>
      {/if}
      {#if showServices && services.length > 0}
        <section aria-labelledby="sources-services" class="space-y-2" data-testid="services-section">
          <h2 id="sources-services" class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Services <span class="tabular-nums">{services.length}</span>
          </h2>
          <DataTable
            columns={serviceColumns}
            rows={services}
            rowKey={serviceKey}
            rowHref={serviceHref}
            bind:sort={serviceSort}
            mobileRow={svcCell(serviceMobile)}
          />
        </section>
      {/if}
    {/if}

    <p class="text-xs text-muted-foreground">
      Refreshes every minute. Hosts need a host.name resource attribute to appear here.
      <a class="text-primary-text hover:underline" href={SETUP_DOCS.hardware} target="_blank" rel="noopener noreferrer">Hardware agent</a>
    </p>
  {/if}
</div>
