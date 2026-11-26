<script lang="ts">
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { MetricAttrRef, MetricExplorerQuery, MetricQueryResponse, MetricSeries } from '@logtide/shared';
  import { currentOrganization } from '$lib/stores/organization';
  import { scopeStore, resolveRange } from '$lib/stores/scope';
  import { layoutStore } from '$lib/stores/layout';
  import { projectsAPI } from '$lib/api/projects';
  import { metricsV2API } from '$lib/api/metrics-v2';
  import { startVisiblePolling } from '$lib/utils/visible-polling';
  import {
    decodeExplorerQuery,
    encodeExplorerQuery,
    readExplorerQuery,
    writeExplorerQuery,
    EXPLORER_URL_PARAM,
  } from '$lib/utils/metrics-explorer-url';
  import { drillDownQuery, scopeParamsOf, scopeProjectIds, withGroupBy } from '$lib/utils/metrics-explore';

  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import EmptyMetrics from '$lib/components/EmptyMetrics.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { SelectField } from '$lib/components/ui/select';
  import MetricQueryBuilder from '$lib/components/metrics/v2/MetricQueryBuilder.svelte';
  import MetricSeriesView from '$lib/components/metrics/v2/MetricSeriesView.svelte';
  import BreakdownSuggestions from '$lib/components/metrics/v2/BreakdownSuggestions.svelte';
  import AddToDashboardDialog from '$lib/components/metrics/AddToDashboardDialog.svelte';
  import CreateMetricAlertDialog from '$lib/components/alerts/metric/CreateMetricAlertDialog.svelte';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Link from '@lucide/svelte/icons/link';
  import ChartColumn from '@lucide/svelte/icons/chart-column';
  import BellPlus from '@lucide/svelte/icons/bell-plus';

  const maxWidthClass = layoutStore.maxWidthClass;
  const containerPadding = layoutStore.containerPadding;

  // ---- projects for the scope bar ----
  let projects = $state<{ id: string; name: string }[]>([]);
  let projectsLoaded = $state(false);
  let projectsOrg: string | null = null;
  $effect(() => {
    const orgId = $currentOrganization?.id;
    if (!orgId || orgId === projectsOrg) return;
    projectsOrg = orgId;
    projectsAPI
      .getProjects(orgId)
      .then((res) => {
        if (orgId === $currentOrganization?.id) projects = res.projects.map((p) => ({ id: p.id, name: p.name }));
      })
      .catch(() => {
        projects = [];
      })
      .finally(() => {
        projectsLoaded = true;
      });
  });

  // ---- query state (URL is the persistence) ----
  let base = $state<MetricExplorerQuery>(untrack(() => readExplorerQuery(page.url.searchParams)));
  // An explicit project scope in the link (the `project` param, or for older
  // links the projects stored in the query) decides the scope from the first
  // run: the remembered scope never replaces it.
  untrack(() => {
    const url = new URL(page.url);
    if (!url.searchParams.has('project') && base.projectIds && base.projectIds.length > 0) {
      url.searchParams.set('project', base.projectIds.join(','));
    }
    if (url.searchParams.has('project')) scopeStore.applyUrl(url);
  });
  const scopeIds = $derived(scopeProjectIds($scopeStore.projectIds));
  // The query's projects always follow the scope.
  const effective = $derived<MetricExplorerQuery>({ ...base, projectIds: scopeIds });

  const hasMetric = $derived(effective.queries.some((q) => q.metricName !== ''));
  const metricNames = $derived(Object.fromEntries(effective.queries.map((q) => [q.id, q.metricName])));
  const firstQuery = $derived(effective.queries[0]);
  const showBreakdown = $derived(!!firstQuery && firstQuery.metricName !== '' && firstQuery.groupBy.length === 0);

  /** Identity of a query regardless of the scope projects (those live in the scope bar). */
  const identity = (q: MetricExplorerQuery) => encodeExplorerQuery({ ...q, projectIds: null });

  // URL -> state (back/forward, a link opened while the page is mounted).
  $effect(() => {
    const decoded = decodeExplorerQuery(page.url.searchParams.get(EXPLORER_URL_PARAM));
    if (!decoded) return;
    untrack(() => {
      if (identity(decoded) !== identity(base)) base = decoded;
    });
  });

  // state -> URL (replaceState keeps the history clean while typing).
  $effect(() => {
    const next = effective;
    untrack(() => {
      const current = page.url.searchParams;
      const hasParam = current.has(EXPLORER_URL_PARAM);
      if (!hasParam && !next.queries.some((q) => q.metricName !== '')) return;
      const existing = decodeExplorerQuery(current.get(EXPLORER_URL_PARAM));
      if (existing && identity(existing) === identity(next) && JSON.stringify(existing.projectIds) === JSON.stringify(next.projectIds)) return;
      const url = new URL(page.url);
      url.search = writeExplorerQuery(current, next).toString();
      goto(url, { replaceState: true, keepFocus: true, noScroll: true });
    });
  });

  // ---- running the query ----
  const rangeKey = $derived(JSON.stringify($scopeStore.range));
  let tick = $state(0);
  let response = $state<MetricQueryResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let controller: AbortController | null = null;

  const runKey = $derived(
    JSON.stringify([$currentOrganization?.id ?? null, { ...effective, display: null }, rangeKey, tick]),
  );

  async function run() {
    controller?.abort();
    const orgId = $currentOrganization?.id;
    const q = effective;
    if (!orgId || !q.queries.some((s) => s.metricName !== '')) {
      controller = null;
      response = null;
      error = null;
      loading = false;
      return;
    }
    const ctl = new AbortController();
    controller = ctl;
    loading = true;
    error = null;
    const { from, to } = resolveRange($scopeStore.range);
    try {
      const res = await metricsV2API.query(
        {
          ...q,
          queries: q.queries.filter((s) => s.metricName !== ''),
          organizationId: orgId,
          from: from.toISOString(),
          to: to.toISOString(),
        },
        ctl.signal,
      );
      if (ctl.signal.aborted) return;
      response = res;
    } catch (e) {
      if (ctl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      error = e instanceof Error ? e.message : 'Could not run the query';
    } finally {
      if (controller === ctl) loading = false;
    }
  }

  $effect(() => {
    void runKey;
    untrack(run);
    return () => controller?.abort();
  });

  // ---- auto refresh ----
  const REFRESH_OPTIONS = [
    { value: '0', label: 'Off' },
    { value: '30000', label: '30s' },
    { value: '60000', label: '1m' },
    { value: '300000', label: '5m' },
  ];
  const DISPLAYS: Array<{ value: MetricExplorerQuery['display']; label: string }> = [
    { value: 'lines', label: 'Lines' },
    { value: 'area', label: 'Area' },
    { value: 'bars', label: 'Bars' },
    { value: 'split', label: 'Split' },
    { value: 'stat', label: 'Stat' },
    { value: 'table', label: 'Table' },
  ];
  let refreshMs = $state('0');
  $effect(() => {
    const ms = Number(refreshMs);
    if (!ms) return;
    return startVisiblePolling(() => (tick += 1), ms);
  });

  // ---- actions ----
  function onBuilderChange(next: MetricExplorerQuery) {
    base = next;
  }

  function onAddGroupBy(ref: MetricAttrRef) {
    base = withGroupBy(effective, ref);
  }

  function onSeriesClick(series: MetricSeries) {
    base = drillDownQuery(effective, series);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(page.url.href);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  }

  let addOpen = $state(false);
  let alertOpen = $state(false);
  const lookupRange = $derived.by(() => {
    const { from, to } = resolveRange($scopeStore.range);
    return { from: from.toISOString(), to: to.toISOString() };
  });
  const scopeSearch = $derived(scopeParamsOf(page.url.searchParams).toString());
</script>

<svelte:head>
  <title>Explore metrics - LogTide</title>
</svelte:head>

<div class="container mx-auto {$containerPadding} {$maxWidthClass}">
  <PageHeader title="Metrics explorer" description="Query any metric, from any source, grouped the way you need" appliesTo="organization">
    {#snippet actions()}
      {#if !(projectsLoaded && projects.length === 0)}
        <ScopeBar mode="multi" {projects} hideZoneOnMobile />
        <div class="flex items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-9 rounded-r-none border-r-0"
            disabled={!hasMetric || loading}
            aria-label="Refresh"
            onclick={() => (tick += 1)}
          >
            <RefreshCw class="h-4 w-4 {loading ? 'animate-spin' : ''}" aria-hidden="true" />
          </Button>
          <SelectField
            class="h-9 w-24 rounded-l-none text-xs"
            aria-label="Auto refresh"
            bind:value={refreshMs}
            options={REFRESH_OPTIONS}
          />
        </div>
      {/if}
    {/snippet}
  </PageHeader>

  {#if projectsLoaded && projects.length === 0}
    <EmptyMetrics />
  {:else if $currentOrganization}
    <div class="mb-4">
      <MetricQueryBuilder
        value={effective}
        onChange={onBuilderChange}
        organizationId={$currentOrganization.id}
        from={lookupRange.from}
        to={lookupRange.to}
        showDisplay={false}
        projectNames={Object.fromEntries(projects.map((p) => [p.id, p.name]))}
      />
    </div>

    {#if !hasMetric}
      <EmptyState
        variant="no-data"
        title="Pick a metric to start"
        description="Choose a metric above, or browse the catalog to see what your sources send."
      >
        {#snippet actions()}
          <a class="text-sm text-primary hover:underline" href="/dashboard/metrics/catalog?{scopeSearch}">Open the catalog</a>
        {/snippet}
      </EmptyState>
    {:else}
      {#if showBreakdown}
        <div class="mb-4">
          <BreakdownSuggestions
            metricName={firstQuery.metricName}
            organizationId={$currentOrganization.id}
            projectIds={scopeIds}
            {onAddGroupBy}
          />
        </div>
      {/if}
      <section class="rounded-lg border border-border bg-card" aria-label="Result">
        <div class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2" role="toolbar" aria-label="Explorer actions">
          <div class="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Display">
            {#each DISPLAYS as d (d.value)}
              <button
                type="button"
                class="rounded px-2.5 py-1 text-xs font-medium transition-colors {effective.display === d.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}"
                aria-pressed={effective.display === d.value}
                onclick={() => (base = { ...base, display: d.value })}
              >
                {d.label}
              </button>
            {/each}
          </div>
          <div class="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" class="gap-2" onclick={copyLink}>
              <Link class="h-4 w-4" aria-hidden="true" />
              Copy link
            </Button>
            <Button type="button" variant="outline" size="sm" class="gap-2" onclick={() => (alertOpen = true)}>
              <BellPlus class="h-4 w-4" aria-hidden="true" />
              Create alert
            </Button>
            <Button type="button" size="sm" class="gap-2" onclick={() => (addOpen = true)}>
              <ChartColumn class="h-4 w-4" aria-hidden="true" />
              Add to dashboard
            </Button>
          </div>
        </div>
        <div class="p-3">
          <MetricSeriesView
            {response}
            {loading}
            {error}
            display={effective.display}
            {metricNames}
            {onSeriesClick}
          />
        </div>
      </section>
    {/if}

    <AddToDashboardDialog
      bind:open={addOpen}
      organizationId={$currentOrganization.id}
      query={effective}
      range={$scopeStore.range}
    />

    <CreateMetricAlertDialog
      bind:open={alertOpen}
      organizationId={$currentOrganization.id}
      query={effective}
      {response}
    />
  {/if}
</div>
