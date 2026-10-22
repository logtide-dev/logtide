<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { currentOrganization } from '$lib/stores/organization';
  import { authStore } from '$lib/stores/auth';
  import { scopeStore, resolveRange } from '$lib/stores/scope';
  import { layoutStore } from '$lib/stores/layout';
  import { shortcutsStore, type ShortcutScope } from '$lib/stores/shortcuts';
  import { ProjectsAPI } from '$lib/api/projects';
  import {
    tracesAPI,
    type TraceRecord,
    type TraceStats,
    type OperationRow,
    type LatencyHistogram as LatencyHistogramData,
    type EnrichedServiceDependencies,
    type EnrichedServiceDependencyNode,
  } from '$lib/api/traces';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import ServiceMap from '$lib/components/ServiceMap.svelte';
  import EmptyTraces from '$lib/components/EmptyTraces.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import * as Popover from '$lib/components/ui/popover';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Layers from '@lucide/svelte/icons/layers';
  import Timer from '@lucide/svelte/icons/timer';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';
  import Network from '@lucide/svelte/icons/network';
  import List from '@lucide/svelte/icons/list';
  import Download from '@lucide/svelte/icons/download';
  import Radio from '@lucide/svelte/icons/radio';
  import X from '@lucide/svelte/icons/x';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import OperationsTable from './OperationsTable.svelte';
  import LatencyHistogram from './LatencyHistogram.svelte';
  import TraceFilterBar from './TraceFilterBar.svelte';
  import TraceListTable from './TraceListTable.svelte';
  import { validateAttr } from './attr';
  import { formatDuration } from './format';
  import {
    parseTraceFilters,
    writeTraceFilters,
    toListQuery,
    rememberTraceListState,
    type TraceUrlFilters,
  } from '$lib/utils/trace-filters';
  import { createLatest } from '$lib/utils/latest';
  import { traceDetailUrl } from '$lib/utils/trace-links';
  import { resolveTraceProject } from '$lib/utils/trace-resolve';
  import { levelTone, stateTone } from '$lib/utils/severity';

  const PAGE_SIZE = 25;
  const LIVE_LIMIT_KEY = 'logtide_traces_livetail_limit';
  // 'traces' is not in the ShortcutScope union yet (pre-existing type gap).
  const SHORTCUT_SCOPE = 'traces' as unknown as ShortcutScope;

  const maxWidthClass = layoutStore.maxWidthClass;
  const containerPadding = layoutStore.containerPadding;

  let token = $state<string | null>(null);
  const unsubAuth = authStore.subscribe((s) => {
    token = s.token;
  });

  // ─── URL and scope state ───────────────────────────────────────────────
  const filters = $derived(parseTraceFilters(page.url));
  const projectId = $derived($scopeStore.projectIds[0] ?? null);
  const rangeKey = $derived(JSON.stringify($scopeStore.range));
  const attrCheck = $derived(validateAttr(filters.attr));
  const filtersActive = $derived(
    !!filters.service ||
      !!filters.operation ||
      !!filters.status ||
      filters.minDuration !== undefined ||
      filters.maxDuration !== undefined ||
      !!filters.attr,
  );
  const liveBlocked = $derived(
    !!filters.operation ||
      !!filters.attr ||
      filters.sortBy !== 'start_time' ||
      filters.sortOrder !== 'desc',
  );

  function navigate(url: URL) {
    goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  /** Writes filters and resets to page 1 unless the patch sets the page. */
  function patch(next: Partial<TraceUrlFilters>) {
    const withPage = 'page' in next ? next : { ...next, page: 1 };
    navigate(writeTraceFilters(page.url, withPage));
  }

  // ─── Data ──────────────────────────────────────────────────────────────
  let projects = $state<{ id: string; name: string }[]>([]);
  let projectsLoaded = $state(false);
  let availableServices = $state<string[]>([]);

  let traces = $state<TraceRecord[]>([]);
  let totalTraces = $state(0);
  let isLoading = $state(false);
  let hasLoadedOnce = $state(false);
  let listError = $state<string | null>(null);

  let stats = $state<TraceStats | null>(null);
  let statsLoading = $state(false);
  let statsError = $state<string | null>(null);

  let operations = $state<OperationRow[]>([]);
  let operationsLoading = $state(false);
  let operationsError = $state<string | null>(null);

  let histogram = $state<LatencyHistogramData | null>(null);
  let histogramLoading = $state(false);

  let mapData = $state<EnrichedServiceDependencies | null>(null);
  let isLoadingMap = $state(false);
  let mapLoadError = $state<string | null>(null);
  let selectedNode = $state<EnrichedServiceDependencyNode | null>(null);

  const listGuard = createLatest();
  const statsGuard = createLatest();
  const operationsGuard = createLatest();
  const histogramGuard = createLatest();
  const servicesGuard = createLatest();
  const mapGuard = createLatest();

  function errorMessage(e: unknown, fallback: string): string {
    return e instanceof Error && e.message ? e.message : fallback;
  }

  function currentRange() {
    return resolveRange($scopeStore.range);
  }

  async function loadProjects() {
    const org = $currentOrganization;
    if (!org) return;
    const api = new ProjectsAPI(() => token);
    try {
      const [res, availability] = await Promise.all([
        api.getProjects(org.id),
        api.getProjectDataAvailability(org.id).catch(() => null),
      ]);
      const withTraces = availability?.traces;
      const list =
        withTraces && withTraces.length > 0
          ? res.projects.filter((p) => withTraces.includes(p.id))
          : res.projects;
      projects = list.map((p) => ({ id: p.id, name: p.name }));
    } catch (e) {
      console.error('Failed to load projects:', e);
      projects = [];
    } finally {
      projectsLoaded = true;
    }
  }

  async function loadServices() {
    const pid = projectId;
    const isCurrent = servicesGuard.begin();
    if (!pid) {
      availableServices = [];
      return;
    }
    try {
      const services = await tracesAPI.getServices(pid);
      if (isCurrent()) availableServices = services;
    } catch (e) {
      if (isCurrent()) availableServices = [];
      console.error('Failed to load services:', e);
    }
  }

  async function loadTraces() {
    const pid = projectId;
    const isCurrent = listGuard.begin();
    if (!pid) {
      traces = [];
      totalTraces = 0;
      isLoading = false;
      hasLoadedOnce = true;
      return;
    }
    if (!attrCheck.ok) {
      // The filter bar shows the message; do not send the bad filter.
      traces = [];
      totalTraces = 0;
      listError = null;
      isLoading = false;
      hasLoadedOnce = true;
      return;
    }
    isLoading = true;
    listError = null;
    try {
      const response = await tracesAPI.getTraces(toListQuery(filters, currentRange(), pid, PAGE_SIZE));
      if (!isCurrent()) return;
      traces = response.traces;
      totalTraces = response.total;
    } catch (e) {
      if (!isCurrent()) return;
      listError = errorMessage(e, 'Failed to load traces');
      traces = [];
      totalTraces = 0;
    } finally {
      if (isCurrent()) {
        isLoading = false;
        hasLoadedOnce = true;
      }
    }
  }

  async function loadStats() {
    const pid = projectId;
    const isCurrent = statsGuard.begin();
    if (!pid) {
      stats = null;
      statsError = null;
      return;
    }
    statsLoading = true;
    statsError = null;
    try {
      const range = currentRange();
      const result = await tracesAPI.getStats(pid, range.from.toISOString(), range.to.toISOString(), {
        service: filters.service,
        operation: filters.operation,
      });
      if (isCurrent()) stats = result;
    } catch (e) {
      if (isCurrent()) {
        stats = null;
        statsError = errorMessage(e, 'Failed to load stats');
      }
    } finally {
      if (isCurrent()) statsLoading = false;
    }
  }

  async function loadOperations() {
    const pid = projectId;
    const isCurrent = operationsGuard.begin();
    if (!pid) {
      operations = [];
      operationsError = null;
      return;
    }
    operationsLoading = true;
    operationsError = null;
    try {
      const range = currentRange();
      const rows = await tracesAPI.getOperations({
        projectId: pid,
        service: filters.service,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      });
      if (isCurrent()) operations = rows;
    } catch (e) {
      if (isCurrent()) {
        operations = [];
        operationsError = errorMessage(e, 'Failed to load operations');
      }
    } finally {
      if (isCurrent()) operationsLoading = false;
    }
  }

  async function loadHistogram() {
    const pid = projectId;
    const isCurrent = histogramGuard.begin();
    if (!pid) {
      histogram = null;
      return;
    }
    histogramLoading = true;
    try {
      const range = currentRange();
      const result = await tracesAPI.getLatencyHistogram({
        projectId: pid,
        service: filters.service,
        operation: filters.operation,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      });
      if (isCurrent()) histogram = result;
    } catch (e) {
      console.error('Failed to load latency histogram:', e);
      if (isCurrent()) histogram = null;
    } finally {
      if (isCurrent()) histogramLoading = false;
    }
  }

  async function loadMap() {
    const pid = projectId;
    const isCurrent = mapGuard.begin();
    if (!pid) {
      mapData = null;
      return;
    }
    isLoadingMap = true;
    mapLoadError = null;
    try {
      const range = currentRange();
      const result = await tracesAPI.getServiceMap(pid, range.from.toISOString(), range.to.toISOString());
      if (isCurrent()) mapData = result;
    } catch (e) {
      console.error('Failed to load service map:', e);
      if (isCurrent()) {
        mapLoadError = 'Failed to load service map data';
        mapData = null;
      }
    } finally {
      if (isCurrent()) isLoadingMap = false;
    }
  }

  // ─── Reactions ─────────────────────────────────────────────────────────
  $effect(() => {
    if (!$currentOrganization) return;
    void $currentOrganization.id;
    untrack(() => {
      projectsLoaded = false;
      loadProjects();
    });
  });

  $effect(() => {
    void projectId;
    untrack(loadServices);
  });

  $effect(() => {
    void projectId;
    void rangeKey;
    void filters.service;
    void filters.operation;
    untrack(loadStats);
  });

  $effect(() => {
    void projectId;
    void rangeKey;
    void filters.service;
    untrack(loadOperations);
  });

  $effect(() => {
    void projectId;
    void rangeKey;
    void filters.service;
    void filters.operation;
    untrack(loadHistogram);
  });

  const listKey = $derived(
    JSON.stringify([
      filters.service,
      filters.operation,
      filters.status,
      filters.minDuration,
      filters.maxDuration,
      filters.attr,
      filters.sortBy,
      filters.sortOrder,
      filters.page,
    ]),
  );

  $effect(() => {
    void projectId;
    void rangeKey;
    void listKey;
    if (liveTail) return;
    untrack(loadTraces);
  });

  $effect(() => {
    void projectId;
    void rangeKey;
    if (filters.view !== 'map') return;
    untrack(loadMap);
  });

  // A changed project invalidates service and operation; a changed scope
  // restarts pagination.
  let lastScope: { project: string | null; range: string } | null = null;
  $effect(() => {
    const now = { project: projectId, range: rangeKey };
    const before = lastScope;
    lastScope = now;
    // The first project resolution (null to a project) is not a user switch.
    if (!before || !before.project) return;
    untrack(() => {
      if (before.project !== now.project && (filters.service || filters.operation || filters.attr)) {
        patch({ service: undefined, operation: undefined, attr: undefined });
      } else if (filters.page !== 1) {
        patch({ page: 1 });
      }
    });
  });

  // ─── B11: old `?traceId=` links ────────────────────────────────────────
  let traceNotFound = $state<string | null>(null);
  let resolvedTraceId: string | null = null;

  $effect(() => {
    const id = page.url.searchParams.get('traceId')?.trim() || null;
    if (!id) {
      traceNotFound = null;
      resolvedTraceId = null;
      return;
    }
    if (!projectsLoaded || id === resolvedTraceId) return;
    resolvedTraceId = id;
    const candidates = [
      page.url.searchParams.get('project'),
      page.url.searchParams.get('projectId'),
      projectId,
      ...projects.map((p) => p.id),
    ].filter((v): v is string => !!v);
    untrack(async () => {
      const found = await resolveTraceProject(id, candidates);
      if (resolvedTraceId !== id) return;
      if (found) {
        traceNotFound = null;
        await goto(traceDetailUrl(id, found), { replaceState: true });
      } else {
        traceNotFound = id;
      }
    });
  });

  // ─── Live tail ─────────────────────────────────────────────────────────
  let liveTail = $state(false);
  let liveTailLimit = $state(100);
  let liveTailKey = $state<string | null>(null);
  let eventSource: EventSource | null = null;
  let liveSeq = 0;

  $effect(() => {
    if (liveTail && liveBlocked) liveTail = false;
  });

  $effect(() => {
    const live = liveTail;
    const pid = projectId;
    const service = filters.service;
    const status = filters.status;
    untrack(() => {
      if (!live || !pid) {
        const wasLive = liveTailKey !== null;
        stopLiveTail();
        liveTailKey = null;
        if (wasLive && pid) loadTraces();
        return;
      }
      const key = `${pid}|${service ?? ''}|${status ?? ''}`;
      if (key === liveTailKey) return;
      stopLiveTail();
      startLiveTail(pid, service, status);
      liveTailKey = key;
    });
  });

  async function startLiveTail(pid: string, service?: string, status?: 'errors' | 'ok') {
    const seq = ++liveSeq;
    try {
      const es = await tracesAPI.createTracesEventSource({
        projectId: pid,
        service: service ? [service] : undefined,
        error: status === 'errors' ? true : status === 'ok' ? false : undefined,
      });
      if (seq !== liveSeq) {
        es.close();
        return;
      }
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type !== 'trace') return;
          const incoming = data.data as TraceRecord;
          const existing = traces.findIndex((t) => t.trace_id === incoming.trace_id);
          const next =
            existing >= 0
              ? [incoming, ...traces.filter((_, i) => i !== existing)]
              : [incoming, ...traces];
          traces = next.slice(0, liveTailLimit);
          if (existing < 0) totalTraces += 1;
        } catch (e) {
          console.error('[TracesLiveTail] parse error', e);
        }
      };
      es.onerror = (err) => console.error('[TracesLiveTail] EventSource error:', err);
      eventSource = es;
    } catch (e) {
      console.error('[TracesLiveTail] failed to start:', e);
    }
  }

  function stopLiveTail() {
    liveSeq++;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function setLiveLimit(value: string) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    liveTailLimit = n;
    try {
      localStorage.setItem(LIVE_LIMIT_KEY, String(n));
    } catch {
      // storage unavailable
    }
    if (traces.length > n) traces = traces.slice(0, n);
  }

  // ─── Actions ───────────────────────────────────────────────────────────
  let selectedTraceIndex = $state(-1);

  function openTrace(traceId: string) {
    if (!projectId) return;
    rememberTraceListState(page.url.search);
    goto(traceDetailUrl(traceId, projectId));
  }

  function jumpToTrace(traceId: string) {
    if (!projectId) return;
    goto(traceDetailUrl(traceId, projectId));
  }

  function onFilterChange(change: Partial<{
    service: string | null;
    status: 'errors' | 'ok' | null;
    minDuration: number | null;
    maxDuration: number | null;
    attr: string;
    operation: string | null;
  }>) {
    const next: Partial<TraceUrlFilters> = {};
    if ('service' in change) next.service = change.service ?? undefined;
    if ('status' in change) next.status = change.status ?? undefined;
    if ('minDuration' in change) next.minDuration = change.minDuration ?? undefined;
    if ('maxDuration' in change) next.maxDuration = change.maxDuration ?? undefined;
    if ('attr' in change) next.attr = change.attr || undefined;
    if ('operation' in change) next.operation = change.operation ?? undefined;
    patch(next);
  }

  function clearFilters() {
    patch({
      service: undefined,
      operation: undefined,
      status: undefined,
      minDuration: undefined,
      maxDuration: undefined,
      attr: undefined,
    });
  }

  function onBrush(range: { minMs: number; maxMs: number | null } | null) {
    if (!range) {
      patch({ minDuration: undefined, maxDuration: undefined });
      return;
    }
    patch({
      minDuration: range.minMs > 0 ? range.minMs : undefined,
      maxDuration: range.maxMs ?? undefined,
    });
  }

  function refreshAll() {
    loadTraces();
    loadStats();
    loadOperations();
    loadHistogram();
    if (filters.view === 'map') loadMap();
  }

  function download(content: string, type: string, name: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    if (traces.length === 0) return;
    download(JSON.stringify(traces, null, 2), 'application/json', `traces-${Date.now()}.json`);
  }

  function exportCsv() {
    if (traces.length === 0) return;
    const header = 'start_time,project_id,service,operation,duration_ms,span_count,error,trace_id';
    const rows = traces.map((t) =>
      [
        t.start_time,
        JSON.stringify(projectId ?? ''),
        JSON.stringify(t.root_service_name || t.service_name),
        JSON.stringify(t.root_operation_name || ''),
        t.duration_ms,
        t.span_count,
        t.error,
        t.trace_id,
      ].join(','),
    );
    download([header, ...rows].join('\n'), 'text/csv', `traces-${Date.now()}.csv`);
  }

  // ─── Service map ───────────────────────────────────────────────────────
  function handleNodeClick(name: string) {
    selectedNode = mapData?.nodes.find((n) => n.name === name) ?? null;
  }

  function healthOf(errorRate: number): { label: string; tone: ReturnType<typeof stateTone> } {
    if (errorRate >= 0.1) return { label: 'Unhealthy', tone: stateTone('failed') };
    if (errorRate >= 0.01) return { label: 'Degraded', tone: levelTone('warn') };
    return { label: 'Healthy', tone: stateTone('ok') };
  }

  function viewTracesForService(name: string) {
    selectedNode = null;
    patch({ view: 'list', service: name, operation: undefined });
  }

  const downstreamEdges = $derived(
    mapData && selectedNode ? mapData.edges.filter((e) => e.source === selectedNode!.name) : [],
  );
  const upstreamEdges = $derived(
    mapData && selectedNode ? mapData.edges.filter((e) => e.target === selectedNode!.name) : [],
  );

  // ─── Shortcuts ─────────────────────────────────────────────────────────
  function focusRow(index: number) {
    const links = document.querySelectorAll<HTMLElement>('[data-trace-link]');
    links[index]?.focus();
  }

  onMount(() => {
    try {
      const saved = parseInt(localStorage.getItem(LIVE_LIMIT_KEY) ?? '', 10);
      if (Number.isFinite(saved) && saved > 0) liveTailLimit = saved;
    } catch {
      // storage unavailable
    }

    shortcutsStore.setScope(SHORTCUT_SCOPE);
    shortcutsStore.register([
      {
        id: 'traces:focus',
        combo: '/',
        label: 'Focus trace ID input',
        scope: SHORTCUT_SCOPE,
        category: 'search',
        action: () => document.getElementById('trace-id-input')?.focus(),
      },
      {
        id: 'traces:refresh',
        combo: 'r',
        label: 'Refresh results',
        scope: SHORTCUT_SCOPE,
        category: 'actions',
        action: () => refreshAll(),
      },
      {
        id: 'traces:next',
        combo: 'j',
        label: 'Next trace',
        scope: SHORTCUT_SCOPE,
        category: 'navigation',
        action: () => {
          if (traces.length === 0) return;
          selectedTraceIndex = Math.min(selectedTraceIndex + 1, traces.length - 1);
          focusRow(selectedTraceIndex);
        },
      },
      {
        id: 'traces:prev',
        combo: 'k',
        label: 'Previous trace',
        scope: SHORTCUT_SCOPE,
        category: 'navigation',
        action: () => {
          if (traces.length === 0) return;
          selectedTraceIndex = Math.max(selectedTraceIndex - 1, 0);
          focusRow(selectedTraceIndex);
        },
      },
      {
        id: 'traces:expand',
        combo: 'enter',
        label: 'Open selected trace',
        scope: SHORTCUT_SCOPE,
        category: 'actions',
        action: () => {
          const t = traces[selectedTraceIndex];
          if (t) openTrace(t.trace_id);
        },
      },
    ]);
  });

  onDestroy(() => {
    stopLiveTail();
    shortcutsStore.unregisterScope(SHORTCUT_SCOPE);
    unsubAuth();
  });

  function pct(rate: number): string {
    return `${((Number.isFinite(rate) ? rate : 0) * 100).toFixed(1)}%`;
  }
</script>

<svelte:head>
  <title>Traces - LogTide</title>
</svelte:head>

<div class="container mx-auto {$containerPadding} {$maxWidthClass}">
  <PageHeader title="Traces" description="Find slow operations and open an example trace">
    {#snippet actions()}
      <ScopeBar mode="single" {projects} timeDisabled={liveTail} />
      <div class="inline-flex items-center rounded-md border bg-background p-0.5">
        <Button
          variant={filters.view === 'list' ? 'secondary' : 'ghost'}
          size="sm"
          class="h-7 gap-1.5 text-xs"
          aria-pressed={filters.view === 'list'}
          onclick={() => patch({ view: 'list', page: filters.page })}
        >
          <List class="size-3.5" aria-hidden="true" />
          <span class="hidden sm:inline">List</span>
        </Button>
        <Button
          variant={filters.view === 'map' ? 'secondary' : 'ghost'}
          size="sm"
          class="h-7 gap-1.5 text-xs"
          aria-pressed={filters.view === 'map'}
          onclick={() => patch({ view: 'map', page: filters.page })}
        >
          <Network class="size-3.5" aria-hidden="true" />
          <span class="hidden sm:inline">Map</span>
        </Button>
      </div>
      {#if filters.view === 'list'}
        <Popover.Root>
          <Popover.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="outline"
                size="sm"
                class="gap-2"
                disabled={liveTail || traces.length === 0}
              >
                <Download class="size-4" aria-hidden="true" />
                <span class="hidden sm:inline">Export</span>
              </Button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content class="w-[180px] max-w-[90vw] p-1.5" align="end">
            <div class="space-y-0.5">
              <button
                type="button"
                class="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onclick={exportJson}
              >
                Export JSON
              </button>
              <button
                type="button"
                class="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onclick={exportCsv}
              >
                Export CSV
              </button>
            </div>
          </Popover.Content>
        </Popover.Root>
        <div
          class="flex items-center gap-2"
          title={liveBlocked ? 'Live tail ignores operation, attribute and sort settings' : undefined}
        >
          <Label for="traces-live-tail" class="m-0 flex cursor-pointer items-center gap-1.5 text-sm font-normal">
            <Radio
              class="size-3.5 {liveTail ? `${stateTone('ok').text} animate-pulse` : 'text-muted-foreground'}"
              aria-hidden="true"
            />
            Live tail
          </Label>
          <Switch id="traces-live-tail" bind:checked={liveTail} disabled={liveBlocked} />
          {#if liveTail}
            <select
              class="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Live tail limit"
              value={String(liveTailLimit)}
              onchange={(e) => setLiveLimit(e.currentTarget.value)}
            >
              {#each [50, 100, 200, 500, 1000] as n (n)}
                <option value={String(n)}>{n.toLocaleString('en-US')}</option>
              {/each}
            </select>
          {/if}
        </div>
      {/if}
    {/snippet}
  </PageHeader>

  {#if traceNotFound}
    <EmptyState
      variant="no-results"
      title="No trace with id {traceNotFound} in your projects"
      description="Check the id, or widen the project and time range."
    >
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={() => navigate(new URL('/dashboard/traces', page.url))}>
          Back to traces
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <!-- Stats -->
    {#if stats}
      <div class="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent class="pt-6">
            <div class="flex items-center gap-3">
              <GitBranch class="size-5 text-muted-foreground" aria-hidden="true" />
              <div>
                <p class="text-sm text-muted-foreground">Total traces</p>
                <p class="text-2xl font-bold">{stats.total_traces.toLocaleString('en-US')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="pt-6">
            <div class="flex items-center gap-3">
              <Layers class="size-5 text-muted-foreground" aria-hidden="true" />
              <div>
                <p class="text-sm text-muted-foreground">Total spans</p>
                <p class="text-2xl font-bold">{stats.total_spans.toLocaleString('en-US')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="pt-6">
            <div class="flex items-center gap-3">
              <Timer class="size-5 text-muted-foreground" aria-hidden="true" />
              <div>
                <p class="text-sm text-muted-foreground">p95 latency</p>
                <p class="text-2xl font-bold" title="Approximate, from latency buckets">
                  {formatDuration(stats.p95_duration_ms)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="pt-6">
            <div class="flex items-center gap-3">
              <AlertCircle class="size-5 {levelTone('error').text}" aria-hidden="true" />
              <div>
                <p class="text-sm text-muted-foreground">Error rate</p>
                <p class="text-2xl font-bold">{pct(stats.error_rate)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    {:else if statsError}
      <div class="mb-6 flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-sm" role="alert">
        <span class="text-muted-foreground">Could not load stats: {statsError}</span>
        <Button variant="outline" size="sm" onclick={loadStats}>Retry</Button>
      </div>
    {/if}

    {#if filters.view === 'list'}
      {#if projectId}
        <div class="mb-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader class="pb-2">
              <CardTitle class="text-base">Operations</CardTitle>
            </CardHeader>
            <CardContent>
              <OperationsTable
                rows={operations}
                loading={operationsLoading}
                error={operationsError}
                selectedOperation={filters.operation ?? null}
                showService={!filters.service}
                onSelect={(op) => patch({ operation: op ?? undefined })}
                onRetry={loadOperations}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent class="pt-6">
              <LatencyHistogram
                data={histogram}
                loading={histogramLoading}
                selection={{ minMs: filters.minDuration ?? null, maxMs: filters.maxDuration ?? null }}
                {onBrush}
              />
            </CardContent>
          </Card>
        </div>
      {/if}

      <div class="mb-4 rounded-lg border bg-card p-3">
        <TraceFilterBar
          services={availableServices}
          service={filters.service ?? null}
          status={filters.status ?? null}
          minDuration={filters.minDuration ?? null}
          maxDuration={filters.maxDuration ?? null}
          attr={filters.attr ?? ''}
          operation={filters.operation ?? null}
          onChange={onFilterChange}
          onJumpToTrace={jumpToTrace}
        />
      </div>

      {#if hasLoadedOnce && !isLoading && traces.length === 0 && !filtersActive && !listError && !liveTail}
        <EmptyTraces />
      {:else}
        <TraceListTable
          {traces}
          projectId={projectId ?? ''}
          loading={!hasLoadedOnce || (isLoading && traces.length === 0)}
          total={totalTraces}
          page={filters.page}
          pageSize={PAGE_SIZE}
          sortBy={filters.sortBy}
          sortOrder={filters.sortOrder}
          {filtersActive}
          error={listError}
          onSort={(sortBy, sortOrder) => patch({ sortBy, sortOrder })}
          onPageChange={(p) => patch({ page: p })}
          onClearFilters={clearFilters}
          onOpen={() => rememberTraceListState(page.url.search)}
          onRetry={loadTraces}
        />
      {/if}
    {:else}
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <div class="flex items-center gap-1.5">
            <span class="inline-block size-3 rounded-full {stateTone('ok').dot}"></span>
            <span>Healthy (under 1%)</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="inline-block size-3 rounded-full {levelTone('warn').dot}"></span>
            <span>Degraded (1 to 10%)</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="inline-block size-3 rounded-full {stateTone('failed').dot}"></span>
            <span>Unhealthy (over 10%)</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="inline-block w-6 border-t-2 border-dashed border-muted-foreground"></span>
            <span>Log correlation</span>
          </div>
        </div>
      </div>

      <div class="flex gap-4">
        <div class="min-w-0 flex-1">
          <Card>
            <CardContent class="pt-6">
              {#if isLoadingMap}
                <div class="flex h-[500px] items-center justify-center"><Spinner size="lg" /></div>
              {:else if mapLoadError}
                <EmptyState variant="error" title="Could not load the service map" description={mapLoadError}>
                  {#snippet actions()}
                    <Button variant="outline" size="sm" onclick={loadMap}>Retry</Button>
                  {/snippet}
                </EmptyState>
              {:else if mapData && mapData.nodes.length > 0}
                <ServiceMap dependencies={mapData} height="600px" onNodeClick={handleNodeClick} />
              {:else if mapData}
                <EmptyState
                  variant="no-data"
                  title="No service dependencies found"
                  description="Send traces with parent-child spans or logs with a trace id to see service relationships"
                />
              {:else}
                <p class="py-24 text-center text-muted-foreground">Select a project to view the service map</p>
              {/if}
            </CardContent>
          </Card>
        </div>

        {#if selectedNode}
          {@const health = healthOf(selectedNode.errorRate)}
          <div class="w-80 flex-shrink-0">
            <Card>
              <CardHeader class="flex flex-row items-start justify-between pb-3">
                <div>
                  <CardTitle class="text-base">{selectedNode.name}</CardTitle>
                  <span class="mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium {health.tone.badge}">
                    {health.label}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8"
                  aria-label="Close service panel"
                  onclick={() => (selectedNode = null)}
                >
                  <X class="size-4" aria-hidden="true" />
                </Button>
              </CardHeader>
              <CardContent class="space-y-4">
                <div class="grid grid-cols-2 gap-3">
                  <div class="rounded-lg bg-muted/50 p-3">
                    <p class="text-xs text-muted-foreground">Error rate</p>
                    <p class="text-lg font-bold {health.tone.text}">{pct(selectedNode.errorRate)}</p>
                  </div>
                  <div class="rounded-lg bg-muted/50 p-3">
                    <p class="text-xs text-muted-foreground">Avg latency</p>
                    <p class="text-lg font-bold">{formatDuration(selectedNode.avgLatencyMs)}</p>
                  </div>
                  <div class="rounded-lg bg-muted/50 p-3">
                    <p class="text-xs text-muted-foreground">p95 latency</p>
                    <p class="text-lg font-bold">
                      {selectedNode.p95LatencyMs != null ? formatDuration(selectedNode.p95LatencyMs) : 'N/A'}
                    </p>
                  </div>
                  <div class="rounded-lg bg-muted/50 p-3">
                    <p class="text-xs text-muted-foreground">Total calls</p>
                    <p class="text-lg font-bold">{selectedNode.totalCalls.toLocaleString('en-US')}</p>
                  </div>
                </div>

                {#if downstreamEdges.length > 0}
                  <div>
                    <p class="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <ArrowRight class="size-3" aria-hidden="true" />
                      Calls to
                    </p>
                    <div class="space-y-1.5">
                      {#each downstreamEdges as edge (edge.target)}
                        <div class="flex items-center justify-between text-sm">
                          <span class="truncate font-medium">{edge.target}</span>
                          <div class="flex flex-shrink-0 items-center gap-2">
                            <span class="tabular-nums text-muted-foreground">{edge.callCount.toLocaleString('en-US')}</span>
                            {#if edge.type === 'log_correlation'}
                              <Badge variant="outline" class="px-1 py-0 text-[10px]">log</Badge>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}

                {#if upstreamEdges.length > 0}
                  <div>
                    <p class="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <ArrowLeft class="size-3" aria-hidden="true" />
                      Called by
                    </p>
                    <div class="space-y-1.5">
                      {#each upstreamEdges as edge (edge.source)}
                        <div class="flex items-center justify-between text-sm">
                          <span class="truncate font-medium">{edge.source}</span>
                          <div class="flex flex-shrink-0 items-center gap-2">
                            <span class="tabular-nums text-muted-foreground">{edge.callCount.toLocaleString('en-US')}</span>
                            {#if edge.type === 'log_correlation'}
                              <Badge variant="outline" class="px-1 py-0 text-[10px]">log</Badge>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}

                <Button class="w-full" onclick={() => viewTracesForService(selectedNode!.name)}>
                  View traces
                </Button>
              </CardContent>
            </Card>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
