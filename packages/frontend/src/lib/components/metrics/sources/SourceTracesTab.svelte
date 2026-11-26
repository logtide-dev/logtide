<!--
  Traces tab of a source page (host or service).

  Requests and errors over time and p95 latency, from the entry spans of the
  source (a host by the host.name of its spans), then the traces that touched
  it: filter by service (host pages), errors only, sort by time or duration.
  A trace opens its waterfall; "Open in Traces" carries the same filter.

  Props:
    kind, name       the source
    organizationId   organization of the page
    projectIds       projects the source reports to
    services         services seen on the host (service chips), [] on service pages
    from, to         ISO window of the page
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import type { MetricSourceKind, SourceTraceSeries } from '@logtide/shared';
  import { metricsV2API } from '$lib/api/metrics-v2';
  import { tracesAPI, type TraceRecord } from '$lib/api/traces';
  import { traceDetailUrl } from '$lib/utils/trace-links';
  import { formatDuration } from '$lib/components/traces/format';
  import TraceListTable from '$lib/components/traces/TraceListTable.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import SourceTraceChart from './SourceTraceChart.svelte';
  import { errorRate, sourceTraceAttr, sourceTracesHref } from './source-traces';

  interface Props {
    kind: MetricSourceKind;
    name: string;
    organizationId: string;
    projectIds: string[];
    services: string[];
    from: string;
    to: string;
  }

  let { kind, name, organizationId, projectIds, services, from, to }: Props = $props();

  const PAGE_SIZE = 20;

  let service = $state<string | null>(null);
  let errorsOnly = $state(false);
  let sortBy = $state<'start_time' | 'duration'>('start_time');
  let sortOrder = $state<'asc' | 'desc'>('desc');
  let page = $state(1);

  // A new source or page window starts over.
  $effect(() => {
    kind;
    name;
    from;
    to;
    untrack(() => {
      service = null;
      errorsOnly = false;
      sortBy = 'start_time';
      sortOrder = 'desc';
      page = 1;
    });
  });

  const ready = $derived(projectIds.length > 0);
  const attr = $derived(sourceTraceAttr(kind, name, service));

  // ---- activity -----------------------------------------------------------------

  let series = $state<SourceTraceSeries | null>(null);
  let seriesLoading = $state(true);
  let seriesError = $state<string | null>(null);
  let seriesSeq = 0;

  async function loadSeries() {
    const mine = ++seriesSeq;
    seriesLoading = true;
    seriesError = null;
    try {
      const res = await metricsV2API.getSourceTraces(kind, name, { organizationId, projectIds, from, to });
      if (mine !== seriesSeq) return;
      series = res;
    } catch (err) {
      if (mine !== seriesSeq) return;
      series = null;
      seriesError = err instanceof Error ? err.message : 'Could not load the trace activity';
    } finally {
      if (mine === seriesSeq) seriesLoading = false;
    }
  }

  $effect(() => {
    if (!ready) return;
    kind;
    name;
    from;
    to;
    projectIds;
    untrack(() => void loadSeries());
  });

  // ---- list -----------------------------------------------------------------------

  let traces = $state<TraceRecord[]>([]);
  let total = $state(0);
  let listLoading = $state(true);
  let listError = $state<string | null>(null);
  let listSeq = 0;

  async function loadList() {
    const mine = ++listSeq;
    listLoading = true;
    listError = null;
    try {
      const res = await tracesAPI.getTraces({
        projectId: projectIds,
        attr,
        ...(errorsOnly ? { error: true } : {}),
        from,
        to,
        sortBy,
        sortOrder,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      if (mine !== listSeq) return;
      traces = res.traces;
      total = res.total;
    } catch (err) {
      if (mine !== listSeq) return;
      traces = [];
      total = 0;
      listError = err instanceof Error ? err.message : 'Could not load traces';
    } finally {
      if (mine === listSeq) listLoading = false;
    }
  }

  $effect(() => {
    if (!ready) return;
    attr;
    errorsOnly;
    sortBy;
    sortOrder;
    page;
    from;
    to;
    projectIds;
    untrack(() => void loadList());
  });

  // ---- actions --------------------------------------------------------------------

  function pickService(next: string | null) {
    service = service === next ? null : next;
    page = 1;
  }
  function toggleErrors() {
    errorsOnly = !errorsOnly;
    page = 1;
  }
  function clearFilters() {
    service = null;
    errorsOnly = false;
    page = 1;
  }
  const filtersActive = $derived(service !== null || errorsOnly);

  const singleProject = $derived(projectIds.length === 1 ? projectIds[0] : null);
  const openHref = $derived(sourceTracesHref({ attr, errorsOnly, projectId: projectIds[0] ?? null, from, to }));

  const totals = $derived(series?.totals ?? { requests: 0, errors: 0 });
  const errPct = $derived(errorRate(totals));
  const worstP95 = $derived(
    (series?.buckets ?? []).reduce<number | null>((max, b) => (b.p95 !== null && (max === null || b.p95 > max) ? b.p95 : max), null),
  );
  const noActivity = $derived(!seriesLoading && !seriesError && totals.requests === 0);

  const chipBase =
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const chipOn = 'border-primary bg-primary/10 text-foreground';
  const chipOff = 'border-border text-muted-foreground hover:text-foreground';
</script>

<section class="space-y-3" data-testid="source-traces">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h3 class="text-sm font-medium">Traces {kind === 'host' ? 'on' : 'of'} {name}</h3>
      {#if series && totals.requests > 0}
        <p class="text-xs text-muted-foreground" data-testid="trace-totals">
          {totals.requests.toLocaleString('en-US')} requests
          {#if errPct !== null}· {errPct < 10 ? errPct.toFixed(1) : Math.round(errPct)}% errors{/if}
          {#if worstP95 !== null}· p95 peak {formatDuration(worstP95)}{/if}
        </p>
      {/if}
    </div>
    <Button size="sm" variant="outline" href={openHref}>Open in Traces</Button>
  </div>

  {#if !ready}
    <EmptyState variant="no-data" title="No project" description="This {kind} reports to no project you can read." />
  {:else}
    {#if seriesError}
      <div class="flex items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3">
        <p class="text-sm text-destructive-text" role="alert">Could not load the trace activity: {seriesError}</p>
        <Button size="sm" variant="outline" onclick={() => void loadSeries()}>Try again</Button>
      </div>
    {:else if !noActivity}
      <div class="grid gap-3 lg:grid-cols-2">
        <div class="rounded-lg border bg-card px-3 pt-2 pb-1">
          <p class="text-xs font-medium text-muted-foreground">Requests and errors</p>
          {#if series}
            <SourceTraceChart variant="requests" buckets={series.buckets} bucketSeconds={series.bucketSeconds} />
          {:else}
            <div class="h-36 animate-pulse rounded bg-muted/40" role="status" aria-label="Loading"></div>
          {/if}
        </div>
        <div class="rounded-lg border bg-card px-3 pt-2 pb-1">
          <p class="text-xs font-medium text-muted-foreground">p95 latency</p>
          {#if series}
            <SourceTraceChart variant="latency" buckets={series.buckets} bucketSeconds={series.bucketSeconds} />
          {:else}
            <div class="h-36 animate-pulse rounded bg-muted/40" role="status" aria-label="Loading"></div>
          {/if}
        </div>
      </div>
    {/if}

    {#if noActivity && total === 0 && !listLoading && !filtersActive}
      <div class="rounded-lg border bg-card px-4 py-2">
        <EmptyState
          variant="no-data"
          title="No traces {kind === 'host' ? 'on this host' : 'from this service'}"
          description={kind === 'host'
            ? 'No span in this window carries this host. OpenTelemetry SDKs set host.name with the host resource detector; services on this host that send traces will appear here.'
            : 'This service sent no traces in this window. Instrument it with OpenTelemetry tracing to see them.'}
        />
      </div>
    {:else}
      <div class="flex flex-wrap items-center gap-2">
        {#if kind === 'host' && services.length > 0}
          <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Service">
            {#each services as s (s)}
              {@const on = service === s}
              <button type="button" class="{chipBase} {on ? chipOn : chipOff}" aria-pressed={on} onclick={() => pickService(s)}>{s}</button>
            {/each}
          </div>
          <span class="mx-1 h-4 w-px bg-border" aria-hidden="true"></span>
        {/if}
        <button type="button" class="{chipBase} {errorsOnly ? chipOn : chipOff}" aria-pressed={errorsOnly} onclick={toggleErrors}>
          <span class="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true"></span>Errors only
        </button>
        {#if filtersActive}
          <Button size="sm" variant="ghost" onclick={clearFilters}>Clear</Button>
        {/if}
      </div>

      <TraceListTable
        {traces}
        projectId={singleProject ?? ''}
        loading={listLoading}
        {total}
        {page}
        pageSize={PAGE_SIZE}
        {sortBy}
        {sortOrder}
        {filtersActive}
        error={listError}
        onSort={(by, order) => {
          sortBy = by;
          sortOrder = order;
          page = 1;
        }}
        onPageChange={(p) => (page = p)}
        onClearFilters={clearFilters}
        onOpen={(traceId) => void goto(traceDetailUrl(traceId, singleProject))}
        onRetry={() => void loadList()}
      />
    {/if}
  {/if}
</section>
