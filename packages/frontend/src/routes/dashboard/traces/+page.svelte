<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { currentOrganization } from "$lib/stores/organization";
  import { authStore } from "$lib/stores/auth";
  import { currentProjectStore } from "$lib/stores/current-project";
  import { ProjectsAPI } from "$lib/api/projects";
  import type { Project } from "@logtide/shared";
  import {
    tracesAPI,
    type TraceRecord,
    type TraceStats,
    type EnrichedServiceDependencies,
    type EnrichedServiceDependencyNode,
  } from "$lib/api/traces";
  import ServiceMap from "$lib/components/ServiceMap.svelte";
  import Button from "$lib/components/ui/button/button.svelte";
  import Label from "$lib/components/ui/label/label.svelte";
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "$lib/components/ui/table";
  import * as Select from "$lib/components/ui/select";
  import * as Popover from "$lib/components/ui/popover";
  import Input from "$lib/components/ui/input/input.svelte";
  import Switch from "$lib/components/ui/switch/switch.svelte";
  import TimeRangePicker from "$lib/components/TimeRangePicker.svelte";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import AlertCircle from "@lucide/svelte/icons/alert-circle";
  import Timer from "@lucide/svelte/icons/timer";
  import Layers from "@lucide/svelte/icons/layers";
  import Network from "@lucide/svelte/icons/network";
  import List from "@lucide/svelte/icons/list";
  import Download from "@lucide/svelte/icons/download";
  import X from "@lucide/svelte/icons/x";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Clock from "@lucide/svelte/icons/clock";
  import Radio from "@lucide/svelte/icons/radio";
  import EmptyTraces from "$lib/components/EmptyTraces.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { SkeletonTable, TableLoadingOverlay } from "$lib/components/ui/skeleton";
  import { layoutStore } from "$lib/stores/layout";
  import { toastStore } from "$lib/stores/toast";
  import { shortcutsStore } from "$lib/stores/shortcuts";
  import type { SpanRecord } from "$lib/api/traces";

  let token = $state<string | null>(null);
  let maxWidthClass = $state("max-w-7xl");
  let containerPadding = $state("px-6 py-8");

  $effect(() => {
    const unsubscribe = layoutStore.maxWidthClass.subscribe((value) => {
      maxWidthClass = value;
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = layoutStore.containerPadding.subscribe((value) => {
      containerPadding = value;
    });
    return unsubscribe;
  });

  let traces = $state<TraceRecord[]>([]);
  let stats = $state<TraceStats | null>(null);
  let totalTraces = $state(0);
  let isLoading = $state(false);
  let hasLoadedOnce = $state(false);
  let availableServices = $state<string[]>([]);

  // View toggle: list or map
  let activeView = $state<'list' | 'map'>('list');

  // List view filters
  let selectedServices = $state<string[]>([]);
  let statusFilter = $state<'all' | 'errors' | 'ok'>('all');
  let minDurationMs = $state<number | null>(null);
  let maxDurationMs = $state<number | null>(null);
  let traceIdInput = $state("");

  // Live tail
  let liveTail = $state(false);
  let liveTailLimit = $state(100);
  let liveTailConnectionKey = $state<string | null>(null);
  let tracesEventSource: EventSource | null = null;
  let liveTailSeq = 0;

  // Row expansion + keyboard nav
  let expandedTraceIds = $state<Set<string>>(new Set());
  let traceSpansCache = $state<Map<string, SpanRecord[]>>(new Map());
  let loadingSpansFor = $state<Set<string>>(new Set());
  let selectedTraceIndex = $state(-1);

  // Map view state
  let mapData = $state<EnrichedServiceDependencies | null>(null);
  let isLoadingMap = $state(false);
  let mapLoadError = $state<string | null>(null);
  let selectedNode = $state<EnrichedServiceDependencyNode | null>(null);

  const unsubAuthStore = authStore.subscribe((state) => {
    token = state.token;
  });

  onDestroy(() => {
    stopLiveTail();
    shortcutsStore.unregisterScope('traces');
    unsubAuthStore();
  });

  // Local project and time range state
  let projects = $state<Project[]>([]);
  let selectedProject = $state<string | null>(null);
  let timeRangePicker = $state<ReturnType<typeof TimeRangePicker> | null>(null);
  let timeRangeType = $state<'last_hour' | 'last_24h' | 'last_7d' | 'custom'>('last_24h');
  let customFromTime = $state("");
  let customToTime = $state("");

  let projectsAPI = $derived(new ProjectsAPI(() => token));

  async function loadProjects() {
    if (!$currentOrganization) return;
    try {
      const [res, availability] = await Promise.all([
        projectsAPI.getProjects($currentOrganization.id),
        projectsAPI.getProjectDataAvailability($currentOrganization.id).catch(() => null),
      ]);
      const tracesProjectIds = availability?.traces;
      projects = tracesProjectIds && tracesProjectIds.length > 0
        ? res.projects.filter((p) => tracesProjectIds.includes(p.id))
        : res.projects;
      if (projects.length > 0 && !selectedProject) {
        const remembered = currentProjectStore.get();
        selectedProject = projects.some((p) => p.id === remembered)
          ? remembered
          : projects[0].id;
      }
    } catch (e) {
      console.error("Failed to load projects:", e);
    }
  }

  function getTimeRange(): { from: Date; to: Date } {
    if (timeRangePicker) {
      return timeRangePicker.getTimeRange();
    }
    const now = new Date();
    switch (timeRangeType) {
      case 'last_hour':
        return { from: new Date(now.getTime() - 60 * 60 * 1000), to: now };
      case 'last_24h':
        return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
      case 'last_7d':
        return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
      case 'custom': {
        const from = customFromTime ? new Date(customFromTime) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const to = customToTime ? new Date(customToTime) : now;
        return { from, to };
      }
      default:
        return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
    }
  }

  async function handleTimeRangeChange() {
    if (!timeRangePicker) return;
    const newType = timeRangePicker.getType();
    const custom = timeRangePicker.getCustomValues();
    customFromTime = custom.from;
    customToTime = custom.to;
    // Mutating `timeRangeType` re-fires the effect that reloads traces and
    // services. We only trigger an explicit load when the preset type didn't
    // change (custom range edit within the same "custom" preset).
    if (newType === timeRangeType) {
      currentPage = 1;
      await loadServices();
      loadTraces();
      if (activeView === 'map') loadMap();
    } else {
      timeRangeType = newType;
    }
  }

  // Pagination
  let pageSize = $state(25);
  let currentPage = $state(1);
  let totalPages = $derived(Math.ceil(totalTraces / pageSize));

  let lastLoadedOrg = $state<string | null>(null);

  // Request-sequence guard: each loadTraces() captures the current value and
  // bails out after its await if a newer load has started in the meantime,
  // so a slow earlier response cannot overwrite fresher results.
  let loadTracesSeq = 0;

  onMount(() => {
    shortcutsStore.setScope('traces');
    shortcutsStore.register([
      {
        id: 'traces:focus',
        combo: '/',
        label: 'Focus trace ID input',
        scope: 'traces',
        category: 'search',
        action: () => {
          const el = document.getElementById('trace-id-input') as HTMLInputElement | null;
          el?.focus();
        },
      },
      {
        id: 'traces:refresh',
        combo: 'r',
        label: 'Refresh results',
        scope: 'traces',
        category: 'actions',
        action: () => loadTraces(),
      },
      {
        id: 'traces:next',
        combo: 'j',
        label: 'Next trace',
        scope: 'traces',
        category: 'navigation',
        action: () => {
          if (traces.length === 0) return;
          selectedTraceIndex = Math.min(selectedTraceIndex + 1, traces.length - 1);
          scrollToSelectedTrace();
        },
      },
      {
        id: 'traces:prev',
        combo: 'k',
        label: 'Previous trace',
        scope: 'traces',
        category: 'navigation',
        action: () => {
          if (traces.length === 0) return;
          selectedTraceIndex = Math.max(selectedTraceIndex - 1, 0);
          scrollToSelectedTrace();
        },
      },
      {
        id: 'traces:expand',
        combo: 'enter',
        label: 'Expand/collapse selected trace',
        scope: 'traces',
        category: 'actions',
        action: () => {
          if (selectedTraceIndex >= 0 && selectedTraceIndex < traces.length) {
            void toggleTraceRow(traces[selectedTraceIndex].trace_id);
          }
        },
      },
    ]);

    // Restore live-tail limit persisted across sessions.
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('logtide_traces_livetail_limit');
      if (saved) {
        const n = parseInt(saved, 10);
        if (!Number.isNaN(n) && n > 0) liveTailLimit = n;
      }
    }

    // Read URL params for cross-page links
    const urlService = page.url.searchParams.get('service');
    const urlProjectId = page.url.searchParams.get('projectId');
    const urlFrom = page.url.searchParams.get('from');
    const urlTo = page.url.searchParams.get('to');
    const urlTraceId = page.url.searchParams.get('traceId');

    if (urlService) {
      selectedServices = [urlService];
    }

    if (urlTraceId) {
      traceIdInput = urlTraceId;
    }

    if (urlProjectId) {
      selectedProject = urlProjectId;
    }

    if (urlFrom && urlTo) {
      timeRangeType = 'custom';
      customFromTime = urlFrom;
      customToTime = urlTo;
    }

    loadProjects();
  });

  // React to organization changes
  $effect(() => {
    if (!$currentOrganization) {
      traces = [];
      lastLoadedOrg = null;
      return;
    }

    if ($currentOrganization.id === lastLoadedOrg) return;
    lastLoadedOrg = $currentOrganization.id;
    selectedProject = null;
    loadProjects();
  });

  // React to project or time range changes
  $effect(() => {
    // track
    selectedProject;
    timeRangeType;

    untrack(() => {
      if (!selectedProject) {
        traces = [];
        totalTraces = 0;
        stats = null;
        availableServices = [];
        mapData = null;
        return;
      }

      currentPage = 1;
      loadTraces();
      loadServices();

      if (activeView === 'map') {
        loadMap();
      }
    });
  });

  async function loadTraces() {
    if (!selectedProject) {
      traces = [];
      totalTraces = 0;
      hasLoadedOnce = true;
      return;
    }

    isLoading = true;
    const seq = ++loadTracesSeq;

    try {
      const timeRange = getTimeRange();
      const offset = (currentPage - 1) * pageSize;

      const response = await tracesAPI.getTraces({
        projectId: selectedProject,
        service: selectedServices.length > 0
          ? (selectedServices.length === 1 ? selectedServices[0] : selectedServices)
          : undefined,
        error: statusFilter === 'errors' ? true : statusFilter === 'ok' ? false : undefined,
        from: timeRange.from.toISOString(),
        to: timeRange.to.toISOString(),
        minDurationMs: minDurationMs ?? undefined,
        maxDurationMs: maxDurationMs ?? undefined,
        limit: pageSize,
        offset: offset,
      });

      // A newer load started while this request was in flight: discard the
      // stale response so it cannot overwrite fresher results.
      if (seq !== loadTracesSeq) return;

      traces = response.traces;
      totalTraces = response.total;

      // Stats are auxiliary: a stats failure must not discard the loaded traces,
      // so fetch them in their own try/catch rather than the outer one.
      try {
        const loadedStats = await tracesAPI.getStats(
          selectedProject,
          timeRange.from.toISOString(),
          timeRange.to.toISOString()
        );
        if (seq === loadTracesSeq) {
          stats = loadedStats;
        }
      } catch (e) {
        console.error("Failed to load trace stats:", e);
      }
    } catch (e) {
      if (seq !== loadTracesSeq) return;
      console.error("Failed to load traces:", e);
      toastStore.error('Failed to load traces');
      traces = [];
    } finally {
      if (seq === loadTracesSeq) {
        isLoading = false;
        hasLoadedOnce = true;
      }
    }
  }

  // ─── Live tail ────────────────────────────────────────────────────────
  $effect(() => {
    // React to liveTail toggle and the filters that change the subscription.
    liveTail;
    selectedProject;
    selectedServices;
    statusFilter;

    if (!liveTail || !selectedProject) {
      const wasLive = liveTailConnectionKey !== null;
      stopLiveTail();
      liveTailConnectionKey = null;
      if (wasLive && selectedProject) {
        loadTraces();
      }
      return;
    }

    const key = `${selectedProject}|${selectedServices.join(',')}|${statusFilter}`;
    if (key === liveTailConnectionKey) return;

    stopLiveTail();
    startLiveTail();
    liveTailConnectionKey = key;
  });

  async function startLiveTail() {
    if (!selectedProject) return;
    const seq = ++liveTailSeq;
    try {
      const es = await tracesAPI.createTracesEventSource({
        projectId: selectedProject,
        service: selectedServices.length > 0 ? selectedServices : undefined,
        error: statusFilter === 'errors' ? true : statusFilter === 'ok' ? false : undefined,
      });

      // A newer start/stop happened while the ticket request was in flight: drop
      // this now-stale stream instead of leaking it.
      if (seq !== liveTailSeq) {
        es.close();
        return;
      }

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'trace') {
            const incoming = data.data as TraceRecord;
            // Prepend and dedupe by trace_id; cap the displayed list at liveTailLimit.
            const existing = traces.findIndex((t) => t.trace_id === incoming.trace_id);
            const next = existing >= 0
              ? [incoming, ...traces.filter((_, i) => i !== existing)]
              : [incoming, ...traces];
            traces = next.slice(0, liveTailLimit);
            // Only the rendered list is capped at liveTailLimit; do NOT overwrite
            // totalTraces with the capped length (that corrupts pagination). Bump
            // the running total when a genuinely new trace arrives.
            if (existing < 0) {
              totalTraces += 1;
            }
          }
        } catch (e) {
          console.error('[TracesLiveTail] parse error', e);
        }
      };

      es.onerror = (err) => {
        console.error('[TracesLiveTail] EventSource error:', err);
      };

      tracesEventSource = es;
    } catch (e) {
      console.error('[TracesLiveTail] failed to start:', e);
    }
  }

  function stopLiveTail() {
    liveTailSeq++;
    if (tracesEventSource) {
      tracesEventSource.close();
      tracesEventSource = null;
    }
  }

  async function loadServices() {
    if (!selectedProject) {
      availableServices = [];
      return;
    }

    try {
      availableServices = await tracesAPI.getServices(selectedProject);
    } catch (e) {
      console.error("Failed to load services:", e);
      availableServices = [];
    }
  }

  async function loadMap() {
    if (!selectedProject) {
      mapData = null;
      return;
    }

    isLoadingMap = true;
    mapLoadError = null;

    try {
      const { from, to } = getTimeRange();
      mapData = await tracesAPI.getServiceMap(
        selectedProject,
        from.toISOString(),
        to.toISOString(),
      );
    } catch (e) {
      console.error("Failed to load service map:", e);
      mapLoadError = "Failed to load service map data.";
      mapData = null;
    } finally {
      isLoadingMap = false;
    }
  }

  // Map view helpers
  function handleNodeClick(nodeName: string) {
    if (!mapData) return;
    selectedNode = mapData.nodes.find((n) => n.name === nodeName) ?? null;
  }

  function closeSidePanel() {
    selectedNode = null;
  }

  function getHealthLabel(errorRate: number): {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  } {
    if (errorRate >= 0.1) return { label: "Unhealthy", variant: "destructive" };
    if (errorRate >= 0.01) return { label: "Degraded", variant: "default" };
    return { label: "Healthy", variant: "secondary" };
  }

  function exportMapPng() {
    const canvas = document.querySelector(
      ".service-map canvas",
    ) as HTMLCanvasElement | null;
    if (!canvas) {
      toastStore.error('Unable to export the service map image');
      return;
    }
    const link = document.createElement("a");
    link.download = `service-map-${selectedProject}-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function viewTracesForService(serviceName: string) {
    selectedServices = [serviceName];
    selectedNode = null;
    activeView = 'list';
    currentPage = 1;
    loadTraces();
  }

  let downstreamEdges = $derived(
    mapData && selectedNode
      ? mapData.edges.filter((e) => e.source === selectedNode!.name)
      : [],
  );

  let upstreamEdges = $derived(
    mapData && selectedNode
      ? mapData.edges.filter((e) => e.target === selectedNode!.name)
      : [],
  );

  // Switch view handler
  function switchView(view: 'list' | 'map') {
    activeView = view;
    if (view === 'map' && !mapData && selectedProject) {
      loadMap();
    }
  }

  // List view helpers
  function goToPage(pg: number) {
    if (pg >= 1 && pg <= totalPages && pg !== currentPage) {
      currentPage = pg;
      loadTraces();
    }
  }

  function nextPage() {
    if (currentPage < totalPages) {
      currentPage++;
      loadTraces();
    }
  }

  function previousPage() {
    if (currentPage > 1) {
      currentPage--;
      loadTraces();
    }
  }

  function applyFilters() {
    currentPage = 1;
    loadTraces();
  }

  function formatDateTime(dateStr: string): string {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  function formatDuration(ms: number): string {
    if (ms < 1) return "<1ms";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  }

  function formatLatency(ms: number): string {
    if (ms < 1) return "<1ms";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function viewTrace(traceId: string) {
    if (selectedProject) {
      goto(`/dashboard/traces/${traceId}?projectId=${selectedProject}`);
    }
  }

  function jumpToTraceId() {
    const id = traceIdInput.trim();
    if (!id || !selectedProject) return;
    goto(`/dashboard/traces/${id}?projectId=${selectedProject}`);
  }

  async function toggleTraceRow(traceId: string) {
    const next = new Set(expandedTraceIds);
    if (next.has(traceId)) {
      next.delete(traceId);
      expandedTraceIds = next;
      return;
    }
    next.add(traceId);
    expandedTraceIds = next;
    if (!traceSpansCache.has(traceId) && selectedProject) {
      const loading = new Set(loadingSpansFor);
      loading.add(traceId);
      loadingSpansFor = loading;
      try {
        const spans = await tracesAPI.getTraceSpans(traceId, selectedProject);
        const cache = new Map(traceSpansCache);
        cache.set(traceId, spans);
        traceSpansCache = cache;
      } catch (e) {
        console.error('Failed to load spans:', e);
        toastStore.error('Failed to load spans for this trace');
      } finally {
        const loading2 = new Set(loadingSpansFor);
        loading2.delete(traceId);
        loadingSpansFor = loading2;
      }
    }
  }

  function exportTracesJson() {
    if (traces.length === 0) return;
    const blob = new Blob([JSON.stringify(traces, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `traces-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportTracesCsv() {
    if (traces.length === 0) return;
    const header = 'start_time,service,operation,duration_ms,span_count,error,trace_id';
    const rows = traces.map((t) => [
      t.start_time,
      JSON.stringify(t.root_service_name || t.service_name),
      JSON.stringify(t.root_operation_name || ''),
      t.duration_ms,
      t.span_count,
      t.error,
      t.trace_id,
    ].join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `traces-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function scrollToSelectedTrace() {
    if (selectedTraceIndex < 0) return;
    const row = document.querySelector(`[data-trace-index="${selectedTraceIndex}"]`);
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ─── Pill derived helpers ─────────────────────────────────────────────
  function truncate(s: string, max = 16): string {
    return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
  }

  const timeRangeLabel = $derived.by(() => {
    switch (timeRangeType) {
      case 'last_hour': return 'Last hour';
      case 'last_24h': return 'Last 24 hours';
      case 'last_7d': return 'Last 7 days';
      case 'custom': return 'Custom range';
      default: return 'Time range';
    }
  });

  const projectPillLabel = $derived.by(() => {
    if (!selectedProject) return 'Project: —';
    const p = projects.find((x) => x.id === selectedProject);
    return `Project: ${truncate(p?.name ?? 'unknown')}`;
  });

  const servicesPillLabel = $derived.by(() => {
    if (selectedServices.length === 0) return 'All services';
    if (selectedServices.length === 1) return `Service: ${truncate(selectedServices[0])}`;
    return `Services: ${selectedServices.length}`;
  });
  const servicesPillActive = $derived(selectedServices.length > 0);

  const statusPillLabel = $derived(
    statusFilter === 'errors'
      ? 'Status: errors'
      : statusFilter === 'ok'
        ? 'Status: ok'
        : 'All statuses'
  );
  const statusPillActive = $derived(statusFilter !== 'all');

  const durationPillLabel = $derived.by(() => {
    if (minDurationMs == null && maxDurationMs == null) return 'Duration';
    const lo = minDurationMs != null ? `${minDurationMs}ms` : '0';
    const hi = maxDurationMs != null ? `${maxDurationMs}ms` : '∞';
    return `${lo}–${hi}`;
  });
  const durationPillActive = $derived(minDurationMs != null || maxDurationMs != null);

  const tracePillLabel = $derived(
    traceIdInput.trim().length > 0 ? `Trace: ${truncate(traceIdInput, 10)}` : 'Trace ID'
  );
  const tracePillActive = $derived(traceIdInput.trim().length > 0);

  const activeFilterCount = $derived(
    (servicesPillActive ? 1 : 0) +
    (statusPillActive ? 1 : 0) +
    (durationPillActive ? 1 : 0) +
    (tracePillActive ? 1 : 0)
  );

  function clearAllFilters() {
    selectedServices = [];
    statusFilter = 'all';
    minDurationMs = null;
    maxDurationMs = null;
    traceIdInput = "";
    applyFilters();
  }
</script>

<svelte:head>
  <title>Traces - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <!-- Header -->
  <div class="mb-6">
    <div class="flex items-center gap-3 mb-2">
      <GitBranch class="w-8 h-8 text-primary" />
      <h1 class="text-3xl font-bold tracking-tight">Distributed Traces</h1>
    </div>
    <p class="text-muted-foreground">
      View and analyze distributed traces from your applications
    </p>
  </div>

  <!-- Stats cards -->
  {#if stats}
    <div class="grid gap-4 md:grid-cols-4 mb-6">
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center gap-3">
            <GitBranch class="w-5 h-5 text-muted-foreground" />
            <div>
              <p class="text-sm text-muted-foreground">Total Traces</p>
              <p class="text-2xl font-bold">{stats.total_traces.toLocaleString('en-US')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center gap-3">
            <Layers class="w-5 h-5 text-muted-foreground" />
            <div>
              <p class="text-sm text-muted-foreground">Total Spans</p>
              <p class="text-2xl font-bold">{stats.total_spans.toLocaleString('en-US')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center gap-3">
            <Timer class="w-5 h-5 text-muted-foreground" />
            <div>
              <p class="text-sm text-muted-foreground">Avg Duration</p>
              <p class="text-2xl font-bold">{formatDuration(stats.avg_duration_ms)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center gap-3">
            <AlertCircle class="w-5 h-5 text-red-500" />
            <div>
              <p class="text-sm text-muted-foreground">Error Rate</p>
              <p class="text-2xl font-bold">{(stats.error_rate * 100).toFixed(1)}%</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Filter bar (Search-style pill layout) -->
  <div class="mb-6 rounded-lg border bg-card p-2 sm:p-3 space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline" size="sm" class="gap-2">
              <Clock class="w-4 h-4" />
              <span>{timeRangeLabel}</span>
              <ChevronDown class="w-4 h-4 opacity-50" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-[320px] max-w-[90vw] p-4" align="start">
          <TimeRangePicker
            bind:this={timeRangePicker}
            initialType={timeRangeType}
            initialCustomFrom={customFromTime}
            initialCustomTo={customToTime}
            onchange={handleTimeRangeChange}
          />
        </Popover.Content>
      </Popover.Root>

      <div class="flex items-center gap-2 ml-auto">
        {#if activeView === 'list'}
          <Label for="traces-live-tail" class="m-0 flex items-center gap-1.5 text-sm font-normal cursor-pointer">
            <Radio
              class="w-3.5 h-3.5 {liveTail ? 'text-green-500 animate-pulse' : 'text-muted-foreground'}"
            />
            Live tail
          </Label>
          <Switch id="traces-live-tail" bind:checked={liveTail} />
          {#if liveTail}
            <Select.Root
              type="single"
              value={String(liveTailLimit)}
              onValueChange={(v) => {
                if (v) {
                  liveTailLimit = parseInt(v, 10);
                  localStorage.setItem('logtide_traces_livetail_limit', String(liveTailLimit));
                  if (traces.length > liveTailLimit) {
                    traces = traces.slice(0, liveTailLimit);
                  }
                }
              }}
            >
              <Select.Trigger class="w-[95px] h-9">
                {liveTailLimit}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="50">50</Select.Item>
                <Select.Item value="100">100</Select.Item>
                <Select.Item value="200">200</Select.Item>
                <Select.Item value="500">500</Select.Item>
                <Select.Item value="1000">1000</Select.Item>
              </Select.Content>
            </Select.Root>
          {/if}
        {/if}

        <div class="inline-flex items-center rounded-md border bg-background p-0.5">
          <Button
            variant={activeView === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            onclick={() => switchView('list')}
            class="h-7 gap-1.5 text-xs"
          >
            <List class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">List</span>
          </Button>
          <Button
            variant={activeView === 'map' ? 'secondary' : 'ghost'}
            size="sm"
            onclick={() => switchView('map')}
            class="h-7 gap-1.5 text-xs"
          >
            <Network class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">Map</span>
          </Button>
        </div>

        {#if activeView === 'list'}
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
                  <Download class="w-4 h-4" />
                  <span class="hidden sm:inline">Export</span>
                </Button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Content class="w-[180px] max-w-[90vw] p-1.5" align="end">
              <div class="space-y-0.5">
                <button
                  type="button"
                  class="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent"
                  onclick={exportTracesJson}
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  class="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent"
                  onclick={exportTracesCsv}
                >
                  Export CSV
                </button>
              </div>
            </Popover.Content>
          </Popover.Root>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5 pt-2 border-t border-dashed">
      <!-- Project pill -->
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant={selectedProject ? 'secondary' : 'outline'}
              size="sm"
              class="h-7 gap-1.5 text-xs font-normal"
            >
              <span>{projectPillLabel}</span>
              <ChevronDown class="w-3 h-3 opacity-60" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-[280px] max-w-[90vw] p-0" align="start">
          <div class="max-h-[260px] overflow-y-auto p-1.5">
            {#if projects.length === 0}
              <div class="text-center py-4 text-sm text-muted-foreground">No projects available</div>
            {:else}
              <div class="space-y-1">
                {#each projects as project}
                  <label class="flex items-center gap-2 cursor-pointer hover:bg-accent px-2 py-1 rounded-sm">
                    <input
                      type="radio"
                      name="trace-project"
                      value={project.id}
                      checked={selectedProject === project.id}
                      onchange={() => { selectedProject = project.id; currentProjectStore.set(selectedProject); applyFilters(); }}
                      class="h-4 w-4"
                    />
                    <span class="text-sm flex-1">{project.name}</span>
                  </label>
                {/each}
              </div>
            {/if}
          </div>
        </Popover.Content>
      </Popover.Root>

      <!-- Services pill -->
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant={servicesPillActive ? 'secondary' : 'outline'}
              size="sm"
              class="h-7 gap-1.5 text-xs font-normal"
            >
              <span>{servicesPillLabel}</span>
              <ChevronDown class="w-3 h-3 opacity-60" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-[280px] max-w-[90vw] p-0" align="start">
          <div class="p-1.5 border-b">
            <div class="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                class="flex-1 h-7 text-xs"
                onclick={() => { selectedServices = [...availableServices]; applyFilters(); }}
              >
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="flex-1 h-7 text-xs"
                onclick={() => { selectedServices = []; applyFilters(); }}
              >
                Clear
              </Button>
            </div>
          </div>
          <div class="max-h-[260px] overflow-y-auto p-1.5">
            {#if availableServices.length === 0}
              <div class="text-center py-4 text-sm text-muted-foreground">No services available</div>
            {:else}
              <div class="space-y-1">
                {#each availableServices as service}
                  <label class="flex items-center gap-2 cursor-pointer hover:bg-accent px-2 py-1 rounded-sm">
                    <input
                      type="checkbox"
                      value={service}
                      checked={selectedServices.includes(service)}
                      onchange={(e) => {
                        if ((e.currentTarget as HTMLInputElement).checked) {
                          selectedServices = [...selectedServices, service];
                        } else {
                          selectedServices = selectedServices.filter((s) => s !== service);
                        }
                        applyFilters();
                      }}
                      class="h-4 w-4 rounded border-gray-300"
                    />
                    <span class="text-sm flex-1">{service}</span>
                  </label>
                {/each}
              </div>
            {/if}
          </div>
        </Popover.Content>
      </Popover.Root>

      <!-- Status pill (tri-state) -->
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant={statusPillActive ? 'secondary' : 'outline'}
              size="sm"
              class="h-7 gap-1.5 text-xs font-normal"
            >
              <span>{statusPillLabel}</span>
              <ChevronDown class="w-3 h-3 opacity-60" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-[200px] max-w-[90vw] p-1.5" align="start">
          <div class="space-y-1">
            {#each [['all', 'All statuses'], ['errors', 'Errors only'], ['ok', 'Success only']] as [value, label]}
              <label class="flex items-center gap-2 cursor-pointer hover:bg-accent px-2 py-1 rounded-sm">
                <input
                  type="radio"
                  name="trace-status"
                  value={value}
                  checked={statusFilter === value}
                  onchange={() => { statusFilter = value as typeof statusFilter; applyFilters(); }}
                  class="h-4 w-4"
                />
                <span class="text-sm flex-1">{label}</span>
              </label>
            {/each}
          </div>
        </Popover.Content>
      </Popover.Root>

      <!-- Duration pill -->
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant={durationPillActive ? 'secondary' : 'outline'}
              size="sm"
              class="h-7 gap-1.5 text-xs font-normal"
            >
              <span>{durationPillLabel}</span>
              <ChevronDown class="w-3 h-3 opacity-60" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-[280px] max-w-[90vw] p-3 space-y-2" align="start">
          <Label class="text-xs uppercase text-muted-foreground">Duration range (ms)</Label>
          <div class="flex items-center gap-2">
            <Input
              type="number"
              placeholder="Min"
              value={minDurationMs ?? ''}
              oninput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                minDurationMs = v === '' ? null : Number(v);
              }}
              class="h-8 text-sm"
            />
            <span class="text-muted-foreground text-xs">–</span>
            <Input
              type="number"
              placeholder="Max"
              value={maxDurationMs ?? ''}
              oninput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                maxDurationMs = v === '' ? null : Number(v);
              }}
              class="h-8 text-sm"
            />
          </div>
          <div class="flex gap-2">
            <Button size="sm" class="h-7 text-xs" onclick={() => applyFilters()}>Apply</Button>
            <Button size="sm" variant="ghost" class="h-7 text-xs text-muted-foreground" onclick={() => { minDurationMs = null; maxDurationMs = null; applyFilters(); }}>Clear</Button>
          </div>
        </Popover.Content>
      </Popover.Root>

      <!-- Trace ID pill -->
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant={tracePillActive ? 'secondary' : 'outline'}
              size="sm"
              class="h-7 gap-1.5 text-xs font-normal"
            >
              <span>{tracePillLabel}</span>
              <ChevronDown class="w-3 h-3 opacity-60" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-[320px] max-w-[90vw] p-3 space-y-2" align="start">
          <Label for="trace-id-input" class="text-xs uppercase text-muted-foreground">Trace ID</Label>
          <Input
            id="trace-id-input"
            type="text"
            placeholder="Paste a trace ID to jump to it..."
            bind:value={traceIdInput}
            onkeydown={(e) => { if ((e as KeyboardEvent).key === 'Enter') jumpToTraceId(); }}
            class="h-8 text-sm font-mono"
          />
          <div class="flex gap-2">
            <Button size="sm" class="h-7 text-xs" onclick={jumpToTraceId} disabled={!traceIdInput.trim() || !selectedProject}>Open trace</Button>
            {#if traceIdInput.trim().length > 0}
              <Button size="sm" variant="ghost" class="h-7 text-xs text-muted-foreground" onclick={() => { traceIdInput = ""; }}>Clear</Button>
            {/if}
          </div>
        </Popover.Content>
      </Popover.Root>

      {#if activeFilterCount > 0}
        <button
          type="button"
          class="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          onclick={clearAllFilters}
        >
          Clear all
        </button>
      {/if}
    </div>
  </div>

  <!-- LIST VIEW -->
  {#if activeView === 'list'}
    <!-- Traces table -->
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <CardTitle>
            {#if totalTraces > 0}
              {totalTraces.toLocaleString('en-US')}
              {totalTraces === 1 ? "trace" : "traces"}
            {:else}
              No traces
            {/if}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {#if !hasLoadedOnce || (isLoading && traces.length === 0)}
          <SkeletonTable rows={7} columns={7} />
        {:else if traces.length === 0}
          {#if activeFilterCount > 0}
            <div class="text-center py-16 text-muted-foreground space-y-2">
              <p class="text-sm">No traces match the current filters.</p>
              <button
                type="button"
                class="text-xs underline underline-offset-2 hover:text-foreground"
                onclick={clearAllFilters}
              >
                Clear filters
              </button>
            </div>
          {:else}
            <EmptyTraces />
          {/if}
        {:else}
          <TableLoadingOverlay loading={isLoading}>
          <div class="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead class="w-[180px]">Time</TableHead>
                  <TableHead class="w-[150px]">Service</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead class="w-[100px]">Duration</TableHead>
                  <TableHead class="w-[80px]">Spans</TableHead>
                  <TableHead class="w-[80px]">Status</TableHead>
                  <TableHead class="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#each traces as trace, i}
                  {@const expanded = expandedTraceIds.has(trace.trace_id)}
                  {@const spans = traceSpansCache.get(trace.trace_id)}
                  {@const loadingSpans = loadingSpansFor.has(trace.trace_id)}
                  <TableRow
                    class="cursor-pointer hover:bg-muted/50 {selectedTraceIndex === i ? 'bg-muted/50' : ''}"
                    data-trace-index={i}
                    onclick={() => toggleTraceRow(trace.trace_id)}
                  >
                    <TableCell class="font-mono text-xs">
                      {formatDateTime(trace.start_time)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {trace.root_service_name || trace.service_name}
                      </Badge>
                    </TableCell>
                    <TableCell class="max-w-md truncate">
                      {trace.root_operation_name || "-"}
                    </TableCell>
                    <TableCell class="font-mono text-sm">
                      {formatDuration(trace.duration_ms)}
                    </TableCell>
                    <TableCell class="text-center">
                      {trace.span_count}
                    </TableCell>
                    <TableCell>
                      {#if trace.error}
                        <Badge variant="destructive">Error</Badge>
                      {:else}
                        <Badge variant="secondary">OK</Badge>
                      {/if}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={(e) => {
                          e.stopPropagation();
                          viewTrace(trace.trace_id);
                        }}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                  {#if expanded}
                    <TableRow class="bg-muted/20">
                      <TableCell colspan={7} class="p-0">
                        <div class="p-4 space-y-2">
                          <div class="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                            <span>trace_id:</span>
                            <span class="text-foreground">{trace.trace_id}</span>
                          </div>
                          {#if loadingSpans}
                            <div class="flex items-center gap-2 text-sm text-muted-foreground py-2">
                              <Spinner class="w-4 h-4" />
                              Loading spans...
                            </div>
                          {:else if spans && spans.length > 0}
                            <div class="border rounded-md overflow-hidden bg-background">
                              <div class="max-h-[300px] overflow-y-auto">
                                <table class="w-full text-xs">
                                  <thead class="text-muted-foreground bg-muted/40 sticky top-0">
                                    <tr>
                                      <th class="px-3 py-2 text-left font-medium w-[150px]">Service</th>
                                      <th class="px-3 py-2 text-left font-medium">Operation</th>
                                      <th class="px-3 py-2 text-left font-medium w-[80px]">Kind</th>
                                      <th class="px-3 py-2 text-right font-medium w-[90px]">Duration</th>
                                      <th class="px-3 py-2 text-center font-medium w-[80px]">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {#each spans as span}
                                      <tr class="border-t hover:bg-muted/30">
                                        <td class="px-3 py-1.5 font-mono">{span.service_name}</td>
                                        <td class="px-3 py-1.5 truncate max-w-md">{span.operation_name}</td>
                                        <td class="px-3 py-1.5 text-muted-foreground">{span.kind ?? '—'}</td>
                                        <td class="px-3 py-1.5 text-right font-mono">{formatDuration(span.duration_ms)}</td>
                                        <td class="px-3 py-1.5 text-center">
                                          {#if span.status_code === 'ERROR'}
                                            <Badge variant="destructive" class="text-[10px] px-1.5 py-0">Error</Badge>
                                          {:else if span.status_code === 'OK'}
                                            <Badge variant="secondary" class="text-[10px] px-1.5 py-0">OK</Badge>
                                          {:else}
                                            <span class="text-muted-foreground">—</span>
                                          {/if}
                                        </td>
                                      </tr>
                                    {/each}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          {:else if spans}
                            <div class="text-sm text-muted-foreground py-2">No spans for this trace.</div>
                          {/if}
                        </div>
                      </TableCell>
                    </TableRow>
                  {/if}
                {/each}
              </TableBody>
            </Table>
          </div>

          {#if traces.length > 0}
            <div class="flex items-center justify-between mt-6 px-2">
              <div class="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * pageSize + 1).toLocaleString('en-US')} to {Math.min(
                  currentPage * pageSize,
                  totalTraces,
                ).toLocaleString('en-US')} of {totalTraces.toLocaleString('en-US')} traces
              </div>
              <div class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onclick={previousPage}
                  disabled={currentPage === 1 || isLoading}
                >
                  <ChevronLeft class="w-4 h-4" />
                  Previous
                </Button>
                <div class="flex items-center gap-1">
                  {#if totalPages <= 7}
                    {#each Array.from({ length: totalPages }, (_, i) => i + 1) as pg}
                      <Button
                        variant={currentPage === pg ? "default" : "outline"}
                        size="sm"
                        onclick={() => goToPage(pg)}
                        disabled={isLoading}
                        class="w-10"
                      >
                        {pg}
                      </Button>
                    {/each}
                  {:else if currentPage <= 3}
                    {#each [1, 2, 3, 4] as pg}
                      <Button
                        variant={currentPage === pg ? "default" : "outline"}
                        size="sm"
                        onclick={() => goToPage(pg)}
                        disabled={isLoading}
                        class="w-10"
                      >
                        {pg}
                      </Button>
                    {/each}
                    <span class="px-2">...</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => goToPage(totalPages)}
                      disabled={isLoading}
                      class="w-10"
                    >
                      {totalPages}
                    </Button>
                  {:else if currentPage >= totalPages - 2}
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => goToPage(1)}
                      disabled={isLoading}
                      class="w-10"
                    >
                      1
                    </Button>
                    <span class="px-2">...</span>
                    {#each [totalPages - 3, totalPages - 2, totalPages - 1, totalPages] as pg}
                      <Button
                        variant={currentPage === pg ? "default" : "outline"}
                        size="sm"
                        onclick={() => goToPage(pg)}
                        disabled={isLoading}
                        class="w-10"
                      >
                        {pg}
                      </Button>
                    {/each}
                  {:else}
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => goToPage(1)}
                      disabled={isLoading}
                      class="w-10"
                    >
                      1
                    </Button>
                    <span class="px-2">...</span>
                    {#each [currentPage - 1, currentPage, currentPage + 1] as pg}
                      <Button
                        variant={currentPage === pg ? "default" : "outline"}
                        size="sm"
                        onclick={() => goToPage(pg)}
                        disabled={isLoading}
                        class="w-10"
                      >
                        {pg}
                      </Button>
                    {/each}
                    <span class="px-2">...</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => goToPage(totalPages)}
                      disabled={isLoading}
                      class="w-10"
                    >
                      {totalPages}
                    </Button>
                  {/if}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={nextPage}
                  disabled={currentPage >= totalPages || isLoading}
                >
                  Next
                  <ChevronRight class="w-4 h-4" />
                </Button>
              </div>
            </div>
          {/if}
          </TableLoadingOverlay>
        {/if}
      </CardContent>
    </Card>

  <!-- MAP VIEW -->
  {:else}
    <!-- Legend + Export -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-4 text-sm text-muted-foreground">
        <div class="flex items-center gap-1.5">
          <span class="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
          <span>Healthy (&lt;1%)</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-3 h-3 rounded-full bg-amber-500 inline-block"></span>
          <span>Degraded (1-10%)</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-3 h-3 rounded-full bg-red-500 inline-block"></span>
          <span>Unhealthy (&gt;10%)</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="border-t-2 border-dashed border-muted-foreground w-6 inline-block"></span>
          <span>Log correlation</span>
        </div>
      </div>
      <Button variant="outline" size="sm" onclick={exportMapPng}>
        <Download class="w-4 h-4 mr-2" />
        Export PNG
      </Button>
    </div>

    <!-- Graph + side panel -->
    <div class="flex gap-4">
      <!-- Graph -->
      <div class="flex-1 min-w-0">
        <Card>
          <CardContent class="pt-6">
            {#if isLoadingMap}
              <div class="flex items-center justify-center h-[500px]">
                <Spinner size="lg" />
              </div>
            {:else if mapLoadError}
              <div class="flex items-center justify-center h-[500px] text-destructive">
                <p>{mapLoadError}</p>
              </div>
            {:else if mapData && mapData.nodes.length > 0}
              <ServiceMap
                dependencies={mapData}
                height="600px"
                onNodeClick={handleNodeClick}
              />
            {:else if mapData}
              <div class="flex items-center justify-center h-[500px] text-muted-foreground">
                <div class="text-center">
                  <Network class="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p class="font-medium">No service dependencies found</p>
                  <p class="text-sm mt-1">
                    Send traces with parent-child spans or logs with trace_id to see service relationships
                  </p>
                </div>
              </div>
            {:else}
              <div class="flex items-center justify-center h-[500px] text-muted-foreground">
                <p>Select a project to view the service map</p>
              </div>
            {/if}
          </CardContent>
        </Card>
      </div>

      <!-- Side panel -->
      {#if selectedNode}
        {@const health = getHealthLabel(selectedNode.errorRate)}
        <div class="w-80 flex-shrink-0">
          <Card>
            <CardHeader class="flex flex-row items-start justify-between pb-3">
              <div>
                <CardTitle class="text-base">{selectedNode.name}</CardTitle>
                <Badge variant={health.variant} class="mt-1.5">
                  {health.label}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                onclick={closeSidePanel}
              >
                <X class="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent class="space-y-4">
              <!-- Stats grid -->
              <div class="grid grid-cols-2 gap-3">
                <div class="p-3 rounded-lg bg-muted/50">
                  <p class="text-xs text-muted-foreground">Error Rate</p>
                  <p
                    class="text-lg font-bold {selectedNode.errorRate >= 0.1
                      ? 'text-red-500'
                      : selectedNode.errorRate >= 0.01
                        ? 'text-amber-500'
                        : 'text-emerald-500'}"
                  >
                    {(selectedNode.errorRate * 100).toFixed(1)}%
                  </p>
                </div>
                <div class="p-3 rounded-lg bg-muted/50">
                  <p class="text-xs text-muted-foreground">Avg Latency</p>
                  <p class="text-lg font-bold">
                    {formatLatency(selectedNode.avgLatencyMs)}
                  </p>
                </div>
                <div class="p-3 rounded-lg bg-muted/50">
                  <p class="text-xs text-muted-foreground">P95 Latency</p>
                  <p class="text-lg font-bold">
                    {selectedNode.p95LatencyMs != null
                      ? formatLatency(selectedNode.p95LatencyMs)
                      : "N/A"}
                  </p>
                </div>
                <div class="p-3 rounded-lg bg-muted/50">
                  <p class="text-xs text-muted-foreground">Total Calls</p>
                  <p class="text-lg font-bold">
                    {selectedNode.totalCalls.toLocaleString('en-US')}
                  </p>
                </div>
              </div>

              <!-- Downstream services -->
              {#if downstreamEdges.length > 0}
                <div>
                  <p class="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1">
                    <ArrowRight class="w-3 h-3" />
                    Calls to
                  </p>
                  <div class="space-y-1.5">
                    {#each downstreamEdges as edge}
                      <div class="flex items-center justify-between text-sm">
                        <span class="font-medium truncate">{edge.target}</span>
                        <div class="flex items-center gap-2 flex-shrink-0">
                          <span class="text-muted-foreground tabular-nums">
                            {edge.callCount}
                          </span>
                          {#if edge.type === "log_correlation"}
                            <Badge variant="outline" class="text-[10px] px-1 py-0">log</Badge>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              <!-- Upstream services -->
              {#if upstreamEdges.length > 0}
                <div>
                  <p class="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1">
                    <ArrowLeft class="w-3 h-3" />
                    Called by
                  </p>
                  <div class="space-y-1.5">
                    {#each upstreamEdges as edge}
                      <div class="flex items-center justify-between text-sm">
                        <span class="font-medium truncate">{edge.source}</span>
                        <div class="flex items-center gap-2 flex-shrink-0">
                          <span class="text-muted-foreground tabular-nums">
                            {edge.callCount}
                          </span>
                          {#if edge.type === "log_correlation"}
                            <Badge variant="outline" class="text-[10px] px-1 py-0">log</Badge>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              <Button class="w-full" onclick={() => viewTracesForService(selectedNode!.name)}>
                View Traces
              </Button>
            </CardContent>
          </Card>
        </div>
      {/if}
    </div>
  {/if}
</div>