<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import * as echarts from "echarts";
  import {
    chartColors,
    getAxisStyle,
    getTooltipStyle,
    getLegendStyle,
  } from "$lib/utils/echarts-theme";
  import { themeStore } from "$lib/stores/theme";
  import { currentProjectStore } from "$lib/stores/current-project";
  import { metricsStore } from "$lib/stores/metrics";
  import { metricsAPI } from "$lib/api/metrics";
  import type { MetricAggregateResult } from "$lib/api/metrics";
  import { currentOrganization } from "$lib/stores/organization";
  import { ProjectsAPI } from "$lib/api/projects";
  import type { Project } from "@logtide/shared";
  import { authStore } from "$lib/stores/auth";
  import { layoutStore } from "$lib/stores/layout";

  import ServiceSelector from "$lib/components/metrics/ServiceSelector.svelte";
  import OverviewPanel from "$lib/components/metrics/OverviewPanel.svelte";
  import GoldenSignalsPanel from "$lib/components/metrics/GoldenSignalsPanel.svelte";

  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "$lib/components/ui/table";
  import { Badge } from "$lib/components/ui/badge";
  import Button from "$lib/components/ui/button/button.svelte";

  import BarChart3 from "@lucide/svelte/icons/bar-chart-3";
  import Activity from "@lucide/svelte/icons/activity";
  import Filter from "@lucide/svelte/icons/filter";
  import X from "@lucide/svelte/icons/x";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
  import Search from "@lucide/svelte/icons/search";
  import Gauge from "@lucide/svelte/icons/gauge";

  // Layout state
  let maxWidthClass = $state("max-w-7xl");
  let containerPadding = $state("px-8 py-8");

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

  // Local project and time range state
  let token = $state<string | null>(null);
  const unsubAuthStore = authStore.subscribe((state) => { token = state.token; });
  let projectsAPI = $derived(new ProjectsAPI(() => token));

  onDestroy(() => {
    unsubAuthStore();
  });

  let projects = $state<Project[]>([]);
  let selectedProject = $state<string | null>(null);
  let timeRangeType = $state<'last_hour' | 'last_6h' | 'last_24h' | 'last_7d'>('last_24h');

  async function loadProjects() {
    if (!$currentOrganization) return;
    try {
      const [res, availability] = await Promise.all([
        projectsAPI.getProjects($currentOrganization.id),
        projectsAPI.getProjectDataAvailability($currentOrganization.id).catch(() => null),
      ]);
      const metricsProjectIds = availability?.metrics;
      projects = metricsProjectIds && metricsProjectIds.length > 0
        ? res.projects.filter((p) => metricsProjectIds.includes(p.id))
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
    const now = new Date();
    switch (timeRangeType) {
      case 'last_hour':
        return { from: new Date(now.getTime() - 60 * 60 * 1000), to: now };
      case 'last_6h':
        return { from: new Date(now.getTime() - 6 * 60 * 60 * 1000), to: now };
      case 'last_24h':
        return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
      case 'last_7d':
        return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
      default:
        return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
    }
  }

  // Metrics store state
  let storeState = $state({
    metricNames: [] as { name: string; type: string }[],
    metricNamesLoading: false,
    metricNamesError: null as string | null,
    selectedMetric: null as string | null,
    selectedInterval: "1h",
    selectedAggregation: "avg" as string,
    selectedGroupBy: [] as string[],
    activeLabels: {} as Record<string, string>,
    timeseries: null as MetricAggregateResult | null,
    timeseriesLoading: false,
    timeseriesError: null as string | null,
    labelKeys: [] as string[],
    labelValues: {} as Record<string, string[]>,
    dataPoints: null as {
      metrics: {
        id: string;
        time: string;
        metricName: string;
        metricType: string;
        value: number;
        serviceName: string;
        attributes: Record<string, unknown> | null;
        resourceAttributes: Record<string, unknown> | null;
        histogramData: Record<string, unknown> | null;
        hasExemplars: boolean;
        exemplars?: Array<{
          exemplarValue: number;
          exemplarTime?: string;
          traceId?: string;
          spanId?: string;
          attributes?: Record<string, unknown>;
        }>;
      }[];
      total: number;
      hasMore: boolean;
      limit: number;
      offset: number;
    } | null,
    dataPointsLoading: false,
    activeTab: 'overview' as 'overview' | 'explorer' | 'golden',
    overview: null as import("$lib/api/metrics").MetricsOverviewResult | null,
    overviewLoading: false,
    overviewError: null as string | null,
    selectedService: null as string | null,
  });

  $effect(() => {
    const unsubscribe = metricsStore.subscribe((s) => {
      storeState = s;
    });
    return unsubscribe;
  });

  // Overview sparkline data
  let sparklineMap = $state<Map<string, MetricAggregateResult>>(new Map());
  let sparklineLoading = $state<Set<string>>(new Set());

  // Label filter UI
  let selectedLabelKey = $state<string | null>(null);
  let selectedLabelValue = $state<string | null>(null);

  // ECharts
  let chartContainer = $state<HTMLDivElement | undefined>(undefined);
  let chart: echarts.ECharts | null = null;

  // Org tracking
  let lastLoadedOrg = $state<string | null>(null);

  onMount(() => {
    loadProjects();

    return () => {
      chart?.dispose();
      metricsStore.reset();
    };
  });

  // Init/dispose chart when chartContainer mounts/unmounts
  let resizeObserver: ResizeObserver | null = null;
  let unsubTheme: (() => void) | null = null;

  $effect(() => {
    if (chartContainer && !chart) {
      chart = echarts.init(chartContainer);

      chart.on('click', (params: any) => {
        if (!selectedProject || !storeState.selectedMetric) return;
        const ts = storeState.timeseries?.timeseries?.[params.dataIndex];
        if (!ts) return;
        const bucketDate = typeof ts.bucket === 'string' ? new Date(ts.bucket) : ts.bucket;
        const halfInterval = getIntervalMs(storeState.selectedInterval) / 2;
        const from = new Date(bucketDate.getTime() - halfInterval).toISOString();
        const to = new Date(bucketDate.getTime() + halfInterval).toISOString();
        goto(`/dashboard/traces?from=${from}&to=${to}&projectId=${selectedProject}`);
      });

      resizeObserver = new ResizeObserver(() => chart?.resize());
      resizeObserver.observe(chartContainer);

      unsubTheme = themeStore.subscribe(() => {
        if (chart && storeState.timeseries) {
          chart.setOption(getChartOption(storeState.timeseries), true);
        }
      });

      // If timeseries data already loaded, render it
      if (storeState.timeseries) {
        chart.setOption(getChartOption(storeState.timeseries), true);
      }
    } else if (!chartContainer && chart) {
      resizeObserver?.disconnect();
      unsubTheme?.();
      chart.dispose();
      chart = null;
    }
  });

  // React to org change
  $effect(() => {
    if (!$currentOrganization) {
      lastLoadedOrg = null;
      return;
    }

    if ($currentOrganization.id === lastLoadedOrg) return;
    lastLoadedOrg = $currentOrganization.id;
    selectedProject = null;
    loadProjects();
  });

  // React to project or time range changes
  let lastContextKey = $state<string | null>(null);
  $effect(() => {
    const _proj = selectedProject;
    const _tr = timeRangeType;

    if (!$currentOrganization || !selectedProject) {
      return;
    }

    const key = `${$currentOrganization.id}-${selectedProject}-${timeRangeType}`;
    if (key === lastContextKey) return;
    lastContextKey = key;

    loadMetricNames();

    // Load overview data when context changes
    if (storeState.activeTab === 'overview') {
      loadOverviewData();
    }
  });

  // React to tab changes - load overview data if switching to overview
  let lastOverviewKey = $state<string | null>(null);
  $effect(() => {
    const tab = storeState.activeTab;
    if (tab === 'overview' && selectedProject && $currentOrganization) {
      const key = `${$currentOrganization.id}-${selectedProject}-${timeRangeType}`;
      if (key !== lastOverviewKey) {
        lastOverviewKey = key;
        loadOverviewData();
      }
    }
  });

  // React to timeseries data changes -> update chart
  $effect(() => {
    if (chart && storeState.timeseries) {
      chart.setOption(getChartOption(storeState.timeseries), true);
    } else if (chart && !storeState.timeseries) {
      chart.clear();
    }
  });

  function loadMetricNames() {
    if (!selectedProject) return;
    const { from, to } = getTimeRange();
    metricsStore.loadMetricNames(
      selectedProject,
      from.toISOString(),
      to.toISOString()
    );
  }

  async function loadOverviewData() {
    if (!selectedProject) return;
    const { from, to } = getTimeRange();
    const fromISO = from.toISOString();
    const toISO = to.toISOString();

    await metricsStore.loadOverview(
      selectedProject,
      fromISO,
      toISO,
      storeState.selectedService ?? undefined
    );

    // After overview loads, load sparkline timeseries for each metric
    if (storeState.overview?.services) {
      for (const service of storeState.overview.services) {
        for (const metric of service.metrics) {
          const sparklineKey = `${metric.metricName}:${metric.serviceName}`;
          if (sparklineMap.has(sparklineKey)) continue;

          sparklineLoading = new Set([...sparklineLoading, sparklineKey]);

          metricsAPI.aggregateMetrics({
            projectId: selectedProject!,
            metricName: metric.metricName,
            from: fromISO,
            to: toISO,
            interval: '15m',
            aggregation: 'avg',
          }).then((result) => {
            sparklineMap = new Map(sparklineMap).set(sparklineKey, result);
            const next = new Set(sparklineLoading);
            next.delete(sparklineKey);
            sparklineLoading = next;
          }).catch(() => {
            const next = new Set(sparklineLoading);
            next.delete(sparklineKey);
            sparklineLoading = next;
          });
        }
      }
    }
  }

  function handleMetricSelect(metricName: string) {
    metricsStore.selectMetric(metricName);
    // Reset local label filter selectors to match the cleared store state
    selectedLabelKey = null;
    selectedLabelValue = null;
    if (!selectedProject) return;

    const { from, to } = getTimeRange();
    const fromISO = from.toISOString();
    const toISO = to.toISOString();

    metricsStore.loadLabelKeys(selectedProject, metricName, fromISO, toISO);
    metricsStore.loadTimeseries(selectedProject, metricName, fromISO, toISO);
    metricsStore.loadDataPoints(
      selectedProject,
      metricName,
      fromISO,
      toISO,
      true
    );
  }

  function handleOverviewMetricClick(metricName: string) {
    metricsStore.setActiveTab('explorer');
    handleMetricSelect(metricName);
  }

  function handleIntervalChange(interval: string) {
    metricsStore.setInterval(interval);
    reloadTimeseries();
  }

  function handleAggregationChange(agg: string) {
    metricsStore.setAggregation(
      agg as "avg" | "sum" | "min" | "max" | "count" | "last"
    );
    reloadTimeseries();
  }

  function addLabelFilter() {
    if (!selectedLabelKey || !selectedLabelValue) return;
    metricsStore.setLabel(selectedLabelKey, selectedLabelValue);
    selectedLabelKey = null;
    selectedLabelValue = null;
    reloadTimeseries();
    reloadDataPoints();
  }

  function removeLabelFilter(key: string) {
    metricsStore.removeLabel(key);
    reloadTimeseries();
    reloadDataPoints();
  }

  function handleLabelKeyChange(key: string) {
    selectedLabelKey = key;
    selectedLabelValue = null;
    if (selectedProject && storeState.selectedMetric) {
      const { from, to } = getTimeRange();
      metricsStore.loadLabelValues(
        selectedProject,
        storeState.selectedMetric,
        key,
        from.toISOString(),
        to.toISOString()
      );
    }
  }

  function reloadTimeseries() {
    if (!selectedProject || !storeState.selectedMetric) return;
    const { from, to } = getTimeRange();
    metricsStore.loadTimeseries(
      selectedProject,
      storeState.selectedMetric,
      from.toISOString(),
      to.toISOString()
    );
  }

  function reloadDataPoints() {
    if (!selectedProject || !storeState.selectedMetric) return;
    const { from, to } = getTimeRange();
    metricsStore.loadDataPoints(
      selectedProject,
      storeState.selectedMetric,
      from.toISOString(),
      to.toISOString(),
      true
    );
  }

  function handleServiceChange(service: string | null) {
    metricsStore.setSelectedService(service);
    // Clear sparkline cache and reload overview
    sparklineMap = new Map();
    sparklineLoading = new Set();
    lastOverviewKey = null;
  }

  function handleTimeRangeChange(range: string) {
    timeRangeType = range as typeof timeRangeType;
    // Clear sparkline cache so new data is fetched
    sparklineMap = new Map();
    sparklineLoading = new Set();
    lastOverviewKey = null;
  }

  function getChartOption(data: MetricAggregateResult): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const tooltipStyle = getTooltipStyle();
    const legendStyle = getLegendStyle();

    const seriesColors = [
      chartColors.series.blue,
      chartColors.series.green,
      chartColors.series.amber,
      chartColors.series.purple,
      chartColors.series.orange,
      chartColors.series.red,
    ];

    // Group timeseries by labels for groupBy support
    const groups = new Map<string, { bucket: string; value: number }[]>();

    for (const point of data.timeseries) {
      const key = point.labels
        ? Object.entries(point.labels)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
        : data.metricName;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ bucket: point.bucket, value: point.value });
    }

    // If no groups, use a single series
    if (groups.size === 0) {
      groups.set(data.metricName, []);
    }

    const allBuckets = [
      ...new Set(data.timeseries.map((p) => p.bucket)),
    ].sort();
    const seriesNames = [...groups.keys()];

    const series: echarts.SeriesOption[] = seriesNames.map((name, i) => {
      const points = groups.get(name)!;
      const bucketMap = new Map(points.map((p) => [p.bucket, p.value]));

      return {
        name,
        type: "line",
        smooth: true,
        cursor: 'pointer',
        data: allBuckets.map((b) => bucketMap.get(b) ?? null),
        lineStyle: { color: seriesColors[i % seriesColors.length] },
        itemStyle: { color: seriesColors[i % seriesColors.length] },
        areaStyle: seriesNames.length === 1
          ? { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: seriesColors[i % seriesColors.length] + "40" },
              { offset: 1, color: seriesColors[i % seriesColors.length] + "05" },
            ]) }
          : undefined,
      };
    });

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        ...tooltipStyle,
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const lines = params.map((p: any) => {
            const val = typeof p.value === 'number' ? p.value.toFixed(2) : p.value;
            return `<div style="display:flex;align-items:center;gap:6px">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color}"></span>
              <span>${p.seriesName}:</span>
              <strong>${val}</strong>
            </div>`;
          });
          return `<div style="font-size:12px">
            <div style="font-weight:600;margin-bottom:4px">${params[0].name}</div>
            ${lines.join('')}
            <div style="color:#888;font-size:11px;margin-top:6px;border-top:1px solid rgba(128,128,128,0.2);padding-top:4px">Click to view related traces</div>
          </div>`;
        },
      },
      legend: {
        data: seriesNames,
        bottom: 0,
        ...legendStyle,
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "10%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: allBuckets.map((b) => formatBucketLabel(b)),
        ...axisStyle,
      },
      yAxis: {
        type: "value",
        ...axisStyle,
        axisLabel: {
          ...axisStyle.axisLabel,
          formatter: (value: number) => {
            if (Number.isInteger(value)) return value.toString();
            return value.toFixed(2);
          }
        },
      },
      series,
    };
  }

  function formatBucketLabel(bucket: string): string {
    const d = new Date(bucket);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
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

  function truncateJson(obj: Record<string, unknown> | null, maxLen = 60): string {
    if (!obj) return "-";
    const str = JSON.stringify(obj);
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + "...";
  }

  function getIntervalMs(interval: string): number {
    const map: Record<string, number> = {
      '1m': 60_000, '5m': 300_000, '15m': 900_000,
      '1h': 3_600_000, '6h': 21_600_000, '1d': 86_400_000,
    };
    return map[interval] || 3_600_000;
  }

  function goToTrace(traceId: string) {
    if (selectedProject) {
      goto(`/dashboard/traces/${traceId}?projectId=${selectedProject}`);
    }
  }

  const intervals = [
    { value: "1m", label: "1 min" },
    { value: "5m", label: "5 min" },
    { value: "15m", label: "15 min" },
    { value: "1h", label: "1 hour" },
    { value: "6h", label: "6 hours" },
    { value: "1d", label: "1 day" },
  ];

  const aggregations = [
    { value: "avg", label: "Average" },
    { value: "sum", label: "Sum" },
    { value: "min", label: "Min" },
    { value: "max", label: "Max" },
    { value: "count", label: "Count" },
    { value: "last", label: "Last" },
  ];

  // Derived helpers for overview panel
  let overviewServices = $derived(storeState.overview?.services ?? []);
  let serviceNames = $derived(overviewServices.map(s => s.serviceName));
</script>

<svelte:head>
  <title>Metrics - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <!-- Header -->
  <div class="mb-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div class="flex items-center gap-3 mb-2">
          <BarChart3 class="w-8 h-8 text-primary" />
          <h1 class="text-3xl font-bold tracking-tight">Metrics</h1>
        </div>
        <p class="text-muted-foreground">
          Explore and visualize OTLP metrics from your applications
        </p>
      </div>
      <div class="flex items-center gap-3">
        <Select.Root
          type="single"
          value={selectedProject || ""}
          onValueChange={(v) => { selectedProject = v || null; currentProjectStore.set(selectedProject); }}
        >
          <Select.Trigger class="w-[180px]">
            {projects.find(p => p.id === selectedProject)?.name || "Select project"}
          </Select.Trigger>
          <Select.Content>
            {#each projects as project}
              <Select.Item value={project.id}>{project.name}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        <ServiceSelector
          services={serviceNames}
          selectedService={storeState.selectedService}
          timeRange={timeRangeType}
          onServiceChange={handleServiceChange}
          onTimeRangeChange={handleTimeRangeChange}
        />
      </div>
    </div>
  </div>

  <!-- Tab buttons -->
  <div class="flex items-center gap-1 mb-6 border-b">
    <button
      class="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {storeState.activeTab === 'overview' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}"
      onclick={() => metricsStore.setActiveTab('overview')}
    >
      <LayoutDashboard class="w-4 h-4" />
      Overview
    </button>
    <button
      class="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {storeState.activeTab === 'explorer' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}"
      onclick={() => metricsStore.setActiveTab('explorer')}
    >
      <Search class="w-4 h-4" />
      Explorer
    </button>
    <button
      class="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {storeState.activeTab === 'golden' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}"
      onclick={() => metricsStore.setActiveTab('golden')}
    >
      <Gauge class="w-4 h-4" />
      Golden Signals
    </button>
  </div>

  {#if storeState.activeTab === 'overview'}
    <!-- Overview Tab -->
    {#if storeState.overviewLoading}
      <div class="flex items-center justify-center py-16">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    {:else if storeState.overviewError}
      <div class="flex flex-col items-center justify-center py-16 text-destructive">
        <p class="text-lg font-medium mb-1">Failed to load metrics</p>
        <p class="text-sm">{storeState.overviewError}</p>
      </div>
    {:else if !selectedProject}
      <div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <BarChart3 class="w-12 h-12 mb-3 opacity-50" />
        <p class="text-lg font-medium mb-1">No project selected</p>
        <p class="text-sm">Select a project to view metrics</p>
      </div>
    {:else}
      <OverviewPanel
        services={overviewServices}
        selectedService={storeState.selectedService}
        timeseriesMap={sparklineMap}
        loadingMetrics={sparklineLoading}
        projectId={selectedProject}
        timeRange={getTimeRange()}
        onMetricClick={handleOverviewMetricClick}
      />
    {/if}
  {:else if storeState.activeTab === 'golden'}
    <!-- Golden Signals Tab -->
    {#if !selectedProject}
      <div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Gauge class="w-12 h-12 mb-3 opacity-50" />
        <p class="text-lg font-medium mb-1">No project selected</p>
        <p class="text-sm">Select a project to view golden signals</p>
      </div>
    {:else}
      <GoldenSignalsPanel
        metricNames={storeState.metricNames}
        services={overviewServices}
        projectId={selectedProject}
        timeRange={getTimeRange()}
        interval={storeState.selectedInterval}
      />
    {/if}
  {:else}
    <!-- Explorer Tab -->

    <!-- Filters -->
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>Filters</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid gap-4">
          <!-- Metric name selector (project and time range are set in the page header) -->
          <div class="space-y-2">
            <span class="text-sm font-medium">Metric</span>
            <Select.Root
              type="single"
              value={storeState.selectedMetric || ""}
              onValueChange={(v) => {
                if (v) handleMetricSelect(v);
              }}
            >
              <Select.Trigger class="w-full">
                {#if storeState.metricNamesLoading}
                  Loading...
                {:else}
                  {storeState.selectedMetric || "Select metric"}
                {/if}
              </Select.Trigger>
              <Select.Content>
                {#each storeState.metricNames as metric}
                  <Select.Item value={metric.name}>
                    <span class="flex items-center gap-2">
                      {metric.name}
                      <Badge variant="outline" class="text-xs"
                        >{metric.type}</Badge
                      >
                    </span>
                  </Select.Item>
                {/each}
                {#if storeState.metricNames.length === 0 && !storeState.metricNamesLoading}
                  <div class="px-3 py-2 text-sm text-muted-foreground">
                    No metrics found
                  </div>
                {/if}
              </Select.Content>
            </Select.Root>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Controls row -->
    {#if storeState.selectedMetric}
      <Card class="mb-6">
        <CardHeader>
          <div class="flex items-center gap-2">
            <Activity class="w-5 h-5 text-muted-foreground" />
            <CardTitle>Chart Controls</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <!-- Interval -->
            <div class="space-y-2">
              <span class="text-sm font-medium">Interval</span>
              <Select.Root
                type="single"
                value={storeState.selectedInterval}
                onValueChange={(v) => {
                  if (v) handleIntervalChange(v);
                }}
              >
                <Select.Trigger class="w-full">
                  {intervals.find((i) => i.value === storeState.selectedInterval)
                    ?.label || storeState.selectedInterval}
                </Select.Trigger>
                <Select.Content>
                  {#each intervals as interval}
                    <Select.Item value={interval.value}
                      >{interval.label}</Select.Item
                    >
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>

            <!-- Aggregation -->
            <div class="space-y-2">
              <span class="text-sm font-medium">Aggregation</span>
              <Select.Root
                type="single"
                value={storeState.selectedAggregation}
                onValueChange={(v) => {
                  if (v) handleAggregationChange(v);
                }}
              >
                <Select.Trigger class="w-full">
                  {aggregations.find(
                    (a) => a.value === storeState.selectedAggregation
                  )?.label || storeState.selectedAggregation}
                </Select.Trigger>
                <Select.Content>
                  {#each aggregations as agg}
                    <Select.Item value={agg.value}>{agg.label}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>

            <!-- Label key filter -->
            <div class="space-y-2">
              <span class="text-sm font-medium">Filter by label</span>
              <Select.Root
                type="single"
                value={selectedLabelKey || ""}
                onValueChange={(v) => {
                  if (v) handleLabelKeyChange(v);
                }}
              >
                <Select.Trigger class="w-full">
                  {selectedLabelKey || "Select label key"}
                </Select.Trigger>
                <Select.Content>
                  {#each storeState.labelKeys as key}
                    <Select.Item value={key}>{key}</Select.Item>
                  {/each}
                  {#if storeState.labelKeys.length === 0}
                    <div class="px-3 py-2 text-sm text-muted-foreground">
                      No labels available
                    </div>
                  {/if}
                </Select.Content>
              </Select.Root>
            </div>

            <!-- Label value filter -->
            <div class="space-y-2">
              <span class="text-sm font-medium">Label value</span>
              <div class="flex gap-2">
                <Select.Root
                  type="single"
                  value={selectedLabelValue || ""}
                  onValueChange={(v) => {
                    if (v) selectedLabelValue = v;
                  }}
                >
                  <Select.Trigger class="w-full">
                    {selectedLabelValue || "Select value"}
                  </Select.Trigger>
                  <Select.Content>
                    {#each storeState.labelValues[selectedLabelKey ?? ""] ?? [] as val}
                      <Select.Item value={val}>{val}</Select.Item>
                    {/each}
                    {#if !selectedLabelKey}
                      <div class="px-3 py-2 text-sm text-muted-foreground">
                        Select a label key first
                      </div>
                    {/if}
                  </Select.Content>
                </Select.Root>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={addLabelFilter}
                  disabled={!selectedLabelKey || !selectedLabelValue}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>

          <!-- Active label filters -->
          {#if Object.keys(storeState.activeLabels).length > 0}
            <div class="flex flex-wrap gap-2 mt-4">
              <Filter class="w-4 h-4 text-muted-foreground mt-1" />
              {#each Object.entries(storeState.activeLabels) as [key, value]}
                <Badge variant="secondary" class="flex items-center gap-1">
                  {key}={value}
                  <button
                    class="ml-1 hover:text-destructive"
                    onclick={() => removeLabelFilter(key)}
                  >
                    <X class="w-3 h-3" />
                  </button>
                </Badge>
              {/each}
            </div>
          {/if}
        </CardContent>
      </Card>
    {/if}

    <!-- Chart -->
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>
          {#if storeState.selectedMetric}
            {storeState.selectedMetric}
            <Badge variant="outline" class="ml-2 text-xs">
              {storeState.selectedAggregation} / {storeState.selectedInterval}
            </Badge>
          {:else}
            Time Series
          {/if}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {#if storeState.timeseriesLoading}
          <div class="flex items-center justify-center h-[350px]">
            <div
              class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
          </div>
        {:else if storeState.timeseriesError}
          <div
            class="flex items-center justify-center h-[350px] text-destructive"
          >
            <p>Error: {storeState.timeseriesError}</p>
          </div>
        {:else if !storeState.selectedMetric}
          <div
            class="flex flex-col items-center justify-center h-[350px] text-muted-foreground"
          >
            <BarChart3 class="w-12 h-12 mb-3 opacity-50" />
            <p>Select a metric to visualize</p>
          </div>
        {:else}
          <div bind:this={chartContainer} class="h-[350px] w-full"></div>
        {/if}
      </CardContent>
    </Card>

    <!-- Data table -->
    {#if storeState.selectedMetric}
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <CardTitle>
              {#if storeState.dataPoints}
                {storeState.dataPoints.total} data
                {storeState.dataPoints.total === 1 ? "point" : "points"}
              {:else}
                Data Points
              {/if}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {#if storeState.dataPointsLoading}
            <div class="flex items-center justify-center h-32">
              <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
            </div>
          {:else if storeState.dataPoints && storeState.dataPoints.metrics.length > 0}
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
                  {#each storeState.dataPoints.metrics as point}
                    <TableRow>
                      <TableCell class="font-mono text-xs">
                        {formatDateTime(point.time)}
                      </TableCell>
                      <TableCell class="font-mono text-sm font-medium">
                        {typeof point.value === "number"
                          ? point.value.toFixed(2)
                          : point.value}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{point.metricType}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{point.serviceName}</Badge>
                      </TableCell>
                      <TableCell
                        class="font-mono text-xs max-w-xs truncate"
                        title={point.attributes
                          ? JSON.stringify(point.attributes)
                          : ""}
                      >
                        {truncateJson(point.attributes)}
                      </TableCell>
                      <TableCell>
                        {#if point.hasExemplars && point.exemplars?.length}
                          {#each point.exemplars.filter((e) => e.traceId) as exemplar}
                            <button
                              class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              onclick={() => {
                                if (exemplar.traceId) goToTrace(exemplar.traceId);
                              }}
                            >
                              <ExternalLink class="w-3 h-3" />
                              Trace
                            </button>
                          {/each}
                          {#if !point.exemplars.some((e) => e.traceId)}
                            <span class="text-xs text-muted-foreground">-</span>
                          {/if}
                        {:else}
                          <span class="text-xs text-muted-foreground">-</span>
                        {/if}
                      </TableCell>
                    </TableRow>
                  {/each}
                </TableBody>
              </Table>
            </div>

            {#if storeState.dataPoints.hasMore}
              <div class="mt-4 text-center">
                <p class="text-sm text-muted-foreground">
                  Showing {storeState.dataPoints.metrics.length} of {storeState
                    .dataPoints.total} data points
                </p>
              </div>
            {/if}
          {:else}
            <div
              class="flex flex-col items-center justify-center h-32 text-muted-foreground"
            >
              <Activity class="w-8 h-8 mb-2 opacity-50" />
              <p>No data points found for the selected metric and time range</p>
            </div>
          {/if}
        </CardContent>
      </Card>
    {/if}
  {/if}
</div>
