<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { layoutStore } from '$lib/stores/layout';
  import { currentOrganization } from '$lib/stores/organization';
  import { scopeStore, resolveRange } from '$lib/stores/scope';
  import { metricsStore } from '$lib/stores/metrics';
  import { ProjectsAPI } from '$lib/api/projects';
  import type { MetricDataPoint } from '$lib/api/metrics';
  import {
    inferMetricUnit,
    parseMetricsUrl,
    writeMetricsUrl,
    type MetricQueryState,
    type MetricsTab,
    type PanelRangeInput,
  } from '$lib/utils/metrics-query';

  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import EmptyMetrics from '$lib/components/EmptyMetrics.svelte';
  import OverviewPanel from '$lib/components/metrics/OverviewPanel.svelte';
  import GoldenSignalsPanel from '$lib/components/metrics/GoldenSignalsPanel.svelte';
  import MetricQueryRow from '$lib/components/metrics/MetricQueryRow.svelte';
  import MetricChart from '$lib/components/metrics/MetricChart.svelte';
  import AddToDashboardDialog from '$lib/components/metrics/AddToDashboardDialog.svelte';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '$lib/components/ui/table';

  import ExternalLink from '@lucide/svelte/icons/external-link';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import Search from '@lucide/svelte/icons/search';
  import Gauge from '@lucide/svelte/icons/gauge';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import ChartColumn from '@lucide/svelte/icons/chart-column';

  // Layout
  let maxWidthClass = $state('max-w-7xl');
  let containerPadding = $state('px-8 py-8');
  $effect(() => layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v)));
  $effect(() => layoutStore.containerPadding.subscribe((v) => (containerPadding = v)));

  // Projects
  let token = $state<string | null>(null);
  $effect(() => authStore.subscribe((s) => (token = s.token)));
  let projectsAPI = $derived(new ProjectsAPI(() => token));

  let projects = $state<{ id: string; name: string }[]>([]);
  let projectsLoaded = $state(false);
  let projectsError = $state<string | null>(null);
  let projectsRequest = 0;

  $effect(() => {
    const org = $currentOrganization;
    const api = projectsAPI;
    if (!org) return;
    const request = ++projectsRequest;
    projectsLoaded = false;
    projectsError = null;
    (async () => {
      try {
        const [res, availability] = await Promise.all([
          api.getProjects(org.id),
          api.getProjectDataAvailability(org.id).catch(() => null),
        ]);
        if (request !== projectsRequest) return;
        const withMetrics = availability?.metrics;
        const list = withMetrics && withMetrics.length > 0
          ? res.projects.filter((p) => withMetrics.includes(p.id))
          : res.projects;
        projects = list.map((p) => ({ id: p.id, name: p.name }));
      } catch (e) {
        if (request !== projectsRequest) return;
        projects = [];
        projectsError = e instanceof Error ? e.message : 'Could not load projects';
      } finally {
        if (request === projectsRequest) projectsLoaded = true;
      }
    })();
  });

  let refreshTick = $state(0);
  let projectId = $derived($scopeStore.projectIds[0] ?? null);

  // URL <-> query state. Once the page runs the store is the source of truth;
  // the URL is applied to it only for navigation this page did not cause.
  function sameQuery(a: MetricQueryState, b: MetricQueryState): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  const writtenSearches = new Set<string>();

  $effect(() => {
    const search = page.url.search.replace(/^\?/, '');
    const parsed = parseMetricsUrl(page.url.searchParams);
    untrack(() => {
      // One of our own writes arriving back: the store already holds newer state.
      if (writtenSearches.delete(search)) return;
      if (!sameQuery(parsed, metricsStore.get().query)) metricsStore.setQuery(parsed);
    });
  });

  $effect(() => {
    const query = $metricsStore.query;
    const current = page.url.searchParams;
    const next = writeMetricsUrl(current, query);
    if (next.toString() === current.toString()) return;
    writtenSearches.add(next.toString());
    const url = new URL(page.url);
    url.search = next.toString();
    goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  });

  // Scope -> store context (project and time bounds). Declared after the URL
  // effect so the first load already knows which tab and metric to fetch.
  // Preset ranges resolve against "now", so the bounds are recomputed only when
  // the scope value really changed or Refresh was pressed.
  let lastScopeKey = '';
  $effect(() => {
    const scope = $scopeStore;
    const tick = refreshTick;
    const id = scope.projectIds[0] ?? null;
    if (!id) return;
    const key = JSON.stringify([id, scope.range, tick]);
    if (key === lastScopeKey) return;
    lastScopeKey = key;
    const { from, to } = resolveRange(scope.range);
    untrack(() => metricsStore.setContext({ projectId: id, from, to }));
  });

  $effect(() => () => metricsStore.reset());

  let query = $derived($metricsStore.query);
  let tab = $derived(query.tab);
  let range = $derived.by(() => $metricsStore.range);
  let unit = $derived(query.metric ? inferMetricUnit(query.metric, query.aggregation) : null);

  let dashboardRange = $derived.by((): PanelRangeInput => {
    const r = $scopeStore.range;
    if (r.kind === 'preset') return r.preset;
    return range;
  });

  let addOpen = $state(false);

  const TABS: { id: MetricsTab; label: string; icon: typeof Search }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard as unknown as typeof Search },
    { id: 'explorer', label: 'Explorer', icon: Search },
    { id: 'golden', label: 'Golden signals', icon: Gauge as unknown as typeof Search },
  ];

  function setTab(next: MetricsTab) {
    metricsStore.setQuery({ tab: next });
  }

  function handleChange(patch: Partial<MetricQueryState>) {
    metricsStore.setQuery(patch);
  }

  function handleOverviewMetricClick(metricName: string) {
    metricsStore.setQuery({ tab: 'explorer', metric: metricName });
  }

  // Chart click: open the first exemplar trace inside the clicked bucket.
  function handleBucketClick(bucketStart: Date, bucketSeconds: number) {
    const id = projectId;
    if (!id) return;
    const start = bucketStart.getTime();
    const end = start + Math.max(bucketSeconds, 1) * 1000;
    const points: MetricDataPoint[] = $metricsStore.dataPoints?.metrics ?? [];
    for (const point of points) {
      const t = new Date(point.time).getTime();
      if (t < start || t >= end || !point.hasExemplars) continue;
      const traceId = point.exemplars?.find((e) => e.traceId)?.traceId;
      if (traceId) {
        goto(`/dashboard/traces/${encodeURIComponent(traceId)}?project=${encodeURIComponent(id)}`);
        return;
      }
    }
  }

  function goToTrace(traceId: string) {
    if (projectId) {
      goto(`/dashboard/traces/${encodeURIComponent(traceId)}?project=${encodeURIComponent(projectId)}`);
    }
  }

  function truncateJson(obj: Record<string, unknown> | null, maxLen = 60): string {
    if (!obj) return '-';
    const str = JSON.stringify(obj);
    return str.length <= maxLen ? str : `${str.slice(0, maxLen)}...`;
  }

  // Derived data for the panels
  let overviewServices = $derived($metricsStore.overview?.services ?? []);
  let visibleServices = $derived(
    query.service ? overviewServices.filter((s) => s.serviceName === query.service) : overviewServices
  );
  let sparklineMap = $derived(new Map(Object.entries($metricsStore.sparklines)));
  let sparklineLoading = $derived(new Set($metricsStore.sparklinesLoading));
  let panelRange = $derived(range ?? { from: new Date(), to: new Date() });
</script>

<svelte:head>
  <title>Metrics - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <PageHeader title="Metrics" description="Explore OTLP metrics from your applications">
    {#snippet actions()}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="gap-2"
        disabled={!projectId}
        onclick={() => (refreshTick += 1)}
      >
        <RefreshCw class="h-4 w-4" aria-hidden="true" />
        Refresh
      </Button>
      <Button
        type="button"
        size="sm"
        class="gap-2"
        disabled={!query.metric || !projectId || !$currentOrganization}
        onclick={() => (addOpen = true)}
      >
        <ChartColumn class="h-4 w-4" aria-hidden="true" />
        Add to dashboard
      </Button>
    {/snippet}
  </PageHeader>

  {#if !projectsLoaded}
    <div class="py-16 text-center text-sm text-muted-foreground" role="status">Loading projects</div>
  {:else if projectsError}
    <EmptyState variant="error" title="Could not load projects" description={projectsError} />
  {:else if projects.length === 0}
    <EmptyMetrics />
  {:else}
    <div class="mb-4">
      <ScopeBar mode="single" {projects} />
    </div>

    <div class="mb-6 flex items-center gap-1 border-b" role="tablist" aria-label="Metrics views">
      {#each TABS as t (t.id)}
        {@const Icon = t.icon}
        <button
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          class="-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors {tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => setTab(t.id)}
        >
          <Icon class="h-4 w-4" aria-hidden="true" />
          {t.label}
        </button>
      {/each}
    </div>

    {#if !projectId}
      <EmptyState
        variant="no-data"
        title="No project selected"
        description="Select a project to view metrics."
      />
    {:else}
      <div class="mb-6">
        <MetricQueryRow
          metricNames={$metricsStore.metricNames}
          metricNamesLoading={$metricsStore.metricNamesLoading}
          {query}
          labelKeys={$metricsStore.labelKeys}
          loadLabelValues={(key) => metricsStore.loadLabelValues(key)}
          services={$metricsStore.services}
          onChange={handleChange}
          serviceOnly={tab !== 'explorer'}
        />
      </div>

      {#if tab === 'overview'}
        {#if $metricsStore.overviewLoading && !$metricsStore.overview}
          <div class="py-16 text-center text-sm text-muted-foreground" role="status">Loading metrics</div>
        {:else if $metricsStore.overviewError}
          <EmptyState
            variant="error"
            title="Could not load metrics"
            description={$metricsStore.overviewError}
          />
        {:else}
          <OverviewPanel
            services={overviewServices}
            selectedService={query.service}
            timeseriesMap={sparklineMap}
            loadingMetrics={sparklineLoading}
            {projectId}
            timeRange={panelRange}
            onMetricClick={handleOverviewMetricClick}
          />
        {/if}
      {:else if tab === 'golden'}
        <GoldenSignalsPanel
          metricNames={$metricsStore.metricNames}
          services={visibleServices}
          {projectId}
          timeRange={panelRange}
          interval={query.interval}
        />
      {:else}
        <Card class="mb-6">
          <CardHeader>
            <CardTitle>
              {#if query.metric}
                {query.metric}
                <Badge variant="outline" class="ml-2 text-xs">
                  {query.aggregation} / {$metricsStore.timeseries?.interval ?? query.interval}
                </Badge>
              {:else}
                Time series
              {/if}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {#if !query.metric}
              <EmptyState
                variant="no-data"
                title="Select a metric to visualize"
                description="Pick a metric above, then add filters or a group by."
              />
            {:else}
              <MetricChart
                result={$metricsStore.timeseries}
                {unit}
                loading={$metricsStore.timeseriesLoading}
                error={$metricsStore.timeseriesError}
                onBucketClick={handleBucketClick}
                clickHint="Click to open a trace when the metric has exemplars"
              />
            {/if}
          </CardContent>
        </Card>

        {#if query.metric}
          <Card>
            <CardHeader>
              <CardTitle>
                {#if $metricsStore.dataPoints}
                  {$metricsStore.dataPoints.total.toLocaleString('en-US')} data {$metricsStore.dataPoints.total === 1 ? 'point' : 'points'}
                {:else}
                  Data points
                {/if}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {#if $metricsStore.dataPointsLoading && !$metricsStore.dataPoints}
                <div class="py-8 text-center text-sm text-muted-foreground" role="status">Loading data points</div>
              {:else if $metricsStore.dataPoints && $metricsStore.dataPoints.metrics.length > 0}
                <div class="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead class="w-[180px]">Time</TableHead>
                        <TableHead class="w-[120px]">Value</TableHead>
                        <TableHead class="w-[100px]">Type</TableHead>
                        <TableHead class="w-[140px]">Service</TableHead>
                        <TableHead>Attributes</TableHead>
                        <TableHead class="w-[100px]">Exemplar</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {#each $metricsStore.dataPoints.metrics as point (point.id)}
                        <TableRow>
                          <TableCell class="font-mono text-xs"><Timestamp value={point.time} precision="second" /></TableCell>
                          <TableCell class="font-mono text-sm font-medium">
                            {typeof point.value === 'number' ? point.value.toLocaleString('en-US', { maximumFractionDigits: 3 }) : point.value}
                          </TableCell>
                          <TableCell><Badge variant="outline">{point.metricType}</Badge></TableCell>
                          <TableCell><Badge variant="secondary">{point.serviceName}</Badge></TableCell>
                          <TableCell
                            class="max-w-xs truncate font-mono text-xs"
                            title={point.attributes ? JSON.stringify(point.attributes) : ''}
                          >
                            {truncateJson(point.attributes)}
                          </TableCell>
                          <TableCell>
                            {#each (point.exemplars ?? []).filter((e) => e.traceId) as exemplar}
                              <button
                                type="button"
                                class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                onclick={() => exemplar.traceId && goToTrace(exemplar.traceId)}
                              >
                                <ExternalLink class="h-3 w-3" aria-hidden="true" />
                                Trace
                              </button>
                            {:else}
                              <span class="text-xs text-muted-foreground">-</span>
                            {/each}
                          </TableCell>
                        </TableRow>
                      {/each}
                    </TableBody>
                  </Table>
                </div>
                {#if $metricsStore.dataPoints.hasMore}
                  <p class="mt-4 text-center text-sm text-muted-foreground">
                    Showing {$metricsStore.dataPoints.metrics.length.toLocaleString('en-US')} of {$metricsStore.dataPoints.total.toLocaleString('en-US')} data points
                  </p>
                {/if}
              {:else}
                <EmptyState
                  variant="no-data"
                  title="No data points"
                  description="Nothing was recorded for this metric and time range."
                />
              {/if}
            </CardContent>
          </Card>
        {/if}
      {/if}
    {/if}
  {/if}
</div>

{#if projectId && $currentOrganization && query.metric}
  <AddToDashboardDialog
    bind:open={addOpen}
    organizationId={$currentOrganization.id}
    {query}
    {projectId}
    range={dashboardRange}
  />
{/if}
