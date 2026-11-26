<!--
  Logs tab of a source page (host or service).

  Volume by level over the window (drag or click to zoom), filters by level and,
  on a host, by service (with counts), free text, then the newest matching logs
  with "Load more". A log opens the Logs explorer centred on it; "Open in Logs"
  carries the same query and window.

  Props:
    kind, name       the source (a host filters on host:, a service on service:)
    projectIds       project ids the source reports to (the logs API needs at least one)
    from, to         ISO window of the page
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { LogLevel, MetricSourceKind } from '@logtide/shared';
  import { logsAPI, LogQueryError, type LogEntry, type LogHistogramBucket } from '$lib/api/logs';
  import { levelLabel, levelTone } from '$lib/utils/severity';
  import { pickBucketSeconds } from '$lib/components/search/histogram';
  import LogVolumeHistogram from '$lib/components/search/LogVolumeHistogram.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import Search from '@lucide/svelte/icons/search';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import {
    EMPTY_FILTERS,
    TAB_LEVELS,
    buildSourceLogsQuery,
    sourceLogsHref,
    toggleValue,
    type SourceLogsFilters,
  } from './source-logs';

  interface Props {
    kind: MetricSourceKind;
    name: string;
    projectIds: string[];
    from: string;
    to: string;
  }

  let { kind, name, projectIds, from, to }: Props = $props();

  const PAGE = 25;
  const SERVICE_CHIPS = 8;

  let filters = $state<SourceLogsFilters>({ ...EMPTY_FILTERS });
  let textDraft = $state('');
  /** A zoomed window inside the page window, from the histogram. */
  let zoom = $state<{ from: string; to: string } | null>(null);

  // A new source or page window starts over.
  $effect(() => {
    kind;
    name;
    from;
    to;
    untrack(() => {
      filters = { ...EMPTY_FILTERS };
      textDraft = '';
      zoom = null;
    });
  });

  const win = $derived(zoom ?? { from, to });
  const query = $derived(buildSourceLogsQuery(kind, name, filters));
  // Counts for the chips come from the source alone (level and service chips
  // show what is there, whatever is selected).
  const baseQuery = $derived(buildSourceLogsQuery(kind, name, { ...EMPTY_FILTERS, text: filters.text }));
  const ready = $derived(projectIds.length > 0);

  // ---- histogram ------------------------------------------------------------

  let buckets = $state<LogHistogramBucket[]>([]);
  let bucketSeconds = $state(60);
  let histTotal = $state<number | null>(null);
  let histLoading = $state(true);
  let histError = $state<string | null>(null);
  let histSeq = 0;

  async function loadHistogram() {
    const mine = ++histSeq;
    histLoading = true;
    histError = null;
    const step = pickBucketSeconds(Date.parse(win.to) - Date.parse(win.from));
    try {
      const res = await logsAPI.getHistogram({ projectId: projectIds, q: query, from: win.from, to: win.to, bucketSeconds: step });
      if (mine !== histSeq) return;
      buckets = res.buckets;
      bucketSeconds = typeof res.bucketSeconds === 'number' ? res.bucketSeconds : step;
      histTotal = res.total;
    } catch (err) {
      if (mine !== histSeq) return;
      buckets = [];
      histTotal = null;
      histError = err instanceof Error ? err.message : 'Could not load the log volume';
    } finally {
      if (mine === histSeq) histLoading = false;
    }
  }

  // ---- chips (facets) ---------------------------------------------------------

  let levelCounts = $state<Partial<Record<string, number>>>({});
  let serviceCounts = $state<{ value: string; count: number }[]>([]);
  let facetSeq = 0;

  async function loadFacets() {
    const mine = ++facetSeq;
    const fields = kind === 'host' ? ['level', 'service'] : ['level'];
    try {
      const res = await logsAPI.getFacets({ projectId: projectIds, q: baseQuery, from: win.from, to: win.to, fields, limit: 20 });
      if (mine !== facetSeq) return;
      const byField = new Map(res.facets.map((f) => [f.field, f.values]));
      levelCounts = Object.fromEntries((byField.get('level') ?? []).map((v) => [v.value, v.count]));
      serviceCounts = byField.get('service') ?? [];
    } catch {
      if (mine !== facetSeq) return;
      // Chips without counts still filter.
      levelCounts = {};
      serviceCounts = [];
    }
  }

  // ---- list -------------------------------------------------------------------

  let logs = $state<LogEntry[]>([]);
  let listLoading = $state(true);
  let listError = $state<string | null>(null);
  let queryError = $state<string | null>(null);
  let nextCursor = $state<string | null>(null);
  let hasMore = $state(false);
  let loadingMore = $state(false);
  let listSeq = 0;

  async function loadList() {
    const mine = ++listSeq;
    listLoading = true;
    listError = null;
    queryError = null;
    try {
      const res = await logsAPI.getLogs({ projectId: projectIds, q: query, from: win.from, to: win.to, limit: PAGE });
      if (mine !== listSeq) return;
      logs = res.logs ?? [];
      nextCursor = res.nextCursor ?? null;
      hasMore = !!(res.hasMore ?? res.nextCursor);
    } catch (err) {
      if (mine !== listSeq) return;
      logs = [];
      hasMore = false;
      if (err instanceof LogQueryError) queryError = err.message;
      else listError = err instanceof Error ? err.message : 'Could not load logs';
    } finally {
      if (mine === listSeq) listLoading = false;
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const mine = listSeq;
    loadingMore = true;
    try {
      const res = await logsAPI.getLogs({ projectId: projectIds, q: query, from: win.from, to: win.to, limit: PAGE, cursor: nextCursor });
      if (mine !== listSeq) return;
      logs = [...logs, ...(res.logs ?? [])];
      nextCursor = res.nextCursor ?? null;
      hasMore = !!(res.hasMore ?? res.nextCursor);
    } catch (err) {
      if (mine === listSeq) listError = err instanceof Error ? err.message : 'Could not load more logs';
    } finally {
      loadingMore = false;
    }
  }

  // Everything reloads when the query or the window changes.
  $effect(() => {
    if (!ready) return;
    query;
    baseQuery;
    win.from;
    win.to;
    untrack(() => {
      void loadHistogram();
      void loadFacets();
      void loadList();
    });
  });

  // ---- actions ----------------------------------------------------------------

  function toggleLevel(level: LogLevel) {
    filters = { ...filters, levels: toggleValue(filters.levels, level) };
  }
  function toggleService(service: string) {
    filters = { ...filters, services: toggleValue(filters.services, service) };
  }
  function applyText(event: SubmitEvent) {
    event.preventDefault();
    filters = { ...filters, text: textDraft };
  }
  function clearFilters() {
    filters = { ...EMPTY_FILTERS };
    textDraft = '';
  }
  const filtered = $derived(filters.levels.length > 0 || filters.services.length > 0 || filters.text.trim() !== '');

  const openHref = $derived(sourceLogsHref({ query, projectIds, from: win.from, to: win.to }));
  const logHref = (log: LogEntry) =>
    sourceLogsHref({ query, projectIds, from: win.from, to: win.to, logId: log.id, logProjectId: log.projectId });

  const shownServices = $derived.by(() => {
    // Selected services stay visible even when they fall out of the top list.
    const top = serviceCounts.slice(0, SERVICE_CHIPS);
    const missing = filters.services.filter((s) => !top.some((t) => t.value === s)).map((value) => ({ value, count: 0 }));
    return [...top, ...missing];
  });

  const chipBase =
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const chipOn = 'border-primary bg-primary/10 text-foreground';
  const chipOff = 'border-border text-muted-foreground hover:text-foreground';
</script>

<section class="space-y-3" data-testid="source-logs">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h3 class="text-sm font-medium">Logs {kind === 'host' ? 'on' : 'from'} {name}</h3>
      {#if zoom}<p class="text-xs text-muted-foreground">Zoomed window</p>{/if}
    </div>
    <div class="flex items-center gap-2">
      {#if zoom}
        <Button size="sm" variant="ghost" onclick={() => (zoom = null)}>
          <ZoomOut class="mr-1.5 h-4 w-4" aria-hidden="true" />Reset zoom
        </Button>
      {/if}
      <Button size="sm" variant="outline" href={openHref}>Open in Logs</Button>
    </div>
  </div>

  {#if !ready}
    <EmptyState variant="no-data" title="No project" description="This {kind} reports to no project you can read." />
  {:else}
    <div class="rounded-lg border bg-card p-3">
      <LogVolumeHistogram
        {buckets}
        {bucketSeconds}
        total={histTotal}
        loading={histLoading}
        error={histError}
        onRangeSelect={(f, t) => (zoom = { from: f.toISOString(), to: t.toISOString() })}
        onRetry={() => void loadHistogram()}
      />
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Level">
        {#each TAB_LEVELS as level (level)}
          {@const on = filters.levels.includes(level)}
          <button type="button" class="{chipBase} {on ? chipOn : chipOff}" aria-pressed={on} onclick={() => toggleLevel(level)}>
            <span class="h-1.5 w-1.5 rounded-full {levelTone(level).dot}" aria-hidden="true"></span>
            {levelLabel(level)}
            {#if levelCounts[level] !== undefined}<span class="tabular-nums opacity-70">{levelCounts[level]?.toLocaleString('en-US')}</span>{/if}
          </button>
        {/each}
      </div>
      {#if kind === 'host' && shownServices.length > 0}
        <span class="mx-1 h-4 w-px bg-border" aria-hidden="true"></span>
        <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Service">
          {#each shownServices as s (s.value)}
            {@const on = filters.services.includes(s.value)}
            <button type="button" class="{chipBase} {on ? chipOn : chipOff}" aria-pressed={on} onclick={() => toggleService(s.value)}>
              {s.value}
              {#if s.count > 0}<span class="tabular-nums opacity-70">{s.count.toLocaleString('en-US')}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
      <form class="relative ml-auto min-w-56 flex-1 sm:max-w-sm" onsubmit={applyText}>
        <Search class="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input class="h-9 pl-8" placeholder="Search text or field:value, Enter" aria-label="Search logs" bind:value={textDraft} />
      </form>
      {#if filtered}
        <Button size="sm" variant="ghost" onclick={clearFilters}>Clear</Button>
      {/if}
    </div>

    <div class="rounded-lg border bg-card">
      {#if listLoading}
        <p class="px-4 py-6 text-sm text-muted-foreground" role="status">Loading logs</p>
      {:else if queryError}
        <p class="px-4 py-3 text-sm text-destructive-text" role="alert">The search is not valid: {queryError}</p>
      {:else if listError && logs.length === 0}
        <div class="flex items-center justify-between gap-2 px-4 py-3">
          <p class="text-sm text-destructive-text" role="alert">Could not load logs: {listError}</p>
          <Button size="sm" variant="outline" onclick={() => void loadList()}>Try again</Button>
        </div>
      {:else if logs.length === 0}
        <div class="px-4 py-2">
          <EmptyState
            variant={filtered ? 'no-results' : 'no-data'}
            title={filtered ? 'No logs match these filters' : `No logs for this ${kind}`}
            description={filtered
              ? 'Change the level, the service or the search.'
              : kind === 'host'
                ? 'No log in this window carries this host name (hostname, or host.name for OpenTelemetry logs).'
                : 'No log in this window comes from this service.'}
          />
        </div>
      {:else}
        <ul class="max-h-[34rem] divide-y overflow-y-auto" data-testid="source-log-list">
          {#each logs as log, i (log.id ?? `${log.time}-${i}`)}
            {@const tone = levelTone(log.level)}
            <li>
              <a
                class="grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-3 px-4 py-1.5 text-sm hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none sm:grid-cols-[auto_auto_10rem_minmax(0,1fr)]"
                href={logHref(log)}
                data-testid="source-log-row"
              >
                <span class="whitespace-nowrap font-mono text-xs text-muted-foreground"><Timestamp value={log.time} precision="second" /></span>
                <span class="inline-flex w-16 items-center gap-1.5 text-xs font-medium uppercase {tone.text}">
                  <span class="h-1.5 w-1.5 rounded-full {tone.dot}" aria-hidden="true"></span>{log.level}
                </span>
                <span class="hidden truncate text-xs text-muted-foreground sm:block" title={log.service}>{log.service}</span>
                <span class="flex min-w-0 items-baseline gap-2">
                  <span class="min-w-0 flex-1 truncate font-mono text-xs" title={log.message}>{log.message}</span>
                  {#if log.traceId}
                    <GitBranch class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Has a trace" />
                  {/if}
                </span>
              </a>
            </li>
          {/each}
        </ul>
        <div class="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>{logs.length.toLocaleString('en-US')} shown{histTotal !== null ? ` of ${histTotal.toLocaleString('en-US')}` : ''}</span>
          {#if hasMore}
            <Button size="sm" variant="ghost" onclick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Loading' : 'Load more'}
            </Button>
          {/if}
        </div>
        {#if listError}
          <p class="px-4 pb-2 text-xs text-destructive-text" role="alert">{listError}</p>
        {/if}
      {/if}
    </div>
  {/if}
</section>
